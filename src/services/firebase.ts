import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  CharacterId,
  CharacterState,
  FriendRecord,
  GameSettings,
  GameStats,
  InventoryState,
  MissionProgressRecord,
  SavedGarageState,
  StoredVehicleRecord,
} from '../types/game';
import {
  DEFAULT_CHARACTERS,
  DEFAULT_INVENTORY,
  DEFAULT_MISSIONS,
  DEFAULT_SETTINGS,
  DEFAULT_STATS,
} from '../data/defaults';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Firebase configuration offline or unreachable.');
      return false;
    }
    return true;
  }
}

export function subscribeToAuth(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, callback);
}

export async function signInWithGoogle(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}

export function computeFriendCode(uid: string): string {
  return `VH-${uid.slice(0, 6).toUpperCase()}`;
}

export async function ensurePublicUserCard(user: User): Promise<void> {
  const uid = user.uid;
  const displayName = (user.displayName || user.email?.split('@')[0] || 'Hráč').slice(0, 80);
  const friendCode = computeFriendCode(uid);
  const emailLower = (user.email || '').trim().toLowerCase().slice(0, 160);
  try {
    await setDoc(doc(db, 'publicUsers', uid), {
      uid,
      displayName,
      emailLower,
      friendCode,
      updatedAt: serverTimestamp(),
    });
  } catch {
    // non-fatal if unverified
  }
}

export async function fetchFriends(user: User): Promise<FriendRecord[]> {
  try {
    const snap = await getDocs(collection(db, 'users', user.uid, 'friends'));
    const list: FriendRecord[] = [];
    snap.forEach((d) => {
      const data = d.data();
      list.push({
        uid: String(data.uid || d.id),
        displayName: String(data.displayName || 'Hráč'),
        email: typeof data.email === 'string' ? data.email : undefined,
        friendCode: String(data.friendCode || computeFriendCode(d.id)),
        addedAt: String(data.addedAt || new Date().toISOString()),
      });
    });
    return list;
  } catch {
    return [];
  }
}

export async function addFriendByQuery(user: User, inputQuery: string): Promise<FriendRecord> {
  const clean = inputQuery.trim();
  if (!clean) {
    throw new Error('Zadaj e-mail alebo kód priateľa (napr. VH-XXXXXX).');
  }
  const upper = clean.toUpperCase();
  const lower = clean.toLowerCase();

  let foundDoc: Record<string, unknown> | null = null;
  const col = collection(db, 'publicUsers');

  if (upper.startsWith('VH-')) {
    const q = query(col, where('friendCode', '==', upper), limit(1));
    const snap = await getDocs(q);
    if (!snap.empty) foundDoc = snap.docs[0].data();
  } else if (lower.includes('@')) {
    const q = query(col, where('emailLower', '==', lower), limit(1));
    const snap = await getDocs(q);
    if (!snap.empty) foundDoc = snap.docs[0].data();
  } else {
    const byUid = await getDoc(doc(db, 'publicUsers', clean));
    if (byUid.exists()) foundDoc = byUid.data();
  }

  if (!foundDoc) {
    throw new Error('Hráč sa nenašiel. Musí sa aspoň raz prihlásiť do Vice Horizon.');
  }

  const friendUid = String(foundDoc.uid);
  if (friendUid === user.uid) {
    throw new Error('Nemôžeš pridať sám seba do priateľov.');
  }

  const record: FriendRecord = {
    uid: friendUid,
    displayName: String(foundDoc.displayName || 'Kamarát'),
    email: typeof foundDoc.emailLower === 'string' ? foundDoc.emailLower : undefined,
    friendCode: String(foundDoc.friendCode || computeFriendCode(friendUid)),
    addedAt: new Date().toISOString(),
  };

  await setDoc(doc(db, 'users', user.uid, 'friends', friendUid), {
    uid: record.uid,
    ownerId: user.uid,
    displayName: record.displayName,
    email: record.email || '',
    friendCode: record.friendCode,
    addedAt: record.addedAt,
  });

  return record;
}

export async function removeFriend(user: User, friendUid: string): Promise<void> {
  await deleteDoc(doc(db, 'users', user.uid, 'friends', friendUid));
}

export interface CloudSavePayload {
  activeCharacterId: CharacterId;
  cash: number;
  stats: GameStats;
  characters: Record<CharacterId, CharacterState>;
  inventory: InventoryState;
  settings: GameSettings;
  missions: Record<string, MissionProgressRecord>;
  garage?: SavedGarageState;
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

export async function saveGameToCloud(user: User, payload: CloudSavePayload): Promise<void> {
  const uid = user.uid;
  const userPath = `users/${uid}`;
  const batch = writeBatch(db);

  try {
    const userRef = doc(db, 'users', uid);
    const existingUserSnap = await getDoc(userRef);

    const displayName = (user.displayName || user.email?.split('@')[0] || 'Hráč').slice(0, 80);
    const baseProfile: Record<string, unknown> = {
      uid,
      displayName,
      activeCharacterId: payload.activeCharacterId,
      cash: clamp(Math.round(payload.cash), 0, 999999999),
      totalEliminations: clamp(Math.round(payload.stats.totalEliminations), 0, 1000000),
      policeEscapes: clamp(Math.round(payload.stats.policeEscapes), 0, 1000000),
      stuntJumps: clamp(Math.round(payload.stats.stuntJumps), 0, 1000000),
      shootingRangeScore: clamp(Math.round(payload.stats.shootingRangeScore || 0), 0, 10000000),
      updatedAt: serverTimestamp(),
    };

    if (!existingUserSnap.exists()) {
      baseProfile.createdAt = serverTimestamp();
      batch.set(userRef, baseProfile);
    } else {
      batch.update(userRef, {
        displayName: baseProfile.displayName,
        activeCharacterId: baseProfile.activeCharacterId,
        cash: baseProfile.cash,
        totalEliminations: baseProfile.totalEliminations,
        policeEscapes: baseProfile.policeEscapes,
        stuntJumps: baseProfile.stuntJumps,
        shootingRangeScore: baseProfile.shootingRangeScore,
        updatedAt: serverTimestamp(),
      });
    }

    const charIds: CharacterId[] = ['lucia', 'mateo', 'kairo'];
    for (const cid of charIds) {
      const ch = payload.characters[cid] || DEFAULT_CHARACTERS[cid];
      const charRef = doc(db, 'users', uid, 'characters', cid);
      batch.set(charRef, {
        id: cid,
        ownerId: uid,
        cash: clamp(Math.round(ch.cash ?? DEFAULT_CHARACTERS[cid].cash), 0, 999999999),
        skills: {
          driving: clamp(Math.round(ch.skills?.driving ?? 50), 0, 100),
          shooting: clamp(Math.round(ch.skills?.shooting ?? 50), 0, 100),
          flying: clamp(Math.round(ch.skills?.flying ?? 50), 0, 100),
          stamina: clamp(Math.round(ch.skills?.stamina ?? 50), 0, 100),
        },
        health: clamp(ch.health, 0, 200),
        armor: clamp(ch.armor, 0, 200),
        posX: clamp(ch.posX, -2400, 2400),
        posY: clamp(ch.posY, -60, 1100),
        posZ: clamp(ch.posZ, -2400, 2400),
        heading: Number.isFinite(ch.heading) ? ch.heading : 0,
        appearance: { ...ch.appearance },
        customOutfits: (ch.customOutfits || []).slice(0, 12),
        updatedAt: serverTimestamp(),
      });
    }

    const invRef = doc(db, 'users', uid, 'inventory', 'loadout');
    batch.set(invRef, {
      ownerId: uid,
      equippedWeapon: payload.inventory.equippedWeapon,
      hasParachute: Boolean(payload.inventory.hasParachute),
      weapons: payload.inventory.weapons.slice(0, 16),
      consumables: payload.inventory.consumables.slice(0, 24),
      contraband: payload.inventory.contraband.slice(0, 32),
      updatedAt: serverTimestamp(),
    });

    const settingsRef = doc(db, 'users', uid, 'settings', 'preferences');
    batch.set(settingsRef, {
      ownerId: uid,
      graphics: { ...payload.settings.graphics },
      audio: { ...payload.settings.audio },
      controls: { ...payload.settings.controls },
      hudMod: { ...payload.settings.hudMod },
      gameplayMods: { ...payload.settings.gameplayMods },
      updatedAt: serverTimestamp(),
    });

    for (const [mid, mrec] of Object.entries(payload.missions)) {
      const mRef = doc(db, 'users', uid, 'missions', mid);
      batch.set(mRef, {
        id: mid,
        ownerId: uid,
        status: mrec.status,
        completedCount: clamp(mrec.completedCount, 0, 10000),
        bestTimeSec: clamp(mrec.bestTimeSec, 0, 86400),
        updatedAt: serverTimestamp(),
      });
    }

    const sanitizeStored = (list: StoredVehicleRecord[] | undefined) =>
      (list || []).slice(0, 6).map((v) => ({
        id: String(v.id || 'veh').slice(0, 64),
        brand: String(v.brand || 'Valkyra').slice(0, 48),
        name: String(v.name || 'Vehicle').slice(0, 48),
        kind: String(v.kind || 'sedan').slice(0, 24),
        color: String(v.color || '#38bdf8').slice(0, 16),
        x: clamp(Number(v.x) || 0, -2400, 2400),
        z: clamp(Number(v.z) || 0, -2400, 2400),
        heading: Number.isFinite(v.heading) ? v.heading : 0,
        upgrades: v.upgrades || { engineLevel: 0, turbo: false, armorLevel: 0, suspensionLevel: 0 },
      }));

    const garageRef = doc(db, 'users', uid, 'garage', 'stored');
    batch.set(garageRef, {
      ownerId: uid,
      hangarVehicles: sanitizeStored(payload.garage?.hangarVehicles),
      safehouseVehicles: sanitizeStored(payload.garage?.safehouseVehicles),
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
    await ensurePublicUserCard(user);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }
}

export async function loadGameFromCloud(user: User): Promise<CloudSavePayload | null> {
  const uid = user.uid;
  const userPath = `users/${uid}`;

  try {
    await ensurePublicUserCard(user);
    const userRef = doc(db, 'users', uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      return null;
    }

    const userData = userSnap.data();

    const characters: Record<CharacterId, CharacterState> = {
      lucia: structuredClone(DEFAULT_CHARACTERS.lucia),
      mateo: structuredClone(DEFAULT_CHARACTERS.mateo),
      kairo: structuredClone(DEFAULT_CHARACTERS.kairo),
    };

    const charSnap = await getDocs(collection(db, 'users', uid, 'characters'));
    charSnap.forEach((docSnap) => {
      const d = docSnap.data();
      const cid = d.id as CharacterId;
      if (cid === 'lucia' || cid === 'mateo' || cid === 'kairo') {
        characters[cid] = {
          ...DEFAULT_CHARACTERS[cid],
          cash: typeof d.cash === 'number' ? d.cash : DEFAULT_CHARACTERS[cid].cash,
          skills: d.skills ? { ...DEFAULT_CHARACTERS[cid].skills, ...d.skills } : DEFAULT_CHARACTERS[cid].skills,
          health: typeof d.health === 'number' ? d.health : DEFAULT_CHARACTERS[cid].health,
          armor: typeof d.armor === 'number' ? d.armor : DEFAULT_CHARACTERS[cid].armor,
          posX: typeof d.posX === 'number' ? d.posX : DEFAULT_CHARACTERS[cid].posX,
          posY: typeof d.posY === 'number' ? d.posY : DEFAULT_CHARACTERS[cid].posY,
          posZ: typeof d.posZ === 'number' ? d.posZ : DEFAULT_CHARACTERS[cid].posZ,
          heading: typeof d.heading === 'number' ? d.heading : DEFAULT_CHARACTERS[cid].heading,
          appearance: d.appearance ? { ...DEFAULT_CHARACTERS[cid].appearance, ...d.appearance } : DEFAULT_CHARACTERS[cid].appearance,
          customOutfits: Array.isArray(d.customOutfits) ? d.customOutfits : DEFAULT_CHARACTERS[cid].customOutfits,
        };
      }
    });

    let inventory: InventoryState = structuredClone(DEFAULT_INVENTORY);
    const invSnap = await getDoc(doc(db, 'users', uid, 'inventory', 'loadout'));
    if (invSnap.exists()) {
      const idata = invSnap.data();
      const savedWeapons = Array.isArray(idata.weapons) ? idata.weapons : [];
      const mergedWeapons = DEFAULT_INVENTORY.weapons.map((defW) => {
        const match = savedWeapons.find((sw: { id?: string }) => sw.id === defW.id);
        return match ? { ...defW, ...match } : defW;
      });
      inventory = {
        equippedWeapon: idata.equippedWeapon || DEFAULT_INVENTORY.equippedWeapon,
        hasParachute: Boolean(idata.hasParachute),
        weapons: mergedWeapons,
        consumables: Array.isArray(idata.consumables) ? idata.consumables : DEFAULT_INVENTORY.consumables,
        contraband: Array.isArray(idata.contraband) ? idata.contraband : DEFAULT_INVENTORY.contraband,
      };
    }

    let settings: GameSettings = structuredClone(DEFAULT_SETTINGS);
    const settingsSnap = await getDoc(doc(db, 'users', uid, 'settings', 'preferences'));
    if (settingsSnap.exists()) {
      const sdata = settingsSnap.data();
      settings = {
        graphics: { ...DEFAULT_SETTINGS.graphics, ...(sdata.graphics || {}) },
        audio: { ...DEFAULT_SETTINGS.audio, ...(sdata.audio || {}) },
        controls: {
          ...DEFAULT_SETTINGS.controls,
          ...(sdata.controls || {}),
          keyBindings: {
            ...DEFAULT_SETTINGS.controls.keyBindings,
            ...(sdata.controls?.keyBindings || {}),
          },
          gamepadBindings: {
            ...DEFAULT_SETTINGS.controls.gamepadBindings,
            ...(sdata.controls?.gamepadBindings || {}),
          },
          vehicleOverrides: {
            ...(sdata.controls?.vehicleOverrides || {}),
          },
        },
        hudMod: { ...DEFAULT_SETTINGS.hudMod, ...(sdata.hudMod || {}) },
        gameplayMods: { ...DEFAULT_SETTINGS.gameplayMods, ...(sdata.gameplayMods || {}) },
      };
    }

    const missions: Record<string, MissionProgressRecord> = structuredClone(DEFAULT_MISSIONS);
    const missionsSnap = await getDocs(collection(db, 'users', uid, 'missions'));
    missionsSnap.forEach((docSnap) => {
      const m = docSnap.data();
      if (m.id) {
        missions[m.id] = {
          id: m.id,
          status: m.status || 'available',
          completedCount: typeof m.completedCount === 'number' ? m.completedCount : 0,
          bestTimeSec: typeof m.bestTimeSec === 'number' ? m.bestTimeSec : 0,
        };
      }
    });

    let garage: SavedGarageState = { hangarVehicles: [], safehouseVehicles: [] };
    try {
      const garageSnap = await getDoc(doc(db, 'users', uid, 'garage', 'stored'));
      if (garageSnap.exists()) {
        const gdata = garageSnap.data();
        garage = {
          hangarVehicles: Array.isArray(gdata.hangarVehicles) ? gdata.hangarVehicles : [],
          safehouseVehicles: Array.isArray(gdata.safehouseVehicles) ? gdata.safehouseVehicles : [],
        };
      }
    } catch {
      garage = { hangarVehicles: [], safehouseVehicles: [] };
    }

    const activeCharacterId: CharacterId =
      userData.activeCharacterId === 'mateo' || userData.activeCharacterId === 'kairo'
        ? userData.activeCharacterId
        : 'lucia';

    return {
      activeCharacterId,
      cash: typeof userData.cash === 'number' ? userData.cash : characters[activeCharacterId].cash,
      stats: {
        totalEliminations: typeof userData.totalEliminations === 'number' ? userData.totalEliminations : 0,
        policeEscapes: typeof userData.policeEscapes === 'number' ? userData.policeEscapes : 0,
        stuntJumps: typeof userData.stuntJumps === 'number' ? userData.stuntJumps : 0,
        shootingRangeScore: typeof userData.shootingRangeScore === 'number' ? userData.shootingRangeScore : 0,
      },
      characters,
      inventory,
      settings,
      missions,
      garage,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, userPath);
  }
}

export async function resetCloudProgress(user: User): Promise<void> {
  const uid = user.uid;
  const defaults: CloudSavePayload = {
    activeCharacterId: 'lucia',
    cash: DEFAULT_CHARACTERS.lucia.cash,
    stats: { ...DEFAULT_STATS },
    characters: structuredClone(DEFAULT_CHARACTERS),
    inventory: structuredClone(DEFAULT_INVENTORY),
    settings: structuredClone(DEFAULT_SETTINGS),
    missions: structuredClone(DEFAULT_MISSIONS),
    garage: { hangarVehicles: [], safehouseVehicles: [] },
  };
  await saveGameToCloud(user, defaults);
}
