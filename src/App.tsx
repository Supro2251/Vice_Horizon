import React, { useCallback, useEffect, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import {
  DEFAULT_CHARACTERS,
  DEFAULT_INVENTORY,
  DEFAULT_MISSIONS,
  DEFAULT_SAVED_GARAGE,
  DEFAULT_SETTINGS,
  DEFAULT_STATS,
  WEAPON_CATALOG,
} from './data/defaults';
import {
  CharacterAppearance,
  CharacterId,
  CharacterState,
  FriendRecord,
  GameSettings,
  GameStats,
  HudTelemetry,
  InventoryState,
  MissionInvite,
  MissionProgressRecord,
  OnlinePlayerInfo,
  RemotePlayerState,
  SavedGarageState,
  WeaponId,
} from './types/game';
import { ViceEngine } from './engine/ViceEngine';
import { ROAD_SEGMENTS } from './engine/navigation';
import {
  addFriendByQuery,
  computeFriendCode,
  ensurePublicUserCard,
  fetchFriends,
  loadGameFromCloud,
  removeFriend,
  saveGameToCloud,
  signInWithGoogle,
  signOutUser,
  subscribeToAuth,
  testFirestoreConnection,
  updatePlayerNickname,
} from './services/firebase';
import { isRtlLanguage, t } from './i18n/translations';
import { ErrorBoundary } from './components/ErrorBoundary';
import { GameHUD } from './components/GameHUD';
import { CharacterWheel } from './components/CharacterWheel';
import { InventoryModal } from './components/InventoryModal';
import { WardrobeModal } from './components/WardrobeModal';
import { MissionsModal } from './components/MissionsModal';
import { MapModal } from './components/MapModal';
import { SettingsAndModsModal } from './components/SettingsAndModsModal';
import { CutsceneOverlay } from './components/CutsceneOverlay';
import { PhoneOverlay } from './components/PhoneOverlay';
import { TaxiModal } from './components/TaxiModal';
import { TuningGarageModal } from './components/TuningGarageModal';

type ActiveModal =
  | 'none'
  | 'character'
  | 'inventory'
  | 'wardrobe'
  | 'missions'
  | 'map'
  | 'garage'
  | 'taxi'
  | 'settings';

const INITIAL_TELEMETRY: HudTelemetry = {
  fps: 60,
  health: 100,
  maxHealth: 100,
  armor: 50,
  maxArmor: 100,
  stamina: 100,
  cash: 450,
  skills: { driving: 55, shooting: 50, flying: 45, stamina: 55 },
  wantedStars: 0,
  wantedEvading: false,
  evasionProgress: 0,
  policeDispatchTimer: 0,
  policeDispatchReason: null,
  autoAimLocked: false,
  inVehicle: false,
  vehicleKind: null,
  vehicleBrand: '',
  vehicleName: '',
  vehicleHealthPct: 100,
  vehicleBurning: false,
  nearbyRepairCost: 0,
  nearbyTuningAvailable: false,
  speedKmh: 0,
  altitudeM: 0,
  inWater: false,
  handbrake: false,
  isDrifting: false,
  taxiMode: 'none',
  taxiFareCash: 0,
  taxiDestinationLabel: null,
  taxiTripDistM: 0,
  taxiPickupLabel: null,
  courierStatus: null,
  hangarCount: 0,
  garageCount: 0,
  parkedFacilityNotice: null,
  hasParachute: false,
  parachuteDeployed: false,
  godModeActive: false,
  cheatSessionActive: false,
  gameClockStr: '17:16',
  gameTimeNormalized: 0.72,
  cloudCoverage: 0.42,
  weatherType: 'clear',
  weatherLabel: 'Clear Sky',
  rainIntensity: 0,
  ambientTempC: 26,
  radioStation: 'off',
  radioStationName: 'Radio Off',
  radioGenre: 'Mute',
  radioTrack: '---',
  nearestNpcDialogue: null,
  controlCategory: 'foot',
  equippedWeapon: 'pistol',
  ammoInClip: 15,
  reserveAmmo: 90,
  isReloading: false,
  isAiming: false,
  cameraMode: 'third_person',
  district: 'Coral Strip',
  nearbyPrompt: null,
  activeSidePrompt: null,
  activeMissionTitle: null,
  activeObjectiveLabel: null,
  missionTimerRemaining: null,
  missionNotification: null,
  activeCutscene: null,
  remotePlayersCount: 0,
  controllerConnected: false,
  controllerType: 'none',
  controllerName: '',
  hitMarkerActive: false,
  damageFlashActive: false,
  stuntMessage: null,
  playerX: 465,
  playerZ: -110,
  playerHeading: -Math.PI / 2,
  minimapBlips: [],
  gpsWaypoint: null,
  gpsRoute: [],
  gpsDistanceM: 0,
  pointerLocked: false,
  isWasted: false,
  wastedReason: null,
  isBusted: false,
};

const LOCAL_SAVE_KEY = 'vice_horizon_local_save_v1';

function ViceHorizonApp() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<ViceEngine | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const shopNoticeTimerRef = useRef<number | null>(null);

  const [initialLocal] = useState(() => {
    try {
      const raw = localStorage.getItem(LOCAL_SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const [characters, setCharacters] = useState<Record<CharacterId, CharacterState>>(() => {
    const base = structuredClone(DEFAULT_CHARACTERS);
    if (!initialLocal?.characters) return base;
    for (const cid of ['lucia', 'mateo', 'kairo'] as CharacterId[]) {
      const savedChar = initialLocal.characters[cid];
      if (savedChar) {
        base[cid] = {
          ...base[cid],
          ...savedChar,
          appearance: {
            ...base[cid].appearance,
            ...savedChar.appearance,
          },
        };
      }
    }
    return base;
  });
  const [activeCharacterId, setActiveCharacterId] = useState<CharacterId>(
    initialLocal?.activeCharacterId || 'lucia'
  );
  const [inventory, setInventory] = useState<InventoryState>(() =>
    initialLocal?.inventory ? initialLocal.inventory : structuredClone(DEFAULT_INVENTORY)
  );
  const [cash, setCash] = useState<number>(typeof initialLocal?.cash === 'number' ? initialLocal.cash : 450);
  const [stats, setStats] = useState<GameStats>(() =>
    initialLocal?.stats ? initialLocal.stats : { ...DEFAULT_STATS }
  );
  const [settings, setSettings] = useState<GameSettings>(() => {
    if (!initialLocal?.settings) return structuredClone(DEFAULT_SETTINGS);
    const saved = initialLocal.settings;
    // Language ALWAYS boots in English locally; only Cloud Save persists a non-English language.
    return {
      language: 'en',
      graphics: { ...DEFAULT_SETTINGS.graphics, ...(saved.graphics || {}) },
      audio: { ...DEFAULT_SETTINGS.audio, ...(saved.audio || {}) },
      controls: {
        ...DEFAULT_SETTINGS.controls,
        ...(saved.controls || {}),
        keyBindings: {
          ...DEFAULT_SETTINGS.controls.keyBindings,
          ...(saved.controls?.keyBindings || {}),
        },
        gamepadBindings: {
          ...DEFAULT_SETTINGS.controls.gamepadBindings,
          ...(saved.controls?.gamepadBindings || {}),
        },
        vehicleOverrides: {
          ...DEFAULT_SETTINGS.controls.vehicleOverrides,
          ...(saved.controls?.vehicleOverrides || {}),
        },
      },
      hudMod: { ...DEFAULT_SETTINGS.hudMod, ...(saved.hudMod || {}) },
      gameplayMods: { ...DEFAULT_SETTINGS.gameplayMods, ...(saved.gameplayMods || {}) },
    };
  });
  const [missionsProgress, setMissionsProgress] = useState<Record<string, MissionProgressRecord>>(() => ({
    ...structuredClone(DEFAULT_MISSIONS),
    ...(initialLocal?.missions || {}),
  }));
  const [savedGarage, setSavedGarage] = useState<SavedGarageState>(() =>
    initialLocal?.savedGarage ? initialLocal.savedGarage : structuredClone(DEFAULT_SAVED_GARAGE)
  );
  const [discoveredSideIds, setDiscoveredSideIds] = useState<string[]>(() =>
    Array.isArray(initialLocal?.discoveredSideIds) ? initialLocal.discoveredSideIds : []
  );

  const [activeMissionId, setActiveMissionId] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<HudTelemetry>(INITIAL_TELEMETRY);

  const [activeModal, setActiveModal] = useState<ActiveModal>('none');
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [wardrobeMode, setWardrobeMode] = useState<'wardrobe' | 'barber' | 'tattoo' | 'safehouse'>('wardrobe');
  const [settingsInitialTab, setSettingsInitialTab] = useState<'language' | 'graphics' | 'audio' | 'controls' | 'mods' | 'cloud'>('graphics');
  const [inventoryTab, setInventoryTab] = useState<'weapons' | 'gear' | 'loot'>('weapons');
  const [dockOpen, setDockOpen] = useState(false);
  const [shopNotice, setShopNotice] = useState<string | null>(null);

  const [user, setUser] = useState<User | null>(null);
  const [playerNickname, setPlayerNickname] = useState<string>('');
  const [cloudStatus, setCloudStatus] = useState<string | null>(null);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [friends, setFriends] = useState<FriendRecord[]>([]);
  const [onlineUids, setOnlineUids] = useState<string[]>([]);
  const [onlinePlayers, setOnlinePlayers] = useState<OnlinePlayerInfo[]>([]);
  const [remotePlayers, setRemotePlayers] = useState<RemotePlayerState[]>([]);
  const [incomingInvite, setIncomingInvite] = useState<MissionInvite | null>(null);

  const showNotice = useCallback((msg: string) => {
    setShopNotice(msg);
    if (shopNoticeTimerRef.current) window.clearTimeout(shopNoticeTimerRef.current);
    shopNoticeTimerRef.current = window.setTimeout(() => setShopNotice(null), 4600);
  }, []);

  // Refs for latest state inside autosave / callbacks / WebSocket ticks
  const stateRef = useRef({
    characters,
    activeCharacterId,
    inventory,
    cash,
    stats,
    settings,
    missionsProgress,
    savedGarage,
    discoveredSideIds,
    activeMissionId,
    telemetry,
    friends,
    playerNickname,
  });
  stateRef.current = {
    characters,
    activeCharacterId,
    inventory,
    cash,
    stats,
    settings,
    missionsProgress,
    savedGarage,
    discoveredSideIds,
    activeMissionId,
    telemetry,
    friends,
    playerNickname,
  };

  // Validate Firestore connection & subscribe to Auth
  useEffect(() => {
    testFirestoreConnection().catch(() => {});
    const unsub = subscribeToAuth(async (u) => {
      setUser(u);
      if (u) {
        setCloudBusy(true);
        try {
          const [loaded, friendList, resolvedNick] = await Promise.all([
            loadGameFromCloud(u),
            fetchFriends(u),
            ensurePublicUserCard(u),
          ]);
          setFriends(friendList);
          setPlayerNickname(resolvedNick || u.displayName || u.email?.split('@')[0] || 'Hráč');
          if (wsRef.current?.readyState === WebSocket.OPEN && resolvedNick) {
            wsRef.current.send(JSON.stringify({ type: 'update_profile', displayName: resolvedNick }));
          }
          if (loaded) {
            setCharacters(loaded.characters);
            setActiveCharacterId(loaded.activeCharacterId);
            setInventory(loaded.inventory);
            setCash(loaded.cash);
            setStats(loaded.stats);
            setSettings(loaded.settings);
            setMissionsProgress(loaded.missions);
            if (loaded.garage) setSavedGarage(loaded.garage);

            if (engineRef.current) {
              engineRef.current.updateCharactersExternal(loaded.characters, loaded.activeCharacterId);
              engineRef.current.updateInventoryExternal(loaded.inventory, loaded.cash);
              engineRef.current.applySettings(loaded.settings);
              if (loaded.garage) engineRef.current.setSavedGarage(loaded.garage);
            }
            setCloudStatus(t(loaded.settings.language, 'app.cloudRestored'));
          } else {
            setCloudStatus(t(stateRef.current.settings.language, 'app.signedInReady'));
          }
        } catch (err) {
          setCloudStatus(err instanceof Error ? err.message : t(stateRef.current.settings.language, 'app.cloudLoadError'));
        } finally {
          setCloudBusy(false);
        }
      } else {
        setPlayerNickname('');
        setFriends([]);
        setOnlineUids([]);
        setOnlinePlayers([]);
        setRemotePlayers([]);
        engineRef.current?.updateRemotePlayers([]);
        setCloudStatus(null);
      }
    });
    return () => unsub();
  }, []);

  // Live Multiplayer Friends & Co-op WebSocket (/ws)
  useEffect(() => {
    if (!user) return;
    let closedByEffect = false;
    let reconnectTimer: number | null = null;
    let syncTimer: number | null = null;
    let pingTimer: number | null = null;

    const connect = () => {
      if (closedByEffect) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        const myName =
          stateRef.current.playerNickname || user.displayName || user.email?.split('@')[0] || 'Hráč';
        ws.send(
          JSON.stringify({
            type: 'hello',
            uid: user.uid,
            displayName: myName,
            friends: stateRef.current.friends.map((f) => f.uid),
          })
        );

        syncTimer = window.setInterval(() => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const s = stateRef.current;
          const t = s.telemetry;
          const ch = s.characters[s.activeCharacterId];
          const myLiveName =
            s.playerNickname || user.displayName || user.email?.split('@')[0] || 'Hráč';
          const playerPayload: RemotePlayerState = {
            uid: user.uid,
            displayName: myLiveName,
            characterId: s.activeCharacterId,
            x: t.playerX,
            y: t.inVehicle ? t.altitudeM : 0,
            z: t.playerZ,
            heading: t.playerHeading,
            vehicleKind: t.inVehicle ? t.vehicleKind : null,
            vehicleColor: '#38bdf8',
            health: t.health,
            activeMissionId: s.activeMissionId,
            appearance: ch.appearance,
            updatedAt: Date.now(),
          };
          ws.send(JSON.stringify({ type: 'player_state', player: playerPayload }));
        }, 120);

        pingTimer = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 20000);
      };

      ws.onmessage = (evt) => {
        try {
          const data = JSON.parse(String(evt.data));
          if (data.type === 'presence' && Array.isArray(data.onlineUids)) {
            setOnlineUids(data.onlineUids);
            if (Array.isArray(data.onlinePlayers)) {
              setOnlinePlayers(data.onlinePlayers as OnlinePlayerInfo[]);
            }
            setRemotePlayers((prev) => {
              const onlineSet = new Set<string>(data.onlineUids);
              const next = prev.filter((p) => onlineSet.has(p.uid));
              engineRef.current?.updateRemotePlayers(next);
              return next;
            });
          } else if (data.type === 'player_state' && data.player?.uid) {
            const rp = data.player as RemotePlayerState;
            setRemotePlayers((prev) => {
              const idx = prev.findIndex((x) => x.uid === rp.uid);
              const next = idx >= 0 ? prev.map((x, i) => (i === idx ? rp : x)) : [...prev, rp];
              engineRef.current?.updateRemotePlayers(next);
              return next;
            });
          } else if (data.type === 'mission_invite' && data.missionId) {
            setIncomingInvite(data as MissionInvite);
          } else if (data.type === 'mission_accept') {
            showNotice(t(stateRef.current.settings.language, 'app.friendAccepted', { name: data.byName || 'Friend' }));
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (syncTimer) window.clearInterval(syncTimer);
        if (pingTimer) window.clearInterval(pingTimer);
        if (!closedByEffect) {
          reconnectTimer = window.setTimeout(connect, 3500);
        }
      };
    };

    connect();
    return () => {
      closedByEffect = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (syncTimer) window.clearInterval(syncTimer);
      if (pingTimer) window.clearInterval(pingTimer);
      try {
        wsRef.current?.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    };
  }, [user, showNotice]);

  // Keep WebSocket friend filter synchronized when friends list updates
  useEffect(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'update_friends', friends: friends.map((f) => f.uid) }));
    }
  }, [friends]);

  // Mount Three.js Engine once
  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    const engine = new ViceEngine(
      container,
      stateRef.current.characters,
      stateRef.current.activeCharacterId,
      stateRef.current.inventory,
      stateRef.current.cash,
      stateRef.current.stats,
      stateRef.current.settings,
      {
        onTelemetry: (t) => setTelemetry(t),
        onInventoryChange: (inv) => setInventory(inv),
        onCashChange: (c) => setCash(c),
        onCharactersChange: (chars, activeId) => {
          setCharacters(chars);
          setActiveCharacterId(activeId);
        },
        onStatsChange: (s) => setStats(s),
        onGarageChange: (g) => setSavedGarage(g),
        onSideMissionDiscovered: (m) => {
          setDiscoveredSideIds((prev) => (prev.includes(m.id) ? prev : [...prev, m.id]));
        },
        onTaxiMenuRequested: () => {
          setPhoneOpen(false);
          setActiveModal('taxi');
        },
        onMissionComplete: (missionId, elapsedSec) => {
          setActiveMissionId(null);
          setMissionsProgress((prev) => {
            const cur = prev[missionId] || {
              id: missionId,
              status: 'completed',
              completedCount: 0,
              bestTimeSec: 0,
            };
            const best = cur.bestTimeSec === 0 ? elapsedSec : Math.min(cur.bestTimeSec, elapsedSec);
            return {
              ...prev,
              [missionId]: {
                id: missionId,
                status: 'completed',
                completedCount: cur.completedCount + 1,
                bestTimeSec: best,
              },
            };
          });
        },
        onMissionFailed: () => {
          setActiveMissionId(null);
        },
        onShopInteract: (shop) => {
          setPhoneOpen(false);
          if (shop.category === 'weapons') {
            setInventoryTab('weapons');
            setActiveModal('inventory');
          } else if (shop.category === 'supplies') {
            setInventoryTab('gear');
            setActiveModal('inventory');
          } else if (shop.category === 'wardrobe') {
            setWardrobeMode('wardrobe');
            setActiveModal('wardrobe');
          } else if (shop.category === 'barber') {
            setWardrobeMode('barber');
            setActiveModal('wardrobe');
          } else if (shop.category === 'tattoo') {
            setWardrobeMode('tattoo');
            setActiveModal('wardrobe');
          } else if (shop.category === 'safehouse') {
            engine.healAtSafehouse();
            setWardrobeMode('safehouse');
            setActiveModal('wardrobe');
          } else if (shop.category === 'hospital') {
            engine.visitHospital();
          } else if (shop.category === 'police_station') {
            engine.visitPoliceStation();
          } else if (shop.category === 'fire_station') {
            engine.visitFireStation();
          } else if (shop.category === 'garage') {
            setActiveModal('garage');
          } else if (shop.category === 'shooting_range') {
            showNotice(t(stateRef.current.settings.language, 'app.shootingRangeNotice'));
          } else if (shop.category === 'lounge') {
            showNotice(t(stateRef.current.settings.language, 'app.loungeNotice'));
          }
        },
      }
    );

    engine.setSavedGarage(stateRef.current.savedGarage);
    engine.setMissionsProgress(stateRef.current.missionsProgress);

    engine.input.onActionTriggered = (action) => {
      if (action === 'inventory') {
        setInventoryTab('weapons');
        setActiveModal((m) => (m === 'inventory' ? 'none' : 'inventory'));
      } else if (action === 'characterWheel') {
        setActiveModal((m) => (m === 'character' ? 'none' : 'character'));
      } else if (action === 'wardrobe') {
        setWardrobeMode('wardrobe');
        setActiveModal((m) => (m === 'wardrobe' ? 'none' : 'wardrobe'));
      } else if (action === 'missions') {
        setActiveModal((m) => (m === 'missions' ? 'none' : 'missions'));
      } else if (action === 'openMap') {
        setActiveModal((m) => (m === 'map' ? 'none' : 'map'));
      } else if (action === 'phone') {
        setPhoneOpen((prev) => {
          const next = !prev;
          if (next) engine.input.exitPointerLock();
          return next;
        });
      } else if (action === 'toggleDock') {
        setDockOpen((prev) => {
          const next = !prev;
          if (next) engine.input.exitPointerLock();
          return next;
        });
      } else if (action === 'pause') {
        setActiveModal((m) => (m === 'settings' ? 'none' : 'settings'));
      } else if (action === 'weaponNext') {
        engine.cycleWeapon();
      } else if (action === 'quickHeal') {
        engine.useConsumable('medkit');
      } else if (action === 'quickArmor') {
        engine.useConsumable('armor_plate');
      } else if (action === 'talkNpc') {
        engine.talkToNearestNpc();
      } else if (action === 'radioNext') {
        engine.cycleRadioStation(1);
      }
    };

    engineRef.current = engine;

    const unlockAudio = () => engine.audio.unlock();
    window.addEventListener('pointerdown', unlockAudio, { once: true });
    window.addEventListener('keydown', unlockAudio, { once: true });

    const onEsc = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        setPhoneOpen(false);
        setActiveModal((cur) => (cur !== 'none' ? 'none' : 'none'));
      } else if (e.code === 'KeyO') {
        setActiveModal((cur) => (cur === 'settings' ? 'none' : 'settings'));
      }
    };
    window.addEventListener('keydown', onEsc);

    return () => {
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
      window.removeEventListener('keydown', onEsc);
      engine.dispose();
      engineRef.current = null;
    };
  }, [showNotice]);

  // Sync sequential story mission locks to 3D world beacons
  useEffect(() => {
    engineRef.current?.setMissionsProgress(missionsProgress);
  }, [missionsProgress]);

  // Pause simulation & handle Wardrobe 3D live camera when modals open
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (activeModal === 'wardrobe') {
      engine.setPaused(false);
      engine.setWardrobePreview(true);
      engine.input.exitPointerLock();
    } else if (activeModal !== 'none') {
      engine.setWardrobePreview(false);
      engine.setPaused(true);
    } else {
      engine.setWardrobePreview(false);
      engine.setPaused(false);
    }
  }, [activeModal]);

  const handleUpdateSettings = useCallback((next: GameSettings) => {
    setSettings(next);
    engineRef.current?.applySettings(next);
  }, []);

  const handleRestartCleanSession = useCallback(() => {
    const res = engineRef.current?.restartCleanSession();
    setSettings((prev) => ({
      ...prev,
      gameplayMods: {
        ...prev.gameplayMods,
        lowGravity: false,
        infiniteAmmo: false,
        rapidFire: false,
        turboVehicles: false,
        noPolice: false,
      },
    }));
    if (res?.message) showNotice(res.message);
  }, [showNotice]);

  const handleSaveCloud = useCallback(async () => {
    if (!user) return;
    const lang = stateRef.current.settings.language;
    if (stateRef.current.telemetry.cheatSessionActive) {
      setCloudStatus(t(lang, 'app.cloudSaveBlockedCheats'));
      return;
    }
    setCloudBusy(true);
    try {
      const s = stateRef.current;
      const syncedGarage = engineRef.current?.syncGarageBeforeSave() || s.savedGarage;
      setSavedGarage(syncedGarage);
      await saveGameToCloud(user, {
        activeCharacterId: s.activeCharacterId,
        cash: s.cash,
        stats: s.stats,
        characters: s.characters,
        inventory: s.inventory,
        settings: s.settings,
        missions: s.missionsProgress,
        garage: syncedGarage,
      });
      setCloudStatus(`${t(s.settings.language, 'app.cloudSaveSuccess')} (${new Date().toLocaleTimeString()})`);
    } catch (err) {
      setCloudStatus(err instanceof Error ? err.message : t(lang, 'app.cloudLoadError'));
    } finally {
      setCloudBusy(false);
    }
  }, [user]);

  const handleLoadCloud = useCallback(async () => {
    if (!user) return;
    const lang = stateRef.current.settings.language;
    setCloudBusy(true);
    try {
      const loaded = await loadGameFromCloud(user);
      if (loaded) {
        setCharacters(loaded.characters);
        setActiveCharacterId(loaded.activeCharacterId);
        setInventory(loaded.inventory);
        setCash(loaded.cash);
        setStats(loaded.stats);
        setSettings(loaded.settings);
        setMissionsProgress(loaded.missions);
        if (loaded.garage) setSavedGarage(loaded.garage);

        engineRef.current?.updateCharactersExternal(loaded.characters, loaded.activeCharacterId);
        engineRef.current?.updateInventoryExternal(loaded.inventory, loaded.cash);
        engineRef.current?.applySettings(loaded.settings);
        if (loaded.garage) engineRef.current?.setSavedGarage(loaded.garage);
        setCloudStatus(`${t(loaded.settings.language, 'app.cloudLoadSuccess')} (${new Date().toLocaleTimeString()})`);
      } else {
        setCloudStatus(t(lang, 'app.cloudNoSave'));
      }
    } catch (err) {
      setCloudStatus(err instanceof Error ? err.message : t(lang, 'app.cloudLoadError'));
    } finally {
      setCloudBusy(false);
    }
  }, [user]);

  // Auto-save locally every 15s & to Cloud every 45s if signed in (language is NEVER saved locally)
  useEffect(() => {
    const localTimer = window.setInterval(() => {
      try {
        const s = stateRef.current;
        if (s.telemetry.cheatSessionActive) return;
        const syncedGarage = engineRef.current?.syncGarageBeforeSave() || s.savedGarage;
        const { language: _omitLanguageLocally, ...settingsWithoutLang } = s.settings;
        localStorage.setItem(
          LOCAL_SAVE_KEY,
          JSON.stringify({
            activeCharacterId: s.activeCharacterId,
            cash: s.cash,
            stats: s.stats,
            characters: s.characters,
            inventory: s.inventory,
            settings: settingsWithoutLang,
            missions: s.missionsProgress,
            savedGarage: syncedGarage,
            discoveredSideIds: s.discoveredSideIds,
          })
        );
      } catch {
        // Ignore quota errors
      }
    }, 15000);
    return () => clearInterval(localTimer);
  }, []);

  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(() => {
      handleSaveCloud().catch(() => {});
    }, 45000);
    return () => clearInterval(timer);
  }, [user, handleSaveCloud]);

  // Inventory Handlers
  const handleEquipWeapon = (id: WeaponId) => {
    engineRef.current?.equipWeapon(id);
  };

  const handleBuyWeapon = (id: WeaponId) => {
    const def = WEAPON_CATALOG[id];
    if (cash < def.price) return;
    const nextCash = cash - def.price;
    const nextInv: InventoryState = {
      ...inventory,
      equippedWeapon: id,
      weapons: inventory.weapons.map((w) =>
        w.id === id ? { ...w, unlocked: true, ammoInClip: def.clipSize, reserveAmmo: def.clipSize * 4 } : w
      ),
    };
    setCash(nextCash);
    setInventory(nextInv);
    engineRef.current?.updateInventoryExternal(nextInv, nextCash);
    engineRef.current?.audio.playUiChime('mission');
  };

  const handleBuyAmmo = (id: WeaponId) => {
    if (cash < 420) return;
    const def = WEAPON_CATALOG[id];
    const nextCash = cash - 420;
    const nextInv: InventoryState = {
      ...inventory,
      weapons: inventory.weapons.map((w) =>
        w.id === id ? { ...w, reserveAmmo: w.reserveAmmo + def.clipSize * 2 } : w
      ),
    };
    setCash(nextCash);
    setInventory(nextInv);
    engineRef.current?.updateInventoryExternal(nextInv, nextCash);
    engineRef.current?.audio.playUiChime('click');
  };

  const handleChangeWeaponSkin = (id: WeaponId, color: string) => {
    const nextInv: InventoryState = {
      ...inventory,
      weapons: inventory.weapons.map((w) => (w.id === id ? { ...w, skinColor: color } : w)),
    };
    setInventory(nextInv);
    engineRef.current?.updateInventoryExternal(nextInv);
  };

  const handleUseConsumable = (id: string) => {
    engineRef.current?.useConsumable(id);
  };

  const handleBuyConsumable = (id: string) => {
    const item = inventory.consumables.find((c) => c.id === id);
    if (!item || cash < item.price) return;
    const nextCash = cash - item.price;
    const nextInv: InventoryState = {
      ...inventory,
      consumables: inventory.consumables.map((c) =>
        c.id === id ? { ...c, quantity: c.quantity + 1 } : c
      ),
    };
    setCash(nextCash);
    setInventory(nextInv);
    engineRef.current?.updateInventoryExternal(nextInv, nextCash);
    engineRef.current?.audio.playUiChime('click');
  };

  const handleSellContraband = (id: string) => {
    const loot = inventory.contraband.find((l) => l.id === id);
    if (!loot) return;
    const earned = loot.value * loot.quantity;
    const nextCash = cash + earned;
    const nextInv: InventoryState = {
      ...inventory,
      contraband: inventory.contraband.filter((l) => l.id !== id),
    };
    setCash(nextCash);
    setInventory(nextInv);
    engineRef.current?.updateInventoryExternal(nextInv, nextCash);
    engineRef.current?.audio.playUiChime('mission');
  };

  // Wardrobe Handlers
  const handleUpdateAppearance = (appearance: CharacterAppearance) => {
    setCharacters((prev) => ({
      ...prev,
      [activeCharacterId]: {
        ...prev[activeCharacterId],
        appearance,
      },
    }));
    engineRef.current?.updateCharacterAppearance(activeCharacterId, appearance);
  };

  const handleSaveOutfit = (name: string, appearance: CharacterAppearance) => {
    setCharacters((prev) => {
      const ch = prev[activeCharacterId];
      const nextOutfits = [
        ...ch.customOutfits,
        { id: `outfit_${Date.now()}`, name, appearance },
      ].slice(-12);
      const updated = {
        ...prev,
        [activeCharacterId]: { ...ch, customOutfits: nextOutfits },
      };
      engineRef.current?.updateCharactersExternal(updated, activeCharacterId);
      return updated;
    });
    engineRef.current?.audio.playUiChime('switch');
  };

  const handleDeleteOutfit = (outfitId: string) => {
    setCharacters((prev) => {
      const ch = prev[activeCharacterId];
      const updated = {
        ...prev,
        [activeCharacterId]: {
          ...ch,
          customOutfits: ch.customOutfits.filter((o) => o.id !== outfitId),
        },
      };
      engineRef.current?.updateCharactersExternal(updated, activeCharacterId);
      return updated;
    });
  };

  const activeCharacter = characters[activeCharacterId];

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-950">
      {/* Dedicated WebGL Mount Container (always LTR spatial viewport) */}
      <div ref={canvasMountRef} className="absolute inset-0 w-full h-full" />

      <div dir={isRtlLanguage(settings.language) ? 'rtl' : 'ltr'} className="contents">
        {/* Game HUD */}
        {activeModal === 'none' && !telemetry.activeCutscene && (
          <GameHUD
            lang={settings.language}
            telemetry={telemetry}
            activeCharacter={activeCharacter}
            characters={characters}
            hudMod={settings.hudMod}
            graphics={settings.graphics}
            controls={settings.controls}
            gameplayMods={settings.gameplayMods}
            dockOpen={dockOpen}
            roadSegments={engineRef.current?.roadSegments || ROAD_SEGMENTS}
            buildingFootprints={engineRef.current?.buildingFootprints || []}
            onToggleDock={() => setDockOpen((prev) => !prev)}
            onCycleCamera={() => engineRef.current?.cycleCameraMode()}
            onOpenModal={(m) => {
              if (m === 'settings') setSettingsInitialTab('graphics');
              if (m === 'wardrobe') setWardrobeMode('wardrobe');
              setActiveModal(m);
            }}
            onTogglePhone={() =>
              setPhoneOpen((prev) => {
                const next = !prev;
                if (next) engineRef.current?.input.exitPointerLock();
                return next;
              })
            }
            onOpenCloud={() => {
              setSettingsInitialTab('cloud');
              setActiveModal('settings');
            }}
            onRequestLock={() => engineRef.current?.input.requestPointerLock()}
            onRestartCleanSession={handleRestartCleanSession}
            onAcceptTaxi={() => engineRef.current?.acceptTaxiFare()}
            onCancelTaxi={() => engineRef.current?.cancelTaxiFare()}
            onSkipTaxiOffer={() => engineRef.current?.skipTaxiOffer()}
            onCycleRadio={(dir) => engineRef.current?.cycleRadioStation(dir)}
          />
        )}

        {/* Shop / Facility Notice Toast */}
        {shopNotice && !telemetry.activeCutscene && (
          <div className="fixed top-20 left-1/2 -translate-x-1/2 z-30 px-5 py-2.5 rounded-xl bg-slate-950/90 border border-white/15 text-xs font-semibold text-white shadow-xl">
            {shopNotice}
          </div>
        )}

        {/* Live Co-op Mission Invite Toast */}
        {incomingInvite && (
          <div className="fixed bottom-24 right-6 z-40 w-80 p-4 rounded-2xl bg-[#0b101b]/95 border border-emerald-500/40 shadow-2xl space-y-2.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">
              {t(settings.language, 'app.coopInviteTitle')}
            </div>
            <div className="text-xs text-slate-200">
              {t(settings.language, 'app.coopInviteBody', {
                name: incomingInvite.fromName,
                mission: incomingInvite.missionTitle,
              })}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (wsRef.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.send(
                      JSON.stringify({
                        type: 'mission_accept',
                        fromUid: incomingInvite.fromUid,
                        missionId: incomingInvite.missionId,
                      })
                    );
                  }
                  setActiveMissionId(incomingInvite.missionId);
                  engineRef.current?.startMission(incomingInvite.missionId);
                  setIncomingInvite(null);
                }}
                className="flex-1 py-1.5 rounded-lg text-xs font-bold text-slate-950 bg-emerald-400 hover:bg-emerald-300"
              >
                {t(settings.language, 'app.acceptStart')}
              </button>
              <button
                onClick={() => setIncomingInvite(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-300 hover:bg-slate-700"
              >
                {t(settings.language, 'app.decline')}
              </button>
            </div>
          </div>
        )}

        {/* Character Switcher */}
        {activeModal === 'character' && (
          <CharacterWheel
            lang={settings.language}
            characters={characters}
            activeCharacterId={activeCharacterId}
            accentColor={settings.hudMod.accentColor}
            onSelect={(id) => engineRef.current?.switchCharacter(id)}
            onClose={() => setActiveModal('none')}
          />
        )}

        {/* Inventory & Shop */}
        {activeModal === 'inventory' && (
          <InventoryModal
            lang={settings.language}
            inventory={inventory}
            cash={cash}
            accentColor={settings.hudMod.accentColor}
            initialTab={inventoryTab}
            onEquipWeapon={handleEquipWeapon}
            onBuyWeapon={handleBuyWeapon}
            onBuyAmmo={handleBuyAmmo}
            onChangeWeaponSkin={handleChangeWeaponSkin}
            onUseConsumable={handleUseConsumable}
            onBuyConsumable={handleBuyConsumable}
            onBuyParachute={() => engineRef.current?.buyParachute()}
            onSellContraband={handleSellContraband}
            onClose={() => setActiveModal('none')}
          />
        )}

        {/* Wardrobe, Barber Studio, Tattoo Parlor & Safehouse Closet */}
        {activeModal === 'wardrobe' && (
          <WardrobeModal
            lang={settings.language}
            character={activeCharacter}
            accentColor={settings.hudMod.accentColor}
            mode={wardrobeMode}
            onUpdateAppearance={handleUpdateAppearance}
            onSaveOutfit={handleSaveOutfit}
            onDeleteOutfit={handleDeleteOutfit}
            onClose={() => setActiveModal('none')}
          />
        )}

        {/* Missions Board */}
        {activeModal === 'missions' && (
          <MissionsModal
            lang={settings.language}
            missionsProgress={missionsProgress}
            discoveredSideIds={discoveredSideIds}
            activeMissionId={activeMissionId}
            cheatSessionActive={telemetry.cheatSessionActive}
            accentColor={settings.hudMod.accentColor}
            onStartMission={(id) => {
              setActiveMissionId(id);
              engineRef.current?.startMission(id);
            }}
            onNavigateGps={(x, z, label) => engineRef.current?.setGpsWaypoint(x, z, label)}
            onCancelMission={() => {
              setActiveMissionId(null);
              engineRef.current?.cancelMission();
            }}
            onRestartCleanSession={handleRestartCleanSession}
            onClose={() => setActiveModal('none')}
          />
        )}

        {/* Interactive City Map & GPS */}
        {activeModal === 'map' && (
          <MapModal
            lang={settings.language}
            telemetry={telemetry}
            missionsProgress={missionsProgress}
            roadSegments={engineRef.current?.roadSegments || ROAD_SEGMENTS}
            buildingFootprints={engineRef.current?.buildingFootprints || []}
            accentColor={settings.hudMod.accentColor}
            onSetGps={(x, z, label) => engineRef.current?.setGpsWaypoint(x, z, label)}
            onClearGps={() => engineRef.current?.clearGpsWaypoint()}
            onStartMission={(id) => {
              setActiveMissionId(id);
              engineRef.current?.startMission(id);
            }}
            onClose={() => setActiveModal('none')}
          />
        )}

        {/* Horizon Cab Destination Modal */}
        {activeModal === 'taxi' && (
          <TaxiModal
            lang={settings.language}
            playerX={telemetry.playerX}
            playerZ={telemetry.playerZ}
            cash={cash}
            accentColor={settings.hudMod.accentColor}
            onSelectDestination={(x, z, label) => {
              engineRef.current?.startTaxiRideTo(x, z, label);
              setActiveModal('none');
            }}
            onTakeWheel={() => {
              engineRef.current?.startTaxiDriverShift();
              setActiveModal('none');
            }}
            onClose={() => setActiveModal('none')}
          />
        )}

        {/* Bayshore Customs Drive-In Tuning & Repair Garage */}
        {activeModal === 'garage' && (
          <TuningGarageModal
            lang={settings.language}
            cash={cash}
            telemetry={telemetry}
            accentColor={settings.hudMod.accentColor}
            onRepairOrRepaint={(colorHex) => {
              const cost = colorHex ? 1200 : Math.max(180, telemetry.nearbyRepairCost || 180);
              if (cash < cost) return false;
              const ok = Boolean(engineRef.current?.repairAndRepaintVehicle(colorHex));
              if (ok) {
                const nextCash = cash - cost;
                setCash(nextCash);
                engineRef.current?.updateInventoryExternal(inventory, nextCash);
              }
              return ok;
            }}
            onUpgrade={(type) =>
              engineRef.current?.upgradeCurrentVehicle(type) || {
                ok: false,
                message: 'Enter garage in a vehicle first.',
              }
            }
            onClose={() => setActiveModal('none')}
          />
        )}

        {/* Smartphone Overlay (Emergency Dispatch, Taxi, Friends, Hangar/Garage, Cheats) */}
        {phoneOpen && activeModal === 'none' && !telemetry.activeCutscene && (
          <PhoneOverlay
            lang={settings.language}
            user={user}
            myNickname={playerNickname || user?.displayName || user?.email?.split('@')[0] || ''}
            myFriendCode={user ? computeFriendCode(user.uid) : 'VH-OFFLINE'}
            friends={friends}
            onlineUids={onlineUids}
            onlinePlayers={onlinePlayers}
            remotePlayers={remotePlayers}
            activeMissionId={activeMissionId}
            savedGarage={savedGarage}
            gameClockStr={telemetry.gameClockStr}
            district={telemetry.district}
            weatherLabel={telemetry.weatherLabel}
            radioStation={telemetry.radioStation}
            radioTrack={telemetry.radioTrack}
            cheatSessionActive={telemetry.cheatSessionActive}
            accentColor={settings.hudMod.accentColor}
            onSignIn={() => signInWithGoogle().catch((e) => setCloudStatus(String(e)))}
            onUpdateNickname={async (nextNick) => {
              if (!user) throw new Error(t(settings.language, 'app.signInRequired'));
              const saved = await updatePlayerNickname(user, nextNick);
              setPlayerNickname(saved);
              if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ type: 'update_profile', displayName: saved }));
              }
              showNotice(t(settings.language, 'app.nickSaved', { nick: saved }));
            }}
            onAddFriend={async (q) => {
              if (!user) throw new Error(t(settings.language, 'app.signInRequired'));
              const rec = await addFriendByQuery(user, q);
              setFriends((prev) => (prev.some((f) => f.uid === rec.uid) ? prev : [...prev, rec]));
            }}
            onRemoveFriend={async (uid) => {
              if (!user) return;
              await removeFriend(user, uid);
              setFriends((prev) => prev.filter((f) => f.uid !== uid));
            }}
            onInviteFriend={(friendUid) => {
              if (!activeMissionId || wsRef.current?.readyState !== WebSocket.OPEN) return;
              wsRef.current.send(
                JSON.stringify({
                  type: 'mission_invite',
                  toUid: friendUid,
                  missionId: activeMissionId,
                  missionTitle: telemetry.activeMissionTitle || activeMissionId,
                })
              );
              showNotice(t(settings.language, 'app.missionInviteSent'));
            }}
            onSetGps={(x, z, label) => engineRef.current?.setGpsWaypoint(x, z, label)}
            onTeleportToFriend={(player) => {
              engineRef.current?.teleportTo(player.x + 4, player.z + 4, player.displayName);
              setPhoneOpen(false);
            }}
            onCallTaxi={() => {
              engineRef.current?.callTaxiPassenger();
              setPhoneOpen(false);
            }}
            onStartTaxiShift={() => {
              engineRef.current?.startTaxiDriverShift();
              setPhoneOpen(false);
            }}
            onRetrieveVehicle={(facility, idx) => {
              engineRef.current?.retrieveSavedVehicle(facility, idx);
            }}
            onSetRadioStation={(stationId) => engineRef.current?.setRadioStation(stationId)}
            onApplyCheat={(code) =>
              engineRef.current?.applyCheatCode(code) || { ok: false, message: 'Engine loading...' }
            }
            onRestartCleanSession={handleRestartCleanSession}
            onClose={() => setPhoneOpen(false)}
          />
        )}

        {/* Story Cutscene Cinematic Letterbox */}
        {telemetry.activeCutscene && (
          <CutsceneOverlay
            lang={settings.language}
            cutscene={telemetry.activeCutscene}
            accentColor={settings.hudMod.accentColor}
            onNext={() => engineRef.current?.advanceCutscene()}
            onSkip={() => engineRef.current?.skipCutscene()}
          />
        )}

        {/* Settings, Controls, Mods, Cloud Save */}
        {activeModal === 'settings' && (
          <SettingsAndModsModal
            settings={settings}
            user={user}
            myNickname={playerNickname || user?.displayName || user?.email?.split('@')[0] || ''}
            myFriendCode={user ? computeFriendCode(user.uid) : 'VH-OFFLINE'}
            friends={friends}
            onlineUids={onlineUids}
            onlinePlayers={onlinePlayers}
            cloudStatus={cloudStatus}
            cloudBusy={cloudBusy}
            stats={stats}
            controllerConnected={telemetry.controllerConnected}
            controllerType={telemetry.controllerType}
            controllerName={telemetry.controllerName}
            gameClockStr={telemetry.gameClockStr}
            gameTimeNormalized={telemetry.gameTimeNormalized}
            cheatSessionActive={telemetry.cheatSessionActive}
            initialTab={settingsInitialTab}
            onUpdateSettings={handleUpdateSettings}
            onSetTimeOfDay={(n) => engineRef.current?.setTimeOfDay(n)}
            onRestartCleanSession={handleRestartCleanSession}
            onSignIn={() => signInWithGoogle().catch((e) => setCloudStatus(String(e)))}
            onSignOut={() => signOutUser().catch(() => {})}
            onUpdateNickname={async (nextNick) => {
              if (!user) throw new Error(t(settings.language, 'app.signInRequired'));
              const saved = await updatePlayerNickname(user, nextNick);
              setPlayerNickname(saved);
              if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ type: 'update_profile', displayName: saved }));
              }
              showNotice(t(settings.language, 'app.nickSaved', { nick: saved }));
            }}
            onAddFriend={async (q) => {
              if (!user) throw new Error(t(settings.language, 'app.signInRequired'));
              const rec = await addFriendByQuery(user, q);
              setFriends((prev) => (prev.some((f) => f.uid === rec.uid) ? prev : [...prev, rec]));
            }}
            onRemoveFriend={async (uid) => {
              if (!user) return;
              await removeFriend(user, uid);
              setFriends((prev) => prev.filter((f) => f.uid !== uid));
            }}
            onSaveCloud={handleSaveCloud}
            onLoadCloud={handleLoadCloud}
            onClose={() => setActiveModal('none')}
          />
        )}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ViceHorizonApp />
    </ErrorBoundary>
  );
}
