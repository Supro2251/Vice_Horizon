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
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  CharacterId,
  CharacterState,
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
    // Permission denied on nonexistent test/connection still confirms server reachability
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
        health: clamp(ch.health, 0, 200),
        armor: clamp(ch.armor, 0, 200),
        posX: clamp(ch.posX, -900, 900),
        posY: clamp(ch.posY, -40, 400),
        posZ: clamp(ch.posZ, -900, 900),
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
        x: clamp(Number(v.x) || 0, -900, 900),
        z: clamp(Number(v.z) || 0, -900, 900),
        heading: Number.isFinite(v.heading) ? v.heading : 0,
      }));

    const garageRef = doc(db, 'users', uid, 'garage', 'stored');
    batch.set(garageRef, {
      ownerId: uid,
      hangarVehicles: sanitizeStored(payload.garage?.hangarVehicles),
      safehouseVehicles: sanitizeStored(payload.garage?.safehouseVehicles),
      updatedAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }
}

export async function loadGameFromCloud(user: User): Promise<CloudSavePayload | null> {
  const uid = user.uid;
  const userPath = `users/${uid}`;

  try {
    const userRef = doc(db, 'users', uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      return null;
    }

    const userData = userSnap.data();

    // Load characters
    const characters: Record<CharacterId, CharacterState> = {
      lucia: { ...DEFAULT_CHARACTERS.lucia },
      mateo: { ...DEFAULT_CHARACTERS.mateo },
      kairo: { ...DEFAULT_CHARACTERS.kairo },
    };

    const charSnap = await getDocs(collection(db, 'users', uid, 'characters'));
    charSnap.forEach((docSnap) => {
      const d = docSnap.data();
      const cid = d.id as CharacterId;
      if (cid === 'lucia' || cid === 'mateo' || cid === 'kairo') {
        characters[cid] = {
          ...DEFAULT_CHARACTERS[cid],
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

    // Load inventory
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
        weapons: mergedWeapons,
        consumables: Array.isArray(idata.consumables) ? idata.consumables : DEFAULT_INVENTORY.consumables,
        contraband: Array.isArray(idata.contraband) ? idata.contraband : DEFAULT_INVENTORY.contraband,
      };
    }

    // Load settings
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
        },
        hudMod: { ...DEFAULT_SETTINGS.hudMod, ...(sdata.hudMod || {}) },
        gameplayMods: { ...DEFAULT_SETTINGS.gameplayMods, ...(sdata.gameplayMods || {}) },
      };
    }

    // Load missions
    const missions: Record<string, MissionProgressRecord> = structuredClone(DEFAULT_MISSIONS);
    const missionsSnap = await getDocs(collection(db, 'users', uid, 'missions'));
    missionsSnap.forEach((docSnap) => {
      const m = docSnap.data();
      if (m.id && missions[m.id]) {
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
      cash: typeof userData.cash === 'number' ? userData.cash : 2500,
      stats: {
        totalEliminations: typeof userData.totalEliminations === 'number' ? userData.totalEliminations : 0,
        policeEscapes: typeof userData.policeEscapes === 'number' ? userData.policeEscapes : 0,
        stuntJumps: typeof userData.stuntJumps === 'number' ? userData.stuntJumps : 0,
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
