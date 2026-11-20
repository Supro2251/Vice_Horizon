import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import {
  ActiveCutsceneState,
  CameraMode,
  CharacterAppearance,
  CharacterId,
  CharacterState,
  GameSettings,
  GameStats,
  GpsWaypoint,
  HudTelemetry,
  InventoryState,
  MinimapBlip,
  MissionCutsceneLine,
  MissionDef,
  MissionProgressRecord,
  RemotePlayerState,
  SavedGarageState,
  ShopDef,
  StoredVehicleRecord,
  VehicleControlCategory,
  VehicleKind,
  VehicleUpgrades,
  WeaponId,
  WeatherType,
} from '../types/game';
import {
  AIRPORT_HANGAR_ZONE,
  ALL_MISSIONS,
  DEFAULT_MISSIONS,
  DEFAULT_SAVED_GARAGE,
  HOSPITAL_RESPAWN,
  isMissionUnlocked,
  MISSIONS,
  POLICE_STATION_RESPAWN,
  SAFEHOUSE_GARAGE_ZONE,
  SHOPS,
  SIDE_DISCOVERY_MISSIONS,
  WEAPON_CATALOG,
} from '../data/defaults';
import { ProceduralAudioEngine } from './audio';
import { InputManager } from './input';
import { createProceduralTextures, ProceduralTextureSet } from './textures';
import {
  CharacterRig,
  createCharacterRig,
  createParachuteRig,
  createVehicleRig,
  createWeaponMesh,
  deformVehicleRig,
  getWeaponMuzzleOffset,
  resetVehicleDeformation,
  updateCharacterRigAppearance,
  VehicleRig,
} from './models';
import {
  AABBCollider,
  buildOpenWorld,
  CircleCollider,
  ClubShowRig,
  ElevatorEntity,
  ExplosiveBarrelEntity,
  getDistrictName,
  RangeTargetEntity,
  ShopInteriorGroup,
  StuntRamp,
} from './world';
import {
  computeGpsRoute,
  getBridgeElevationAt,
  getOverpassDeckHeightAt,
  getUnderpassFloorHeightAt,
  isBridgeAt,
  isIslandLandAt,
  isOnBeachAt,
  isOutOfBoundsSeaAt,
  isWaterAt,
  PARKING_LOTS,
  RoadSegmentDef,
  TRAFFIC_LOOP_PATHS,
} from './navigation';

// Module-scope reusable math helpers & pooled geometries (Zero GC in render loop)
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _camGoal = new THREE.Vector3();
const _lookGoal = new THREE.Vector3();
const _rayOrigin = new THREE.Vector3();
const _rayDir = new THREE.Vector3();
const _tracerGeo = new THREE.CylinderGeometry(0.024, 0.024, 1, 5);
_tracerGeo.rotateX(Math.PI / 2);
const _particleGeo = new THREE.SphereGeometry(0.12, 6, 6);
const _skidGeo = new THREE.PlaneGeometry(0.42, 1.35);
_skidGeo.rotateX(-Math.PI / 2);
const _skidMat = new THREE.MeshBasicMaterial({
  color: 0x090b10,
  transparent: true,
  opacity: 0.46,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -3,
});
const GRID_CELL_SIZE = 32;
const gridKey = (gx: number, gz: number): number => (gx + 2048) * 4096 + (gz + 2048);

// Pre-allocated Atmosphere Color Constants & Scratch Buffers (Zero GC in updateAtmosphere)
const _cNightHor = new THREE.Color(0x0f172a);
const _cNightMid = new THREE.Color(0x090d1a);
const _cNightTop = new THREE.Color(0x020617);
const _cDayHorBase = new THREE.Color(0xbae6fd);
const _cDayMidBase = new THREE.Color(0x38bdf8);
const _cDayTopBase = new THREE.Color(0x0284c7);
const _cRainHor = new THREE.Color(0x64748b);
const _cRainMid = new THREE.Color(0x475569);
const _cRainTop = new THREE.Color(0x334155);
const _cSunHor = new THREE.Color(0xfb923c);
const _cSunMidBase = new THREE.Color(0x7e22ce);
const _cSunTop = new THREE.Color(0x0f172a);
const _cLightningA = new THREE.Color(0xe2e8f0);
const _cLightningB = new THREE.Color(0xf8fafc);
const _cSunLow = new THREE.Color(0x93c5fd);
const _cSunHigh = new THREE.Color(0xfffbeb);
const _cSunWarm = new THREE.Color(0xfdba74);
const _cDayHor = new THREE.Color();
const _cDayMid = new THREE.Color();
const _cDayTop = new THREE.Color();
const _cSunMid = new THREE.Color();
const _cHor = new THREE.Color();
const _cMid = new THREE.Color();
const _cTop = new THREE.Color();
const _cFog = new THREE.Color();
const _cSunCol = new THREE.Color();

// Cached static minimap blips (Shops & Parking lots never move)
const STATIC_MINIMAP_BLIPS: MinimapBlip[] = [
  ...SHOPS.map((shop) => ({
    x: shop.x,
    z: shop.z,
    type: (shop.category === 'shooting_range' ? 'shooting_range' : 'shop') as MinimapBlip['type'],
    label: shop.name,
    shopCategory: shop.category,
    color: shop.color,
  })),
  ...PARKING_LOTS.map((lot) => ({
    x: lot.x,
    z: lot.z,
    type: 'parking' as MinimapBlip['type'],
    label: lot.name,
  })),
];
const MALIBU_CLUB = SHOPS.find((s) => s.category === 'lounge') || { x: 720, z: -340, doorX: 701, doorZ: -340 };

interface VehicleEntity {
  id: string;
  brand: string;
  name: string;
  kind: VehicleKind;
  color: string;
  rig: VehicleRig;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  heading: number;
  pitch: number;
  roll: number;
  speed: number;
  steerAngle: number;
  wheelSpin: number;
  maxSpeed: number;
  accel: number;
  isPolice: boolean;
  isTraffic: boolean;
  hasDriver: boolean;
  stoppedByPlayer: boolean;
  stopHoldTimer: number;
  turnCooldown: number;
  pathIndex: number;
  waypointIndex: number;
  isDrifting: boolean;
  driftIntensity: number;
  occupiedByPlayer: boolean;
  health: number;
  maxHealth: number;
  destroyed: boolean;
  isCheatSpawned?: boolean;
  upgrades: VehicleUpgrades;
}

interface NpcEntity {
  id: string;
  name?: string;
  aiDialogue?: string;
  rig: CharacterRig;
  x: number;
  y: number;
  z: number;
  heading: number;
  health: number;
  kind: 'civilian' | 'police' | 'enemy' | 'bouncer';
  behavior: 'wander' | 'flee' | 'fight' | 'seek_shelter' | 'cheer';
  activity: 'stroll' | 'chat' | 'chill';
  chatTargetX?: number;
  chatTargetZ?: number;
  guardHomeX?: number;
  guardHomeZ?: number;
  guardHeading?: number;
  panicTimer: number;
  shootCooldown: number;
  tackleCooldown: number;
  wanderAngle: number;
  wanderTimer: number;
  alive: boolean;
  hasWeapon?: boolean;
  weaponId?: WeaponId;
  weaponMesh?: THREE.Group;
}

interface BulletTracer {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  active: boolean;
  life: number;
  maxLife: number;
}

interface RocketProjectile {
  mesh: THREE.Mesh;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
}

interface ParticleBurst {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  active: boolean;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  growSpeed: number;
}

interface RemotePlayerVisual {
  uid: string;
  root: THREE.Group;
  charRig: CharacterRig;
  vehRig: VehicleRig | null;
  vehKind: VehicleKind | null;
  vehColor: string;
  targetPos: THREE.Vector3;
  targetHeading: number;
  state: RemotePlayerState;
}

export interface EngineCallbacks {
  onTelemetry: (t: HudTelemetry) => void;
  onInventoryChange: (inv: InventoryState) => void;
  onCashChange: (cash: number) => void;
  onCharactersChange: (chars: Record<CharacterId, CharacterState>, activeId: CharacterId) => void;
  onStatsChange: (stats: GameStats) => void;
  onMissionComplete: (missionId: string, elapsedSec: number, reward: number) => void;
  onShopInteract: (shop: ShopDef) => void;
  onGarageChange?: (garage: SavedGarageState) => void;
  onCutsceneChange?: (cutscene: ActiveCutsceneState | null) => void;
  onSideMissionDiscovered?: (mission: MissionDef) => void;
  onTaxiMenuRequested?: () => void;
}

export class ViceEngine {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private textures: ProceduralTextureSet;
  private sunLight: THREE.DirectionalLight;
  private rimLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private isSoftwareGl: boolean;

  public audio = new ProceduralAudioEngine();
  public input = new InputManager();

  private colliders: AABBCollider[] = [];
  private floorSurfaces: AABBCollider[] = [];
  private circleColliders: CircleCollider[] = [];
  private colliderGrid = new Map<number, { aabb: AABBCollider[]; circle: CircleCollider[] }>();
  private floorGrid = new Map<number, AABBCollider[]>();
  private _queryAabbs = new Set<AABBCollider>();
  private _queryCircles = new Set<CircleCollider>();
  private ramps: StuntRamp[] = [];
  private barrels: ExplosiveBarrelEntity[] = [];
  private rangeTargets: RangeTargetEntity[] = [];
  private elevators: ElevatorEntity[] = [];
  private buildingWindowMaterials: THREE.Material[] = [];
  private spinners: THREE.Object3D[] = [];
  private shopRings: THREE.Mesh[] = [];
  private shopInteriors: ShopInteriorGroup[] = [];
  private oceanMesh!: THREE.Mesh;
  private skyMat!: THREE.ShaderMaterial;
  private cloudGroup!: THREE.Group;
  private cloudMaterials: THREE.MeshStandardMaterial[] = [];
  private wettableRoadMaterials: THREE.MeshStandardMaterial[] = [];
  private extraTextures: THREE.Texture[] = [];
  private clubShow: ClubShowRig | null = null;
  private clubEncoreTimer = 0;
  private clubBouncersAlerted = false;
  private clubBouncerRespawnTimer = 0;
  private clubAlarmNoticeShown = false;
  public roadSegments: RoadSegmentDef[] = [];
  public roadRects: { x: number; z: number; w: number; l: number }[] = [];
  public buildingFootprints: { x: number; z: number; w: number; d: number; color: string }[] = [];

  private characters: Record<CharacterId, CharacterState>;
  private activeCharId: CharacterId;
  private playerRig!: CharacterRig;
  private parachuteRig!: THREE.Group;
  private parachuteDeployed = false;
  private firstPersonWeaponGroup: THREE.Group;
  private muzzleFlashMesh: THREE.Mesh;
  private muzzleFlashTimer = 0;

  private vehicles: VehicleEntity[] = [];
  private npcs: NpcEntity[] = [];
  private tracerPool: BulletTracer[] = [];
  private tracerCursor = 0;
  private rockets: RocketProjectile[] = [];
  private particlePool: ParticleBurst[] = [];
  private particleCursor = 0;
  private skidPool: THREE.Mesh[] = [];
  private skidCursor = 0;
  private skidEmitTimer = 0;
  private currentDriftIntensity = 0;
  private interiorCullTimer = 0;
  private atmosphereTimer = 0;
  private lastShadowX = 999999;
  private lastShadowZ = 999999;
  private shadowCooldown = 0;
  private cachedGpsTargetKey = '';
  private cachedGpsX = 999999;
  private cachedGpsZ = 999999;
  private cachedGpsRoute: { x: number; z: number }[] = [];
  private gpsRefreshTimer = 0;

  // Waypoint, Story Mission Beacons & Pickup visuals
  private waypointGroup: THREE.Group;
  private waypointBeam: THREE.Mesh;
  private waypointRing: THREE.Mesh;
  private pickupBriefcase: THREE.Group;
  private missionStartBeacons: { mission: MissionDef; group: THREE.Group; ring: THREE.Mesh }[] = [];
  private missionsProgress: Record<string, MissionProgressRecord> = structuredClone(DEFAULT_MISSIONS);
  private gpsWaypoint: GpsWaypoint | null = null;

  // Player Physics
  private playerVelX = 0;
  private playerVelY = 0;
  private playerVelZ = 0;
  private playerGrounded = true;
  private playerStamina = 100;
  private isPlayerSprinting = false;
  private crowdMaintainTimer = 0;
  private currentVehicle: VehicleEntity | null = null;
  private lastLandVehicle: VehicleEntity | null = null;
  private wasAirborneInCar = false;
  private airStartTime = 0;

  // Camera state
  private cameraMode: CameraMode = 'third_person';
  private camYaw = 0;
  private camPitch = 0.24;
  private camCurrentPos = new THREE.Vector3();
  private camCurrentLook = new THREE.Vector3();
  private switchSwoopTimer = 0;
  private wardrobePreview = false;

  // Combat, Wanted, God Mode, Auto-Aim & Police Dispatch
  private inventory: InventoryState;
  private cash: number;
  private stats: GameStats;
  private settings: GameSettings;
  private fireCooldown = 0;
  private reloadTimer = 0;
  private weaponRecoilKick = 0;
  private garageTriggerCooldown = 0;
  private hitMarkerTimer = 0;
  private damageFlashTimer = 0;
  private stuntMessage: string | null = null;
  private stuntTimer = 0;
  private wastedTimer = 0;
  private wastedReason: string | null = null;
  private bustedTimer = 0;
  private godModeActive = false;
  private cheatSessionActive = false;
  private preCheatSnapshot: {
    cash: number;
    inventory: InventoryState;
    characters: Record<CharacterId, CharacterState>;
  } | null = null;
  private autoAimLocked = false;

  private wantedStars = 0;
  private wantedHeat = 0;
  private wantedEvading = false;
  private evasionProgress = 0;
  private arrestProgress = 0;
  private policeSpawnTimer = 0;
  private policeDispatchTimer = 0;
  private policeDispatchReason: string | null = null;
  private pendingDispatchStars = 0;

  // Dynamic Day/Night Cycle, Smooth Weather & Adaptive AI NPCs
  private gameTimeNormalized = 0.72; // Start at Vice Sunset (17:15)
  private cloudCoverage = 0.42;
  private weatherType: WeatherType = 'clear';
  private targetWeatherType: WeatherType = 'partly_cloudy';
  private weatherChangeTimer = 95;
  private rainIntensity = 0;
  private fogWeatherBoost = 0;
  private lightningFlash = 0;
  private thunderCooldown = 0;
  private rainPoints!: THREE.Points;
  private rainPositions!: Float32Array;
  private manualCameraCooldown = 0;
  private aiNpcTimer = 6;
  private aiNpcInFlight = false;
  private nearestNpcDialogue: { speaker: string; text: string; behavior: string } | null = null;
  private npcDialogueTimer = 0;

  // Hangar, Garage, Taxi, Side Missions & Cutscenes
  private savedGarage: SavedGarageState = structuredClone(DEFAULT_SAVED_GARAGE);
  private parkedFacilityNotice: string | null = null;
  private parkedNoticeTimer = 0;
  private taxiMode: 'none' | 'passenger' | 'driver_waiting' | 'driver_active' = 'none';
  private taxiFareCash = 0;
  private taxiDestinationLabel: string | null = null;
  private taxiTargetX = 0;
  private taxiTargetZ = 0;
  private taxiPickupX = 0;
  private taxiPickupZ = 0;
  private taxiAutoPilotTimer = 0;
  private taxiDropBeacon: THREE.Mesh | null = null;

  private activeCutscene: ActiveCutsceneState | null = null;
  private cutsceneLines: MissionCutsceneLine[] = [];
  private cutsceneTargetPos = new THREE.Vector3();
  private cutsceneOnFinish: (() => void) | null = null;

  private discoveredSideMissions = new Set<string>();
  private nearbySideMission: MissionDef | null = null;
  private activeSidePrompt: string | null = null;

  // Multiplayer Remote Players & Skill XP
  private remotePlayers = new Map<string, RemotePlayerVisual>();
  private skillXp = { driving: 0, shooting: 0, flying: 0, stamina: 0 };
  private smokeTimer = 0;

  // Mission state
  private activeMission: MissionDef | null = null;
  private activeStageIndex = 0;
  private missionTimerRemaining: number | null = null;
  private missionElapsedSec = 0;
  private missionNotification: { title: string; subtitle: string; reward?: number } | null = null;
  private missionNotifTimer = 0;

  // Loop & perf
  private frameId = 0;
  private disposed = false;
  private lastTime = performance.now();
  private elapsedSec = 0;
  private fpsFrames = 0;
  private fpsAccum = 0;
  private currentFps = 60;
  private telemetryTimer = 0;

  private callbacks: EngineCallbacks;
  private resizeObserver: ResizeObserver;

  constructor(
    container: HTMLElement,
    initialChars: Record<CharacterId, CharacterState>,
    activeCharId: CharacterId,
    initialInventory: InventoryState,
    initialCash: number,
    initialStats: GameStats,
    initialSettings: GameSettings,
    callbacks: EngineCallbacks
  ) {
    this.container = container;
    this.characters = structuredClone(initialChars);
    this.activeCharId = activeCharId;
    this.inventory = structuredClone(initialInventory);
    this.cash = initialCash;
    this.stats = { ...initialStats };
    this.settings = structuredClone(initialSettings);
    this.callbacks = callbacks;

    // 1. Software WebGL probe (per Three.js skill directive)
    this.isSoftwareGl = (() => {
      try {
        const probe = document.createElement('canvas').getContext('webgl2');
        if (!probe) return true;
        const ext = probe.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
        const gpu = String(probe.getParameter(param));
        probe.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    // 2. Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.94;
    this.renderer.shadowMap.enabled = !this.isSoftwareGl && this.settings.graphics.shadowQuality !== 'off';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.setPixelRatio(this.computePixelRatio());
    this.renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    container.appendChild(this.renderer.domElement);

    // 3. Scene & Camera
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      this.settings.graphics.fov,
      (container.clientWidth || window.innerWidth) / (container.clientHeight || window.innerHeight),
      0.15,
      4200
    );
    this.scene.add(this.camera);

    // Environment Map (RoomEnvironment)
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    // Hardware Post-Processing Pipeline (Bloom + ACES Output)
    const initW = container.clientWidth || window.innerWidth;
    const initH = container.clientHeight || window.innerHeight;
    if (!this.isSoftwareGl) {
      const composer = new EffectComposer(this.renderer);
      composer.setPixelRatio(this.computePixelRatio());
      composer.setSize(initW, initH);
      composer.addPass(new RenderPass(this.scene, this.camera));
      const bloom = new UnrealBloomPass(
        new THREE.Vector2(Math.max(1, Math.floor(initW / 2)), Math.max(1, Math.floor(initH / 2))),
        0.20,
        0.38,
        1.18
      );
      composer.addPass(bloom);
      composer.addPass(new OutputPass());
      this.composer = composer;
      this.bloomPass = bloom;
    }

    // Lighting (Calibrated Sun + Cool Rim Fill for crisp GTA V contrast without distance washout)
    this.hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x334155, 0.44);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xffedd5, 1.75);
    this.sunLight.position.set(80, 95, 60);
    this.sunLight.castShadow = !this.isSoftwareGl;
    this.sunLight.shadow.mapSize.set(1024, 1024);
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 260;
    const d = 75;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.025;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    this.rimLight = new THREE.DirectionalLight(0x7dd3fc, 0.32);
    this.rimLight.position.set(-70, 50, -65);
    this.rimLight.castShadow = false;
    this.scene.add(this.rimLight);

    // 4. World & Procedural Textures
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.textures = createProceduralTextures(maxAniso);
    const world = buildOpenWorld(this.textures);
    this.scene.add(world.worldGroup);
    this.colliders = world.colliders;
    this.floorSurfaces = world.floorSurfaces;
    this.circleColliders = world.circleColliders;
    this.ramps = world.ramps;
    this.barrels = world.barrels;
    this.rangeTargets = world.rangeTargets;
    this.elevators = world.elevators;
    this.buildingWindowMaterials = world.buildingWindowMaterials;
    this.spinners = world.spinners;
    this.shopRings = world.shopRings;
    this.shopInteriors = world.shopInteriors || [];
    this.oceanMesh = world.oceanMesh;
    this.skyMat = world.skyMat;
    this.cloudGroup = world.cloudGroup;
    this.cloudMaterials = world.cloudMaterials;
    this.wettableRoadMaterials = world.wettableRoadMaterials || [];
    this.extraTextures = world.extraTextures || [];
    this.clubShow = world.clubShow || null;
    this.roadSegments = world.roadSegments;
    this.roadRects = world.roadRects;
    this.buildingFootprints = world.buildingFootprints;
    this.buildColliderGrid();

    // Dynamic atmospheric rain streaks around camera (strictly outside buildings/roofs)
    const rainCount = 900;
    this.rainPositions = new Float32Array(rainCount * 3);
    for (let i = 0; i < rainCount; i++) {
      this.rainPositions[i * 3] = (Math.random() - 0.5) * 40;
      this.rainPositions[i * 3 + 1] = Math.random() * 20;
      this.rainPositions[i * 3 + 2] = (Math.random() - 0.5) * 40;
    }
    const dropCanvas = document.createElement('canvas');
    dropCanvas.width = 16;
    dropCanvas.height = 64;
    const dCtx = dropCanvas.getContext('2d');
    if (dCtx) {
      const grad = dCtx.createLinearGradient(0, 0, 0, 64);
      grad.addColorStop(0.0, 'rgba(186, 230, 253, 0.0)');
      grad.addColorStop(0.25, 'rgba(186, 230, 253, 0.55)');
      grad.addColorStop(0.85, 'rgba(224, 242, 254, 0.9)');
      grad.addColorStop(1.0, 'rgba(224, 242, 254, 0.0)');
      dCtx.fillStyle = grad;
      dCtx.fillRect(6, 0, 4, 64);
    }
    const dropTex = new THREE.CanvasTexture(dropCanvas);
    dropTex.colorSpace = THREE.SRGBColorSpace;
    this.extraTextures.push(dropTex);

    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(this.rainPositions, 3));
    const rainMat = new THREE.PointsMaterial({
      color: 0xbae6fd,
      map: dropTex,
      size: 0.42,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
      alphaTest: 0.01,
    });
    this.rainPoints = new THREE.Points(rainGeo, rainMat);
    this.rainPoints.frustumCulled = false;
    this.rainPoints.visible = false;
    this.scene.add(this.rainPoints);

    // Pooled asphalt drift skid-mark, bullet tracer & particle meshes (Zero GC)
    for (let i = 0; i < 120; i++) {
      const m = new THREE.Mesh(_skidGeo, _skidMat);
      m.visible = false;
      this.scene.add(m);
      this.skidPool.push(m);
    }
    for (let i = 0; i < 32; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xfef08a, transparent: true, opacity: 0.85 });
      const mesh = new THREE.Mesh(_tracerGeo, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.tracerPool.push({ mesh, mat, active: false, life: 0, maxLife: 0.065 });
    }
    for (let i = 0; i < 64; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.95 });
      const mesh = new THREE.Mesh(_particleGeo, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.particlePool.push({ mesh, mat, active: false, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 0.3, growSpeed: 0 });
    }

    // 5. Player Rig, Parachute & First Person Weapon Viewmodel
    const activeChar = this.characters[this.activeCharId];
    this.playerRig = createCharacterRig(activeChar.appearance, this.textures.contactShadow);
    this.playerRig.root.position.set(activeChar.posX, activeChar.posY, activeChar.posZ);
    this.camYaw = activeChar.heading;
    this.scene.add(this.playerRig.root);

    this.parachuteRig = createParachuteRig();
    this.parachuteRig.position.set(0, 0.45, -0.05);
    this.parachuteRig.visible = false;
    this.playerRig.torsoGroup.add(this.parachuteRig);

    this.firstPersonWeaponGroup = new THREE.Group();
    this.firstPersonWeaponGroup.position.set(0.24, -0.22, -0.42);
    this.firstPersonWeaponGroup.rotation.y = Math.PI;
    this.firstPersonWeaponGroup.visible = false;
    this.camera.add(this.firstPersonWeaponGroup);

    this.muzzleFlashMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xfef08a, transparent: true, opacity: 0.9 })
    );
    this.muzzleFlashMesh.visible = false;
    this.scene.add(this.muzzleFlashMesh);

    this.syncEquippedWeaponMesh();

    // 6. Waypoint Beacon, Taxi Drop Beacon, Story Start Beacons & Mission Briefcase
    this.waypointGroup = new THREE.Group();
    this.waypointGroup.visible = false;
    const beamGeo = new THREE.CylinderGeometry(1.1, 1.1, 48, 16, 1, true);
    beamGeo.translate(0, 24, 0);
    this.waypointBeam = new THREE.Mesh(
      beamGeo,
      new THREE.MeshBasicMaterial({
        color: 0xf59e0b,
        transparent: true,
        opacity: 0.34,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this.waypointRing = new THREE.Mesh(
      new THREE.RingGeometry(1.6, 2.2, 24),
      new THREE.MeshBasicMaterial({ color: 0xfbbf24, side: THREE.DoubleSide })
    );
    this.waypointRing.rotation.x = -Math.PI / 2;
    this.waypointRing.position.y = 0.08;
    this.waypointGroup.add(this.waypointBeam, this.waypointRing);
    this.scene.add(this.waypointGroup);

    this.taxiDropBeacon = new THREE.Mesh(
      new THREE.TorusGeometry(2.1, 0.14, 10, 28),
      new THREE.MeshBasicMaterial({ color: 0xfacc15 })
    );
    this.taxiDropBeacon.rotation.x = Math.PI / 2;
    this.taxiDropBeacon.position.y = 0.22;
    this.taxiDropBeacon.visible = false;
    this.scene.add(this.taxiDropBeacon);

    // Floating 3D Beacons for Unlocked Story Missions
    for (const m of MISSIONS) {
      const mGroup = new THREE.Group();
      mGroup.position.set(m.startX, 0, m.startZ);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.35, 0.09, 10, 28),
        new THREE.MeshBasicMaterial({ color: 0xf59e0b })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.16;
      const orb = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.42, 0),
        new THREE.MeshBasicMaterial({ color: 0xfef08a })
      );
      orb.position.y = 1.6;
      mGroup.add(ring, orb);
      this.scene.add(mGroup);
      this.missionStartBeacons.push({ mission: m, group: mGroup, ring });
    }
    this.refreshMissionBeaconVisibility();

    this.pickupBriefcase = new THREE.Group();
    const caseBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.65, 0.45, 0.22),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.7, roughness: 0.3 })
    );
    const caseGlow = new THREE.Mesh(
      new THREE.TorusGeometry(0.65, 0.05, 8, 24),
      new THREE.MeshBasicMaterial({ color: 0x10b981 })
    );
    caseGlow.rotation.x = Math.PI / 2;
    caseGlow.position.y = -0.35;
    this.pickupBriefcase.add(caseBody, caseGlow);
    this.pickupBriefcase.visible = false;
    this.scene.add(this.pickupBriefcase);

    // 7. Spawn Initial Diverse Fleet (Cars, Taxis, Helicopters, Fighter Jets, Boats, Planes), Civilians & Club Bouncers
    this.spawnInitialVehicles();
    this.spawnAmbientCivilians();
    this.spawnClubBouncers(true);
    this.updateShopInteriorVisibility();

    // 8. Apply Graphics, Audio, Time-of-day, Controls
    this.applySettings(this.settings);
    this.input.attach(this.renderer.domElement);

    // Initialize camera behind active player
    this.camCurrentPos.set(
      activeChar.posX - Math.sin(this.camYaw) * 5.2,
      2.6,
      activeChar.posZ - Math.cos(this.camYaw) * 5.2
    );
    this.camCurrentLook.set(activeChar.posX, 1.4, activeChar.posZ);

    // Resize observer
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);

    // Pre-warm ALL procedural & world GPU textures + shaders multiple frames ahead so zero lazy pop-in occurs
    const warmTex = new Set<THREE.Texture>();
    for (const val of Object.values(this.textures)) {
      if (val instanceof THREE.Texture) warmTex.add(val);
    }
    for (const et of this.extraTextures) warmTex.add(et);
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (!m) continue;
        const std = m as THREE.MeshStandardMaterial;
        if (std.map) warmTex.add(std.map);
        if (std.normalMap) warmTex.add(std.normalMap);
        if (std.roughnessMap) warmTex.add(std.roughnessMap);
        if (std.emissiveMap) warmTex.add(std.emissiveMap);
      }
    });
    for (const tex of warmTex) {
      this.renderer.initTexture(tex);
    }
    if (!this.isSoftwareGl) {
      this.camera.position.copy(this.camCurrentPos);
      this.camera.lookAt(this.camCurrentLook);
      this.renderer.compile(this.scene, this.camera);
      this.camera.lookAt(activeChar.posX + Math.sin(this.camYaw) * 20, 4, activeChar.posZ + Math.cos(this.camYaw) * 20);
      this.renderer.compile(this.scene, this.camera);
      this.camera.lookAt(this.camCurrentLook);
    }

    this.scheduleNextTick();
  }

  private computePixelRatio(): number {
    if (this.isSoftwareGl) return 1;
    const maxCap = this.settings.graphics.preset === 'balanced' || this.settings.graphics.preset === 'low' ? 1.5 : 2;
    const base = Math.min(window.devicePixelRatio || 1, maxCap);
    return Math.max(0.5, Math.min(maxCap, base * this.settings.graphics.renderScale));
  }

  private handleResize() {
    if (this.disposed) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    if (this.composer) {
      this.composer.setSize(w, h);
      this.bloomPass?.resolution.set(Math.max(1, Math.floor(w / 2)), Math.max(1, Math.floor(h / 2)));
    }
  }

  private buildColliderGrid() {
    this.colliderGrid.clear();
    this.floorGrid.clear();
    const insertCell = (cx: number, cz: number, itemAabb?: AABBCollider, itemCircle?: CircleCollider) => {
      const key = gridKey(cx, cz);
      let cell = this.colliderGrid.get(key);
      if (!cell) {
        cell = { aabb: [], circle: [] };
        this.colliderGrid.set(key, cell);
      }
      if (itemAabb) cell.aabb.push(itemAabb);
      if (itemCircle) cell.circle.push(itemCircle);
    };

    for (const c of this.colliders) {
      const minCx = Math.floor(c.minX / GRID_CELL_SIZE);
      const maxCx = Math.floor(c.maxX / GRID_CELL_SIZE);
      const minCz = Math.floor(c.minZ / GRID_CELL_SIZE);
      const maxCz = Math.floor(c.maxZ / GRID_CELL_SIZE);
      for (let gx = minCx; gx <= maxCx; gx++) {
        for (let gz = minCz; gz <= maxCz; gz++) {
          insertCell(gx, gz, c);
        }
      }
    }

    for (const cc of this.circleColliders) {
      const minCx = Math.floor((cc.x - cc.radius) / GRID_CELL_SIZE);
      const maxCx = Math.floor((cc.x + cc.radius) / GRID_CELL_SIZE);
      const minCz = Math.floor((cc.z - cc.radius) / GRID_CELL_SIZE);
      const maxCz = Math.floor((cc.z + cc.radius) / GRID_CELL_SIZE);
      for (let gx = minCx; gx <= maxCx; gx++) {
        for (let gz = minCz; gz <= maxCz; gz++) {
          insertCell(gx, gz, undefined, cc);
        }
      }
    }

    for (const fs of this.floorSurfaces) {
      const minCx = Math.floor((fs.minX - 1) / GRID_CELL_SIZE);
      const maxCx = Math.floor((fs.maxX + 1) / GRID_CELL_SIZE);
      const minCz = Math.floor((fs.minZ - 1) / GRID_CELL_SIZE);
      const maxCz = Math.floor((fs.maxZ + 1) / GRID_CELL_SIZE);
      for (let gx = minCx; gx <= maxCx; gx++) {
        for (let gz = minCz; gz <= maxCz; gz++) {
          const key = gridKey(gx, gz);
          let list = this.floorGrid.get(key);
          if (!list) {
            list = [];
            this.floorGrid.set(key, list);
          }
          list.push(fs);
        }
      }
    }
  }

  private queryNearbyColliders(minX: number, maxX: number, minZ: number, maxZ: number) {
    this._queryAabbs.clear();
    this._queryCircles.clear();
    const minCx = Math.floor(minX / GRID_CELL_SIZE);
    const maxCx = Math.floor(maxX / GRID_CELL_SIZE);
    const minCz = Math.floor(minZ / GRID_CELL_SIZE);
    const maxCz = Math.floor(maxZ / GRID_CELL_SIZE);
    for (let gx = minCx; gx <= maxCx; gx++) {
      for (let gz = minCz; gz <= maxCz; gz++) {
        const cell = this.colliderGrid.get(gridKey(gx, gz));
        if (!cell) continue;
        for (const a of cell.aabb) this._queryAabbs.add(a);
        for (const c of cell.circle) this._queryCircles.add(c);
      }
    }
    return { aabbs: this._queryAabbs, circles: this._queryCircles };
  }

  private updateShopInteriorVisibility() {
    const px = this.playerRig ? this.playerRig.root.position.x : this.characters[this.activeCharId].posX;
    const pz = this.playerRig ? this.playerRig.root.position.z : this.characters[this.activeCharId].posZ;
    for (const si of this.shopInteriors) {
      const dx = px - si.x;
      const dz = pz - si.z;
      si.group.visible = dx * dx + dz * dz <= si.radius * si.radius;
    }
  }

  private spawnInitialVehicles() {
    // 100% Fictional Real-Inspired Car Brands (Zero real-world trademarks/logos!)
    const parkedSpecs: Array<{
      kind: VehicleKind;
      brand: string;
      name: string;
      color: string;
      x: number;
      z: number;
      heading: number;
    }> = [
      // Supercars (Valkyra) & Sports around Coral Strip, Safehouse & Downtown
      { kind: 'supercar', brand: 'Valkyra', name: 'Aether RS', color: '#fbbf24', x: 472, z: -112, heading: 0 },
      { kind: 'supercar', brand: 'Valkyra', name: 'Solaris GT', color: '#ec4899', x: 32, z: -64, heading: Math.PI / 2 },
      { kind: 'supercar', brand: 'Valkyra', name: 'Vortex V12', color: '#f97316', x: 436, z: -478, heading: Math.PI },
      // Muscle Cars (Solano)
      { kind: 'muscle', brand: 'Solano', name: 'Hellhound V8', color: '#e11d48', x: 182, z: -210, heading: Math.PI / 2 },
      { kind: 'muscle', brand: 'Solano', name: 'Mojave 440', color: '#f97316', x: -120, z: -176, heading: 0 },
      // Sport Coupes (Kuroi)
      { kind: 'coupe', brand: 'Kuroi', name: 'Shinobi GT', color: '#06b6d4', x: 448, z: -132, heading: 0 },
      { kind: 'coupe', brand: 'Kuroi', name: 'Ronin Spec-R', color: '#14b8a6', x: 560, z: -206, heading: Math.PI },
      // Sedans (Bavaro)
      { kind: 'sedan', brand: 'Bavaro', name: 'M50 Touring', color: '#94a3b8', x: -292, z: -216, heading: Math.PI / 2 },
      { kind: 'sedan', brand: 'Bavaro', name: '320 Berlina', color: '#475569', x: -322, z: -260, heading: 0 },
      // Horizon Cab Taxis
      { kind: 'taxi', brand: 'Horizon Cab', name: 'Horizon Taxík', color: '#facc15', x: 444, z: -104, heading: -Math.PI / 2 },
      { kind: 'taxi', brand: 'Horizon Cab', name: 'Horizon Taxík', color: '#facc15', x: -72, z: -608, heading: Math.PI / 2 },
      { kind: 'taxi', brand: 'Horizon Cab', name: 'Horizon Taxík', color: '#facc15', x: -746, z: 588, heading: 0 },
      // SUVs (Titanus)
      { kind: 'suv', brand: 'Titanus', name: 'Apex G-Line', color: '#0ea5e9', x: -536, z: 162, heading: -Math.PI / 2 },
      { kind: 'suv', brand: 'Titanus', name: 'Overland 4x4', color: '#a855f7', x: 118, z: -915, heading: 0 },
      // Motorcycles (Zeta)
      { kind: 'motorcycle', brand: 'Zeta', name: 'Viper RR', color: '#ef4444', x: 454, z: -126, heading: -Math.PI / 2 },
      { kind: 'motorcycle', brand: 'Zeta', name: 'Cross 450', color: '#22c55e', x: -720, z: -475, heading: Math.PI },
      { kind: 'motorcycle', brand: 'Zeta', name: 'Volt S', color: '#38bdf8', x: 785, z: -108, heading: 0 },
      // Emergency Fleet stationed outside Hospital, Police Station & Fire Station
      { kind: 'police', brand: 'VCPD', name: 'VCPD Interceptor', color: '#111827', x: -474, z: -498, heading: Math.PI },
      { kind: 'police', brand: 'VCPD', name: 'VCPD Interceptor', color: '#111827', x: -446, z: -498, heading: Math.PI },
      { kind: 'ambulance', brand: 'VEMS', name: 'VEMS Sanitka', color: '#f8fafc', x: -102, z: -606, heading: Math.PI },
      { kind: 'firetruck', brand: 'VCFD', name: 'VCFD Hasičské auto', color: '#dc2626', x: -102, z: 590, heading: 0 },
      // Speedboats (Pelican) in Marina Bay & Coastline
      { kind: 'boat', brand: 'Pelican', name: 'Speeder 320', color: '#06b6d4', x: 650, z: 720, heading: Math.PI / 2 },
      { kind: 'boat', brand: 'Pelican', name: 'Offshore 45', color: '#f43f5e', x: 780, z: 810, heading: Math.PI / 2 },
      { kind: 'boat', brand: 'Pelican', name: 'Marlin Sport', color: '#f59e0b', x: 890, z: 690, heading: 0 },
      { kind: 'boat', brand: 'Pelican', name: 'Coral Wave', color: '#10b981', x: 1120, z: -80, heading: 0 },
      // Dynamic Airport Aircraft Fleet (varied per launch, includes Helicopters & Fighter Jet!)
      { kind: 'plane', brand: 'Pelican', name: 'Skylark Coastal', color: '#f97316', x: -1060, z: 770, heading: Math.PI / 2 },
      { kind: 'helicopter', brand: 'Pelican', name: 'Pelican Helistar', color: '#0ea5e9', x: -860, z: 680, heading: 0 },
      { kind: 'helicopter', brand: 'VCPD', name: 'VCPD Air-1', color: '#1e293b', x: -460, z: -475, heading: Math.PI },
    ];

    const airRoll = Math.random();
    if (airRoll < 0.72) {
      parkedSpecs.push({
        kind: 'fighter_jet',
        brand: 'Zeta',
        name: 'Zeta F-22 Interceptor',
        color: '#334155',
        x: -910,
        z: 845,
        heading: Math.PI / 2,
      });
    }
    if (airRoll > 0.28) {
      parkedSpecs.push({
        kind: 'plane',
        brand: 'Valkyra',
        name: 'Valkyra Jetstream',
        color: '#e11d48',
        x: -790,
        z: 770,
        heading: Math.PI / 2,
      });
    }

    parkedSpecs.forEach((s, idx) => {
      this.addVehicle(
        `parked_${idx}`,
        s.brand,
        s.name,
        s.kind,
        s.color,
        s.x,
        s.z,
        s.heading,
        s.kind === 'police',
        false
      );
    });

    // Autonomous Curved-Path Traffic across the 15x Island (Highways, Roundabouts, Boulevards)
    const fleetPalette: Array<[VehicleKind, string, string, string]> = [
      ['sedan', 'Bavaro', 'Bavaro 320', '#64748b'],
      ['coupe', 'Kuroi', 'Kuroi Shinobi', '#ef4444'],
      ['taxi', 'Horizon Cab', 'Horizon Taxík', '#facc15'],
      ['muscle', 'Solano', 'Solano V8', '#3b82f6'],
      ['suv', 'Titanus', 'Titanus Apex', '#f8fafc'],
      ['supercar', 'Valkyra', 'Valkyra Aether', '#fbbf24'],
      ['coupe', 'Kuroi', 'Kuroi Ronin', '#ec4899'],
      ['sedan', 'Bavaro', 'Bavaro M50', '#10b981'],
      ['motorcycle', 'Zeta', 'Zeta Viper', '#f43f5e'],
      ['taxi', 'Horizon Cab', 'Horizon Taxík', '#facc15'],
      ['ambulance', 'VEMS', 'VEMS Sanitka', '#f8fafc'],
      ['firetruck', 'VCFD', 'VCFD Hasičské auto', '#dc2626'],
    ];

    let tIdx = 0;
    TRAFFIC_LOOP_PATHS.forEach((path, pIdx) => {
      const carsOnLoop = pIdx < 2 ? 6 : 4;
      for (let k = 0; k < carsOnLoop; k++) {
        const wpIdx = Math.floor((k / carsOnLoop) * path.length) % path.length;
        const nextIdx = (wpIdx + 1) % path.length;
        const cur = path[wpIdx];
        const nxt = path[nextIdx];
        const segX = nxt.x - cur.x;
        const segZ = nxt.z - cur.z;
        const segLen = Math.hypot(segX, segZ) || 1;
        const laneX = cur.x + (-segZ / segLen) * 3.1;
        const laneZ = cur.z + (segX / segLen) * 3.1;
        const safeSpawn = !(isWaterAt(laneX, laneZ) && !isBridgeAt(laneX, laneZ));
        const spawnX = safeSpawn ? laneX : cur.x;
        const spawnZ = safeSpawn ? laneZ : cur.z;
        const heading = Math.atan2(segX, segZ);
        const spec = fleetPalette[tIdx % fleetPalette.length];
        const veh = this.addVehicle(
          `traffic_${tIdx}`,
          spec[1],
          spec[2],
          spec[0],
          spec[3],
          spawnX,
          spawnZ,
          heading,
          false,
          true,
          pIdx,
          nextIdx
        );
        veh.speed = 11 + (tIdx % 4) * 1.6;
        tIdx += 1;
      }
    });

    // Autonomous Offshore Boats circling the 15x Island Coastline
    for (let b = 0; b < 4; b++) {
      const ang = (b / 4) * Math.PI * 2;
      const r = 1690;
      this.addVehicle(
        `traffic_boat_${b}`,
        'Pelican',
        'Pelican Cruiser',
        'boat',
        b === 0 ? '#0ea5e9' : b === 1 ? '#f43f5e' : b === 2 ? '#fbbf24' : '#10b981',
        Math.cos(ang) * r,
        Math.sin(ang) * r,
        ang,
        false,
        true
      );
    }
  }

  private addVehicle(
    id: string,
    brand: string,
    name: string,
    kind: VehicleKind,
    color: string,
    x: number,
    z: number,
    heading: number,
    isPolice: boolean,
    isTraffic: boolean,
    pathIndex = 0,
    waypointIndex = 0
  ): VehicleEntity {
    const rig = createVehicleRig(kind, color, this.textures.contactShadow);
    if (kind === 'helicopter' || kind === 'plane' || kind === 'fighter_jet') {
      rig.bodyGroup.rotation.order = 'YXZ';
    }
    const startY = kind === 'boat' ? -0.35 : getBridgeElevationAt(x, z);
    rig.root.position.set(x, startY, z);
    rig.root.rotation.y = heading;
    const hasDriver = isTraffic && kind !== 'boat';
    if (rig.driverGroup) {
      rig.driverGroup.visible = hasDriver;
    }
    this.scene.add(rig.root);

    const speedTable: Record<VehicleKind, [number, number]> = {
      sedan: [28, 14],
      taxi: [30, 15],
      suv: [31, 16],
      muscle: [41, 23],
      police: [46, 26],
      ambulance: [36, 18],
      firetruck: [33, 15],
      coupe: [47, 26],
      supercar: [60, 34],
      motorcycle: [50, 31],
      boat: [40, 20],
      plane: [78, 28],
      helicopter: [52, 24],
      fighter_jet: [118, 46],
    };
    const [maxSpeed, accel] = speedTable[kind];
    const maxHealth =
      kind === 'fighter_jet' || kind === 'helicopter' || kind === 'plane' || kind === 'boat' || kind === 'firetruck'
        ? 300
        : kind === 'ambulance' || kind === 'police'
          ? 230
          : 170;

    const v: VehicleEntity = {
      id,
      brand,
      name,
      kind,
      color,
      rig,
      x,
      y: startY,
      z,
      vx: 0,
      vy: 0,
      vz: 0,
      heading,
      pitch: 0,
      roll: 0,
      speed: isTraffic ? 10 : 0,
      steerAngle: 0,
      wheelSpin: 0,
      maxSpeed,
      accel,
      isPolice,
      isTraffic,
      hasDriver,
      stoppedByPlayer: false,
      stopHoldTimer: 0,
      turnCooldown: 1.0,
      pathIndex,
      waypointIndex,
      isDrifting: false,
      driftIntensity: 0,
      occupiedByPlayer: false,
      health: maxHealth,
      maxHealth,
      destroyed: false,
      upgrades: { engineLevel: 0, turbo: false, armorLevel: 0, suspensionLevel: 0 },
    };
    this.vehicles.push(v);
    return v;
  }

  private spawnCivilianAt(
    x: number,
    z: number,
    idxSeed: number,
    behavior: 'wander' | 'flee' | 'fight' = 'wander',
    panicTimer = 0,
    activity: 'stroll' | 'chat' | 'chill' = 'stroll',
    chatTargetX?: number,
    chatTargetZ?: number
  ): NpcEntity {
    const colors = ['#f97316', '#06b6d4', '#ec4899', '#eab308', '#8b5cf6', '#10b981', '#ef4444', '#38bdf8'];
    const skinTones = ['#f1c29b', '#d49a73', '#c68b67', '#b97e5b', '#8d5524'];
    const hairStyles: CharacterAppearance['hairStyle'][] = ['waves', 'bun', 'fade', 'ponytail', 'pompadour', 'buzz'];
    const glassesOpts: CharacterAppearance['glasses'][] = ['none', 'none', 'aviators', 'wayfarer', 'round'];
    const beardOpts: CharacterAppearance['facialHair'][] = ['none', 'none', 'stubble', 'goatee', 'beard'];
    const appearance: CharacterAppearance = {
      skinTone: skinTones[idxSeed % skinTones.length],
      hairStyle: hairStyles[idxSeed % hairStyles.length],
      hairColor: idxSeed % 5 === 0 ? '#a16207' : idxSeed % 4 === 0 ? '#5b3a29' : '#1f1714',
      facialHair: idxSeed % 2 === 0 ? beardOpts[idxSeed % beardOpts.length] : 'none',
      glasses: glassesOpts[idxSeed % glassesOpts.length],
      tattoo: idxSeed % 5 === 0 ? 'sleeve' : 'none',
      jacketStyle: idxSeed % 3 === 0 ? 'cuban' : idxSeed % 3 === 1 ? 'bomber' : 'tank',
      jacketColor: colors[idxSeed % colors.length],
      shirtColor: '#f8fafc',
      pantsColor: idxSeed % 2 === 0 ? '#1e293b' : '#334155',
      shoesColor: '#e2e8f0',
      accessory: idxSeed % 6 === 0 ? 'gold_chain' : 'none',
    };
    const rig = createCharacterRig(appearance, this.textures.contactShadow);
    const resolved = this.resolveBuildingCollision(x, z, 0.45, 0, true);
    rig.root.position.set(resolved.x, 0, resolved.z);

    // ~30% of citizens carry concealed weapons and shoot back if provoked!
    const hasWeapon = idxSeed % 3 === 0 || behavior === 'fight';
    const weaponId: WeaponId = idxSeed % 2 === 0 ? 'pistol' : 'smg';
    let weaponMesh: THREE.Group | undefined;
    if (hasWeapon) {
      weaponMesh = createWeaponMesh(weaponId, '#18181b');
      weaponMesh.visible = behavior === 'fight';
      rig.weaponMount.add(weaponMesh);
      if (behavior === 'fight') {
        rig.rightArmPivot.rotation.x = -Math.PI / 2.2;
      }
    }

    this.scene.add(rig.root);
    const npcNames = ['Elena', 'Marco', 'Sofia', 'Dante', 'Nina', 'Lucas', 'Maya', 'Victor', 'Clara', 'Rafael'];
    const npc: NpcEntity = {
      id: `civ_${Date.now()}_${idxSeed}_${Math.random().toString(36).slice(2, 5)}`,
      name: npcNames[idxSeed % npcNames.length],
      rig,
      x: resolved.x,
      y: 0,
      z: resolved.z,
      heading: chatTargetX !== undefined && chatTargetZ !== undefined
        ? Math.atan2(chatTargetX - resolved.x, chatTargetZ - resolved.z)
        : Math.random() * Math.PI * 2,
      health: hasWeapon ? 70 : 55,
      kind: 'civilian',
      behavior,
      activity,
      chatTargetX,
      chatTargetZ,
      panicTimer,
      shootCooldown: 0.65,
      tackleCooldown: 0,
      wanderAngle: Math.random() * Math.PI * 2,
      wanderTimer: 2 + Math.random() * 3,
      alive: true,
      hasWeapon,
      weaponId,
      weaponMesh,
    };
    this.npcs.push(npc);
    return npc;
  }

  private spawnAmbientCivilians() {
    // Conversing pairs near Coral Strip, Slnečné námestie, Downtown, Marina & Beaches
    const pairs: [number, number][] = [
      [445, -112],
      [475, -130],
      [-28, -56],
      [34, 14],
      [512, -96],
      [-285, -208],
      [785, -90],
      [510, 560],
      [-740, 565],
      [148, -225],
    ];
    pairs.forEach(([px, pz], i) => {
      if (!isWaterAt(px, pz)) {
        this.spawnCivilianAt(px - 0.75, pz, i * 2, 'wander', 0, 'chat', px + 0.75, pz);
        this.spawnCivilianAt(px + 0.75, pz, i * 2 + 1, 'wander', 0, 'chat', px - 0.75, pz);
      }
    });

    // Strolling & chilling pedestrians across the 15x Island
    for (let i = 0; i < 20; i++) {
      const ang = (i / 20) * Math.PI * 2;
      const r = 80 + (i % 6) * 195;
      const sx = Math.cos(ang) * r;
      const sz = Math.sin(ang) * r;
      if (!isWaterAt(sx, sz)) {
        const act = isOnBeachAt(sx, sz) ? 'chill' : 'stroll';
        this.spawnCivilianAt(sx, sz, i + 20, 'wander', 0, act);
      }
    }
  }

  private spawnHostileNpc(kind: 'police' | 'enemy', x: number, z: number) {
    const isCop = kind === 'police';
    const appearance: CharacterAppearance = isCop
      ? {
          skinTone: '#d49a73',
          hairStyle: 'buzz',
          hairColor: '#18181b',
          facialHair: 'stubble',
          glasses: 'aviators',
          tattoo: 'none',
          jacketStyle: 'tech',
          jacketColor: '#1e3a8a',
          shirtColor: '#1e293b',
          pantsColor: '#0f172a',
          shoesColor: '#09090b',
          accessory: 'cap',
        }
      : {
          skinTone: '#b97e5b',
          hairStyle: 'fade',
          hairColor: '#111827',
          facialHair: 'beard',
          glasses: 'none',
          tattoo: 'sleeve',
          jacketStyle: 'bomber',
          jacketColor: '#991b1b',
          shirtColor: '#18181b',
          pantsColor: '#27272a',
          shoesColor: '#09090b',
          accessory: 'tactical_vest',
        };
    const rig = createCharacterRig(appearance, this.textures.contactShadow);
    const wMesh = createWeaponMesh(isCop ? 'pistol' : 'smg', '#18181b');
    rig.weaponMount.add(wMesh);
    rig.rightArmPivot.rotation.x = -Math.PI / 2.2;
    rig.root.position.set(x, 0, z);
    this.scene.add(rig.root);

    this.npcs.push({
      id: `${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      rig,
      x,
      y: 0,
      z,
      heading: 0,
      health: isCop ? 85 : 95,
      kind,
      behavior: 'fight',
      activity: 'stroll',
      panicTimer: 0,
      shootCooldown: 0.7 + Math.random() * 0.6,
      tackleCooldown: 0,
      wanderAngle: 0,
      wanderTimer: 1,
      alive: true,
    });
  }

  private spawnClubBouncers(initial = false) {
    const cx = MALIBU_CLUB.x;
    const cz = MALIBU_CLUB.z;
    const spots: { x: number; z: number; heading: number; weapon: WeaponId }[] = initial
      ? [
          { x: MALIBU_CLUB.doorX - 1.6, z: cz - 3.6, heading: -Math.PI / 2, weapon: 'pistol' },
          { x: MALIBU_CLUB.doorX - 1.6, z: cz + 3.6, heading: -Math.PI / 2, weapon: 'smg' },
          { x: cx + 4.5, z: cz - 5.5, heading: -Math.PI / 2, weapon: 'smg' },
        ]
      : [
          { x: cx + 6.5, z: cz - 6.0, heading: -Math.PI / 2, weapon: 'smg' },
          { x: cx + 6.5, z: cz + 6.0, heading: -Math.PI / 2, weapon: 'pistol' },
          { x: cx - 1.5, z: cz + 6.5, heading: Math.PI, weapon: 'smg' },
        ];

    for (let i = 0; i < spots.length; i++) {
      const sp = spots[i];
      const rig = createCharacterRig(
        {
          skinTone: i % 2 === 0 ? '#c68b67' : '#8d5524',
          hairStyle: 'buzz',
          hairColor: '#111827',
          facialHair: i === 1 ? 'beard' : 'stubble',
          glasses: 'aviators',
          tattoo: 'none',
          jacketStyle: 'suit',
          jacketColor: '#09090b',
          shirtColor: '#18181b',
          pantsColor: '#09090b',
          shoesColor: '#09090b',
          accessory: 'watch',
        },
        this.textures.contactShadow
      );
      const wMesh = createWeaponMesh(sp.weapon, '#18181b');
      wMesh.visible = !initial;
      rig.weaponMount.add(wMesh);
      rig.root.position.set(sp.x, 0, sp.z);
      rig.root.rotation.y = sp.heading;
      this.scene.add(rig.root);

      this.npcs.push({
        id: `bouncer_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 5)}`,
        name: 'Ochranka klubu Malibu',
        rig,
        x: sp.x,
        y: 0,
        z: sp.z,
        heading: sp.heading,
        health: 110,
        kind: 'bouncer',
        behavior: initial ? 'wander' : 'fight',
        activity: 'chill',
        guardHomeX: sp.x,
        guardHomeZ: sp.z,
        guardHeading: sp.heading,
        panicTimer: 0,
        shootCooldown: 0.45 + i * 0.2,
        tackleCooldown: 0,
        wanderAngle: sp.heading,
        wanderTimer: 2,
        alive: true,
        hasWeapon: true,
        weaponId: sp.weapon,
        weaponMesh: wMesh,
      });
    }
  }

  private alertClubBouncers(showNotice = true) {
    let aliveBouncers = 0;
    for (const n of this.npcs) {
      if (n.alive && n.kind === 'bouncer') {
        aliveBouncers += 1;
        n.behavior = 'fight';
        if (n.weaponMesh) n.weaponMesh.visible = true;
        n.rig.rightArmPivot.rotation.x = -Math.PI / 2.2;
      }
    }
    if (aliveBouncers === 0 && this.clubBouncerRespawnTimer <= 0) {
      this.spawnClubBouncers(false);
      this.clubBouncerRespawnTimer = 25;
    }
    this.clubBouncersAlerted = true;
    if (showNotice && !this.clubAlarmNoticeShown) {
      this.clubAlarmNoticeShown = true;
      this.stuntMessage = 'Ochranka klubu Malibu spustila paľbu! Hľadaná osoba v klube!';
      this.stuntTimer = 3.6;
      this.audio.playUiChime('switch');
    }
  }

  private stepClubSecurity(dt: number, px: number, py: number, pz: number) {
    if (this.clubBouncerRespawnTimer > 0) {
      this.clubBouncerRespawnTimer = Math.max(0, this.clubBouncerRespawnTimer - dt);
    }

    const inClub =
      Math.abs(px - MALIBU_CLUB.x) <= 18.2 &&
      Math.abs(pz - MALIBU_CLUB.z) <= 14.2 &&
      py < 7.5;
    const hasActivePolice = this.wantedStars > 0 && !this.settings.gameplayMods.noPolice;

    if (inClub && hasActivePolice) {
      if (!this.clubBouncersAlerted) {
        this.alertClubBouncers(true);
      } else {
        // Ensure respawned reinforcements also mobilize if player stays inside while wanted
        const anyAlive = this.npcs.some((n) => n.alive && n.kind === 'bouncer');
        if (!anyAlive && this.clubBouncerRespawnTimer <= 0) {
          this.spawnClubBouncers(false);
          this.clubBouncerRespawnTimer = 25;
        }
      }
    } else if (this.clubBouncersAlerted && !hasActivePolice && Math.hypot(px - MALIBU_CLUB.x, pz - MALIBU_CLUB.z) > 34) {
      this.clubBouncersAlerted = false;
      this.clubAlarmNoticeShown = false;
      for (const n of this.npcs) {
        if (n.alive && n.kind === 'bouncer') {
          n.behavior = 'wander';
          if (n.weaponMesh) n.weaponMesh.visible = false;
          n.rig.rightArmPivot.rotation.x = 0;
        }
      }
    }
  }

  public syncEquippedWeaponMesh() {
    // 3rd person weapon mount
    while (this.playerRig.weaponMount.children.length > 1) {
      // keep muzzlePoint at index 0
      const child = this.playerRig.weaponMount.children[1];
      this.playerRig.weaponMount.remove(child);
    }
    const owned = this.inventory.weapons.find((w) => w.id === this.inventory.equippedWeapon);
    const skin = owned?.skinColor || '#27272a';
    const tpMesh = createWeaponMesh(this.inventory.equippedWeapon, skin);
    this.playerRig.weaponMount.add(tpMesh);
    this.playerRig.muzzlePoint.position.set(0, 0.05, getWeaponMuzzleOffset(this.inventory.equippedWeapon));

    // 1st person viewmodel
    while (this.firstPersonWeaponGroup.children.length > 0) {
      this.firstPersonWeaponGroup.remove(this.firstPersonWeaponGroup.children[0]);
    }
    const fpMesh = createWeaponMesh(this.inventory.equippedWeapon, skin);
    fpMesh.scale.setScalar(1.25);
    this.firstPersonWeaponGroup.add(fpMesh);
  }

  public applySettings(settings: GameSettings) {
    this.settings = structuredClone(settings);
    this.audio.applySettings(settings.audio);
    this.input.updateSettings(settings.controls);

    // Graphics settings & Bloom
    const pr = this.computePixelRatio();
    this.renderer.setPixelRatio(pr);
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      const w = this.container.clientWidth || window.innerWidth;
      const h = this.container.clientHeight || window.innerHeight;
      this.composer.setSize(w, h);
    }
    if (this.bloomPass) {
      this.bloomPass.enabled = settings.graphics.preset === 'high' || settings.graphics.preset === 'ultra';
      this.bloomPass.strength = settings.graphics.preset === 'ultra' ? 0.28 : 0.20;
    }
    this.camera.fov = settings.graphics.fov;
    this.camera.updateProjectionMatrix();

    const sq = settings.graphics.shadowQuality;
    const shadowsEnabled = !this.isSoftwareGl && sq !== 'off';
    this.renderer.shadowMap.enabled = shadowsEnabled;
    this.sunLight.castShadow = shadowsEnabled;
    const mapRes = sq === 'high' ? 2048 : sq === 'medium' ? 1024 : 512;
    if (this.sunLight.shadow.mapSize.width !== mapRes) {
      this.sunLight.shadow.mapSize.set(mapRes, mapRes);
      this.sunLight.shadow.map?.dispose();
      this.sunLight.shadow.map = null;
    }
    this.renderer.shadowMap.needsUpdate = true;

    // Time of Day, Weather Override & Sandbox Mod Cheat Detection
    const tod = settings.gameplayMods.timeOfDay;
    if (tod === 'sunset') this.gameTimeNormalized = 0.76;
    else if (tod === 'noon') this.gameTimeNormalized = 0.5;
    else if (tod === 'night') this.gameTimeNormalized = 0.02;

    if (settings.gameplayMods.weatherOverride && settings.gameplayMods.weatherOverride !== 'auto') {
      this.targetWeatherType = settings.gameplayMods.weatherOverride;
      this.weatherType = settings.gameplayMods.weatherOverride;
    }

    const gm = settings.gameplayMods;
    if (gm.lowGravity || gm.infiniteAmmo || gm.rapidFire || gm.turboVehicles || gm.noPolice) {
      this.activateCheatSession();
    }

    this.updateAtmosphere(0);

    if (settings.gameplayMods.noPolice && (this.wantedStars > 0 || this.policeDispatchTimer > 0)) {
      this.clearPolicePursuit();
    }
  }

  public setTimeOfDay(normalized: number) {
    this.gameTimeNormalized = ((normalized % 1) + 1) % 1;
    this.updateAtmosphere(0);
  }

  private getGameClockString(): string {
    const totalMinutes = Math.floor(this.gameTimeNormalized * 1440) % 1440;
    const hh = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
    const mm = String(totalMinutes % 60).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  private getWeatherLabelSk(w: WeatherType): string {
    const labels: Record<WeatherType, string> = {
      clear: 'Jasno',
      partly_cloudy: 'Polooblačno',
      overcast: 'Zamračené',
      rain: 'Dážď',
      storm: 'Búrka',
      foggy: 'Hmlisto',
    };
    return labels[w] || 'Jasno';
  }

  private updateAtmosphere(dt: number) {
    // 1. Day/Night clock (3x faster when auto)
    if (dt > 0 && this.settings.gameplayMods.timeOfDay === 'auto') {
      this.gameTimeNormalized = (this.gameTimeNormalized + (dt * 3) / 1440) % 1;
    }

    // 2. Smooth Weather State Machine
    const override = this.settings.gameplayMods.weatherOverride;
    if (override && override !== 'auto') {
      this.targetWeatherType = override;
      this.weatherType = override;
    } else if (dt > 0) {
      this.weatherChangeTimer -= dt;
      if (this.weatherChangeTimer <= 0) {
        this.weatherChangeTimer = 75 + Math.random() * 65;
        const seq: WeatherType[] = ['clear', 'partly_cloudy', 'overcast', 'rain', 'storm', 'partly_cloudy', 'foggy'];
        const curIdx = seq.indexOf(this.weatherType);
        const nextIdx = Math.random() < 0.72 ? (curIdx + 1) % seq.length : Math.floor(Math.random() * seq.length);
        this.targetWeatherType = seq[nextIdx];
        this.weatherType = this.targetWeatherType;
      }
    }

    const weatherTargets: Record<WeatherType, { cloud: number; rain: number; fogBoost: number }> = {
      clear: { cloud: 0.16, rain: 0.0, fogBoost: 0.0 },
      partly_cloudy: { cloud: 0.48, rain: 0.0, fogBoost: 0.08 },
      overcast: { cloud: 0.85, rain: 0.0, fogBoost: 0.25 },
      rain: { cloud: 0.94, rain: 0.72, fogBoost: 0.45 },
      storm: { cloud: 1.0, rain: 1.0, fogBoost: 0.65 },
      foggy: { cloud: 0.65, rain: 0.0, fogBoost: 1.15 },
    };
    const wt = weatherTargets[this.weatherType] || weatherTargets.clear;
    const wRate = dt > 0 ? 0.35 : 50;
    this.cloudCoverage = THREE.MathUtils.damp(this.cloudCoverage, wt.cloud, wRate, Math.max(0.016, dt));
    this.rainIntensity = THREE.MathUtils.damp(this.rainIntensity, wt.rain, wRate, Math.max(0.016, dt));
    this.fogWeatherBoost = THREE.MathUtils.damp(this.fogWeatherBoost, wt.fogBoost, wRate, Math.max(0.016, dt));

    // Storm thunder & lightning flashes
    if (this.lightningFlash > 0 && dt > 0) {
      this.lightningFlash = Math.max(0, this.lightningFlash - dt * 3.8);
    }
    if (this.weatherType === 'storm' && this.rainIntensity > 0.6 && dt > 0) {
      this.thunderCooldown -= dt;
      if (this.thunderCooldown <= 0) {
        this.thunderCooldown = 9 + Math.random() * 14;
        this.lightningFlash = 0.95;
        this.audio.playThunder();
      }
    }

    // Wet road asphalt reflections during rain/storm
    const wetRoughness = THREE.MathUtils.lerp(0.92, 0.24, this.rainIntensity);
    for (const rMat of this.wettableRoadMaterials) {
      rMat.roughness = wetRoughness;
    }

    // Rain particle drop animation anchored around active camera (never inside buildings or under roofs)
    if (this.rainPoints) {
      const activeRain = this.rainIntensity > 0.06;
      this.rainPoints.visible = activeRain;
      (this.rainPoints.material as THREE.PointsMaterial).opacity = this.rainIntensity * 0.56;
      if (activeRain && dt > 0) {
        const cx = this.camera.position.x;
        const cy = this.camera.position.y;
        const cz = this.camera.position.z;
        const fallSpeed = 28 + this.rainIntensity * 14;
        const len = this.rainPositions.length;
        for (let i = 0; i < len; i += 3) {
          let rx = this.rainPositions[i] + 1.8 * dt;
          let ry = this.rainPositions[i + 1] - fallSpeed * dt;
          let rz = this.rainPositions[i + 2];

          const outOfRange = ry < cy - 8 || ry < 0.05 || Math.abs(rx - cx) > 22 || Math.abs(rz - cz) > 22;
          if (outOfRange || this.isUnderRoofAt(rx, ry, rz)) {
            let placed = false;
            for (let attempt = 0; attempt < 4; attempt++) {
              const candX = cx + (Math.random() - 0.5) * 40;
              const candY = cy + 8 + Math.random() * 11;
              const candZ = cz + (Math.random() - 0.5) * 40;
              if (!this.isUnderRoofAt(candX, candY, candZ) && !this.isUnderRoofAt(candX, Math.max(0.5, cy), candZ)) {
                rx = candX;
                ry = candY;
                rz = candZ;
                placed = true;
                break;
              }
            }
            if (!placed) {
              // Park off-screen below ground if candidate landed under a roof/building
              ry = -250;
            }
          }
          this.rainPositions[i] = rx;
          this.rainPositions[i + 1] = ry;
          this.rainPositions[i + 2] = rz;
        }
        (this.rainPoints.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      }
    }

    // Dynamic drifting clouds
    if (this.cloudGroup) {
      const targetVisOpacity = THREE.MathUtils.clamp(this.cloudCoverage * 0.85, 0.06, 0.86);
      const cloudShade = THREE.MathUtils.lerp(1.0, 0.52, this.rainIntensity);
      for (let i = 0; i < this.cloudGroup.children.length; i++) {
        const cloud = this.cloudGroup.children[i];
        cloud.position.x += dt * (2.0 + this.rainIntensity * 3.2 + (i % 3) * 0.7);
        if (cloud.position.x > 1650) cloud.position.x = -1650;
        cloud.visible = i / this.cloudGroup.children.length <= this.cloudCoverage + 0.08;
      }
      for (const m of this.cloudMaterials) {
        m.opacity = targetVisOpacity;
        m.color.setRGB(cloudShade, cloudShade, cloudShade * 1.03);
      }
    }

    // Throttle expensive sky/fog/windowGlow material updates to ~12 Hz (instant on dt === 0 or lightning flash)
    this.atmosphereTimer -= dt;
    if (dt > 0 && this.lightningFlash <= 0.01 && this.atmosphereTimer > 0) {
      return;
    }
    this.atmosphereTimer = 0.08;

    // Compute smooth solar elevation (-1 midnight .. 0 sunrise/sunset .. +1 noon)
    const sunAngle = (this.gameTimeNormalized - 0.25) * Math.PI * 2;
    const sunY = Math.sin(sunAngle);
    const sunX = Math.cos(sunAngle);
    const dayWeight = THREE.MathUtils.smoothstep(sunY, -0.15, 0.35);
    const sunsetWeight = Math.exp(-Math.pow((sunY - 0.05) / 0.22, 2)) * (1 - this.rainIntensity * 0.7);

    _cDayHor.copy(_cDayHorBase).lerp(_cRainHor, this.rainIntensity * 0.75);
    _cDayMid.copy(_cDayMidBase).lerp(_cRainMid, this.rainIntensity * 0.82);
    _cDayTop.copy(_cDayTopBase).lerp(_cRainTop, this.rainIntensity * 0.85);
    _cSunMid.copy(_cSunMidBase).lerp(_cRainTop, 0.35);

    _cHor.copy(_cNightHor).lerp(_cDayHor, dayWeight).lerp(_cSunHor, sunsetWeight * 0.85);
    _cMid.copy(_cNightMid).lerp(_cDayMid, dayWeight).lerp(_cSunMid, sunsetWeight * 0.78);
    _cTop.copy(_cNightTop).lerp(_cDayTop, dayWeight).lerp(_cSunTop, sunsetWeight * 0.7);

    if (this.lightningFlash > 0.05) {
      _cHor.lerp(_cLightningA, this.lightningFlash * 0.45);
      _cMid.lerp(_cLightningB, this.lightningFlash * 0.35);
    }

    this.skyMat.uniforms.uHorizonColor.value.copy(_cHor);
    this.skyMat.uniforms.uMidColor.value.copy(_cMid);
    this.skyMat.uniforms.uTopColor.value.copy(_cTop);
    this.skyMat.uniforms.uSunDir.value.set(sunX * 0.8, Math.max(-0.2, sunY), 0.42).normalize();
    this.skyMat.uniforms.uSunColor.value.set(sunsetWeight > 0.4 ? 0xffedd5 : 0xfffbeb);
    this.skyMat.uniforms.uSunStrength.value = THREE.MathUtils.lerp(0.28, 1.05, Math.max(dayWeight, sunsetWeight)) * (1 - this.rainIntensity * 0.7);

    _cFog.copy(_cHor).lerp(_cMid, 0.22);
    const baseFog = Math.max(0.0005, 0.24 / Math.max(200, this.settings.graphics.viewDistance));
    const fogDensity = baseFog * (1 + this.fogWeatherBoost * 1.45);
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.copy(_cFog);
    } else {
      this.scene.background = _cFog.clone();
    }
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.copy(_cFog);
      this.scene.fog.density = fogDensity * THREE.MathUtils.lerp(1.12, 0.78, dayWeight);
    } else {
      this.scene.fog = new THREE.FogExp2(_cFog.getHex(), fogDensity);
    }

    _cSunCol.copy(_cSunLow).lerp(_cSunHigh, dayWeight).lerp(_cSunWarm, sunsetWeight * 0.8);
    this.sunLight.color.copy(_cSunCol);
    const rainDim = 1 - this.rainIntensity * 0.45;
    this.sunLight.intensity = THREE.MathUtils.lerp(0.45, 1.82, Math.max(dayWeight, sunsetWeight * 0.75)) * rainDim + this.lightningFlash * 2.1;
    this.rimLight.color.set(dayWeight > 0.5 ? 0xe0f2fe : 0x60a5fa);
    this.rimLight.intensity = THREE.MathUtils.lerp(0.24, 0.34, dayWeight);
    this.hemiLight.color.set(dayWeight > 0.45 ? 0xbae6fd : 0x3b82f6);
    this.hemiLight.groundColor.set(dayWeight > 0.45 ? 0x475569 : 0x0f172a);
    this.hemiLight.intensity = THREE.MathUtils.lerp(0.28, 0.48, dayWeight);
    this.renderer.toneMappingExposure = THREE.MathUtils.lerp(0.86, 0.94, Math.max(dayWeight, sunsetWeight));

    const windowGlow = THREE.MathUtils.lerp(0.65, 0.04, dayWeight * (1 - this.rainIntensity * 0.3));
    for (const wm of this.buildingWindowMaterials) {
      if ('emissiveIntensity' in wm) {
        (wm as THREE.MeshStandardMaterial).emissiveIntensity = windowGlow;
      }
    }
  }

  public setPaused(paused: boolean) {
    this.input.paused = paused;
    if (paused) {
      this.input.exitPointerLock();
      this.input.clearKeys();
    }
  }

  public setWardrobePreview(enabled: boolean) {
    this.wardrobePreview = enabled;
    if (enabled && this.currentVehicle) {
      this.exitCurrentVehicle();
    }
  }

  public updateCharacterAppearance(charId: CharacterId, appearance: CharacterAppearance) {
    this.characters[charId].appearance = { ...appearance };
    if (charId === this.activeCharId) {
      updateCharacterRigAppearance(this.playerRig, appearance);
    }
  }

  public switchCharacter(nextId: CharacterId) {
    if (nextId === this.activeCharId) return;
    if (this.currentVehicle) {
      this.exitCurrentVehicle();
    }

    // Save current character position & state
    const prev = this.characters[this.activeCharId];
    prev.posX = this.playerRig.root.position.x;
    prev.posY = this.playerRig.root.position.y;
    prev.posZ = this.playerRig.root.position.z;
    prev.heading = this.camYaw;

    this.activeCharId = nextId;
    const next = this.characters[nextId];

    this.playerRig.root.position.set(next.posX, next.posY, next.posZ);
    this.camYaw = next.heading;
    updateCharacterRigAppearance(this.playerRig, next.appearance);
    this.playerVelX = 0;
    this.playerVelY = 0;
    this.playerVelZ = 0;

    // Trigger GTA-style aerial swoop transition
    this.switchSwoopTimer = 0.75;
    this.audio.playUiChime('switch');
    this.callbacks.onCharactersChange(structuredClone(this.characters), this.activeCharId);
  }

  public cycleCameraMode(): CameraMode {
    const order: CameraMode[] = ['third_person', 'third_person_far', 'first_person'];
    const nextIdx = (order.indexOf(this.cameraMode) + 1) % order.length;
    this.cameraMode = order[nextIdx];
    this.audio.playUiChime('click');
    return this.cameraMode;
  }

  public setCameraMode(mode: CameraMode) {
    this.cameraMode = mode;
  }

  public cycleWeapon(): WeaponId {
    const unlocked = this.inventory.weapons.filter((w) => w.unlocked);
    if (unlocked.length <= 1) return this.inventory.equippedWeapon;
    const idx = unlocked.findIndex((w) => w.id === this.inventory.equippedWeapon);
    const next = unlocked[(idx + 1) % unlocked.length];
    this.inventory.equippedWeapon = next.id;
    this.reloadTimer = 0;
    this.syncEquippedWeaponMesh();
    this.callbacks.onInventoryChange(structuredClone(this.inventory));
    this.audio.playUiChime('click');
    return next.id;
  }

  public equipWeapon(weaponId: WeaponId) {
    const found = this.inventory.weapons.find((w) => w.id === weaponId && w.unlocked);
    if (!found) return;
    this.inventory.equippedWeapon = weaponId;
    this.reloadTimer = 0;
    this.syncEquippedWeaponMesh();
    this.callbacks.onInventoryChange(structuredClone(this.inventory));
  }

  public updateInventoryExternal(inv: InventoryState, newCash?: number) {
    this.inventory = structuredClone(inv);
    if (typeof newCash === 'number') {
      this.cash = newCash;
    }
    this.syncEquippedWeaponMesh();
  }

  public updateCharactersExternal(chars: Record<CharacterId, CharacterState>, activeId: CharacterId) {
    this.characters = structuredClone(chars);
    this.activeCharId = activeId;
    const ch = this.characters[activeId];
    this.playerRig.root.position.set(ch.posX, ch.posY, ch.posZ);
    updateCharacterRigAppearance(this.playerRig, ch.appearance);
  }

  public useConsumable(itemId: string): boolean {
    const item = this.inventory.consumables.find((c) => c.id === itemId);
    if (!item || item.quantity <= 0) return false;
    const ch = this.characters[this.activeCharId];

    if (item.effectType === 'heal') {
      if (ch.health >= ch.maxHealth) return false;
      ch.health = Math.min(ch.maxHealth, ch.health + item.amount);
    } else if (item.effectType === 'armor') {
      if (ch.armor >= ch.maxArmor) return false;
      ch.armor = Math.min(ch.maxArmor, ch.armor + item.amount);
    } else if (item.effectType === 'stamina') {
      ch.health = Math.min(ch.maxHealth, ch.health + item.amount);
      this.playerStamina = 100;
    }

    item.quantity -= 1;
    this.audio.playUiChime('switch');
    this.callbacks.onInventoryChange(structuredClone(this.inventory));
    this.callbacks.onCharactersChange(structuredClone(this.characters), this.activeCharId);
    return true;
  }

  public setMissionsProgress(progress: Record<string, MissionProgressRecord>) {
    this.missionsProgress = structuredClone(progress);
    this.refreshMissionBeaconVisibility();
  }

  private refreshMissionBeaconVisibility() {
    for (const b of this.missionStartBeacons) {
      const unlocked = isMissionUnlocked(b.mission.id, this.missionsProgress);
      b.group.visible = !this.activeMission && !this.cheatSessionActive && unlocked;
    }
  }

  public setGpsWaypoint(x: number, z: number, label: string) {
    this.gpsWaypoint = { x, z, label };
    if (!this.activeMission) {
      this.waypointGroup.position.set(x, 0, z);
      this.waypointGroup.visible = true;
      (this.waypointBeam.material as THREE.MeshBasicMaterial).color.setHex(0x38bdf8);
      (this.waypointRing.material as THREE.MeshBasicMaterial).color.setHex(0x38bdf8);
    }
    this.audio.playUiChime('click');
  }

  public clearGpsWaypoint() {
    this.gpsWaypoint = null;
    if (!this.activeMission) {
      this.waypointGroup.visible = false;
    }
  }

  public healAtSafehouse() {
    const ch = this.characters[this.activeCharId];
    ch.health = ch.maxHealth;
    ch.armor = ch.maxArmor;
    this.playerStamina = 100;
    if (this.wantedStars > 0 && this.wantedStars <= 2) {
      this.clearPolicePursuit();
    }
    this.stuntMessage = 'Úkryt: Zdravie a vesta doplnené naplno!';
    this.stuntTimer = 3.0;
    this.audio.playUiChime('mission');
    this.callbacks.onCharactersChange(structuredClone(this.characters), this.activeCharId);
  }

  public visitHospital() {
    const ch = this.characters[this.activeCharId];
    const fee = this.cash >= 150 ? 150 : 0;
    if (fee > 0) {
      this.cash -= fee;
      this.callbacks.onCashChange(this.cash);
    }
    ch.health = ch.maxHealth;
    this.playerStamina = 100;
    this.stuntMessage =
      fee > 0
        ? `Nemocnica Vice Central: Ošetrenie dokončené (-$${fee})`
        : 'Nemocnica Vice Central: Zdravie doplnené naplno!';
    this.stuntTimer = 3.2;
    this.audio.playUiChime('mission');
    this.callbacks.onCharactersChange(structuredClone(this.characters), this.activeCharId);
  }

  public visitPoliceStation() {
    if (this.wantedStars > 0) {
      const fine = Math.min(this.cash, this.wantedStars * 200);
      this.cash = Math.max(0, this.cash - fine);
      this.clearPolicePursuit();
      this.callbacks.onCashChange(this.cash);
      this.stuntMessage = `VCPD Stanica: Pokuta zaplatená (-$${fine}), pátranie zrušené`;
    } else {
      const ch = this.characters[this.activeCharId];
      ch.armor = Math.max(ch.armor, Math.round(ch.maxArmor * 0.75));
      this.callbacks.onCharactersChange(structuredClone(this.characters), this.activeCharId);
      this.stuntMessage = 'VCPD Policajná stanica: Taktičká vesta doplnená!';
    }
    this.stuntTimer = 3.2;
    this.audio.playUiChime('mission');
  }

  public visitFireStation() {
    const ch = this.characters[this.activeCharId];
    ch.health = Math.min(ch.maxHealth, ch.health + 40);
    ch.armor = ch.maxArmor;
    this.playerStamina = 100;
    this.stuntMessage = 'Hasičská stanica VCFD: Vesta a prvá pomoc doplnené!';
    this.stuntTimer = 3.0;
    this.audio.playUiChime('mission');
    this.callbacks.onCharactersChange(structuredClone(this.characters), this.activeCharId);
  }

  private clearPolicePursuit() {
    this.wantedStars = 0;
    this.wantedHeat = 0;
    this.wantedEvading = false;
    this.evasionProgress = 0;
    this.arrestProgress = 0;
    this.policeDispatchTimer = 0;
    this.policeDispatchReason = null;
    this.pendingDispatchStars = 0;
    this.clubBouncersAlerted = false;
    this.clubAlarmNoticeShown = false;

    this.npcs = this.npcs.filter((n) => {
      if (n.kind === 'police') {
        this.scene.remove(n.rig.root);
        return false;
      }
      if (n.kind === 'bouncer') {
        n.behavior = 'wander';
        if (n.weaponMesh) n.weaponMesh.visible = false;
        n.rig.rightArmPivot.rotation.x = 0;
      }
      return true;
    });

    this.vehicles = this.vehicles.filter((v) => {
      if (v.id.startsWith('copcar_') && !v.occupiedByPlayer) {
        this.scene.remove(v.rig.root);
        return false;
      }
      if (v.isPolice && !v.occupiedByPlayer) {
        v.speed = 0;
        v.vx = 0;
        v.vz = 0;
        this.updateVehicleBeacon(v);
      }
      return true;
    });
  }

  public getNearbyRepairCost(): number {
    const target = this.currentVehicle || this.lastLandVehicle;
    if (!target || target.destroyed) return 0;
    const damageRatio = 1 - THREE.MathUtils.clamp(target.health / Math.max(1, target.maxHealth), 0, 1);
    return Math.max(40, Math.round(40 + damageRatio * 480));
  }

  public repairAndRepaintVehicle(colorHex?: string): boolean {
    const target = this.currentVehicle || this.lastLandVehicle;
    if (!target || target.destroyed) return false;
    target.health = target.maxHealth;
    resetVehicleDeformation(target.rig);
    if (colorHex && target.rig.paintMat) {
      target.color = colorHex;
      target.rig.paintMat.color.set(colorHex);
    }
    this.stuntMessage = `Servis: ${target.name} opravený a karoséria vyrovnaná!`;
    this.stuntTimer = 3.0;
    this.audio.playUiChime('mission');
    return true;
  }

  public upgradeCurrentVehicle(type: 'engine' | 'turbo' | 'armor' | 'suspension'): {
    ok: boolean;
    cost: number;
    message: string;
  } {
    const target = this.currentVehicle || this.lastLandVehicle;
    if (!target || target.destroyed) {
      return { ok: false, cost: 0, message: 'Najprv zaparkuj vozidlo pred servisom.' };
    }
    let cost = 0;
    let label = '';
    if (type === 'engine') {
      if (target.upgrades.engineLevel >= 3) return { ok: false, cost: 0, message: 'Motor je už na maxime (Úroveň 3).' };
      cost = 900 + target.upgrades.engineLevel * 650;
      if (this.cash < cost) return { ok: false, cost, message: `Nedostatok peňazí ($${cost}).` };
      target.upgrades.engineLevel = (target.upgrades.engineLevel + 1) as 0 | 1 | 2 | 3;
      label = `Motor Stage ${target.upgrades.engineLevel}`;
    } else if (type === 'turbo') {
      if (target.upgrades.turbo) return { ok: false, cost: 0, message: 'Twin-Turbo je už nainštalované.' };
      cost = 2200;
      if (this.cash < cost) return { ok: false, cost, message: `Nedostatok peňazí ($${cost}).` };
      target.upgrades.turbo = true;
      label = 'Twin-Turbo kit';
    } else if (type === 'armor') {
      if (target.upgrades.armorLevel >= 2) return { ok: false, cost: 0, message: 'Pancier je na maxime.' };
      cost = 1200 + target.upgrades.armorLevel * 900;
      if (this.cash < cost) return { ok: false, cost, message: `Nedostatok peňazí ($${cost}).` };
      target.upgrades.armorLevel = (target.upgrades.armorLevel + 1) as 0 | 1 | 2;
      target.maxHealth += 90;
      target.health = target.maxHealth;
      label = `Balistický pancier ${target.upgrades.armorLevel}`;
    } else {
      if (target.upgrades.suspensionLevel >= 2) return { ok: false, cost: 0, message: 'Podvozok je na maxime.' };
      cost = 750 + target.upgrades.suspensionLevel * 600;
      if (this.cash < cost) return { ok: false, cost, message: `Nedostatok peňazí ($${cost}).` };
      target.upgrades.suspensionLevel = (target.upgrades.suspensionLevel + 1) as 0 | 1 | 2;
      label = `Športový podvozok ${target.upgrades.suspensionLevel}`;
    }

    this.cash -= cost;
    this.callbacks.onCashChange(this.cash);
    this.audio.playUiChime('mission');
    this.stuntMessage = `${target.name}: Nainštalovaný ${label}!`;
    this.stuntTimer = 3.0;
    return { ok: true, cost, message: `${label} nainštalovaný (-$${cost}).` };
  }

  public setSavedGarage(garage: SavedGarageState) {
    this.savedGarage = structuredClone(garage);
  }

  public getSavedGarage(): SavedGarageState {
    return structuredClone(this.savedGarage);
  }

  public retrieveSavedVehicle(facility: 'hangar' | 'safehouse', index: number): boolean {
    const list = facility === 'hangar' ? this.savedGarage.hangarVehicles : this.savedGarage.safehouseVehicles;
    const rec = list[index];
    if (!rec) return false;
    const existing = this.vehicles.find((v) => v.id === rec.id && !v.destroyed);
    const spawnX = facility === 'hangar' ? AIRPORT_HANGAR_ZONE.doorX : SAFEHOUSE_GARAGE_ZONE.doorX;
    const spawnZ = facility === 'hangar' ? AIRPORT_HANGAR_ZONE.doorZ + 8 : SAFEHOUSE_GARAGE_ZONE.doorZ + 6;
    if (existing) {
      existing.x = spawnX;
      existing.z = spawnZ;
      existing.y = this.getGroundHeightAt(spawnX, spawnZ, 0);
      existing.speed = 0;
      existing.vx = 0;
      existing.vz = 0;
      existing.heading = rec.heading || 0;
      existing.health = existing.maxHealth;
      resetVehicleDeformation(existing.rig);
      existing.rig.root.position.set(existing.x, existing.y, existing.z);
      existing.rig.root.rotation.y = existing.heading;
    } else {
      const veh = this.addVehicle(
        rec.id || `stored_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        rec.brand,
        rec.name,
        rec.kind,
        rec.color,
        spawnX,
        spawnZ,
        rec.heading || 0,
        rec.kind === 'police',
        false
      );
      if (rec.upgrades) {
        veh.upgrades = { ...rec.upgrades };
        veh.maxHealth += rec.upgrades.armorLevel * 90;
        veh.health = veh.maxHealth;
      }
    }
    this.stuntMessage = `${rec.name} pristavené pred ${facility === 'hangar' ? 'hangár' : 'garáž'}!`;
    this.stuntTimer = 3.2;
    this.audio.playUiChime('mission');
    return true;
  }

  public buyParachute(): boolean {
    if (this.inventory.hasParachute || this.cash < 450) return false;
    this.cash -= 450;
    this.inventory.hasParachute = true;
    this.callbacks.onCashChange(this.cash);
    this.callbacks.onInventoryChange(structuredClone(this.inventory));
    this.audio.playUiChime('mission');
    return true;
  }

  public callTaxiPassenger(): boolean {
    if (this.currentVehicle) return false;
    const px = this.playerRig.root.position.x;
    const pz = this.playerRig.root.position.z;
    const cab = this.addVehicle(
      `cab_call_${Date.now()}`,
      'Horizon Cab',
      'Horizon Taxík',
      'taxi',
      '#facc15',
      px + 8,
      pz + 6,
      this.camYaw + Math.PI,
      false,
      false
    );
    cab.hasDriver = true;
    if (cab.rig.driverGroup) cab.rig.driverGroup.visible = true;
    this.currentVehicle = cab;
    this.lastLandVehicle = cab;
    cab.occupiedByPlayer = true;
    this.playerRig.root.visible = false;
    this.taxiMode = 'passenger';
    this.stuntMessage = 'Horizon Cab dorazil! Vyber destináciu na mape.';
    this.stuntTimer = 3.5;
    this.audio.playHorn();
    this.callbacks.onTaxiMenuRequested?.();
    return true;
  }

  public startTaxiRideTo(destX: number, destZ: number, label: string): boolean {
    if (!this.currentVehicle || this.currentVehicle.kind !== 'taxi') return false;
    this.taxiMode = 'passenger';
    this.taxiTargetX = destX;
    this.taxiTargetZ = destZ;
    this.taxiDestinationLabel = label;
    const dist = Math.hypot(destX - this.currentVehicle.x, destZ - this.currentVehicle.z);
    this.taxiFareCash = Math.max(45, Math.round(dist * 0.14));
    this.taxiAutoPilotTimer = 0;
    this.setGpsWaypoint(destX, destZ, `Taxík: ${label}`);
    this.stuntMessage = `Vodič Horizon Cab vyráža smer ${label} ($${this.taxiFareCash})`;
    this.stuntTimer = 3.5;
    return true;
  }

  public startTaxiDriverShift(): boolean {
    if (!this.currentVehicle || this.currentVehicle.kind !== 'taxi') return false;
    this.taxiMode = 'driver_waiting';
    const px = this.currentVehicle.x;
    const pz = this.currentVehicle.z;
    const ang = Math.random() * Math.PI * 2;
    const dist = 90 + Math.random() * 140;
    this.taxiPickupX = THREE.MathUtils.clamp(px + Math.cos(ang) * dist, -1100, 1100);
    this.taxiPickupZ = THREE.MathUtils.clamp(pz + Math.sin(ang) * dist, -1000, 1000);
    if (isWaterAt(this.taxiPickupX, this.taxiPickupZ)) {
      this.taxiPickupX = 0;
      this.taxiPickupZ = -70;
    }
    const dAng = Math.random() * Math.PI * 2;
    const dDist = 180 + Math.random() * 340;
    this.taxiTargetX = THREE.MathUtils.clamp(this.taxiPickupX + Math.cos(dAng) * dDist, -1050, 1050);
    this.taxiTargetZ = THREE.MathUtils.clamp(this.taxiPickupZ + Math.sin(dAng) * dDist, -950, 950);
    if (isWaterAt(this.taxiTargetX, this.taxiTargetZ)) {
      this.taxiTargetX = 460;
      this.taxiTargetZ = -120;
    }
    this.taxiDestinationLabel = getDistrictName(this.taxiTargetX, this.taxiTargetZ);
    this.taxiFareCash = Math.round(Math.hypot(this.taxiTargetX - this.taxiPickupX, this.taxiTargetZ - this.taxiPickupZ) * 0.45);
    if (this.taxiDropBeacon) {
      this.taxiDropBeacon.position.set(this.taxiPickupX, 0.25, this.taxiPickupZ);
      this.taxiDropBeacon.visible = true;
    }
    this.setGpsWaypoint(this.taxiPickupX, this.taxiPickupZ, 'Zákazník Horizon Cab');
    this.stuntMessage = 'Taxi služba aktívna! Vyzdvihni zákazníka na GPS.';
    this.stuntTimer = 3.5;
    return true;
  }

  public startCutscene(title: string, lines: MissionCutsceneLine[], targetPos?: { x: number; z: number }, onFinish?: () => void) {
    if (!lines || lines.length === 0) {
      onFinish?.();
      return;
    }
    this.cutsceneLines = lines;
    this.cutsceneOnFinish = onFinish || null;
    if (targetPos) this.cutsceneTargetPos.set(targetPos.x, 1.5, targetPos.z);
    else this.cutsceneTargetPos.copy(this.playerRig.root.position);
    this.activeCutscene = {
      title,
      speaker: lines[0].speaker,
      text: lines[0].text,
      lineIndex: 0,
      totalLines: lines.length,
    };
    this.callbacks.onCutsceneChange?.(this.activeCutscene);
  }

  public advanceCutscene() {
    if (!this.activeCutscene) return;
    const nextIdx = this.activeCutscene.lineIndex + 1;
    if (nextIdx >= this.cutsceneLines.length) {
      this.skipCutscene();
      return;
    }
    const line = this.cutsceneLines[nextIdx];
    this.activeCutscene = {
      title: this.activeCutscene.title,
      speaker: line.speaker,
      text: line.text,
      lineIndex: nextIdx,
      totalLines: this.cutsceneLines.length,
    };
    this.callbacks.onCutsceneChange?.(this.activeCutscene);
  }

  public skipCutscene() {
    this.activeCutscene = null;
    this.cutsceneLines = [];
    this.callbacks.onCutsceneChange?.(null);
    const cb = this.cutsceneOnFinish;
    this.cutsceneOnFinish = null;
    cb?.();
  }

  private activateCheatSession() {
    if (!this.cheatSessionActive) {
      this.preCheatSnapshot = {
        cash: this.cash,
        inventory: structuredClone(this.inventory),
        characters: structuredClone(this.characters),
      };
      this.cheatSessionActive = true;
      if (this.activeMission) {
        this.cancelMission();
      }
      this.refreshMissionBeaconVisibility();
    }
  }

  public restartCleanSession(): { ok: boolean; message: string } {
    if (!this.cheatSessionActive && !this.godModeActive) {
      return { ok: true, message: 'Relácia je už čistá bez cheatov.' };
    }
    if (this.currentVehicle?.isCheatSpawned) {
      this.exitCurrentVehicle();
    }
    this.vehicles = this.vehicles.filter((v) => {
      if (v.isCheatSpawned) {
        this.scene.remove(v.rig.root);
        return false;
      }
      return true;
    });
    this.godModeActive = false;
    this.cheatSessionActive = false;
    this.settings.gameplayMods.lowGravity = false;
    this.settings.gameplayMods.infiniteAmmo = false;
    this.settings.gameplayMods.rapidFire = false;
    this.settings.gameplayMods.turboVehicles = false;
    this.settings.gameplayMods.noPolice = false;

    if (this.preCheatSnapshot) {
      this.cash = this.preCheatSnapshot.cash;
      this.inventory = structuredClone(this.preCheatSnapshot.inventory);
      const savedPos = this.playerRig.root.position;
      this.characters = structuredClone(this.preCheatSnapshot.characters);
      const ch = this.characters[this.activeCharId];
      ch.posX = savedPos.x;
      ch.posY = savedPos.y;
      ch.posZ = savedPos.z;
      this.syncEquippedWeaponMesh();
      this.callbacks.onCashChange(this.cash);
      this.callbacks.onInventoryChange(structuredClone(this.inventory));
      this.callbacks.onCharactersChange(structuredClone(this.characters), this.activeCharId);
      this.preCheatSnapshot = null;
    }
    this.refreshMissionBeaconVisibility();
    this.stuntMessage = 'Čistá relácia bez cheatov reštartovaná! Misie a ukladanie sú opäť odomknuté.';
    this.stuntTimer = 3.8;
    this.audio.playUiChime('mission');
    return { ok: true, message: 'Všetko nacheatované bolo zmazané. Misie sú opäť aktívne!' };
  }

  public applyCheatCode(rawCode: string): { ok: boolean; message: string } {
    const clean = rawCode.trim().replace(/\s+/g, '').toUpperCase();
    const ch = this.characters[this.activeCharId];

    if (clean === '3324' || clean === '1999-463-663' || clean === 'GODMODE') {
      this.activateCheatSession();
      this.godModeActive = !this.godModeActive;
      this.audio.playUiChime('mission');
      return {
        ok: true,
        message: this.godModeActive
          ? 'Cheat 3324: Nesmrteľnosť (God Mode) AKTIVOVANÁ! (Misie dočasne zamknuté)'
          : 'God Mode vypnutý. Pre misie reštartuj reláciu bez cheatov.',
      };
    }
    if (clean === '5342' || clean === '1999-435-426' || clean === 'HELI') {
      this.activateCheatSession();
      const px = this.playerRig.root.position.x + Math.sin(this.camYaw) * 12;
      const pz = this.playerRig.root.position.z + Math.cos(this.camYaw) * 12;
      const veh = this.addVehicle(`cheat_heli_${Date.now()}`, 'Pelican', 'Pelican Helistar', 'helicopter', '#0ea5e9', px, pz, this.camYaw, false, false);
      veh.isCheatSpawned = true;
      this.audio.playUiChime('mission');
      return { ok: true, message: 'Cheat 5342: Pristavený vrtuľník Pelican Helistar! (Misie dočasne zamknuté)' };
    }
    if (clean === '7645') {
      this.activateCheatSession();
      const px = this.playerRig.root.position.x + Math.sin(this.camYaw) * 9;
      const pz = this.playerRig.root.position.z + Math.cos(this.camYaw) * 9;
      const veh = this.addVehicle(`cheat_taxi_${Date.now()}`, 'Horizon Cab', 'Horizon Taxík', 'taxi', '#facc15', px, pz, this.camYaw, false, false);
      veh.isCheatSpawned = true;
      this.audio.playUiChime('mission');
      return { ok: true, message: 'Cheat 7645: Pristavený taxík Horizon Cab! (Misie dočasne zamknuté)' };
    }
    if (clean === '7726' || clean === '1999-787-372' || clean === 'SUPERCAR') {
      this.activateCheatSession();
      const px = this.playerRig.root.position.x + Math.sin(this.camYaw) * 9;
      const pz = this.playerRig.root.position.z + Math.cos(this.camYaw) * 9;
      const veh = this.addVehicle(`cheat_super_${Date.now()}`, 'Valkyra', 'Aether RS', 'supercar', '#fbbf24', px, pz, this.camYaw, false, false);
      veh.isCheatSpawned = true;
      this.audio.playUiChime('mission');
      return { ok: true, message: 'Cheat 7726: Pristavený superšport Valkyra Aether RS! (Misie dočasne zamknuté)' };
    }
    if (clean === '8654') {
      this.activateCheatSession();
      const px = this.playerRig.root.position.x + Math.sin(this.camYaw) * 15;
      const pz = this.playerRig.root.position.z + Math.cos(this.camYaw) * 15;
      const veh = this.addVehicle(`cheat_plane_${Date.now()}`, 'Pelican', 'Skylark Coastal', 'plane', '#f97316', px, pz, this.camYaw, false, false);
      veh.isCheatSpawned = true;
      this.audio.playUiChime('mission');
      return { ok: true, message: 'Cheat 8654: Pristavené lietadlo Pelican Skylark! (Misie dočasne zamknuté)' };
    }
    if (clean === '9975' || clean === '1999-727-438' || clean === 'JET') {
      this.activateCheatSession();
      const px = this.playerRig.root.position.x + Math.sin(this.camYaw) * 15;
      const pz = this.playerRig.root.position.z + Math.cos(this.camYaw) * 15;
      const veh = this.addVehicle(`cheat_jet_${Date.now()}`, 'Zeta', 'Zeta F-22 Interceptor', 'fighter_jet', '#334155', px, pz, this.camYaw, false, false);
      veh.isCheatSpawned = true;
      this.audio.playUiChime('mission');
      return { ok: true, message: 'Cheat 9975: Pristavená ozbrojená stíhačka Zeta F-22! (Misie dočasne zamknuté)' };
    }
    if (clean === '1999-227-468' || clean === 'CASH50K') {
      this.activateCheatSession();
      this.cash += 50000;
      this.callbacks.onCashChange(this.cash);
      this.audio.playUiChime('mission');
      return { ok: true, message: '+$50,000 pripísaných! (Misie dočasne zamknuté až do reštartu relácie)' };
    }
    if (clean === '1999-887-853' || clean === 'TURTLE') {
      this.activateCheatSession();
      ch.health = ch.maxHealth;
      ch.armor = ch.maxArmor;
      this.playerStamina = 100;
      this.callbacks.onCharactersChange(structuredClone(this.characters), this.activeCharId);
      this.audio.playUiChime('mission');
      return { ok: true, message: 'Zdravie a vesta doplnené na 100%!' };
    }
    if (clean === '1999-529-937' || clean === 'LAWYERUP') {
      this.activateCheatSession();
      this.clearPolicePursuit();
      this.audio.playUiChime('mission');
      return { ok: true, message: 'Policajné pátranie úplne vymazané!' };
    }
    if (clean === '1999-759-348' || clean === 'SKYDIVE') {
      this.activateCheatSession();
      this.inventory.hasParachute = true;
      this.callbacks.onInventoryChange(structuredClone(this.inventory));
      this.audio.playUiChime('mission');
      return { ok: true, message: 'Získaný taktický padák do výbavy!' };
    }
    if (clean === '1999-866-587' || clean === 'TOOLUP') {
      this.activateCheatSession();
      this.inventory.weapons = this.inventory.weapons.map((w) => {
        const def = WEAPON_CATALOG[w.id];
        return { ...w, unlocked: true, ammoInClip: def.clipSize, reserveAmmo: def.clipSize * 6 };
      });
      this.syncEquippedWeaponMesh();
      this.callbacks.onInventoryChange(structuredClone(this.inventory));
      this.audio.playUiChime('mission');
      return { ok: true, message: 'Všetky zbrane a plná munícia odomknuté!' };
    }
    return { ok: false, message: 'Neznámy cheat kód. Skús 3324, 5342, 7645, 7726, 8654 alebo 9975.' };
  }

  public teleportTo(x: number, z: number, label?: string) {
    if (this.currentVehicle) {
      this.currentVehicle.x = x;
      this.currentVehicle.y = getBridgeElevationAt(x, z);
      this.currentVehicle.z = z;
      this.currentVehicle.vx = 0;
      this.currentVehicle.vz = 0;
      this.currentVehicle.speed = 0;
      this.currentVehicle.rig.root.position.set(x, this.currentVehicle.y, z);
    } else {
      this.playerRig.root.position.set(x, getBridgeElevationAt(x, z), z);
      this.playerVelX = 0;
      this.playerVelY = 0;
      this.playerVelZ = 0;
    }
    if (label) {
      this.stuntMessage = `Presun na pozíciu: ${label}`;
      this.stuntTimer = 2.6;
    }
  }

  public updateRemotePlayers(players: RemotePlayerState[]) {
    const activeUids = new Set(players.map((p) => p.uid));
    for (const [uid, vis] of this.remotePlayers.entries()) {
      if (!activeUids.has(uid)) {
        this.scene.remove(vis.root);
        this.remotePlayers.delete(uid);
      }
    }
    for (const p of players) {
      let vis = this.remotePlayers.get(p.uid);
      if (!vis) {
        const root = new THREE.Group();
        const appearance = p.appearance || this.characters[p.characterId]?.appearance || this.characters.lucia.appearance;
        const charRig = createCharacterRig(appearance, this.textures.contactShadow);
        root.add(charRig.root);
        root.position.set(p.x, p.y, p.z);
        this.scene.add(root);
        vis = {
          uid: p.uid,
          root,
          charRig,
          vehRig: null,
          vehKind: null,
          vehColor: p.vehicleColor || '#38bdf8',
          targetPos: new THREE.Vector3(p.x, p.y, p.z),
          targetHeading: p.heading,
          state: p,
        };
        this.remotePlayers.set(p.uid, vis);
      }
      vis.state = p;
      vis.targetPos.set(p.x, p.y, p.z);
      vis.targetHeading = p.heading;

      if (p.vehicleKind !== vis.vehKind) {
        if (vis.vehRig) {
          vis.root.remove(vis.vehRig.root);
          vis.vehRig = null;
        }
        vis.vehKind = p.vehicleKind;
        if (p.vehicleKind) {
          vis.vehRig = createVehicleRig(p.vehicleKind, p.vehicleColor || '#38bdf8', this.textures.contactShadow);
          vis.root.add(vis.vehRig.root);
          vis.charRig.root.visible = p.vehicleKind === 'motorcycle' || p.vehicleKind === 'boat';
        } else {
          vis.charRig.root.visible = true;
        }
      }
    }
  }

  private schedulePoliceDispatch(reason: string, stars: number, delaySec = 7.5) {
    if (this.settings.gameplayMods.noPolice) return;
    if (this.wantedStars > 0) {
      this.addCrimeHeat(stars * 30);
      return;
    }
    if (this.policeDispatchTimer <= 0) {
      this.policeDispatchTimer = delaySec;
      this.policeDispatchReason = reason;
      this.pendingDispatchStars = stars;
    } else {
      this.pendingDispatchStars = Math.max(this.pendingDispatchStars, stars);
    }
  }

  public startMission(missionId: string) {
    if (this.cheatSessionActive) {
      this.stuntMessage = 'Cheaty sú aktívne! Reštartuj reláciu bez cheatov pre spustenie misií.';
      this.stuntTimer = 3.8;
      this.audio.playUiChime('click');
      return;
    }
    const def = ALL_MISSIONS.find((m) => m.id === missionId);
    if (!def) return;
    const launch = () => {
      this.activeMission = def;
      this.activeStageIndex = 0;
      this.missionElapsedSec = 0;
      this.missionTimerRemaining = def.timeLimitSec ?? null;
      if (def.wantedOnStart && !this.settings.gameplayMods.noPolice) {
        this.addCrimeHeat(def.wantedOnStart * 35);
      }
      this.setupCurrentMissionStage();
      this.refreshMissionBeaconVisibility();
      this.missionNotification = {
        title: def.title,
        subtitle: def.stages[0].label,
      };
      this.missionNotifTimer = 4.5;
      this.audio.playUiChime('mission');
    };

    if (def.cutsceneIntro && def.cutsceneIntro.length > 0) {
      this.startCutscene(def.title, def.cutsceneIntro, { x: def.stages[0].targetX, z: def.stages[0].targetZ }, launch);
    } else {
      launch();
    }
  }

  public cancelMission() {
    this.activeMission = null;
    this.pickupBriefcase.visible = false;
    this.missionTimerRemaining = null;
    this.refreshMissionBeaconVisibility();
    if (this.gpsWaypoint) {
      this.waypointGroup.position.set(this.gpsWaypoint.x, 0, this.gpsWaypoint.z);
      this.waypointGroup.visible = true;
      (this.waypointBeam.material as THREE.MeshBasicMaterial).color.setHex(0x38bdf8);
      (this.waypointRing.material as THREE.MeshBasicMaterial).color.setHex(0x38bdf8);
    } else {
      this.waypointGroup.visible = false;
    }
  }

  private setupCurrentMissionStage() {
    if (!this.activeMission) return;
    const stage = this.activeMission.stages[this.activeStageIndex];
    if (!stage) return;

    this.waypointGroup.position.set(stage.targetX, 0, stage.targetZ);
    this.waypointGroup.visible = stage.type !== 'escape_police';
    (this.waypointBeam.material as THREE.MeshBasicMaterial).color.setHex(0xf59e0b);
    (this.waypointRing.material as THREE.MeshBasicMaterial).color.setHex(0xfbbf24);

    if (stage.type === 'collect') {
      this.pickupBriefcase.position.set(stage.targetX, 0.75, stage.targetZ);
      this.pickupBriefcase.visible = true;
    } else {
      this.pickupBriefcase.visible = false;
    }

    if (stage.type === 'eliminate' && stage.enemyCount) {
      this.npcs = this.npcs.filter((n) => {
        if (n.kind === 'enemy') {
          this.scene.remove(n.rig.root);
          return false;
        }
        return true;
      });
      for (let i = 0; i < stage.enemyCount; i++) {
        const ang = (i / stage.enemyCount) * Math.PI * 2;
        const dist = 6 + (i % 3) * 4.5;
        this.spawnHostileNpc(
          'enemy',
          stage.targetX + Math.cos(ang) * dist,
          stage.targetZ + Math.sin(ang) * dist
        );
      }
    }
  }

  private advanceMissionStage() {
    if (!this.activeMission) return;
    this.activeStageIndex += 1;
    if (this.activeStageIndex >= this.activeMission.stages.length) {
      const completedMission = this.activeMission;
      const completedId = completedMission.id;
      const reward = completedMission.rewardCash;
      this.cash += reward;
      this.callbacks.onCashChange(this.cash);
      this.callbacks.onMissionComplete(
        completedId,
        Math.round(this.missionElapsedSec),
        reward
      );
      this.missionNotification = {
        title: `Misia splnená: ${completedMission.title}`,
        subtitle: `Odmena pripísaná na účet`,
        reward,
      };
      this.missionNotifTimer = 5.5;
      this.audio.playUiChime('mission');
      this.activeMission = null;
      this.pickupBriefcase.visible = false;
      this.missionTimerRemaining = null;
      this.refreshMissionBeaconVisibility();
      if (this.gpsWaypoint) {
        this.waypointGroup.position.set(this.gpsWaypoint.x, 0, this.gpsWaypoint.z);
        this.waypointGroup.visible = true;
      } else {
        this.waypointGroup.visible = false;
      }
      if (completedMission.cutsceneOutro && completedMission.cutsceneOutro.length > 0) {
        this.startCutscene(completedMission.title, completedMission.cutsceneOutro);
      }
      return;
    }

    this.setupCurrentMissionStage();
    const nextStage = this.activeMission.stages[this.activeStageIndex];
    this.missionNotification = {
      title: this.activeMission.title,
      subtitle: nextStage.label,
    };
    this.missionNotifTimer = 4.0;
    this.audio.playUiChime('switch');
  }

  private scheduleNextTick() {
    if (this.disposed) return;
    if (this.isSoftwareGl) {
      this.afterDraw(() => this.tick());
    } else {
      this.frameId = requestAnimationFrame(() => this.tick());
    }
  }

  private afterDraw(cb: () => void) {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (!gl || !gl.fenceSync) {
      this.frameId = window.setTimeout(cb, 80);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) return;
      const state = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private tick() {
    if (this.disposed) return;
    const now = performance.now();
    const rawDt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    const dt = Math.min(0.05, Math.max(0.001, rawDt));
    this.elapsedSec += dt;

    // FPS counter
    this.fpsFrames += 1;
    this.fpsAccum += rawDt;
    if (this.fpsAccum >= 0.4) {
      this.currentFps = Math.round(this.fpsFrames / this.fpsAccum);
      this.fpsFrames = 0;
      this.fpsAccum = 0;
    }

    const inputState = this.input.poll(dt);

    if (inputState.switchCameraPressed && !this.input.paused) {
      this.cycleCameraMode();
    }

    if (!this.input.paused && !this.wardrobePreview) {
      this.stepSimulation(dt, inputState);
    } else if (this.wardrobePreview) {
      this.updateWardrobeCamera(dt);
    }

    // Keep ocean albedo & cross-wave normal map animated for realistic water shimmer
    this.textures.ocean.offset.x = (this.elapsedSec * 0.024) % 1;
    this.textures.ocean.offset.y = (this.elapsedSec * 0.014) % 1;
    this.textures.oceanNormal.offset.x = (1 - ((this.elapsedSec * 0.018) % 1)) % 1;
    this.textures.oceanNormal.offset.y = (this.elapsedSec * 0.022) % 1;

    // Keep sun shadow frustum centered near player, snapped to shadow-map texels & updated only on displacement/cooldown
    const px = this.playerRig.root.position.x;
    const pz = this.playerRig.root.position.z;
    this.shadowCooldown = Math.max(0, this.shadowCooldown - dt);
    const shadowTexel = 150 / (this.sunLight.shadow.mapSize.width || 1024);
    const snapX = Math.round(px / shadowTexel) * shadowTexel;
    const snapZ = Math.round(pz / shadowTexel) * shadowTexel;
    if (
      this.sunLight.castShadow &&
      (Math.abs(snapX - this.lastShadowX) > 0.65 ||
        Math.abs(snapZ - this.lastShadowZ) > 0.65 ||
        this.shadowCooldown <= 0 ||
        this.lightningFlash > 0.05)
    ) {
      this.sunLight.target.position.set(snapX, 0, snapZ);
      this.sunLight.position.set(snapX + 65, 85, snapZ + 45);
      this.sunLight.target.updateMatrixWorld();
      this.renderer.shadowMap.needsUpdate = true;
      this.lastShadowX = snapX;
      this.lastShadowZ = snapZ;
      this.shadowCooldown = 0.022;
    }

    const useBloom =
      !this.isSoftwareGl &&
      this.composer !== null &&
      (this.settings.graphics.preset === 'high' || this.settings.graphics.preset === 'ultra');
    if (useBloom && this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    this.scheduleNextTick();
  }

  private updateWardrobeCamera(dt: number) {
    const px = this.playerRig.root.position.x;
    const py = this.playerRig.root.position.y;
    const pz = this.playerRig.root.position.z;
    const heading = this.playerRig.root.rotation.y;

    _camGoal.set(
      px + Math.sin(heading) * 2.7,
      py + 1.45,
      pz + Math.cos(heading) * 2.7
    );
    _lookGoal.set(px, py + 1.15, pz);

    this.camCurrentPos.x = THREE.MathUtils.damp(this.camCurrentPos.x, _camGoal.x, 8, dt);
    this.camCurrentPos.y = THREE.MathUtils.damp(this.camCurrentPos.y, _camGoal.y, 8, dt);
    this.camCurrentPos.z = THREE.MathUtils.damp(this.camCurrentPos.z, _camGoal.z, 8, dt);
    this.camCurrentLook.x = THREE.MathUtils.damp(this.camCurrentLook.x, _lookGoal.x, 8, dt);
    this.camCurrentLook.y = THREE.MathUtils.damp(this.camCurrentLook.y, _lookGoal.y, 8, dt);
    this.camCurrentLook.z = THREE.MathUtils.damp(this.camCurrentLook.z, _lookGoal.z, 8, dt);

    this.camera.position.copy(this.camCurrentPos);
    this.camera.lookAt(this.camCurrentLook);
  }

  private getControlCategoryForVehicle(v: VehicleEntity | null): VehicleControlCategory {
    if (!v) return 'foot';
    if (v.kind === 'boat') return 'boat';
    if (v.kind === 'helicopter') return 'helicopter';
    if (v.kind === 'fighter_jet') return 'fighter_jet';
    if (v.kind === 'plane') return 'plane';
    if (v.kind === 'motorcycle') return 'motorcycle';
    return 'car';
  }

  private addSkillXp(skill: keyof CharacterState['skills'], amount: number) {
    const ch = this.characters[this.activeCharId];
    if (!ch.skills) ch.skills = { driving: 50, shooting: 50, flying: 50, stamina: 50 };
    if (ch.skills[skill] >= 100) return;
    this.skillXp[skill] += amount;
    if (this.skillXp[skill] >= 100) {
      this.skillXp[skill] -= 100;
      ch.skills[skill] = Math.min(100, ch.skills[skill] + 1);
      const labelMap: Record<keyof CharacterState['skills'], string> = {
        driving: 'Šoférovanie',
        shooting: 'Streľba',
        flying: 'Lietanie',
        stamina: 'Kondícia',
      };
      this.stuntMessage = `Zručnosť ${labelMap[skill]} zvýšená na ${ch.skills[skill]}/100!`;
      this.stuntTimer = 2.6;
      this.callbacks.onCharactersChange(structuredClone(this.characters), this.activeCharId);
    }
  }

  public syncGarageBeforeSave(): SavedGarageState {
    // Remove only vehicles that were taken out into the world and are no longer parked inside Hangar / Safehouse Garage
    const isInsideZone = (v: VehicleEntity, z: { minX: number; maxX: number; minZ: number; maxZ: number }) =>
      !v.destroyed && v.x >= z.minX && v.x <= z.maxX && v.z >= z.minZ && v.z <= z.maxZ;

    this.savedGarage.hangarVehicles = this.savedGarage.hangarVehicles.filter((rec) => {
      const activeInWorld = this.vehicles.find((v) => v.id === rec.id);
      if (!activeInWorld) return true; // safely stored off-map in hangar
      return isInsideZone(activeInWorld, AIRPORT_HANGAR_ZONE);
    });

    this.savedGarage.safehouseVehicles = this.savedGarage.safehouseVehicles.filter((rec) => {
      const activeInWorld = this.vehicles.find((v) => v.id === rec.id);
      if (!activeInWorld) return true; // safely stored off-map in garage
      return isInsideZone(activeInWorld, SAFEHOUSE_GARAGE_ZONE);
    });

    // Also capture any eligible non-cheat vehicle currently parked inside Hangar or Safehouse Garage
    for (const v of this.vehicles) {
      if (v.destroyed || v.isCheatSpawned) continue;
      const isAir = v.kind === 'plane' || v.kind === 'helicopter' || v.kind === 'fighter_jet';
      if (isAir && isInsideZone(v, AIRPORT_HANGAR_ZONE)) {
        this.upsertGarageVehicle('hangar', v);
      } else if (!isAir && v.kind !== 'boat' && isInsideZone(v, SAFEHOUSE_GARAGE_ZONE)) {
        this.upsertGarageVehicle('safehouse', v);
      }
    }
    return this.getSavedGarage();
  }

  private upsertGarageVehicle(facility: 'hangar' | 'safehouse', v: VehicleEntity) {
    const list = facility === 'hangar' ? this.savedGarage.hangarVehicles : this.savedGarage.safehouseVehicles;
    const record: StoredVehicleRecord = {
      id: v.id,
      brand: v.brand,
      name: v.name,
      kind: v.kind,
      color: v.color,
      x: v.x,
      z: v.z,
      heading: v.heading,
      upgrades: { ...v.upgrades },
    };
    const idx = list.findIndex((item) => item.id === v.id);
    if (idx >= 0) {
      list[idx] = record;
    } else {
      if (list.length >= 4) list.shift();
      list.push(record);
      this.parkedFacilityNotice =
        facility === 'hangar'
          ? `${v.name} zaparkované v Hangári Bayshore`
          : `${v.name} zaparkované v Garáži Coral Villa`;
      this.parkedNoticeTimer = 3.5;
      this.callbacks.onGarageChange?.(this.getSavedGarage());
    }
  }

  private stepSimulation(dt: number, inp: ReturnType<InputManager['poll']>) {
    const activeChar = this.characters[this.activeCharId];

    // Always advance dynamic atmosphere & clouds
    this.updateAtmosphere(dt);

    // Smoothly interpolate remote multiplayer friends in 3D world
    for (const vis of this.remotePlayers.values()) {
      vis.root.position.lerp(vis.targetPos, Math.min(1, 10 * dt));
      let hDiff = vis.targetHeading - vis.root.rotation.y;
      while (hDiff > Math.PI) hDiff -= Math.PI * 2;
      while (hDiff < -Math.PI) hDiff += Math.PI * 2;
      vis.root.rotation.y += hDiff * Math.min(1, 10 * dt);
      if (!vis.vehRig) {
        const moveDist = vis.root.position.distanceTo(vis.targetPos);
        const swing = moveDist > 0.12 ? Math.sin(this.elapsedSec * 9) * 0.55 : 0;
        vis.charRig.leftLegPivot.rotation.x = swing;
        vis.charRig.rightLegPivot.rotation.x = -swing;
      }
    }

    // Cutscene mode: cinematic orbit camera, gameplay paused cleanly
    if (this.activeCutscene) {
      this.updateActiveCamera(dt, false);
      this.telemetryTimer += dt;
      if (this.telemetryTimer >= 0.05) {
        this.telemetryTimer = 0;
        this.pushTelemetry(inp, null);
      }
      return;
    }

    // Busted (Arrested) -> Respawn in front of Police Station & clear pursuit
    if (this.bustedTimer > 0) {
      this.bustedTimer -= dt;
      if (this.bustedTimer <= 0) {
        activeChar.health = activeChar.maxHealth;
        this.clearPolicePursuit();
        this.cash = Math.max(0, this.cash - 250);
        this.playerRig.root.position.set(POLICE_STATION_RESPAWN.x, 0, POLICE_STATION_RESPAWN.z);
        this.playerVelX = 0;
        this.playerVelY = 0;
        this.playerVelZ = 0;
        this.playerGrounded = true;
        this.parachuteDeployed = false;
        this.parachuteRig.visible = false;
        this.camYaw = POLICE_STATION_RESPAWN.heading;
        activeChar.posX = POLICE_STATION_RESPAWN.x;
        activeChar.posY = 0;
        activeChar.posZ = POLICE_STATION_RESPAWN.z;
        activeChar.heading = POLICE_STATION_RESPAWN.heading;
        this.stuntMessage = 'Prepustený z policajnej stanice (-$250)';
        this.stuntTimer = 3.2;
        this.callbacks.onCashChange(this.cash);
        this.callbacks.onCharactersChange(structuredClone(this.characters), this.activeCharId);
      }
      this.pushTelemetry(inp, null);
      return;
    }

    // Wasted (Killed or Lost in Deep Ocean) -> Respawn in front of Hospital & clear pursuit
    if (this.wastedTimer > 0) {
      this.wastedTimer -= dt;
      if (this.wastedTimer <= 0) {
        const wasDrowned = Boolean(this.wastedReason);
        this.wastedReason = null;
        activeChar.health = activeChar.maxHealth;
        activeChar.armor = Math.round(activeChar.maxArmor * 0.5);
        this.clearPolicePursuit();
        this.cash = Math.max(0, this.cash - 350);
        this.playerRig.root.position.set(HOSPITAL_RESPAWN.x, 0, HOSPITAL_RESPAWN.z);
        this.playerVelX = 0;
        this.playerVelY = 0;
        this.playerVelZ = 0;
        this.playerGrounded = true;
        this.parachuteDeployed = false;
        this.parachuteRig.visible = false;
        this.camYaw = HOSPITAL_RESPAWN.heading;
        activeChar.posX = HOSPITAL_RESPAWN.x;
        activeChar.posY = 0;
        activeChar.posZ = HOSPITAL_RESPAWN.z;
        activeChar.heading = HOSPITAL_RESPAWN.heading;
        this.stuntMessage = wasDrowned
          ? 'Zachránený pobrežnou strážou pred nemocnicou (-$350)'
          : 'Prepustený z nemocnice Vice General (-$350)';
        this.stuntTimer = 3.2;
        this.callbacks.onCashChange(this.cash);
        this.callbacks.onCharactersChange(structuredClone(this.characters), this.activeCharId);
      }
      this.pushTelemetry(inp, null);
      return;
    }

    // Look angles & manual mouse/pad camera cooldown
    if (Math.abs(inp.lookDeltaX) > 0.0008 || Math.abs(inp.lookDeltaY) > 0.0008) {
      this.manualCameraCooldown = 0.95;
    } else if (this.manualCameraCooldown > 0) {
      this.manualCameraCooldown = Math.max(0, this.manualCameraCooldown - dt);
    }
    this.camYaw -= inp.lookDeltaX;
    this.camPitch = THREE.MathUtils.clamp(this.camPitch + inp.lookDeltaY, -0.55, 0.85);

    // Timers
    if (this.clubEncoreTimer > 0) this.clubEncoreTimer = Math.max(0, this.clubEncoreTimer - dt);
    if (this.npcDialogueTimer > 0) {
      this.npcDialogueTimer -= dt;
      if (this.npcDialogueTimer <= 0) this.nearestNpcDialogue = null;
    }
    if (this.fireCooldown > 0) this.fireCooldown -= dt;
    if (this.garageTriggerCooldown > 0) this.garageTriggerCooldown -= dt;
    if (this.hitMarkerTimer > 0) this.hitMarkerTimer -= dt;
    if (this.damageFlashTimer > 0) this.damageFlashTimer -= dt;
    if (this.parkedNoticeTimer > 0) {
      this.parkedNoticeTimer -= dt;
      if (this.parkedNoticeTimer <= 0) this.parkedFacilityNotice = null;
    }
    if (this.policeDispatchTimer > 0) {
      this.policeDispatchTimer -= dt;
      if (this.policeDispatchTimer <= 0 && this.pendingDispatchStars > 0) {
        if (!this.settings.gameplayMods.noPolice) {
          this.addCrimeHeat(this.pendingDispatchStars * 35);
          this.stuntMessage = 'Polícia VCPD dorazila na hlásenie!';
          this.stuntTimer = 3.0;
        }
        this.policeDispatchReason = null;
        this.pendingDispatchStars = 0;
      }
    }
    if (this.stuntTimer > 0) {
      this.stuntTimer -= dt;
      if (this.stuntTimer <= 0) this.stuntMessage = null;
    }
    if (this.missionNotifTimer > 0) {
      this.missionNotifTimer -= dt;
      if (this.missionNotifTimer <= 0) this.missionNotification = null;
    }
    if (this.muzzleFlashTimer > 0) {
      this.muzzleFlashTimer -= dt;
      if (this.muzzleFlashTimer <= 0) this.muzzleFlashMesh.visible = false;
    }
    if (this.switchSwoopTimer > 0) {
      this.switchSwoopTimer -= dt;
    }

    // Reloading
    if (this.reloadTimer > 0) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        this.finishReload();
      }
    }

    // Animate shop rings, airport radar spinners, elevators, taxi beacon & unlocked story beacons
    for (const sr of this.shopRings) {
      sr.rotation.z += dt * 1.4;
    }
    for (const sp of this.spinners) {
      sp.rotation.y += dt * 0.9;
    }
    let nearbyElevator: ElevatorEntity | null = null;
    for (const el of this.elevators) {
      const prevY = el.currentY;
      const targetFloor = el.floors[el.targetFloorIndex] || el.floors[0];
      const diff = targetFloor.y - el.currentY;
      if (Math.abs(diff) > 0.02) {
        const step = Math.sign(diff) * Math.min(Math.abs(diff), 5.2 * dt);
        el.currentY += step;
        el.cabGroup.position.y = el.currentY;
      } else {
        el.currentY = targetFloor.y;
        el.cabGroup.position.y = el.currentY;
        el.currentFloorIndex = el.targetFloorIndex;
      }
      const distToEl = Math.hypot(
        this.playerRig.root.position.x - el.x,
        this.playerRig.root.position.z - el.z
      );
      if (!this.currentVehicle && distToEl <= el.radius) {
        if (Math.abs(this.playerRig.root.position.y - prevY) < 1.8) {
          this.playerRig.root.position.y += el.currentY - prevY;
        }
        if (Math.abs(this.playerRig.root.position.y - el.currentY) <= 2.6 && !nearbyElevator) {
          nearbyElevator = el;
        }
      }
    }
    for (const mb of this.missionStartBeacons) {
      if (mb.group.visible) {
        mb.group.children[1].rotation.y += dt * 2.0;
      }
    }
    if (this.taxiDropBeacon && this.taxiDropBeacon.visible) {
      this.taxiDropBeacon.rotation.z += dt * 2.4;
    }

    // Animate Malibu Neon Lounge stage show, disco ball, EQ bars & choreographed club performers (only when near club)
    if (this.clubShow) {
      const cdx = this.playerRig.root.position.x - this.clubShow.clubX;
      const cdz = this.playerRig.root.position.z - this.clubShow.clubZ;
      if (cdx * cdx + cdz * cdz < 6724) {
        const tempo = this.clubEncoreTimer > 0 ? 5.6 : 3.2;
        this.clubShow.discoBall.rotation.y += dt * (this.clubEncoreTimer > 0 ? 3.2 : 1.3);
        for (let i = 0; i < this.clubShow.spotlights.length; i++) {
          const sp = this.clubShow.spotlights[i];
          sp.rotation.z = Math.sin(this.elapsedSec * tempo * 0.5 + i * 1.4) * 0.45;
          sp.rotation.x = Math.cos(this.elapsedSec * tempo * 0.4 + i) * 0.3;
        }
        for (let i = 0; i < this.clubShow.eqBars.length; i++) {
          const bar = this.clubShow.eqBars[i];
          const pulse = 0.55 + Math.abs(Math.sin(this.elapsedSec * tempo * 1.7 + i * 0.75)) * (this.clubEncoreTimer > 0 ? 1.85 : 1.15);
          bar.scale.y = pulse;
        }
        for (const pf of this.clubShow.performers) {
          const ph = this.elapsedSec * tempo + pf.phase;
          if (pf.style === 'pole') {
            pf.rig.root.position.set(
              pf.baseX + Math.sin(ph * 0.65) * 0.55,
              pf.baseY + Math.abs(Math.sin(ph)) * 0.35,
              pf.baseZ + Math.cos(ph * 0.65) * 0.55
            );
            pf.rig.root.rotation.y = ph * 0.9;
            pf.rig.leftArmPivot.rotation.x = -1.4 + Math.sin(ph) * 0.4;
            pf.rig.rightArmPivot.rotation.x = -1.4 - Math.sin(ph) * 0.4;
            pf.rig.leftLegPivot.rotation.x = Math.sin(ph) * 0.45;
            pf.rig.rightLegPivot.rotation.x = -Math.sin(ph) * 0.45;
          } else if (pf.style === 'podiumL' || pf.style === 'podiumR') {
            pf.rig.root.position.set(pf.baseX, pf.baseY + Math.abs(Math.sin(ph * 1.1)) * 0.14, pf.baseZ);
            pf.rig.root.rotation.y = Math.sin(ph * 0.5) * 0.85;
            pf.rig.leftArmPivot.rotation.set(-0.9 + Math.sin(ph) * 0.55, 0, -0.35);
            pf.rig.rightArmPivot.rotation.set(-0.9 - Math.sin(ph) * 0.55, 0, 0.35);
            pf.rig.leftLegPivot.rotation.x = Math.sin(ph) * 0.25;
            pf.rig.rightLegPivot.rotation.x = -Math.sin(ph) * 0.25;
          } else if (pf.style === 'dj') {
            pf.rig.leftArmPivot.rotation.x = -0.8 + Math.sin(ph * 1.6) * 0.28;
            pf.rig.rightArmPivot.rotation.x = -0.8 - Math.sin(ph * 1.6) * 0.28;
          } else {
            pf.rig.root.position.y = pf.baseY + Math.abs(Math.sin(ph * 1.2)) * 0.08;
            pf.rig.leftArmPivot.rotation.x = this.clubEncoreTimer > 0 ? -1.8 + Math.sin(ph * 2) * 0.4 : -0.4 + Math.sin(ph) * 0.25;
            pf.rig.rightArmPivot.rotation.x = this.clubEncoreTimer > 0 ? -1.8 - Math.sin(ph * 2) * 0.4 : -0.4 - Math.sin(ph) * 0.25;
          }
        }
      }
    }

    // Sync active control category
    this.input.inAircraft = Boolean(
      this.currentVehicle &&
        (this.currentVehicle.kind === 'plane' ||
          this.currentVehicle.kind === 'helicopter' ||
          this.currentVehicle.kind === 'fighter_jet')
    );
    this.input.setControlCategory(this.getControlCategoryForVehicle(this.currentVehicle));

    const px = this.playerRig.root.position.x;
    const pz = this.playerRig.root.position.z;

    // 5 Hz Shop Interior Proximity Culling & GPS Cache Timer + Malibu Club Security Check
    this.interiorCullTimer -= dt;
    if (this.interiorCullTimer <= 0) {
      this.interiorCullTimer = 0.2;
      this.updateShopInteriorVisibility();
    }
    if (this.gpsRefreshTimer > 0) {
      this.gpsRefreshTimer = Math.max(0, this.gpsRefreshTimer - dt);
    }
    this.stepClubSecurity(dt, px, this.playerRig.root.position.y, pz);

    // Auto-clear custom GPS waypoint when player arrives
    if (!this.activeMission && this.gpsWaypoint && this.taxiMode === 'none') {
      if (Math.hypot(px - this.gpsWaypoint.x, pz - this.gpsWaypoint.z) < 8) {
        this.stuntMessage = `Cieľ GPS dosiahnutý: ${this.gpsWaypoint.label}`;
        this.stuntTimer = 2.8;
        this.clearGpsWaypoint();
      }
    }

    // Discover Hidden Side Missions by proximity
    this.nearbySideMission = null;
    this.activeSidePrompt = null;
    if (!this.activeMission) {
      for (const sm of SIDE_DISCOVERY_MISSIONS) {
        const d = Math.hypot(sm.startX - px, sm.startZ - pz);
        if (d < 28 && !this.discoveredSideMissions.has(sm.id)) {
          this.discoveredSideMissions.add(sm.id);
          this.stuntMessage = `Objavená tajná misia: ${sm.title}!`;
          this.stuntTimer = 3.5;
          this.audio.playUiChime('switch');
          this.callbacks.onSideMissionDiscovered?.(sm);
        }
        if (d < 13 && !this.nearbySideMission) {
          this.nearbySideMission = sm;
          this.activeSidePrompt = `Tajná misia: ${sm.title} ($${sm.rewardCash.toLocaleString('sk-SK')})`;
        }
      }
    }

    // Find nearby vehicle, enterable shop, club stage, or unlocked story mission marker
    let nearbyVehicle: VehicleEntity | null = null;
    let bestVehDist = 5.4;
    if (!this.currentVehicle) {
      for (const v of this.vehicles) {
        if (v.destroyed) continue;
        if (Math.abs(v.speed) > 13) continue;
        const maxR =
          v.kind === 'plane' || v.kind === 'fighter_jet' || v.kind === 'helicopter' || v.kind === 'boat'
            ? 6.6
            : 4.8;
        const d = Math.hypot(v.x - px, v.z - pz);
        if (d < maxR && d < bestVehDist) {
          bestVehDist = d;
          nearbyVehicle = v;
        }
      }
    }

    const nearClubStage = Boolean(
      this.clubShow &&
        !this.currentVehicle &&
        this.clubEncoreTimer <= 0 &&
        Math.hypot(px - this.clubShow.clubX, pz - this.clubShow.clubZ) < 12.5
    );

    let nearbyShop: ShopDef | null = null;
    let bestShopDist = 5.2;
    for (const s of SHOPS) {
      const dDoor = Math.hypot(s.doorX - px, s.doorZ - pz);
      const dCenter = Math.hypot(s.x - px, s.z - pz);
      const d = Math.min(dDoor, dCenter);
      if (d < bestShopDist) {
        bestShopDist = d;
        nearbyShop = s;
      }
    }

    let nearbyMission: MissionDef | null = null;
    if (!this.activeMission && !this.currentVehicle && !this.cheatSessionActive) {
      for (const b of this.missionStartBeacons) {
        if (!b.group.visible) continue;
        if (Math.hypot(b.mission.startX - px, b.mission.startZ - pz) < 4.5) {
          nearbyMission = b.mission;
          break;
        }
      }
    }

    // Interact / Enter / Carjack / Exit Vehicle / Use Elevator / Club VIP Show
    if (inp.enterVehiclePressed || inp.carjackPressed) {
      if (this.currentVehicle) {
        if (this.taxiMode === 'passenger' && inp.carjackPressed) {
          // Throw out taxi driver mid-ride and take over!
          this.taxiMode = 'none';
          this.taxiDestinationLabel = null;
          this.taxiFareCash = 0;
          this.currentVehicle.hasDriver = false;
          if (this.currentVehicle.rig.driverGroup) this.currentVehicle.rig.driverGroup.visible = false;
          const ejectX = this.currentVehicle.x - Math.cos(this.currentVehicle.heading) * 2.1;
          const ejectZ = this.currentVehicle.z + Math.sin(this.currentVehicle.heading) * 2.1;
          this.spawnCivilianAt(ejectX, ejectZ, Math.floor(Math.random() * 60), 'flee', 12);
          this.stuntMessage = 'Vodič Horizon Cab vyhodený! Prebral si volant taxíka.';
          this.stuntTimer = 3.2;
          this.startTaxiDriverShift();
        } else if (nearbyShop?.category === 'garage') {
          this.callbacks.onShopInteract(nearbyShop);
        } else {
          this.exitCurrentVehicle();
        }
      } else if (nearClubStage && (!nearbyShop || nearbyShop.category === 'lounge')) {
        this.triggerClubEncoreShow();
      } else if (nearbyShop && (!nearbyVehicle || bestShopDist <= bestVehDist)) {
        this.callbacks.onShopInteract(nearbyShop);
      } else if (nearbyVehicle) {
        this.enterVehicle(nearbyVehicle, inp.carjackPressed);
      } else if (nearbyMission) {
        this.startMission(nearbyMission.id);
      } else if (this.nearbySideMission) {
        this.startMission(this.nearbySideMission.id);
      } else if (nearbyElevator) {
        nearbyElevator.targetFloorIndex = (nearbyElevator.targetFloorIndex + 1) % nearbyElevator.floors.length;
        const nextFloor = nearbyElevator.floors[nearbyElevator.targetFloorIndex];
        this.stuntMessage = `Výťah (${nearbyElevator.label}): ${nextFloor.name}`;
        this.stuntTimer = 2.6;
        this.audio.playUiChime('click');
      }
    }

    // Drive-in Customs Auto-Trigger: drive straight inside a garage bay to open Tuning & Repair automatically!
    if (this.currentVehicle && this.garageTriggerCooldown <= 0 && this.taxiMode !== 'passenger') {
      const k = this.currentVehicle.kind;
      if (k !== 'plane' && k !== 'fighter_jet' && k !== 'helicopter' && k !== 'boat') {
        const driveInGarage = SHOPS.find(
          (s) =>
            s.category === 'garage' &&
            Math.hypot(this.currentVehicle!.x - s.x, this.currentVehicle!.z - s.z) < 7.2
        );
        if (driveInGarage) {
          this.currentVehicle.speed = 0;
          this.currentVehicle.vx = 0;
          this.currentVehicle.vz = 0;
          this.garageTriggerCooldown = 6.0;
          this.callbacks.onShopInteract(driveInGarage);
        }
      }
    }

    // Check Hangar & Safehouse Garage auto-parking
    if (this.currentVehicle && Math.abs(this.currentVehicle.speed) < 3.5) {
      const v = this.currentVehicle;
      const isAir = v.kind === 'plane' || v.kind === 'helicopter' || v.kind === 'fighter_jet';
      if (
        isAir &&
        v.x >= AIRPORT_HANGAR_ZONE.minX &&
        v.x <= AIRPORT_HANGAR_ZONE.maxX &&
        v.z >= AIRPORT_HANGAR_ZONE.minZ &&
        v.z <= AIRPORT_HANGAR_ZONE.maxZ
      ) {
        this.upsertGarageVehicle('hangar', v);
      } else if (
        !isAir &&
        v.kind !== 'boat' &&
        v.x >= SAFEHOUSE_GARAGE_ZONE.minX &&
        v.x <= SAFEHOUSE_GARAGE_ZONE.maxX &&
        v.z >= SAFEHOUSE_GARAGE_ZONE.minZ &&
        v.z <= SAFEHOUSE_GARAGE_ZONE.maxZ
      ) {
        this.upsertGarageVehicle('safehouse', v);
      }
    }

    // Movement: On Foot vs Driving / Flying / Boating / Taxi Autopilot
    this.currentDriftIntensity = 0;
    if (this.currentVehicle) {
      this.isPlayerSprinting = false;
      this.stepPlayerDriving(dt, inp, this.currentVehicle);
      if (inp.hornHeld) {
        if (Math.floor(this.elapsedSec * 4) % 2 === 0) this.audio.playHorn();
        this.alertNearbyCrowd(px, pz, 18, false);
      }
    } else {
      this.stepPlayerOnFoot(dt, inp);
    }

    // Shooting (allowed on foot & drive-by; fighter_jet shoots rockets inside stepPlayerDriving!)
    if (inp.reloadPressed && this.reloadTimer <= 0) {
      this.startReload();
    }
    const inJet = this.currentVehicle?.kind === 'fighter_jet';
    if (inp.shootHeld && this.fireCooldown <= 0 && this.reloadTimer <= 0 && this.taxiMode !== 'passenger' && !inJet) {
      this.fireEquippedWeapon(inp.aimHeld);
    }

    // Step Vehicles (Autonomous Curved Traffic & Police Cars)
    this.stepOtherVehicles(dt, inp);

    // Step NPCs (Civilians, Cops, Syndicate Enemies)
    this.stepNpcs(dt);

    // Maintain lively ambient city crowd around player across 15x Island
    this.crowdMaintainTimer += dt;
    if (this.crowdMaintainTimer >= 2.5) {
      this.crowdMaintainTimer = 0;
      const curPx = this.playerRig.root.position.x;
      const curPz = this.playerRig.root.position.z;
      this.npcs = this.npcs.filter((n) => {
        if (!n.alive) return false;
        if (n.kind === 'civilian' && Math.hypot(n.x - curPx, n.z - curPz) > 195) {
          this.scene.remove(n.rig.root);
          return false;
        }
        return true;
      });
      const aliveCivs = this.npcs.filter((n) => n.alive && n.kind === 'civilian').length;
      if (aliveCivs < 24 && isIslandLandAt(curPx, curPz)) {
        for (let attempt = 0; attempt < 3; attempt++) {
          const ang = Math.random() * Math.PI * 2;
          const dist = 36 + Math.random() * 88;
          const sx = curPx + Math.cos(ang) * dist;
          const sz = curPz + Math.sin(ang) * dist;
          if (isIslandLandAt(sx, sz) && !isWaterAt(sx, sz)) {
            const act = isOnBeachAt(sx, sz) ? 'chill' : 'stroll';
            this.spawnCivilianAt(sx, sz, Math.floor(Math.random() * 120), 'wander', 0, act);
            break;
          }
        }
      }
    }

    // Step Police Wanted System
    this.stepWantedSystem(dt);

    // Step Explosive Barrels, Targets, Rockets, Tracers, Particles
    this.stepWorldDynamics(dt);

    // Step Mission Objectives
    this.stepMission(dt);

    // Update live soft Auto-Aim lock state for HUD indicator
    this.autoAimLocked = Boolean(inp.aimHeld && !this.currentVehicle && this.findAutoAimTarget());

    // Periodically run Adaptive Gemini AI NPC behavior updates based on weather/stars/district
    this.aiNpcTimer -= dt;
    if (this.aiNpcTimer <= 0 && !this.aiNpcInFlight) {
      this.aiNpcTimer = 8.5;
      this.stepAiNpcReaction(px, pz);
    }

    // Update Camera smoothly
    this.updateActiveCamera(dt, inp.aimHeld);

    // Update Audio Engine (including dynamic rain ambience)
    const speedKmh = this.currentVehicle ? Math.abs(this.currentVehicle.speed) * 3.6 : 0;
    this.audio.updateContinuous(
      Boolean(this.currentVehicle),
      speedKmh,
      this.wantedStars,
      this.elapsedSec,
      this.currentDriftIntensity,
      this.rainIntensity
    );

    // Sync active character coordinates
    activeChar.posX = this.playerRig.root.position.x;
    activeChar.posY = this.playerRig.root.position.y;
    activeChar.posZ = this.playerRig.root.position.z;
    activeChar.heading = this.camYaw;

    // Push Telemetry to React HUD (~18Hz)
    this.telemetryTimer += dt;
    if (this.telemetryTimer >= 0.055) {
      this.telemetryTimer = 0;
      let prompt: string | null = null;
      if (this.currentVehicle && nearbyShop?.category === 'garage') {
        prompt = `Vstúpiť do servisu ${nearbyShop.name}`;
      } else if (!this.currentVehicle) {
        if (nearClubStage && (!nearbyShop || nearbyShop.category === 'lounge')) {
          prompt = 'Spustiť VIP Encore Show v Malibu Lounge (-$100)';
        } else if (nearbyShop && (!nearbyVehicle || bestShopDist <= bestVehDist)) {
          prompt = `Vstúpiť: ${nearbyShop.name}`;
        } else if (nearbyVehicle) {
          const isEmerg =
            nearbyVehicle.kind === 'police' ||
            nearbyVehicle.kind === 'ambulance' ||
            nearbyVehicle.kind === 'firetruck';
          const emergTag = isEmerg ? ' (! Zásah polície)' : '';
          if (nearbyVehicle.kind === 'taxi' && nearbyVehicle.hasDriver) {
            prompt = 'Nastúpiť do Horizon Cab (Pasažier) · [G / Shift+F] Vyhodiť vodiča';
          } else if (nearbyVehicle.hasDriver) {
            prompt = `Vyhodiť vodiča a ukradnúť ${nearbyVehicle.name}${emergTag}`;
          } else {
            const verb =
              nearbyVehicle.kind === 'plane' || nearbyVehicle.kind === 'fighter_jet'
                ? 'Nastúpiť do lietadla'
                : nearbyVehicle.kind === 'helicopter'
                  ? 'Nastúpiť do vrtuľníka'
                  : nearbyVehicle.kind === 'boat'
                    ? 'Nastúpiť na loď'
                    : nearbyVehicle.kind === 'motorcycle'
                      ? 'Nasadať na motorku'
                      : 'Nastúpiť do';
            prompt = `${verb} ${nearbyVehicle.name}${emergTag}`;
          }
        } else if (nearbyMission) {
          prompt = `Spustiť príbeh: ${nearbyMission.title}`;
        } else if (this.nearbySideMission) {
          prompt = `Spustiť tajnú misiu: ${this.nearbySideMission.title}`;
        } else if (nearbyElevator) {
          const nextIdx = (nearbyElevator.targetFloorIndex + 1) % nearbyElevator.floors.length;
          const nextFloor = nearbyElevator.floors[nextIdx];
          prompt = `Použiť výťah (${nearbyElevator.label} -> ${nextFloor.name})`;
        }
      }
      this.pushTelemetry(inp, prompt);
    }
  }

  private triggerClubEncoreShow() {
    if (this.cash < 100) {
      this.stuntMessage = 'Malibu Lounge: Potrebuješ aspoň $100 na VIP Encore Show!';
      this.stuntTimer = 2.6;
      return;
    }
    this.cash -= 100;
    this.callbacks.onCashChange(this.cash);
    this.clubEncoreTimer = 26;
    this.audio.playUiChime('mission');
    this.stuntMessage = 'Malibu VIP Encore Show spustená! DJ zrýchľuje set (-$100)';
    this.stuntTimer = 3.2;
    const cx = this.clubShow?.clubX ?? 720;
    const cz = this.clubShow?.clubZ ?? -340;
    for (const n of this.npcs) {
      if (n.alive && n.kind === 'civilian' && Math.hypot(n.x - cx, n.z - cz) < 35) {
        n.behavior = 'cheer';
        n.panicTimer = 18;
      }
    }
  }

  public talkToNearestNpc() {
    const px = this.playerRig.root.position.x;
    const pz = this.playerRig.root.position.z;
    let closest: NpcEntity | null = null;
    let bestD = 9.0;
    for (const n of this.npcs) {
      if (!n.alive || n.kind !== 'civilian') continue;
      const d = Math.hypot(n.x - px, n.z - pz);
      if (d < bestD) {
        bestD = d;
        closest = n;
      }
    }
    if (!closest) {
      this.stuntMessage = 'V blízkosti nie je žiadny okoloidúci na rozhovor.';
      this.stuntTimer = 2.0;
      return;
    }
    closest.heading = Math.atan2(px - closest.x, pz - closest.z);
    const defaultLine =
      this.rainIntensity > 0.35
        ? 'Riadny lejak v Leonide, idem si nájsť prístrešok!'
        : this.wantedStars > 0
          ? 'Počul som policajné sirény, radšej sa držím bokom!'
          : 'V meste je dnes skvelá atmosféra, choď pozrieť do Malibu Lounge!';
    this.nearestNpcDialogue = {
      speaker: closest.name || 'Obyvateľ Leonidy',
      text: closest.aiDialogue || defaultLine,
      behavior: closest.behavior,
    };
    this.npcDialogueTimer = 5.5;
    this.audio.playUiChime('click');
    this.stepAiNpcReaction(px, pz, closest);
  }

  private stepAiNpcReaction(px: number, pz: number, specificNpc?: NpcEntity) {
    let target = specificNpc || null;
    if (!target) {
      let bestD = 42;
      for (const n of this.npcs) {
        if (!n.alive || n.kind !== 'civilian') continue;
        const d = Math.hypot(n.x - px, n.z - pz);
        if (d < bestD) {
          bestD = d;
          target = n;
        }
      }
    }
    if (!target) return;

    this.aiNpcInFlight = true;
    const weather = this.weatherType;
    const district = getDistrictName(px, pz);
    const wantedStars = this.wantedStars;
    const speedKmh = this.currentVehicle ? Math.round(Math.abs(this.currentVehicle.speed) * 3.6) : 0;

    fetch('/api/ai/npc-react', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        npcName: target.name || 'Obyvateľ',
        weather,
        wantedStars,
        district,
        timeOfDay: this.getGameClockString(),
        playerSpeedKmh: speedKmh,
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data || !target || !target.alive) return;
        if (typeof data.dialogue === 'string' && data.dialogue.trim()) {
          const line = data.dialogue.trim();
          target.aiDialogue = line;
          if (Math.hypot(target.x - this.playerRig.root.position.x, target.z - this.playerRig.root.position.z) < 16) {
            this.nearestNpcDialogue = {
              speaker: target.name || 'Obyvateľ Leonidy',
              text: line,
              behavior: String(data.behavior || target.behavior),
            };
            this.npcDialogueTimer = 5.5;
          }
        }
        const b = data.behavior;
        if (b === 'flee' || b === 'seek_shelter' || b === 'cheer' || b === 'wander') {
          target.behavior = b;
          if (b !== 'wander') target.panicTimer = 10;
        }
      })
      .catch(() => {})
      .finally(() => {
        this.aiNpcInFlight = false;
      });
  }

  private stepPlayerOnFoot(dt: number, inp: ReturnType<InputManager['poll']>) {
    const ch = this.characters[this.activeCharId];
    const hasSpeed = Math.abs(inp.moveX) > 0.05 || Math.abs(inp.moveY) > 0.05;
    const isSprinting = inp.sprint && hasSpeed && this.playerStamina > 4 && !inp.aimHeld;
    this.isPlayerSprinting = isSprinting;

    const staminaBonus = 1 + ((ch.skills?.stamina ?? 50) - 50) * 0.004;
    if (isSprinting) {
      this.playerStamina = Math.max(0, this.playerStamina - (22 / staminaBonus) * dt);
      this.addSkillXp('stamina', dt * 3.0);
    } else {
      const regen = (this.activeCharId === 'kairo' ? 28 : 18) * staminaBonus;
      this.playerStamina = Math.min(100, this.playerStamina + regen * dt);
    }

    const curInWater =
      isWaterAt(this.playerRig.root.position.x, this.playerRig.root.position.z) &&
      this.playerRig.root.position.y < 0.1;
    if (curInWater && hasSpeed) {
      this.addSkillXp('stamina', dt * 2.2);
    }
    const moveSpeed = curInWater
      ? isSprinting
        ? 6.4
        : 4.3
      : inp.aimHeld
        ? 4.2
        : isSprinting
          ? 10.6
          : 6.4;

    // Camera-relative movement direction
    const forwardX = Math.sin(this.camYaw);
    const forwardZ = Math.cos(this.camYaw);
    const rightX = Math.cos(this.camYaw);
    const rightZ = -Math.sin(this.camYaw);

    let dirX = forwardX * inp.moveY + rightX * -inp.moveX;
    let dirZ = forwardZ * inp.moveY + rightZ * -inp.moveX;
    const len = Math.hypot(dirX, dirZ);
    if (len > 1) {
      dirX /= len;
      dirZ /= len;
    }

    // Momentum / acceleration
    const accelFactor = this.playerGrounded ? 14 : this.parachuteDeployed ? 7.5 : 5;
    const airGlideMult = this.parachuteDeployed ? 2.0 : 1.0;
    this.playerVelX = THREE.MathUtils.damp(this.playerVelX, dirX * moveSpeed * airGlideMult, accelFactor, dt);
    this.playerVelZ = THREE.MathUtils.damp(this.playerVelZ, dirZ * moveSpeed * airGlideMult, accelFactor, dt);

    // Jump, Parachute deployment & Gravity
    const grav = this.settings.gameplayMods.lowGravity ? -9.8 : -24.0;
    if (inp.jumpPressed && this.playerGrounded && !curInWater) {
      this.playerVelY = this.settings.gameplayMods.lowGravity ? 10.5 : 8.2;
      this.playerGrounded = false;
    } else if (
      !this.playerGrounded &&
      !curInWater &&
      this.playerRig.root.position.y > 5.5 &&
      this.inventory.hasParachute &&
      !this.parachuteDeployed &&
      inp.jumpPressed
    ) {
      this.parachuteDeployed = true;
      this.parachuteRig.visible = true;
      this.audio.playUiChime('switch');
      this.stuntMessage = 'Padák otvorený!';
      this.stuntTimer = 2.0;
    }

    this.playerVelY += grav * dt;
    if (this.parachuteDeployed) {
      this.playerVelY = Math.max(-3.6, this.playerVelY);
      this.parachuteRig.rotation.z = THREE.MathUtils.damp(this.parachuteRig.rotation.z, -inp.moveX * 0.22, 6, dt);
      this.parachuteRig.rotation.x = THREE.MathUtils.damp(this.parachuteRig.rotation.x, inp.moveY * 0.16, 6, dt);
    } else if (!this.playerGrounded && this.playerRig.root.position.y > 4) {
      this.playerVelY = Math.max(-18.0, this.playerVelY);
    }

    // Sub-step horizontal movement with 0.33m collision radius so player can walk closely up to racks/counters/walls without tunneling
    const startX = this.playerRig.root.position.x;
    const startZ = this.playerRig.root.position.z;
    const dx = this.playerVelX * dt;
    const dz = this.playerVelZ * dt;
    let ny = this.playerRig.root.position.y + this.playerVelY * dt;
    const subSteps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.22));
    let nx = startX;
    let nz = startZ;
    for (let s = 1; s <= subSteps; s++) {
      const candX = nx + dx / subSteps;
      const candZ = nz + dz / subSteps;
      if (isOutOfBoundsSeaAt(candX, candZ)) {
        this.triggerDeepOceanDeath();
        return;
      }
      const res = this.resolveBuildingCollision(candX, candZ, 0.33, Math.max(0, ny), false);
      nx = res.x;
      nz = res.z;
    }

    const groundH = this.getGroundHeightAt(nx, nz, this.playerRig.root.position.y);
    const waterHere = isWaterAt(nx, nz) && groundH <= 0.05;
    const floorY = waterHere ? -0.82 : groundH;
    if (ny <= floorY) {
      ny = floorY;
      this.playerVelY = 0;
      this.playerGrounded = true;
      if (this.parachuteDeployed) {
        this.parachuteDeployed = false;
        this.parachuteRig.visible = false;
      }
    }

    this.playerRig.root.position.set(nx, ny, nz);
    this.playerRig.root.rotation.z = 0;
    this.playerRig.root.visible = true;

    // Character facing rotation
    if (inp.aimHeld || this.cameraMode === 'first_person') {
      this.playerRig.root.rotation.y = this.camYaw;
    } else if (len > 0.1) {
      const targetAngle = Math.atan2(dirX, dirZ);
      let diff = targetAngle - this.playerRig.root.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.playerRig.root.rotation.y += diff * Math.min(1, 14 * dt);
    }

    // Decay weapon recoil smoothly
    this.weaponRecoilKick *= Math.exp(-16 * dt);

    // Procedural limb walk / swim / realistic 1H & 2H weapon holding stance
    const horizSpeed = Math.hypot(this.playerVelX, this.playerVelZ);
    const swing = horizSpeed > 0.3 ? Math.sin(this.elapsedSec * (isSprinting ? 13 : 8.5)) * 0.65 : 0;
    const wId = this.inventory.equippedWeapon;
    if (waterHere && ny < -0.3) {
      const stroke = Math.sin(this.elapsedSec * 5.5) * 0.85;
      this.playerRig.leftArmPivot.rotation.set(-Math.PI / 2 + stroke, 0, 0);
      this.playerRig.rightArmPivot.rotation.set(-Math.PI / 2 - stroke, 0, 0);
      this.playerRig.leftLegPivot.rotation.x = stroke * 0.4;
      this.playerRig.rightLegPivot.rotation.x = -stroke * 0.4;
      this.playerRig.weaponMount.position.set(0, -0.52, 0.05);
      this.playerRig.weaponMount.rotation.set(0.2, 0, 0);
    } else {
      this.playerRig.leftLegPivot.rotation.x = swing;
      this.playerRig.rightLegPivot.rotation.x = -swing;

      if (inp.aimHeld || this.muzzleFlashTimer > 0 || this.weaponRecoilKick > 0.012) {
        if (wId === 'rpg') {
          // Over-the-shoulder heavy launcher stance
          this.playerRig.rightArmPivot.rotation.set(
            -Math.PI * 0.56 + this.camPitch * 0.72 - this.weaponRecoilKick * 1.4,
            0,
            0.08
          );
          this.playerRig.leftArmPivot.rotation.set(-Math.PI * 0.48 + this.camPitch * 0.65, 0, -0.36);
          this.playerRig.weaponMount.position.set(0.02, -0.44, 0.02 - this.weaponRecoilKick * 0.25);
          this.playerRig.weaponMount.rotation.set(Math.PI * 0.54, 0, 0);
        } else if (wId === 'minigun') {
          // Low-hip two-handed heavy minigun brace
          this.playerRig.rightArmPivot.rotation.set(-Math.PI * 0.28 + this.camPitch * 0.42, 0, 0.14);
          this.playerRig.leftArmPivot.rotation.set(-Math.PI * 0.36 + this.camPitch * 0.42, 0, -0.42);
          this.playerRig.weaponMount.position.set(-0.08, -0.48, 0.08 - this.weaponRecoilKick * 0.35);
          this.playerRig.weaponMount.rotation.set(Math.PI * 0.28, -0.18, 0);
        } else if (wId === 'pistol') {
          // Crisp dual-hand tactical pistol grip
          this.playerRig.rightArmPivot.rotation.set(
            -Math.PI * 0.5 + this.camPitch * 0.75 - this.weaponRecoilKick * 1.5,
            0,
            0.06
          );
          this.playerRig.leftArmPivot.rotation.set(-Math.PI * 0.36 + this.camPitch * 0.55, 0, -0.32);
          this.playerRig.weaponMount.position.set(0, -0.52, 0.05 - this.weaponRecoilKick * 0.2);
          this.playerRig.weaponMount.rotation.set(Math.PI * 0.5, -0.04, 0);
        } else {
          // Two-handed rifle / SMG / shotgun / sniper cheek-weld grip
          this.playerRig.rightArmPivot.rotation.set(
            -Math.PI * 0.48 + this.camPitch * 0.72 - this.weaponRecoilKick * 1.2,
            0,
            0.14
          );
          this.playerRig.leftArmPivot.rotation.set(-Math.PI * 0.46 + this.camPitch * 0.72, 0, -0.48);
          this.playerRig.weaponMount.position.set(-0.05, -0.5, 0.07 - this.weaponRecoilKick * 0.3);
          this.playerRig.weaponMount.rotation.set(Math.PI * 0.48, -0.22, 0);
        }
      } else {
        // Natural relaxed/carry pose while walking or sprinting
        this.playerRig.leftArmPivot.rotation.set(-swing * 0.65, 0, 0);
        if (wId === 'pistol') {
          this.playerRig.rightArmPivot.rotation.set(swing * 0.62, 0, 0);
          this.playerRig.weaponMount.position.set(0, -0.52, 0.05);
          this.playerRig.weaponMount.rotation.set(0.14, 0, 0);
        } else if (wId === 'minigun') {
          this.playerRig.rightArmPivot.rotation.set(-0.34 + swing * 0.16, 0, 0.1);
          this.playerRig.weaponMount.position.set(-0.06, -0.49, 0.06);
          this.playerRig.weaponMount.rotation.set(0.32, -0.14, 0);
        } else {
          this.playerRig.rightArmPivot.rotation.set(-0.28 + swing * 0.26, 0, 0.08);
          this.playerRig.weaponMount.position.set(-0.03, -0.51, 0.06);
          this.playerRig.weaponMount.rotation.set(0.28, -0.14, 0);
        }
      }
    }

    // Hide character body in 1st person so camera never clips inside head
    const isFp = this.cameraMode === 'first_person';
    this.playerRig.headGroup.visible = !isFp;
    this.playerRig.torsoGroup.visible = !isFp;
    this.playerRig.leftLegPivot.visible = !isFp;
    this.playerRig.rightLegPivot.visible = !isFp;
    this.firstPersonWeaponGroup.visible = isFp && !this.currentVehicle;

    // Gentle weapon sway & live recoil kickback in 1P
    if (isFp) {
      this.firstPersonWeaponGroup.position.x =
        (inp.aimHeld ? 0.0 : 0.24) + Math.sin(this.elapsedSec * 7) * horizSpeed * 0.002;
      this.firstPersonWeaponGroup.position.y =
        (inp.aimHeld ? -0.15 : -0.22) + Math.abs(Math.cos(this.elapsedSec * 7)) * horizSpeed * 0.002;
      this.firstPersonWeaponGroup.position.z = -0.42 + this.weaponRecoilKick * 0.45;
      this.firstPersonWeaponGroup.rotation.x = this.weaponRecoilKick * 0.85;
    }

    ch.district = getDistrictName(nx, nz);
  }

  private enterVehicle(v: VehicleEntity, forceCarjack = false) {
    // Entering an occupied Horizon Cab as passenger (unless forceCarjack with G / Shift+F)
    if (v.kind === 'taxi' && v.hasDriver && !forceCarjack) {
      this.currentVehicle = v;
      this.lastLandVehicle = v;
      v.occupiedByPlayer = true;
      v.isTraffic = false;
      v.speed = 0;
      this.playerRig.root.visible = false;
      this.firstPersonWeaponGroup.visible = false;
      this.taxiMode = 'passenger';
      this.taxiDestinationLabel = null;
      this.taxiFareCash = 0;
      this.audio.playUiChime('click');
      this.stuntMessage = 'Horizon Cab: Vyber destináciu na mape!';
      this.stuntTimer = 3.2;
      this.callbacks.onTaxiMenuRequested?.();
      return;
    }

    // Carjacking: Eject live driver from traffic vehicle onto the street!
    if (v.hasDriver) {
      v.hasDriver = false;
      v.stoppedByPlayer = false;
      v.speed = 0;
      v.vx = 0;
      v.vz = 0;
      if (v.rig.driverGroup) {
        v.rig.driverGroup.visible = false;
      }
      const ejectX = v.x - Math.cos(v.heading) * 2.1;
      const ejectZ = v.z + Math.sin(v.heading) * 2.1;
      const behavior: 'flee' | 'fight' = Math.random() < 0.28 ? 'fight' : 'flee';
      const ejected = this.spawnCivilianAt(ejectX, ejectZ, Math.floor(Math.random() * 50), behavior, 14);
      ejected.heading = v.heading - Math.PI / 2;
      this.stuntMessage = `Vodič vyhodený! Vozidlo ${v.name} ukradnuté`;
      this.stuntTimer = 3.0;
      this.audio.playImpact(0.45);
      this.input.triggerVibration(160, 0.5, 0.45);
      this.alertNearbyCrowd(v.x, v.z, 20, false);
    }

    this.currentVehicle = v;
    if (v.kind !== 'boat' && v.kind !== 'plane' && v.kind !== 'helicopter' && v.kind !== 'fighter_jet') {
      this.lastLandVehicle = v;
    }
    v.occupiedByPlayer = true;
    v.isTraffic = false;
    const riderVisible = v.kind === 'motorcycle' || v.kind === 'boat';
    this.playerRig.root.visible = riderVisible;
    this.firstPersonWeaponGroup.visible = false;
    this.parachuteDeployed = false;
    this.parachuteRig.visible = false;
    this.audio.playUiChime('click');

    if (v.kind === 'taxi') {
      this.startTaxiDriverShift();
    }

    // Entering Police Car, Ambulance or Firetruck triggers delayed police dispatch (time to flee!)
    const isEmergencyVehicle = v.kind === 'police' || v.kind === 'ambulance' || v.kind === 'firetruck';
    if (isEmergencyVehicle && !this.settings.gameplayMods.noPolice) {
      this.schedulePoliceDispatch(`Krádež zásahového vozidla (${v.name})`, 2, 7.0);
    }
  }

  private exitCurrentVehicle() {
    if (!this.currentVehicle) return;
    const v = this.currentVehicle;
    v.occupiedByPlayer = false;
    if (this.taxiMode !== 'none') {
      this.taxiMode = 'none';
      this.taxiDestinationLabel = null;
      this.taxiFareCash = 0;
      if (this.taxiDropBeacon) this.taxiDropBeacon.visible = false;
      this.clearGpsWaypoint();
    }
    const sideOffset =
      v.kind === 'plane' || v.kind === 'fighter_jet' || v.kind === 'helicopter'
        ? 4.8
        : v.kind === 'boat'
          ? 2.6
          : 2.2;
    const sideX = Math.cos(v.heading) * sideOffset;
    const sideZ = -Math.sin(v.heading) * sideOffset;
    const exitResolved = this.resolveBuildingCollision(v.x + sideX, v.z + sideZ, 0.5, Math.max(0, v.y), true, v);
    this.playerRig.root.position.set(exitResolved.x, Math.max(0, v.y), exitResolved.z);
    this.playerRig.root.rotation.z = 0;
    this.playerRig.headGroup.visible = this.cameraMode !== 'first_person';
    this.playerRig.torsoGroup.visible = this.cameraMode !== 'first_person';
    this.playerRig.leftLegPivot.visible = this.cameraMode !== 'first_person';
    this.playerRig.rightLegPivot.visible = this.cameraMode !== 'first_person';
    this.playerRig.root.visible = true;
    this.playerVelX = v.vx * 0.25;
    this.playerVelZ = v.vz * 0.25;
    this.playerVelY = 0;
    this.playerGrounded = v.y <= this.getGroundHeightAt(exitResolved.x, exitResolved.z, v.y) + 0.5;
    this.currentVehicle = null;
  }

  private stepPlayerDriving(dt: number, inp: ReturnType<InputManager['poll']>, v: VehicleEntity) {
    const ch = this.characters[this.activeCharId];
    const luciaBonus = this.activeCharId === 'lucia' ? 1.15 : 1.0;
    const turbo = this.settings.gameplayMods.turboVehicles ? 1.55 : 1.0;
    const engineMult = 1 + v.upgrades.engineLevel * 0.08 + (v.upgrades.turbo ? 0.14 : 0);
    const accelMult = 1 + v.upgrades.engineLevel * 0.1 + (v.upgrades.turbo ? 0.18 : 0);
    const gripBonus = 1 + v.upgrades.suspensionLevel * 0.14;
    const flyingSkillBonus = 1 + ((ch.skills?.flying ?? 50) - 50) * 0.0025;

    const maxSpd = v.maxSpeed * luciaBonus * turbo * engineMult;
    const accel = v.accel * luciaBonus * turbo * accelMult;

    // Damage smoke & fire particles when vehicle health < 35%
    const hpRatio = v.health / Math.max(1, v.maxHealth);
    if (hpRatio < 0.35 && !v.destroyed) {
      this.smokeTimer -= dt;
      if (this.smokeTimer <= 0) {
        this.smokeTimer = 0.12;
        const hoodX = v.x + Math.sin(v.heading) * 1.3;
        const hoodZ = v.z + Math.cos(v.heading) * 1.3;
        const col = hpRatio < 0.16 ? 0xf97316 : 0x475569;
        this.spawnParticleBurst(new THREE.Vector3(hoodX, v.y + 0.9, hoodZ), col, 2);
      }
    }

    // 0. TAXI PASSENGER AUTOPILOT
    if (this.taxiMode === 'passenger' && v.kind === 'taxi') {
      if (this.taxiDestinationLabel) {
        const route = computeGpsRoute(v.x, v.z, this.taxiTargetX, this.taxiTargetZ);
        let navPt = { x: this.taxiTargetX, z: this.taxiTargetZ };
        for (const pt of route) {
          if (Math.hypot(pt.x - v.x, pt.z - v.z) > 12) {
            navPt = pt;
            break;
          }
        }
        const totalDist = Math.hypot(this.taxiTargetX - v.x, this.taxiTargetZ - v.z);
        if (totalDist < 14) {
          const paid = Math.min(this.cash, this.taxiFareCash);
          this.cash -= paid;
          this.callbacks.onCashChange(this.cash);
          this.stuntMessage = `Horizon Cab dorazil do ${this.taxiDestinationLabel} (-$${paid})`;
          this.stuntTimer = 3.6;
          this.audio.playUiChime('mission');
          this.exitCurrentVehicle();
          return;
        }
        const desiredHeading = Math.atan2(navPt.x - v.x, navPt.z - v.z);
        let hDiff = desiredHeading - v.heading;
        while (hDiff > Math.PI) hDiff -= Math.PI * 2;
        while (hDiff < -Math.PI) hDiff += Math.PI * 2;
        v.steerAngle = THREE.MathUtils.clamp(hDiff * 1.3, -0.5, 0.5);
        v.heading += THREE.MathUtils.clamp(hDiff, -2.6 * dt, 2.6 * dt);
        v.speed = THREE.MathUtils.damp(v.speed, totalDist < 36 ? 12 : 24, 3.5, dt);
        v.vx = Math.sin(v.heading) * v.speed;
        v.vz = Math.cos(v.heading) * v.speed;
        const col = this.resolveBuildingCollision(v.x + v.vx * dt, v.z + v.vz * dt, 1.5, Math.max(0, v.y), true, v);
        v.x = col.x;
        v.z = col.z;
        v.y = this.getGroundHeightAt(v.x, v.z, v.y);
        v.rig.root.position.set(v.x, v.y, v.z);
        v.rig.root.rotation.y = v.heading;
        v.wheelSpin += (v.speed / 0.34) * dt;
        v.rig.wheels.forEach((w) => (w.rotation.x = v.wheelSpin));
        v.rig.frontSteerPivots.forEach((p) => (p.rotation.y = v.steerAngle * 0.8));
      } else {
        v.speed = THREE.MathUtils.damp(v.speed, 0, 5, dt);
      }
      this.playerRig.root.position.set(v.x, v.y, v.z);
      ch.district = getDistrictName(v.x, v.z);
      return;
    }

    // 0b. TAXI DRIVER SHIFT PROGRESS
    if (v.kind === 'taxi' && (this.taxiMode === 'driver_waiting' || this.taxiMode === 'driver_active')) {
      if (this.taxiMode === 'driver_waiting') {
        if (Math.hypot(v.x - this.taxiPickupX, v.z - this.taxiPickupZ) < 12) {
          this.taxiMode = 'driver_active';
          if (this.taxiDropBeacon) {
            this.taxiDropBeacon.position.set(this.taxiTargetX, 0.25, this.taxiTargetZ);
          }
          this.setGpsWaypoint(this.taxiTargetX, this.taxiTargetZ, `Vyložiť zákazníka: ${this.taxiDestinationLabel || 'Cieľ'}`);
          this.stuntMessage = `Zákazník nastúpil! Odvez ho do ${this.taxiDestinationLabel}`;
          this.stuntTimer = 3.2;
          this.audio.playUiChime('switch');
        }
      } else if (this.taxiMode === 'driver_active') {
        if (Math.hypot(v.x - this.taxiTargetX, v.z - this.taxiTargetZ) < 14) {
          this.cash += this.taxiFareCash;
          this.callbacks.onCashChange(this.cash);
          this.stuntMessage = `Zákazník vyložený! Zárobok +$${this.taxiFareCash}`;
          this.stuntTimer = 3.5;
          this.audio.playUiChime('mission');
          this.taxiMode = 'none';
          this.taxiDestinationLabel = null;
          this.taxiFareCash = 0;
          if (this.taxiDropBeacon) this.taxiDropBeacon.visible = false;
          this.clearGpsWaypoint();
        }
      }
    }

    // 1. HELICOPTER 3D CYCLIC ROTOR, MOMENTUM & GROUND-EFFECT PHYSICS
    if (v.kind === 'helicopter') {
      v.rig.bodyGroup.rotation.order = 'YXZ';
      const groundH = isWaterAt(v.x, v.z) ? 0.1 : this.getGroundHeightAt(v.x, v.z, v.y);
      const agl = Math.max(0, v.y - groundH);
      const isAirborne = agl > 0.35;

      // Spin Main Rotor & Tail Rotor
      if (v.rig.propeller) v.rig.propeller.rotation.y += (isAirborne ? 26 : 12) * dt;
      if (v.rig.tailRotor) v.rig.tailRotor.rotation.x += (isAirborne ? 38 : 18) * dt;

      // Ground effect lift cushion within 4.5m of surface
      const groundEffect = 1 + (1 - Math.min(1, agl / 4.5)) * 0.28;

      // Collective Ascend (Space / R2-climb assist) & Descend (Shift / L2)
      const heliStickY =
        Math.abs(inp.padRightStickY) > 0.2 ? inp.padRightStickY : inp.stickConfig.moveStick === 'right' ? inp.padLeftStickY : 0;
      const heliClimbAxis = inp.stickConfig.pitchInvert ? -heliStickY : heliStickY;
      let targetVy = isAirborne ? -0.35 : 0;
      if (inp.jumpHeld || inp.pitchUpHeld || heliClimbAxis > 0.2) {
        targetVy = 16.5 * flyingSkillBonus * groundEffect;
      } else if (inp.sprint || inp.pitchDownHeld || heliClimbAxis < -0.2) {
        targetVy = isAirborne ? -13.5 : 0;
      }
      v.vy = THREE.MathUtils.damp(v.vy, targetVy, 5.2, dt);

      // Cyclic Pitch & Roll Attitude + Aerodynamic Tilt Thrust Vectoring
      const cyclicCmd = inp.throttle - inp.brake * 0.78;
      const bankInput = inp.moveX;
      const yawBumper = (inp.r1Held ? 1 : 0) - (inp.l1Held ? 1 : 0);
      const rudderCmd =
        inp.stickConfig.yawSource === 'bumpers' && yawBumper !== 0
          ? yawBumper
          : inp.stickConfig.yawSource === 'right_x' && Math.abs(inp.padRightStickX) > 0.12
            ? inp.padRightStickX
            : bankInput * 0.88;

      // Coordinated tail-rotor yaw + subtle bank-assisted turn
      const yawRate = -(rudderCmd * 1.95 + Math.sin(v.roll) * 0.55) * flyingSkillBonus * dt;
      v.heading += isAirborne ? yawRate : yawRate * 0.35;

      const targetPitch = isAirborne ? -cyclicCmd * 0.32 : 0;
      const targetRoll = isAirborne ? bankInput * 0.42 : 0; // Right bank (+rotation.z tilts -X wing down)
      v.pitch = THREE.MathUtils.damp(v.pitch, targetPitch, 5.0, dt);
      v.roll = THREE.MathUtils.damp(v.roll, targetRoll, 5.2, dt);

      const fwdX = Math.sin(v.heading);
      const fwdZ = Math.cos(v.heading);
      // Facing +Z with +Y up, screen right is -X: (-cos(heading), +sin(heading))
      const rightVecX = -Math.cos(v.heading);
      const rightVecZ = Math.sin(v.heading);

      if (isAirborne) {
        // Horizontal thrust vector comes from rotor disc tilt (sin(-pitch) forward, sin(roll) lateral)
        const rotorAccelMag = Math.max(accel * 1.45, 28) * flyingSkillBonus;
        const forwardTilt = Math.sin(-v.pitch) * 1.75 + cyclicCmd * 0.28;
        const lateralTilt = Math.sin(v.roll) * 0.85;
        v.vx += (fwdX * forwardTilt + rightVecX * lateralTilt) * rotorAccelMag * dt;
        v.vz += (fwdZ * forwardTilt + rightVecZ * lateralTilt) * rotorAccelMag * dt;

        // Aerodynamic drag + rotor downwash damping
        const airSpeedHoriz = Math.hypot(v.vx, v.vz);
        const dragFactor = Math.exp(-(0.55 + airSpeedHoriz * 0.012) * dt);
        v.vx *= dragFactor;
        v.vz *= dragFactor;

        if (airSpeedHoriz > maxSpd) {
          const clampScale = maxSpd / airSpeedHoriz;
          v.vx *= clampScale;
          v.vz *= clampScale;
        }
      } else {
        // On skids: rolling friction
        const skidDrag = Math.exp(-5.0 * dt);
        v.vx *= skidDrag;
        v.vz *= skidDrag;
      }

      v.speed = v.vx * fwdX + v.vz * fwdZ;

      let nx = v.x + v.vx * dt;
      let ny = THREE.MathUtils.clamp(v.y + v.vy * dt, groundH, 210);
      let nz = v.z + v.vz * dt;

      if (isOutOfBoundsSeaAt(nx, nz)) {
        this.triggerDeepOceanDeath();
        return;
      }

      if (ny <= groundH && v.vy < -10.5) {
        const impactShock = Math.min(28, Math.abs(v.vy + 10.5) * 2.2);
        if (!this.godModeActive) v.health = Math.max(0, v.health - impactShock);
        this.audio.playImpact(0.7);
        this.input.triggerVibration(160, 0.5, 0.65);
        v.vy = 0;
      } else if (ny <= groundH) {
        v.vy = 0;
      }

      if (ny < 68) {
        const heliCol = this.resolveBuildingCollision(nx, nz, 2.6, Math.max(0, ny), true, v);
        if (heliCol.collided) {
          nx = heliCol.x;
          nz = heliCol.z;
          v.vx *= 0.4;
          v.vz *= 0.4;
          v.speed *= 0.4;
          this.audio.playImpact(0.5);
        }
      }

      if (ny > groundH + 2) this.addSkillXp('flying', dt * 2.4);

      v.x = nx;
      v.y = ny;
      v.z = nz;
      v.rig.root.position.set(v.x, v.y, v.z);
      v.rig.root.rotation.y = v.heading;
      v.rig.bodyGroup.rotation.x = -v.pitch;
      v.rig.bodyGroup.rotation.z = v.roll;
      this.playerRig.root.position.set(v.x, v.y + 0.6, v.z);
      ch.district = v.y > 16 ? 'Vzdušný priestor Leonida' : getDistrictName(v.x, v.z);
      return;
    }

    // 2. AIRCRAFT & FIGHTER JET 3D AERODYNAMIC FLIGHT PHYSICS (Lift, Stall, Gravity Energy Trade-off, Bank-to-Turn)
    if (v.kind === 'plane' || v.kind === 'fighter_jet') {
      v.rig.bodyGroup.rotation.order = 'YXZ';
      const isJet = v.kind === 'fighter_jet';
      const afterburner = isJet && inp.sprint && inp.throttle > 0.1;
      const effMaxSpd = maxSpd * (afterburner ? 1.32 : 1.0);
      const effAccel = accel * (afterburner ? 1.48 : 1.0);

      const groundH = isWaterAt(v.x, v.z) ? -0.35 : this.getGroundHeightAt(v.x, v.z, v.y);
      const isAirborne = v.y > groundH + 0.4;
      const stallSpeed = isJet ? 18.0 : 13.5;
      const takeoffSpeed = isJet ? 22.0 : 17.0;

      // Engine Thrust + Quadratic Aerodynamic Drag + Climb/Dive Energy Exchange
      if (inp.throttle > 0.05) {
        v.speed += effAccel * inp.throttle * dt;
      } else {
        const parasiticDrag = isAirborne ? 0.065 + Math.abs(v.speed) * 0.0022 : 0.45;
        v.speed *= Math.exp(-parasiticDrag * dt);
      }
      if (inp.brake > 0.05) {
        const brakeDecel = isAirborne ? effAccel * 0.55 : effAccel * 1.15;
        v.speed -= brakeDecel * inp.brake * dt;
      }
      if (isAirborne) {
        // Gravity trades airspeed for altitude on climbs and accelerates dives
        v.speed -= Math.sin(v.pitch) * 15.5 * dt;
        // Induced drag during high-angle bank maneuvers
        v.speed -= Math.abs(Math.sin(v.roll)) * 2.4 * dt;
      }
      v.speed = THREE.MathUtils.clamp(v.speed, isAirborne ? 4 : -6, effMaxSpd);

      if (v.rig.propeller) {
        v.rig.propeller.rotation.z += (8 + Math.abs(v.speed) * 1.15) * dt;
      }
      if (v.rig.afterburners) {
        const glow = afterburner ? 3.8 : inp.throttle > 0.1 ? 1.6 : 0.35;
        for (const ab of v.rig.afterburners) {
          (ab.material as THREE.MeshStandardMaterial).emissiveIntensity = glow;
        }
        if (afterburner && Math.random() < 0.6) {
          this.spawnParticleBurst(
            new THREE.Vector3(v.x - Math.sin(v.heading) * 3.5, v.y + 0.85, v.z - Math.cos(v.heading) * 3.5),
            0x38bdf8,
            1
          );
        }
      }

      // Stick Y: up = +1, down = -1. With pitchInvert = true (default): stick DOWN (< -0.15) => Climb (+pitch), stick UP (> +0.15) => Dive (-pitch)!
      const primaryStickY = inp.stickConfig.moveStick === 'right' ? inp.padRightStickY : inp.padLeftStickY;
      const altStickY = inp.stickConfig.moveStick === 'right' ? inp.padLeftStickY : inp.padRightStickY;
      const stickPitchRaw =
        Math.abs(primaryStickY) > 0.15 ? primaryStickY : Math.abs(altStickY) > 0.15 ? altStickY : 0;
      const stickPitchCmd = inp.stickConfig.pitchInvert ? -stickPitchRaw : stickPitchRaw;

      const kbClimb = inp.stickConfig.pitchInvert ? inp.pitchDownHeld : inp.pitchUpHeld;
      const kbDive = inp.stickConfig.pitchInvert ? inp.pitchUpHeld : inp.pitchDownHeld;
      const analogClimb = stickPitchCmd > 0.15 ? stickPitchCmd : 0;
      const analogDive = stickPitchCmd < -0.15 ? -stickPitchCmd : 0;
      const climbStrength = Math.max(analogClimb, inp.jumpHeld || kbClimb ? 1 : 0);
      const diveStrength = Math.max(analogDive, kbDive || (!isJet && inp.sprint) ? 1 : 0);

      const controlAuthority = THREE.MathUtils.clamp(v.speed / takeoffSpeed, 0.2, 1.15);
      const isStalling = isAirborne && v.speed < stallSpeed;

      if (v.speed >= takeoffSpeed * 0.9 && climbStrength > 0.05) {
        v.pitch = THREE.MathUtils.clamp(
          v.pitch + (isJet ? 1.05 : 0.86) * climbStrength * controlAuthority * flyingSkillBonus * dt,
          -0.68,
          0.66
        );
      } else if (isAirborne && diveStrength > 0.05) {
        v.pitch = THREE.MathUtils.clamp(
          v.pitch - (isJet ? 1.05 : 0.86) * diveStrength * controlAuthority * flyingSkillBonus * dt,
          -0.68,
          0.66
        );
      } else if (isStalling) {
        // Stall nose-drop recovery pitches nose gently downward toward dive
        v.pitch = THREE.MathUtils.damp(v.pitch, -0.26, 1.8, dt);
      } else if (!isAirborne) {
        v.pitch = THREE.MathUtils.damp(v.pitch, 0, 5.5, dt);
      } else {
        // Subtle aerodynamic pitch stability in cruise
        v.pitch = THREE.MathUtils.damp(v.pitch, 0.015, 0.85, dt);
      }

      // Bank / Aileron Roll + Dihedral Self-Leveling when stick neutral
      const rollInput = inp.moveX;
      const maxBankAngle = isJet ? 0.98 : 0.78;
      if (isAirborne) {
        if (Math.abs(rollInput) > 0.05) {
          const rollRate = (isJet ? 2.4 : 1.85) * controlAuthority * flyingSkillBonus;
          v.roll = THREE.MathUtils.clamp(v.roll + rollInput * rollRate * dt, -maxBankAngle, maxBankAngle);
        } else {
          v.roll = THREE.MathUtils.damp(v.roll, 0, 2.2, dt);
        }
      } else {
        v.roll = THREE.MathUtils.damp(v.roll, rollInput * 0.06, 7, dt);
      }

      // Coordinated Bank-to-Turn + Rudder Yaw
      const bumperYaw = (inp.r1Held ? 1 : 0) - (inp.l1Held ? 1 : 0);
      const rudderInput =
        inp.stickConfig.yawSource === 'bumpers'
          ? bumperYaw * 0.85
          : inp.stickConfig.yawSource === 'right_x'
            ? inp.padRightStickX * 0.85
            : 0;
      const bankTurnRate = Math.sin(v.roll) * (isJet ? 1.48 : 1.18) * controlAuthority;
      const groundSteerRate = (rollInput * 0.9 + rudderInput) * Math.min(1, Math.abs(v.speed) / 10);
      const yawDelta = isAirborne
        ? (bankTurnRate + rudderInput * 0.65 + rollInput * 0.25) * flyingSkillBonus * dt
        : groundSteerRate * dt;
      v.heading -= yawDelta;

      const cosP = Math.cos(v.pitch);
      v.vx = Math.sin(v.heading) * v.speed * cosP;
      v.vz = Math.cos(v.heading) * v.speed * cosP;

      // Wing Lift Curve & Vertical Flight Path
      if (v.speed >= takeoffSpeed && (v.pitch > 0.025 || isAirborne)) {
        const liftRatio = THREE.MathUtils.clamp(v.speed / takeoffSpeed, 0.55, 1.35);
        const stallSink = isStalling ? (1 - v.speed / stallSpeed) * 14.5 : 0;
        const bankLiftLoss = (1 - Math.cos(v.roll)) * 3.8;
        const targetVy = Math.sin(v.pitch) * Math.max(v.speed, takeoffSpeed) * liftRatio - stallSink - bankLiftLoss;
        v.vy = THREE.MathUtils.damp(v.vy, targetVy, isStalling ? 2.4 : 4.2, dt);
      } else {
        v.vy += -16.5 * dt;
      }

      // Armed Fighter Jet Twin Rockets!
      if (isJet && inp.shootHeld && this.fireCooldown <= 0) {
        this.fireCooldown = 0.28;
        this.audio.playGunshot('rpg');
        const fwdX = Math.sin(v.heading) * cosP;
        const fwdY = Math.sin(v.pitch);
        const fwdZ = Math.cos(v.heading) * cosP;
        const rocketMesh = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.11, 0.45, 4, 8),
          new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0ea5e9, emissiveIntensity: 1.8 })
        );
        rocketMesh.rotation.x = Math.PI / 2;
        rocketMesh.position.set(v.x + fwdX * 3.8, v.y + 0.9, v.z + fwdZ * 3.8);
        this.scene.add(rocketMesh);
        this.rockets.push({
          mesh: rocketMesh,
          x: rocketMesh.position.x,
          y: rocketMesh.position.y,
          z: rocketMesh.position.z,
          vx: fwdX * 135,
          vy: fwdY * 135,
          vz: fwdZ * 135,
          life: 2.8,
        });
      }

      let nx = v.x + v.vx * dt;
      let ny = THREE.MathUtils.clamp(v.y + v.vy * dt, groundH, 240);
      let nz = v.z + v.vz * dt;

      if (isOutOfBoundsSeaAt(nx, nz)) {
        this.triggerDeepOceanDeath();
        return;
      }

      if (ny <= groundH) {
        if (v.vy < -13.0) {
          const crashDamage = Math.min(48, Math.abs(v.vy + 13.0) * 3.2);
          if (!this.godModeActive) v.health = Math.max(0, v.health - crashDamage);
          this.audio.playImpact(0.8);
          this.input.triggerVibration(220, 0.7, 0.8);
        }
        ny = groundH;
        v.vy = 0;
        if (v.pitch < 0) v.pitch = 0;
      }

      if (ny < 64) {
        const planeCol = this.resolveBuildingCollision(nx, nz, 2.8, Math.max(0, ny), true, v);
        if (planeCol.collided) {
          nx = planeCol.x;
          nz = planeCol.z;
          v.speed *= 0.55;
          this.audio.playImpact(0.65);
          this.input.triggerVibration(180, 0.55, 0.65);
        }
      }

      if (isAirborne) this.addSkillXp('flying', dt * 2.5);

      v.x = nx;
      v.y = ny;
      v.z = nz;
      v.rig.root.position.set(v.x, v.y, v.z);
      v.rig.root.rotation.y = v.heading;
      v.rig.bodyGroup.rotation.x = -v.pitch;
      v.rig.bodyGroup.rotation.z = v.roll;

      if (!isAirborne) {
        v.wheelSpin += (v.speed / 0.25) * dt;
        v.rig.wheels.forEach((w) => (w.rotation.x = v.wheelSpin));
      }

      this.playerRig.root.position.set(v.x, v.y + 0.5, v.z);
      ch.district = v.y > 16 ? 'Vzdušný priestor Leonida' : getDistrictName(v.x, v.z);
      return;
    }

    // 3. WATER SPEEDBOAT PHYSICS (Open Sea around Entire 15x Island)
    if (v.kind === 'boat') {
      const forwardX = Math.sin(v.heading);
      const forwardZ = Math.cos(v.heading);
      const rightX = Math.cos(v.heading);
      const rightZ = -Math.sin(v.heading);

      let vForward = v.vx * forwardX + v.vz * forwardZ;
      let vLateral = v.vx * rightX + v.vz * rightZ;

      if (inp.throttle > 0.05) vForward += accel * inp.throttle * dt;
      if (inp.brake > 0.05) vForward -= accel * 0.85 * inp.brake * dt;
      vForward *= Math.exp(-0.9 * dt);
      vForward = THREE.MathUtils.clamp(vForward, -maxSpd * 0.35, maxSpd);

      const targetSteer = -inp.moveX * 0.52;
      v.steerAngle = THREE.MathUtils.damp(v.steerAngle, targetSteer, 8, dt);
      const speedFactor = Math.min(1, Math.abs(vForward) / 6);
      v.heading += v.steerAngle * 2.5 * speedFactor * (vForward >= -0.2 ? 1 : -1) * dt;
      vLateral *= Math.exp(-3.2 * dt);

      v.vx = Math.sin(v.heading) * vForward + Math.cos(v.heading) * vLateral;
      v.vz = Math.cos(v.heading) * vForward - Math.sin(v.heading) * vLateral;
      v.speed = vForward;

      let nx = v.x + v.vx * dt;
      let nz = v.z + v.vz * dt;

      if (isOutOfBoundsSeaAt(nx, nz)) {
        this.triggerDeepOceanDeath();
        return;
      }

      if (!isWaterAt(nx, nz)) {
        if (isWaterAt(nx, v.z)) {
          nz = v.z;
          v.vz *= -0.25;
        } else if (isWaterAt(v.x, nz)) {
          nx = v.x;
          v.vx *= -0.25;
        } else {
          nx = v.x;
          nz = v.z;
          v.vx *= -0.3;
          v.vz *= -0.3;
        }
      }
      const boatCol = this.resolveBuildingCollision(nx, nz, 2.2, 0.5, true, v);
      if (boatCol.collided) {
        nx = boatCol.x;
        nz = boatCol.z;
        if (boatCol.hitX) v.vx *= -0.3;
        if (boatCol.hitZ) v.vz *= -0.3;
      }

      const waveY = -0.35 + Math.sin(this.elapsedSec * 2.8 + v.x * 0.1) * 0.08;
      v.x = nx;
      v.y = waveY;
      v.z = nz;
      v.rig.root.position.set(v.x, v.y, v.z);
      v.rig.root.rotation.y = v.heading;
      v.rig.bodyGroup.rotation.x = THREE.MathUtils.damp(v.rig.bodyGroup.rotation.x, -inp.throttle * 0.11 + inp.brake * 0.05, 6, dt);
      v.rig.bodyGroup.rotation.z = THREE.MathUtils.damp(v.rig.bodyGroup.rotation.z, -v.steerAngle * speedFactor * 0.22, 6, dt);

      const isFp = this.cameraMode === 'first_person';
      this.playerRig.headGroup.visible = !isFp;
      this.playerRig.torsoGroup.visible = !isFp;
      this.playerRig.leftLegPivot.visible = false;
      this.playerRig.rightLegPivot.visible = false;
      this.playerRig.root.position.set(
        v.x - Math.sin(v.heading) * 0.55,
        v.y + 0.5,
        v.z - Math.cos(v.heading) * 0.55
      );
      this.playerRig.root.rotation.y = v.heading;
      ch.district = getDistrictName(v.x, v.z);
      return;
    }

    // 4. CARS & MOTORCYCLES GROUND / BRIDGE / OVERPASS / UNDERPASS / DRIFT ("ŠMYK") PHYSICS
    const forwardX = Math.sin(v.heading);
    const forwardZ = Math.cos(v.heading);
    const rightX = Math.cos(v.heading);
    const rightZ = -Math.sin(v.heading);

    let vForward = v.vx * forwardX + v.vz * forwardZ;
    let vLateral = v.vx * rightX + v.vz * rightZ;

    if (inp.throttle > 0.05) {
      vForward += accel * inp.throttle * dt;
    }
    if (inp.brake > 0.05) {
      if (vForward > 1.0) {
        vForward -= accel * 1.8 * inp.brake * dt;
      } else {
        vForward -= accel * 0.65 * inp.brake * dt;
      }
    }

    const handbrake = inp.handbrakeHeld;
    v.rig.brakeLightsMat.emissiveIntensity = inp.brake > 0.1 || handbrake ? 2.4 : 0.6;

    const drag = handbrake ? 2.05 : 0.52;
    vForward *= Math.exp(-drag * dt);
    vForward = THREE.MathUtils.clamp(vForward, -maxSpd * 0.4, maxSpd);

    const targetSteer = -inp.moveX * (v.kind === 'motorcycle' ? 0.64 : 0.58);
    v.steerAngle = THREE.MathUtils.damp(v.steerAngle, targetSteer, 12, dt);
    const speedFactor = Math.min(1, Math.abs(vForward) / 8);
    const steerDir = vForward >= -0.2 ? 1 : -1;
    const turnMult = v.kind === 'motorcycle' ? 3.8 : 3.2;
    const turnRate = v.steerAngle * turnMult * speedFactor * steerDir * (handbrake ? 1.46 : 1.0);
    v.heading += turnRate * dt;

    // Authentic Drift Physics
    const highSpeedCorner = Math.abs(vForward) > 16 && Math.abs(v.steerAngle) > 0.34;
    const lateralGrip =
      (handbrake
        ? 1.55
        : highSpeedCorner
          ? 4.4
          : v.kind === 'motorcycle'
            ? 11.2
            : 8.6) * gripBonus;
    vLateral *= Math.exp(-lateralGrip * dt);

    const newFwdX = Math.sin(v.heading);
    const newFwdZ = Math.cos(v.heading);
    const newRightX = Math.cos(v.heading);
    const newRightZ = -Math.sin(v.heading);

    v.vx = newFwdX * vForward + newRightX * vLateral;
    v.vz = newFwdZ * vForward + newRightZ * vLateral;
    v.speed = vForward;

    if (Math.abs(vForward) > 14) {
      this.addSkillXp('driving', dt * 1.3);
    }

    const grav = this.settings.gameplayMods.lowGravity ? -9.5 : -24.0;
    v.vy += grav * dt;

    let nx = v.x + v.vx * dt;
    let ny = v.y + v.vy * dt;
    let nz = v.z + v.vz * dt;

    if (isOutOfBoundsSeaAt(nx, nz)) {
      this.triggerDeepOceanDeath();
      return;
    }

    const col = this.resolveBuildingCollision(
      nx,
      nz,
      v.kind === 'motorcycle' ? 0.85 : 1.5,
      Math.max(0, ny),
      true,
      v
    );
    if (col.collided) {
      const impactSpeed = Math.hypot(v.vx, v.vz);
      if (impactSpeed > 6) {
        this.audio.playImpact(Math.min(1, impactSpeed / 30));
        this.input.triggerVibration(160, 0.4, Math.min(1, impactSpeed / 28));
      }
      if (impactSpeed > 10) {
        const armorMit = 1 - v.upgrades.armorLevel * 0.25;
        v.health -= impactSpeed * 0.85 * armorMit;
        deformVehicleRig(v.rig, (col.hitX ? (v.vx > 0 ? 0.8 : -0.8) : 0), (col.hitZ ? 1.5 : 0.8), Math.min(1.1, impactSpeed / 24));
        if (v.health <= 0 && !v.destroyed) {
          v.destroyed = true;
          this.triggerExplosion(v.x, v.z, 8.5);
          this.damagePlayer(95);
          this.scene.remove(v.rig.root);
          return;
        }
      }
      if (col.hitX) v.vx *= -0.35;
      if (col.hitZ) v.vz *= -0.35;
      nx = col.x;
      nz = col.z;
    }

    const waterUnder = isWaterAt(nx, nz);
    const groundH = waterUnder ? -0.45 : this.getGroundHeightAt(nx, nz, v.y);
    if (waterUnder && ny <= 0.05) {
      v.vx *= Math.exp(-4.5 * dt);
      v.vz *= Math.exp(-4.5 * dt);
      if (Math.random() < 0.25 && Math.abs(v.speed) > 2) {
        this.spawnParticleBurst(new THREE.Vector3(nx, -0.1, nz), 0x38bdf8, 2);
      }
    }

    if (ny <= groundH) {
      if (this.wasAirborneInCar) {
        const airDuration = this.elapsedSec - this.airStartTime;
        if (airDuration > 0.75 && Math.abs(v.speed) > 12) {
          this.stats.stuntJumps += 1;
          this.cash += 500;
          this.stuntMessage = `Kaskadérsky skok! +$500`;
          this.stuntTimer = 3.0;
          this.callbacks.onCashChange(this.cash);
          this.callbacks.onStatsChange({ ...this.stats });
          this.audio.playUiChime('mission');
        }
        this.wasAirborneInCar = false;
      }
      if (groundH > v.y + 0.01 && v.speed > 8) {
        v.vy = Math.max(v.vy, (groundH - v.y) / dt);
      } else {
        v.vy = 0;
      }
      ny = groundH;
    } else {
      if (!this.wasAirborneInCar && ny - groundH > 0.85) {
        this.wasAirborneInCar = true;
        this.airStartTime = this.elapsedSec;
      }
    }

    v.x = nx;
    v.y = ny;
    v.z = nz;
    v.rig.root.position.set(v.x, v.y, v.z);
    v.rig.root.rotation.y = v.heading;

    const slipSpeed = Math.abs(vLateral);
    const onGround = !waterUnder && ny <= groundH + 0.12;
    const driftingNow =
      onGround &&
      Math.abs(vForward) > 6.5 &&
      ((handbrake && Math.abs(v.steerAngle) > 0.14) || slipSpeed > 3.6);
    v.isDrifting = driftingNow;
    v.driftIntensity = driftingNow ? Math.min(1, 0.35 + slipSpeed * 0.11 + (handbrake ? 0.25 : 0)) : 0;
    this.currentDriftIntensity = v.driftIntensity;

    if (driftingNow) {
      this.skidEmitTimer -= dt;
      if (this.skidEmitTimer <= 0) {
        this.skidEmitTimer = 0.045;
        this.emitDriftEffects(v, ny, newFwdX, newFwdZ, newRightX, newRightZ);
      }
    }

    const targetRoll =
      v.kind === 'motorcycle'
        ? -v.steerAngle * speedFactor * 0.48
        : -v.steerAngle * speedFactor * (driftingNow ? 0.18 : 0.14);
    const targetPitch = (inp.brake - inp.throttle) * (v.kind === 'motorcycle' ? 0.07 : 0.045);
    v.rig.bodyGroup.rotation.z = THREE.MathUtils.damp(v.rig.bodyGroup.rotation.z, targetRoll, 9, dt);
    v.rig.bodyGroup.rotation.x = THREE.MathUtils.damp(v.rig.bodyGroup.rotation.x, targetPitch, 8, dt);

    const wheelRadius = v.kind === 'suv' || v.kind === 'firetruck' || v.kind === 'ambulance' ? 0.42 : 0.34;
    v.wheelSpin += (vForward / wheelRadius) * dt;
    v.rig.wheels.forEach((w) => {
      w.rotation.x = v.wheelSpin;
    });
    v.rig.frontSteerPivots.forEach((p) => {
      p.rotation.y = v.steerAngle * 0.85;
    });

    this.updateVehicleBeacon(v);

    if (v.kind === 'motorcycle') {
      const isFp = this.cameraMode === 'first_person';
      this.playerRig.headGroup.visible = !isFp;
      this.playerRig.torsoGroup.visible = !isFp;
      this.playerRig.leftLegPivot.visible = !isFp;
      this.playerRig.rightLegPivot.visible = !isFp;
      this.playerRig.root.position.set(v.x, v.y + 0.25, v.z);
      this.playerRig.root.rotation.y = v.heading;
      this.playerRig.root.rotation.z = v.rig.bodyGroup.rotation.z;
      this.playerRig.leftArmPivot.rotation.x = -0.75;
      this.playerRig.rightArmPivot.rotation.x = -0.75;
      this.playerRig.leftLegPivot.rotation.x = -0.55;
      this.playerRig.rightLegPivot.rotation.x = -0.55;
    } else {
      this.playerRig.root.position.set(v.x, v.y, v.z);
    }
    ch.district = getDistrictName(v.x, v.z);
  }

  private emitDriftEffects(
    v: VehicleEntity,
    groundY: number,
    fwdX: number,
    fwdZ: number,
    rightX: number,
    rightZ: number
  ) {
    const offsets = v.kind === 'motorcycle' ? [0] : [-0.88, 0.88];
    const rearOffset = -1.32;
    const travelYaw = Math.atan2(v.vx, v.vz);
    for (const lat of offsets) {
      const sx = v.x + fwdX * rearOffset + rightX * lat;
      const sz = v.z + fwdZ * rearOffset + rightZ * lat;
      const skid = this.skidPool[this.skidCursor];
      this.skidCursor = (this.skidCursor + 1) % this.skidPool.length;
      skid.position.set(sx, groundY + 0.045, sz);
      skid.rotation.set(0, travelYaw, 0);
      skid.visible = true;
      if (Math.random() < 0.45) {
        this.spawnParticleBurst(new THREE.Vector3(sx, groundY + 0.16, sz), 0xdbeafe, 1);
      }
    }
  }

  private triggerDeepOceanDeath() {
    if (this.wastedTimer > 0) return;
    this.wastedTimer = 3.2;
    this.wastedReason = 'Stratil si sa v hlbinách otvoreného oceánu';
    this.exitCurrentVehicle();
    this.clearPolicePursuit();
    this.audio.playImpact(1.0);
  }

  private updateVehicleBeacon(v: VehicleEntity) {
    if (!v.rig.redBeacon || !v.rig.blueBeacon) return;
    const isEmergency = v.kind === 'police' || v.kind === 'ambulance' || v.kind === 'firetruck';
    if (!isEmergency) return;
    const active = v.occupiedByPlayer || (v.isPolice && this.wantedStars > 0) || (v.isTraffic && (v.kind === 'ambulance' || v.kind === 'firetruck'));
    const flash = Math.floor(this.elapsedSec * 10) % 2 === 0;
    (v.rig.redBeacon.material as THREE.MeshStandardMaterial).emissiveIntensity = active && flash ? 3.5 : 0.2;
    (v.rig.blueBeacon.material as THREE.MeshStandardMaterial).emissiveIntensity = active && !flash ? 3.5 : 0.2;
  }

  private alertNearbyCrowd(originX: number, originZ: number, radius: number, fromGunshot: boolean) {
    for (const npc of this.npcs) {
      if (!npc.alive || npc.kind !== 'civilian') continue;
      const d = Math.hypot(npc.x - originX, npc.z - originZ);
      if (d < radius) {
        npc.behavior = 'flee';
        npc.panicTimer = fromGunshot ? 12 : 8;
      }
    }
    if (fromGunshot) {
      for (const v of this.vehicles) {
        if (!v.isTraffic || v.destroyed || v.occupiedByPlayer || !v.hasDriver) continue;
        if (Math.hypot(v.x - originX, v.z - originZ) < radius * 1.2) {
          v.stoppedByPlayer = true;
          v.stopHoldTimer = 4.5;
        }
      }
    }
  }

  private stepOtherVehicles(dt: number, inp: ReturnType<InputManager['poll']>) {
    const px = this.playerRig.root.position.x;
    const pz = this.playerRig.root.position.z;
    const lookFwdX = Math.sin(this.camYaw);
    const lookFwdZ = Math.cos(this.camYaw);

    const trafficCap =
      this.settings.graphics.trafficDensity === 'low'
        ? 8
        : this.settings.graphics.trafficDensity === 'medium'
          ? 14
          : 22;
    let activeTrafficCount = 0;

    for (const v of this.vehicles) {
      if (v.occupiedByPlayer || v.destroyed) continue;
      const dvx = v.x - px;
      const dvz = v.z - pz;
      const distSq = dvx * dvx + dvz * dvz;
      const isAirVeh = v.kind === 'plane' || v.kind === 'helicopter' || v.kind === 'fighter_jet';

      if (v.isPolice && this.wantedStars > 0 && !this.settings.gameplayMods.noPolice) {
        v.rig.root.visible = distSq <= 160000;
        this.updateVehicleBeacon(v);
        const dx = px - v.x;
        const dz = pz - v.z;
        const dist = Math.hypot(dx, dz);

        const desiredHeading = Math.atan2(dx, dz);
        let diff = desiredHeading - v.heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        v.steerAngle = THREE.MathUtils.clamp(diff, -0.45, 0.45);
        v.heading += THREE.MathUtils.clamp(diff, -2.3 * dt, 2.3 * dt);

        const targetSpd = dist > 11 ? 24 + this.wantedStars * 2.4 : 0;
        v.speed = THREE.MathUtils.damp(v.speed, targetSpd, 4, dt);
        const pFwdX = Math.sin(v.heading);
        const pFwdZ = Math.cos(v.heading);
        v.vx = pFwdX * v.speed;
        v.vz = pFwdZ * v.speed;

        const nx = v.x + v.vx * dt;
        const nz = v.z + v.vz * dt;
        const probeX = nx + pFwdX * 1.8;
        const probeZ = nz + pFwdZ * 1.8;
        const hitsWater =
          (isWaterAt(nx, nz) && !isBridgeAt(nx, nz)) ||
          (isWaterAt(probeX, probeZ) && !isBridgeAt(probeX, probeZ));

        if (!hitsWater) {
          const col = this.resolveBuildingCollision(nx, nz, 1.5, Math.max(0, v.y), true, v);
          v.x = col.x;
          v.z = col.z;
        } else {
          // Turn along shoreline/bridge instead of plunging into canal or harbor
          v.speed *= 0.45;
          v.heading += 1.45 * dt;
        }
        v.y = this.getGroundHeightAt(v.x, v.z, v.y);
        v.rig.root.position.set(v.x, v.y, v.z);
        v.rig.root.rotation.y = v.heading;
        if (distSq <= 19600) {
          v.wheelSpin += (v.speed / 0.36) * dt;
          v.rig.wheels.forEach((w) => (w.rotation.x = v.wheelSpin));
          v.rig.frontSteerPivots.forEach((p) => (p.rotation.y = v.steerAngle * 0.8));
        }
      } else if (v.isTraffic) {
        const withinCull = distSq <= 115600;
        if (!withinCull) {
          v.rig.root.visible = false;
          continue;
        }
        activeTrafficCount += 1;
        v.rig.root.visible = activeTrafficCount <= trafficCap;
        if (!v.rig.root.visible) continue;
        this.updateVehicleBeacon(v);

        if (v.kind === 'boat') {
          // Autonomous Boats Orbiting Around the 15x Island Coastline
          v.speed = THREE.MathUtils.damp(v.speed, 13.5, 2.5, dt);
          const orbitAng = Math.atan2(v.z, v.x) + 0.018 * dt;
          const targetR = 1690;
          const tx = Math.cos(orbitAng) * targetR;
          const tz = Math.sin(orbitAng) * targetR;
          v.heading = Math.atan2(tx - v.x, tz - v.z);
          v.x += Math.sin(v.heading) * v.speed * dt;
          v.z += Math.cos(v.heading) * v.speed * dt;
          v.y = -0.35 + Math.sin(this.elapsedSec * 2.5 + v.x * 0.1) * 0.08;
          v.rig.root.position.set(v.x, v.y, v.z);
          v.rig.root.rotation.y = v.heading;
          continue;
        }

        // Autonomous Curved-Path City & Highway Traffic (strictly on paved roads & bridges)
        if (v.stopHoldTimer > 0) {
          v.stopHoldTimer -= dt;
          if (v.stopHoldTimer <= 0) v.stoppedByPlayer = false;
        }

        const fwdX = Math.sin(v.heading);
        const fwdZ = Math.cos(v.heading);

        // Aiming weapon at traffic stops car so player can carjack driver!
        let shouldBrake = v.stoppedByPlayer;
        const toVehX = v.x - px;
        const toVehZ = v.z - pz;
        const distToPlayer = Math.hypot(toVehX, toVehZ);
        if (!this.currentVehicle && inp.aimHeld && distToPlayer < 24 && distToPlayer > 0.5) {
          const aimDot = (toVehX / distToPlayer) * lookFwdX + (toVehZ / distToPlayer) * lookFwdZ;
          if (aimDot > 0.86) {
            v.stoppedByPlayer = true;
            v.stopHoldTimer = 5.0;
            shouldBrake = true;
          }
        }

        if (!shouldBrake && distToPlayer < 11.5 && distToPlayer > 0.4) {
          const aheadDot = (toVehX / distToPlayer) * -fwdX + (toVehZ / distToPlayer) * -fwdZ;
          if (aheadDot > 0.62) {
            shouldBrake = true;
          }
        }

        if (!shouldBrake) {
          for (const other of this.vehicles) {
            if (
              other === v ||
              other.destroyed ||
              other.kind === 'boat' ||
              other.kind === 'plane' ||
              other.kind === 'helicopter' ||
              other.kind === 'fighter_jet'
            ) {
              continue;
            }
            const ox = other.x - v.x;
            const oz = other.z - v.z;
            const od = Math.hypot(ox, oz);
            if (od < 10.5 && od > 0.1) {
              const odot = (ox / od) * fwdX + (oz / od) * fwdZ;
              if (odot > 0.72) {
                shouldBrake = true;
                break;
              }
            }
          }
        }

        const path = TRAFFIC_LOOP_PATHS[v.pathIndex % TRAFFIC_LOOP_PATHS.length];
        const wp = path[v.waypointIndex % path.length];
        const nxtWp = path[(v.waypointIndex + 1) % path.length];
        let segX = nxtWp.x - wp.x;
        let segZ = nxtWp.z - wp.z;
        const segLen = Math.hypot(segX, segZ) || 1;
        segX /= segLen;
        segZ /= segLen;
        // Right-hand driving lane offset (+3.1m), falling back to centerline if near bridge edge
        let targetX = wp.x + -segZ * 3.1;
        let targetZ = wp.z + segX * 3.1;
        if (isWaterAt(targetX, targetZ) && !isBridgeAt(targetX, targetZ)) {
          targetX = wp.x;
          targetZ = wp.z;
        }

        if (Math.hypot(targetX - v.x, targetZ - v.z) < 8.5) {
          v.waypointIndex = (v.waypointIndex + 1) % path.length;
        }

        const desiredHeading = Math.atan2(targetX - v.x, targetZ - v.z);
        let hDiff = desiredHeading - v.heading;
        while (hDiff > Math.PI) hDiff -= Math.PI * 2;
        while (hDiff < -Math.PI) hDiff += Math.PI * 2;
        v.steerAngle = THREE.MathUtils.damp(v.steerAngle, THREE.MathUtils.clamp(hDiff * 1.4, -0.5, 0.5), 8, dt);
        v.heading += THREE.MathUtils.clamp(hDiff, -2.8 * dt, 2.8 * dt);

        const isHighwayLoop = v.pathIndex < 2;
        const cruiseSpd = isHighwayLoop
          ? v.kind === 'supercar'
            ? 18.5
            : 15.0
          : v.kind === 'motorcycle'
            ? 12.6
            : 10.5;
        const targetSpd = shouldBrake ? 0 : cruiseSpd;
        v.speed = THREE.MathUtils.damp(v.speed, targetSpd, shouldBrake ? 8.5 : 3.4, dt);
        v.rig.brakeLightsMat.emissiveIntensity = shouldBrake || v.speed < 1.5 ? 2.4 : 0.45;

        const nx = v.x + Math.sin(v.heading) * v.speed * dt;
        const nz = v.z + Math.cos(v.heading) * v.speed * dt;
        const probeX = nx + Math.sin(v.heading) * 1.8;
        const probeZ = nz + Math.cos(v.heading) * 1.8;
        const entersWater =
          (isWaterAt(nx, nz) && !isBridgeAt(nx, nz)) ||
          (isWaterAt(probeX, probeZ) && !isBridgeAt(probeX, probeZ));

        if (entersWater) {
          // Hard guard: never drive NPC cars into canal, harbor, or sea; snap smoothly back toward paved waypoint
          v.speed = Math.min(v.speed, 3.0);
          v.heading = desiredHeading;
          const pullX = wp.x - v.x;
          const pullZ = wp.z - v.z;
          const pullLen = Math.hypot(pullX, pullZ) || 1;
          const safeX = v.x + (pullX / pullLen) * 2.5 * dt;
          const safeZ = v.z + (pullZ / pullLen) * 2.5 * dt;
          if (!isWaterAt(safeX, safeZ) || isBridgeAt(safeX, safeZ)) {
            v.x = safeX;
            v.z = safeZ;
          }
        } else {
          const col = this.resolveBuildingCollision(nx, nz, v.kind === 'motorcycle' ? 0.85 : 1.4, Math.max(0, v.y), true, v);
          if (!isWaterAt(col.x, col.z) || isBridgeAt(col.x, col.z)) {
            v.x = col.x;
            v.z = col.z;
          }
        }

        v.vx = Math.sin(v.heading) * v.speed;
        v.vz = Math.cos(v.heading) * v.speed;
        v.y = this.getGroundHeightAt(v.x, v.z, v.y);
        v.rig.root.position.set(v.x, v.y, v.z);
        v.rig.root.rotation.y = v.heading;
        if (distSq <= 19600) {
          v.wheelSpin += (v.speed / 0.36) * dt;
          v.rig.wheels.forEach((w) => (w.rotation.x = v.wheelSpin));
          v.rig.frontSteerPivots.forEach((p) => (p.rotation.y = v.steerAngle * 0.8));
        }
      } else {
        // Distant parked ground/boat/air visibility cull (aircraft visible up to 680m, ground cars/boats up to 340m)
        const maxCullSq = isAirVeh ? 462400 : 115600;
        v.rig.root.visible = distSq <= maxCullSq;
        if (!v.rig.root.visible) continue;
      }

      // Vehicle-to-Player-Car elastic bump + real-time deformation
      if (this.currentVehicle && Math.abs(this.currentVehicle.y - v.y) < 3.0) {
        const dx = this.currentVehicle.x - v.x;
        const dz = this.currentVehicle.z - v.z;
        const d = Math.hypot(dx, dz);
        const minSep = v.kind === 'motorcycle' || this.currentVehicle.kind === 'motorcycle' ? 2.3 : 3.2;
        if (d < minSep && d > 0.01) {
          const push = (minSep - d) * 0.5;
          const nx = dx / d;
          const nz = dz / d;
          this.currentVehicle.x += nx * push;
          this.currentVehicle.z += nz * push;
          v.x -= nx * push;
          v.z -= nz * push;
          const relSpeed = Math.hypot(this.currentVehicle.vx - v.vx, this.currentVehicle.vz - v.vz);
          if (relSpeed > 7) {
            this.audio.playImpact(0.6);
            this.input.triggerVibration(140, 0.5, 0.7);
            v.stoppedByPlayer = true;
            v.stopHoldTimer = 5.0;
            const armorMit = 1 - this.currentVehicle.upgrades.armorLevel * 0.25;
            this.currentVehicle.health -= relSpeed * 0.7 * armorMit;
            v.health -= relSpeed * 0.9;
            deformVehicleRig(this.currentVehicle.rig, 0, 1.35, Math.min(1.0, relSpeed / 22));
            deformVehicleRig(v.rig, 0, -1.2, Math.min(1.0, relSpeed / 22));
            if (v.isPolice && !this.settings.gameplayMods.noPolice) {
              this.addCrimeHeat(22);
            }
          }
          this.currentVehicle.vx *= 0.65;
          this.currentVehicle.vz *= 0.65;
        }
      }
    }
  }

  private stepNpcs(dt: number) {
    const px = this.playerRig.root.position.x;
    const pz = this.playerRig.root.position.z;
    const lookFwdX = Math.sin(this.camYaw);
    const lookFwdZ = Math.cos(this.camYaw);

    for (const npc of this.npcs) {
      if (!npc.alive) continue;
      if (npc.tackleCooldown > 0) npc.tackleCooldown -= dt;

      const dx = px - npc.x;
      const dz = pz - npc.z;
      const distSq = dx * dx + dz * dz;
      if (npc.kind === 'civilian') {
        if (distSq > 30625) {
          npc.rig.root.visible = false;
          continue;
        }
        npc.rig.root.visible = true;
      } else {
        npc.rig.root.visible = distSq <= 48400;
      }
      const dist = Math.sqrt(distSq);
      const animateLimbs = distSq <= 16900;

      // Run over by player vehicle!
      if (this.currentVehicle && Math.abs(this.currentVehicle.speed) > 7 && dist < 2.2) {
        this.damageNpc(npc, 120);
        this.audio.playImpact(0.5);
        this.alertNearbyCrowd(npc.x, npc.z, 18, false);
        continue;
      }

      // Sprint tackle / Chase takedown on foot!
      if (!this.currentVehicle && this.isPlayerSprinting && dist < 1.15 && npc.tackleCooldown <= 0) {
        npc.tackleCooldown = 0.7;
        this.audio.playImpact(0.55);
        this.input.triggerVibration(120, 0.45, 0.4);
        this.damageNpc(npc, 65, true);
        this.alertNearbyCrowd(npc.x, npc.z, 15, false);
        if (!npc.alive) continue;
      }

      if (npc.kind === 'civilian') {
        if (npc.panicTimer > 0) {
          npc.panicTimer -= dt;
          if (npc.panicTimer <= 0 && (npc.behavior === 'flee' || npc.behavior === 'seek_shelter' || npc.behavior === 'cheer')) {
            npc.behavior = 'wander';
          }
        }

        // Trigger chase/flee panic if player sprints close or aims weapon at them!
        if (npc.behavior === 'wander') {
          if (this.isPlayerSprinting && dist < 7.5) {
            npc.behavior = 'flee';
            npc.panicTimer = 9.0;
          } else if (this.input.isPointerLocked && dist < 16 && dist > 0.5) {
            const aimDot = (-dx / dist) * lookFwdX + (-dz / dist) * lookFwdZ;
            if (aimDot > 0.9 && this.muzzleFlashTimer > 0) {
              npc.behavior = 'flee';
              npc.panicTimer = 11.0;
            }
          } else if (this.wantedStars > 0 && dist < 22) {
            npc.behavior = 'flee';
            npc.panicTimer = 8.0;
          }
        }

        if (npc.behavior === 'fight' && dist < 38) {
          // Armed or feisty NPC fights or shoots back!
          npc.heading = Math.atan2(dx, dz);
          if (npc.hasWeapon) {
            if (npc.weaponMesh) npc.weaponMesh.visible = true;
            if (dist > 14) {
              const spd = 5.0;
              const nx = npc.x + (dx / dist) * spd * dt;
              const nz = npc.z + (dz / dist) * spd * dt;
              const col = this.resolveBuildingCollision(nx, nz, 0.42, 0, false);
              npc.x = col.x;
              npc.z = col.z;
              if (animateLimbs) {
                const swing = Math.sin(this.elapsedSec * 9) * 0.55;
                npc.rig.leftLegPivot.rotation.x = swing;
                npc.rig.rightLegPivot.rotation.x = -swing;
              }
            } else if (animateLimbs) {
              npc.rig.leftLegPivot.rotation.x = 0;
              npc.rig.rightLegPivot.rotation.x = 0;
            }
            npc.rig.rightArmPivot.rotation.x = -Math.PI / 2.2;
            npc.shootCooldown -= dt;
            if (npc.shootCooldown <= 0 && dist < 32) {
              npc.shootCooldown = npc.weaponId === 'smg' ? 0.55 : 1.05;
              this.enemyFireAtPlayer(npc, dist);
            }
          } else {
            const spd = 5.4;
            if (dist > 1.4) {
              const nx = npc.x + (dx / dist) * spd * dt;
              const nz = npc.z + (dz / dist) * spd * dt;
              const col = this.resolveBuildingCollision(nx, nz, 0.42, 0, false);
              npc.x = col.x;
              npc.z = col.z;
            } else {
              npc.shootCooldown -= dt;
              if (npc.shootCooldown <= 0) {
                npc.shootCooldown = 1.05;
                this.damagePlayer(5);
                this.audio.playImpact(0.35);
              }
            }
            if (animateLimbs) {
              const swing = Math.sin(this.elapsedSec * 11) * 0.6;
              npc.rig.leftLegPivot.rotation.x = swing;
              npc.rig.rightLegPivot.rotation.x = -swing;
              npc.rig.rightArmPivot.rotation.x = -Math.PI / 2.6 + swing;
            }
          }
        } else if (npc.behavior === 'flee') {
          // Sprint away from player along open ground (7.4 m/s vs player 10.2 m/s sprint so player can chase & catch!)
          const awayAngle = Math.atan2(-dx, -dz);
          const spd = 7.4;
          let nx = npc.x + Math.sin(awayAngle) * spd * dt;
          let nz = npc.z + Math.cos(awayAngle) * spd * dt;
          if (isWaterAt(nx, nz)) {
            const tangentAngle = awayAngle + Math.PI / 2;
            nx = npc.x + Math.sin(tangentAngle) * spd * dt;
            nz = npc.z + Math.cos(tangentAngle) * spd * dt;
          }
          const col = this.resolveBuildingCollision(nx, nz, 0.42, 0, false);
          npc.x = col.x;
          npc.z = col.z;
          npc.heading = awayAngle;
          if (animateLimbs) {
            const swing = Math.sin(this.elapsedSec * 14) * 0.7;
            npc.rig.leftLegPivot.rotation.x = swing;
            npc.rig.rightLegPivot.rotation.x = -swing;
            npc.rig.leftArmPivot.rotation.x = -swing * 0.85;
            npc.rig.rightArmPivot.rotation.x = swing * 0.85;
          }
        } else if (npc.behavior === 'seek_shelter') {
          let shop = SHOPS[0];
          let bestShopD = Infinity;
          for (const s of SHOPS) {
            const sd = (s.doorX - npc.x) * (s.doorX - npc.x) + (s.doorZ - npc.z) * (s.doorZ - npc.z);
            if (sd < bestShopD) {
              bestShopD = sd;
              shop = s;
            }
          }
          const toShopAngle = Math.atan2(shop.doorX - npc.x, shop.doorZ - npc.z);
          const spd = 4.6;
          const col = this.resolveBuildingCollision(
            npc.x + Math.sin(toShopAngle) * spd * dt,
            npc.z + Math.cos(toShopAngle) * spd * dt,
            0.38,
            0,
            false
          );
          npc.x = col.x;
          npc.z = col.z;
          npc.heading = toShopAngle;
          if (animateLimbs) {
            const swing = Math.sin(this.elapsedSec * 10) * 0.55;
            npc.rig.leftLegPivot.rotation.x = swing;
            npc.rig.rightLegPivot.rotation.x = -swing;
            npc.rig.leftArmPivot.rotation.x = -1.9;
            npc.rig.rightArmPivot.rotation.x = -1.9;
          }
        } else if (npc.behavior === 'cheer') {
          npc.heading = Math.atan2(dx, dz);
          if (animateLimbs) {
            npc.rig.leftLegPivot.rotation.x = 0;
            npc.rig.rightLegPivot.rotation.x = 0;
            const w = Math.sin(this.elapsedSec * 8 + npc.x) * 0.45;
            npc.rig.leftArmPivot.rotation.x = -2.4 + w;
            npc.rig.rightArmPivot.rotation.x = -2.4 - w;
          }
        } else if (npc.activity === 'chat' && npc.chatTargetX !== undefined && npc.chatTargetZ !== undefined) {
          // Conversing pedestrians stand facing partner with subtle lifelike gestures
          npc.heading = Math.atan2(npc.chatTargetX - npc.x, npc.chatTargetZ - npc.z);
          if (animateLimbs) {
            npc.rig.leftLegPivot.rotation.x = 0;
            npc.rig.rightLegPivot.rotation.x = 0;
            const phase = (npc.id.charCodeAt(4) || 1) * 0.7;
            const gesture = Math.sin(this.elapsedSec * 2.6 + phase) * 0.22;
            npc.rig.leftArmPivot.rotation.x = -0.25 + gesture;
            npc.rig.rightArmPivot.rotation.x = -0.35 - gesture;
          }
        } else if (npc.activity === 'chill') {
          // Relaxed coastal/plaza idle stance
          if (animateLimbs) {
            npc.rig.leftLegPivot.rotation.x = 0;
            npc.rig.rightLegPivot.rotation.x = 0;
            npc.rig.leftArmPivot.rotation.x = Math.sin(this.elapsedSec * 1.3 + npc.x) * 0.06;
            npc.rig.rightArmPivot.rotation.x = -Math.sin(this.elapsedSec * 1.3 + npc.z) * 0.06;
          }
        } else {
          npc.wanderTimer -= dt;
          if (npc.wanderTimer <= 0) {
            npc.wanderAngle += (Math.random() - 0.5) * 2.4;
            npc.wanderTimer = 2.5 + Math.random() * 3.5;
          }
          const spd = 1.8;
          const nx = npc.x + Math.sin(npc.wanderAngle) * spd * dt;
          const nz = npc.z + Math.cos(npc.wanderAngle) * spd * dt;
          if (isWaterAt(nx, nz)) {
            npc.wanderAngle += Math.PI * 0.75;
          } else {
            const col = this.resolveBuildingCollision(nx, nz, 0.42, 0, false);
            npc.x = col.x;
            npc.z = col.z;
            if (col.collided) npc.wanderAngle += Math.PI * 0.65;
          }
          npc.heading = npc.wanderAngle;
          if (animateLimbs) {
            const swing = Math.sin(this.elapsedSec * 4.5) * 0.42;
            npc.rig.leftLegPivot.rotation.x = swing;
            npc.rig.rightLegPivot.rotation.x = -swing;
            npc.rig.leftArmPivot.rotation.x = -swing * 0.5;
            npc.rig.rightArmPivot.rotation.x = swing * 0.5;
          }
        }
      } else if (npc.kind === 'bouncer') {
        // Malibu Neon Lounge Club Security AI
        if (npc.behavior === 'fight') {
          if (npc.weaponMesh) npc.weaponMesh.visible = true;
          npc.rig.rightArmPivot.rotation.x = -Math.PI / 2.2;
          if (dist < 68) {
            // Route out through the West doorway (701, -340) if bouncer is inside and player stepped outside
            const insideClub = npc.x > 702.5 && Math.abs(npc.z - MALIBU_CLUB.z) < 14.5;
            const playerOutside = px < 701.5;
            const tx = insideClub && playerOutside ? MALIBU_CLUB.doorX - 0.8 : px;
            const tz = insideClub && playerOutside ? MALIBU_CLUB.doorZ : pz;
            const toX = tx - npc.x;
            const toZ = tz - npc.z;
            const moveDist = Math.hypot(toX, toZ) || 0.001;
            npc.heading = Math.atan2(dx, dz);

            if (dist > 10.5 || (insideClub && playerOutside)) {
              const spd = 5.4;
              const nx = npc.x + (toX / moveDist) * spd * dt;
              const nz = npc.z + (toZ / moveDist) * spd * dt;
              const col = this.resolveBuildingCollision(nx, nz, 0.4, 0, false);
              npc.x = col.x;
              npc.z = col.z;
              const swing = Math.sin(this.elapsedSec * 10) * 0.6;
              npc.rig.leftLegPivot.rotation.x = swing;
              npc.rig.rightLegPivot.rotation.x = -swing;
            } else {
              npc.rig.leftLegPivot.rotation.x = 0;
              npc.rig.rightLegPivot.rotation.x = 0;
            }

            npc.shootCooldown -= dt;
            if (npc.shootCooldown <= 0 && dist < 44) {
              npc.shootCooldown = npc.weaponId === 'smg' ? 0.65 : 0.95;
              this.enemyFireAtPlayer(npc, dist);
            }
          } else if (this.wantedStars === 0) {
            npc.behavior = 'wander';
            if (npc.weaponMesh) npc.weaponMesh.visible = false;
            npc.rig.rightArmPivot.rotation.x = 0;
          }
        } else {
          // Peaceful club guard duty: stay or walk back to guard post
          if (npc.weaponMesh) npc.weaponMesh.visible = false;
          npc.rig.rightArmPivot.rotation.x = 0;
          const hx = npc.guardHomeX ?? MALIBU_CLUB.doorX - 1.5;
          const hz = npc.guardHomeZ ?? MALIBU_CLUB.doorZ;
          const hdx = hx - npc.x;
          const hdz = hz - npc.z;
          const hDist = Math.hypot(hdx, hdz);
          if (hDist > 0.8) {
            const spd = 2.6;
            const col = this.resolveBuildingCollision(
              npc.x + (hdx / hDist) * spd * dt,
              npc.z + (hdz / hDist) * spd * dt,
              0.4,
              0,
              false
            );
            npc.x = col.x;
            npc.z = col.z;
            npc.heading = Math.atan2(hdx, hdz);
            const swing = Math.sin(this.elapsedSec * 5) * 0.42;
            npc.rig.leftLegPivot.rotation.x = swing;
            npc.rig.rightLegPivot.rotation.x = -swing;
          } else {
            npc.heading = npc.guardHeading ?? -Math.PI / 2;
            npc.rig.leftLegPivot.rotation.x = 0;
            npc.rig.rightLegPivot.rotation.x = 0;
          }
        }
      } else {
        // Police or Syndicate Enemy AI
        const aggroRange = npc.kind === 'police' ? 58 : 42;
        if (dist < aggroRange) {
          npc.heading = Math.atan2(dx, dz);
          if (dist > 13) {
            const spd = npc.kind === 'police' ? 5.2 : 4.4;
            const nx = npc.x + (dx / dist) * spd * dt;
            const nz = npc.z + (dz / dist) * spd * dt;
            const col = this.resolveBuildingCollision(nx, nz, 0.42, 0, false);
            npc.x = col.x;
            npc.z = col.z;
            if (animateLimbs) {
              const swing = Math.sin(this.elapsedSec * 9) * 0.55;
              npc.rig.leftLegPivot.rotation.x = swing;
              npc.rig.rightLegPivot.rotation.x = -swing;
            }
          } else if (animateLimbs) {
            npc.rig.leftLegPivot.rotation.x = 0;
            npc.rig.rightLegPivot.rotation.x = 0;
          }

          npc.shootCooldown -= dt;
          if (npc.shootCooldown <= 0 && dist < 34) {
            npc.shootCooldown = npc.kind === 'police' ? 1.15 : 0.95;
            this.enemyFireAtPlayer(npc, dist);
          }
        }
      }

      npc.rig.root.position.set(npc.x, 0, npc.z);
      npc.rig.root.rotation.y = npc.heading;
    }
  }

  private raycastWorldObstacles(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): number {
    const endX = origin.x + dir.x * maxDist;
    const endZ = origin.z + dir.z * maxDist;
    const minX = Math.min(origin.x, endX) - 2;
    const maxX = Math.max(origin.x, endX) + 2;
    const minZ = Math.min(origin.z, endZ) - 2;
    const maxZ = Math.max(origin.z, endZ) + 2;
    const { aabbs, circles } = this.queryNearbyColliders(minX, maxX, minZ, maxZ);

    let closest = maxDist;
    // Check ground plane y <= 0
    if (dir.y < -1e-4 && origin.y > 0.05) {
      const tg = -origin.y / dir.y;
      if (tg > 0.2 && tg < closest) closest = tg;
    }

    // Check building walls, interior counters & racks
    for (const c of aabbs) {
      const cMinY = c.minY ?? 0;
      const cMaxY = c.height;
      let tmin = 0;
      let tmax = closest;

      if (Math.abs(dir.x) < 1e-6) {
        if (origin.x < c.minX || origin.x > c.maxX) continue;
      } else {
        const invX = 1 / dir.x;
        let t1 = (c.minX - origin.x) * invX;
        let t2 = (c.maxX - origin.x) * invX;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }

      if (Math.abs(dir.z) < 1e-6) {
        if (origin.z < c.minZ || origin.z > c.maxZ) continue;
      } else {
        const invZ = 1 / dir.z;
        let t1 = (c.minZ - origin.z) * invZ;
        let t2 = (c.maxZ - origin.z) * invZ;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }

      if (Math.abs(dir.y) < 1e-6) {
        if (origin.y < cMinY || origin.y > cMaxY) continue;
      } else {
        const invY = 1 / dir.y;
        let t1 = (cMinY - origin.y) * invY;
        let t2 = (cMaxY - origin.y) * invY;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }

      if (tmin > 0.15 && tmin < closest) {
        closest = tmin;
      }
    }

    // Check cylinder pillars & tree trunks
    const dirXZSq = dir.x * dir.x + dir.z * dir.z;
    if (dirXZSq > 1e-5) {
      for (const cc of circles) {
        const ox = origin.x - cc.x;
        const oz = origin.z - cc.z;
        const b = ox * dir.x + oz * dir.z;
        const c = ox * ox + oz * oz - cc.radius * cc.radius;
        const disc = b * b - dirXZSq * c;
        if (disc < 0) continue;
        const t = (-b - Math.sqrt(disc)) / dirXZSq;
        if (t > 0.15 && t < closest) {
          const hitY = origin.y + dir.y * t;
          if (hitY >= 0 && hitY <= cc.height) {
            closest = t;
          }
        }
      }
    }

    return closest;
  }

  private enemyFireAtPlayer(npc: NpcEntity, dist: number) {
    this.audio.playGunshot(npc.weaponId || 'pistol');
    const origin = _rayOrigin.set(npc.x, 1.45, npc.z);
    const target = _v2.set(
      this.playerRig.root.position.x + (Math.random() - 0.5) * 1.4,
      1.2,
      this.playerRig.root.position.z + (Math.random() - 0.5) * 1.4
    );
    _rayDir.copy(target).sub(origin);
    const segLen = _rayDir.length();
    if (segLen < 0.1) return;
    _rayDir.divideScalar(segLen);

    const wallDist = this.raycastWorldObstacles(origin, _rayDir, segLen);
    if (wallDist < segLen - 0.4) {
      const wallHit = _v4.copy(origin).addScaledVector(_rayDir, wallDist);
      this.spawnTracer(origin, wallHit, 0xef4444);
      this.spawnParticleBurst(wallHit, 0xe2e8f0, 2);
      return;
    }

    this.spawnTracer(origin, target, 0xef4444);
    const hitChance = Math.max(0.15, 0.55 - dist * 0.012);
    if (Math.random() < hitChance) {
      this.damagePlayer(npc.kind === 'police' ? 8 : npc.kind === 'bouncer' ? 9 : npc.kind === 'civilian' ? 7 : 10);
    }
  }

  private damagePlayer(amount: number) {
    if (this.wastedTimer > 0 || this.bustedTimer > 0 || this.godModeActive) return;
    const ch = this.characters[this.activeCharId];
    if (this.currentVehicle) amount *= 0.45; // vehicle chassis absorbs partial damage

    if (ch.armor > 0) {
      const absorbed = Math.min(ch.armor, amount * 0.75);
      ch.armor -= absorbed;
      amount -= absorbed;
    }
    ch.health = Math.max(0, ch.health - amount);
    this.damageFlashTimer = 0.25;
    this.input.triggerVibration(110, 0.3, 0.5);

    if (ch.health <= 0 && this.wastedTimer <= 0) {
      this.wastedTimer = 3.2;
      this.wastedReason = null;
      this.parachuteDeployed = false;
      this.parachuteRig.visible = false;
      this.exitCurrentVehicle();
      this.clearPolicePursuit();
      this.audio.playImpact(1.0);
    }
    this.callbacks.onCharactersChange(structuredClone(this.characters), this.activeCharId);
  }

  private startReload() {
    const owned = this.inventory.weapons.find((w) => w.id === this.inventory.equippedWeapon);
    const def = WEAPON_CATALOG[this.inventory.equippedWeapon];
    if (!owned || owned.ammoInClip >= def.clipSize || owned.reserveAmmo <= 0) return;
    this.reloadTimer = 1.1;
    this.audio.playReload();
  }

  private finishReload() {
    const owned = this.inventory.weapons.find((w) => w.id === this.inventory.equippedWeapon);
    const def = WEAPON_CATALOG[this.inventory.equippedWeapon];
    if (!owned) return;
    const needed = def.clipSize - owned.ammoInClip;
    const taken = Math.min(needed, owned.reserveAmmo);
    owned.ammoInClip += taken;
    owned.reserveAmmo -= taken;
    this.callbacks.onInventoryChange(structuredClone(this.inventory));
  }

  private findAutoAimTarget(): { x: number; y: number; z: number } | null {
    const def = WEAPON_CATALOG[this.inventory.equippedWeapon];
    const origin = this.camera.position;
    const forward = _v1.set(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
    let bestScore = -1;
    let bestPos: { x: number; y: number; z: number } | null = null;
    const hasActiveMission = Boolean(this.activeMission);

    for (const npc of this.npcs) {
      if (!npc.alive) continue;
      // During mission prioritize enemies; in free roam snap to armed/hostile/nearby targets
      if (hasActiveMission && npc.kind === 'civilian' && npc.behavior !== 'fight') continue;
      const ty = 1.15;
      const dx = npc.x - origin.x;
      const dy = ty - origin.y;
      const dz = npc.z - origin.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist < 1.5 || dist > def.range) continue;
      const dot = (dx * forward.x + dy * forward.y + dz * forward.z) / dist;
      if (dot > 0.89) {
        const priority =
          (npc.kind === 'enemy' || (npc.kind === 'bouncer' && npc.behavior === 'fight')
            ? 0.08
            : npc.kind === 'police'
              ? 0.04
              : 0) +
          dot -
          dist * 0.0008;
        if (priority > bestScore) {
          bestScore = priority;
          bestPos = { x: npc.x, y: ty, z: npc.z };
        }
      }
    }

    for (const rt of this.rangeTargets) {
      if (!rt.alive) continue;
      const dx = rt.x - origin.x;
      const dy = rt.y - origin.y;
      const dz = rt.z - origin.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist < 1.5 || dist > def.range) continue;
      const dot = (dx * forward.x + dy * forward.y + dz * forward.z) / dist;
      if (dot > 0.91) {
        const priority = dot + 0.03 - dist * 0.0008;
        if (priority > bestScore) {
          bestScore = priority;
          bestPos = { x: rt.x, y: rt.y, z: rt.z };
        }
      }
    }

    return bestPos;
  }

  private fireEquippedWeapon(isAiming = false) {
    const owned = this.inventory.weapons.find((w) => w.id === this.inventory.equippedWeapon);
    const def = WEAPON_CATALOG[this.inventory.equippedWeapon];
    if (!owned) return;

    if (!this.settings.gameplayMods.infiniteAmmo) {
      if (owned.ammoInClip <= 0) {
        this.startReload();
        return;
      }
      owned.ammoInClip -= 1;
      this.callbacks.onInventoryChange(structuredClone(this.inventory));
    }

    const rateMult = this.settings.gameplayMods.rapidFire ? 0.42 : 1.0;
    this.fireCooldown = (def.fireRateMs / 1000) * rateMult;
    this.audio.playGunshot(def.id);
    this.input.triggerVibration(70, 0.35, def.id === 'shotgun' ? 0.85 : 0.3);

    // Subtle camera + weapon recoil kickback
    this.weaponRecoilKick = def.id === 'shotgun' || def.id === 'rpg' ? 0.14 : def.id === 'minigun' ? 0.045 : 0.065;
    this.camPitch = THREE.MathUtils.clamp(this.camPitch - (def.id === 'shotgun' ? 0.032 : 0.011), -0.55, 0.85);

    // Firing into the air scatters nearby crowd, without spawning random police!
    const fpx = this.playerRig.root.position.x;
    const fpy = this.playerRig.root.position.y;
    const fpz = this.playerRig.root.position.z;
    this.alertNearbyCrowd(fpx, fpz, 26, true);
    if (Math.abs(fpx - MALIBU_CLUB.x) <= 19.5 && Math.abs(fpz - MALIBU_CLUB.z) <= 15.5 && fpy < 7.5) {
      this.alertClubBouncers(true);
    }

    // Muzzle origin
    const muzzleWorld = _v1;
    if (this.cameraMode === 'first_person' && !this.currentVehicle) {
      muzzleWorld.copy(this.camera.position).add(
        _v2.set(0.18, -0.14, -0.55).applyQuaternion(this.camera.quaternion)
      );
    } else if (this.currentVehicle) {
      muzzleWorld.set(this.currentVehicle.x, this.currentVehicle.y + 1.25, this.currentVehicle.z);
    } else {
      this.playerRig.muzzlePoint.getWorldPosition(muzzleWorld);
    }

    this.muzzleFlashMesh.position.copy(muzzleWorld);
    this.muzzleFlashMesh.visible = true;
    this.muzzleFlashTimer = 0.055;

    // Soft Auto-Aim lock onto closest NPC / Mission Enemy / Range Target when aiming
    const lockTarget = isAiming && !this.currentVehicle ? this.findAutoAimTarget() : null;
    this.autoAimLocked = Boolean(lockTarget);

    // Aim ray from camera center
    const mateoSpreadMult = this.activeCharId === 'mateo' ? 0.78 : 1.0;
    const spread = def.spread * mateoSpreadMult * (lockTarget ? 0.45 : 1.0);

    // Rocket Launcher fires a 3D explosive projectile!
    if (def.id === 'rpg') {
      if (lockTarget) {
        _rayDir.set(
          lockTarget.x - this.camera.position.x,
          lockTarget.y - this.camera.position.y,
          lockTarget.z - this.camera.position.z
        ).normalize();
      } else {
        _rayDir.set(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
      }
      const rocketMesh = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.08, 0.36, 4, 8),
        new THREE.MeshStandardMaterial({ color: 0xf97316, emissive: 0xef4444, emissiveIntensity: 1.5 })
      );
      rocketMesh.rotation.x = Math.PI / 2;
      rocketMesh.position.copy(muzzleWorld);
      this.scene.add(rocketMesh);
      this.rockets.push({
        mesh: rocketMesh,
        x: muzzleWorld.x,
        y: muzzleWorld.y,
        z: muzzleWorld.z,
        vx: _rayDir.x * 58,
        vy: _rayDir.y * 58,
        vz: _rayDir.z * 58,
        life: 3.0,
      });
      return;
    }

    for (let p = 0; p < def.pellets; p++) {
      if (lockTarget) {
        _rayDir.set(
          lockTarget.x - this.camera.position.x,
          lockTarget.y - this.camera.position.y,
          lockTarget.z - this.camera.position.z
        ).normalize();
      } else {
        _rayDir.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
      }
      _rayDir.x += (Math.random() - 0.5) * spread;
      _rayDir.y += (Math.random() - 0.5) * spread;
      _rayDir.z += (Math.random() - 0.5) * spread;
      _rayDir.normalize();

      const rayOrigin = this.camera.position;
      // Check solid walls/pillars/buildings FIRST so bullets NEVER shoot through walls!
      const wallDist = this.raycastWorldObstacles(rayOrigin, _rayDir, def.range);
      let bestDist = wallDist;
      const hitPoint = _v2.copy(rayOrigin).addScaledVector(_rayDir, bestDist);
      let hitNpc: NpcEntity | null = null;
      let hitRangeTarget: RangeTargetEntity | null = null;
      let hitBarrel: ExplosiveBarrelEntity | null = null;
      let hitVehicle: VehicleEntity | null = null;

      // 1. Check NPCs (only closer than wallDist)
      for (const npc of this.npcs) {
        if (!npc.alive) continue;
        _v3.set(npc.x, 1.05, npc.z);
        const t = _v4.copy(_v3).sub(rayOrigin).dot(_rayDir);
        if (t > 1 && t < bestDist) {
          const closest = _rayOrigin.copy(rayOrigin).addScaledVector(_rayDir, t);
          if (closest.distanceTo(_v3) < 0.78) {
            bestDist = t;
            hitPoint.copy(closest);
            hitNpc = npc;
          }
        }
      }

      // 2. Check Shooting Range Targets
      for (const rt of this.rangeTargets) {
        if (!rt.alive) continue;
        _v3.set(rt.x, rt.y, rt.z);
        const t = _v4.copy(_v3).sub(rayOrigin).dot(_rayDir);
        if (t > 1 && t < bestDist) {
          const closest = _rayOrigin.copy(rayOrigin).addScaledVector(_rayDir, t);
          if (closest.distanceTo(_v3) < 0.65) {
            bestDist = t;
            hitPoint.copy(closest);
            hitRangeTarget = rt;
            hitNpc = null;
          }
        }
      }

      // 3. Check Explosive Barrels
      for (const b of this.barrels) {
        if (!b.alive) continue;
        _v3.set(b.x, 0.6, b.z);
        const t = _v4.copy(_v3).sub(rayOrigin).dot(_rayDir);
        if (t > 1 && t < bestDist) {
          const closest = _rayOrigin.copy(rayOrigin).addScaledVector(_rayDir, t);
          if (closest.distanceTo(_v3) < 0.72) {
            bestDist = t;
            hitPoint.copy(closest);
            hitBarrel = b;
            hitRangeTarget = null;
            hitNpc = null;
          }
        }
      }

      // 4. Check Vehicles
      for (const veh of this.vehicles) {
        if (veh === this.currentVehicle || veh.destroyed) continue;
        _v3.set(veh.x, veh.y + 0.85, veh.z);
        const t = _v4.copy(_v3).sub(rayOrigin).dot(_rayDir);
        if (t > 1 && t < bestDist) {
          const closest = _rayOrigin.copy(rayOrigin).addScaledVector(_rayDir, t);
          if (closest.distanceTo(_v3) < 1.65) {
            bestDist = t;
            hitPoint.copy(closest);
            hitVehicle = veh;
            hitBarrel = null;
            hitRangeTarget = null;
            hitNpc = null;
          }
        }
      }

      this.spawnTracer(muzzleWorld, hitPoint, 0xfef08a);

      if (hitNpc) {
        this.damageNpc(hitNpc, def.damage);
        this.addSkillXp('shooting', 3.5);
        this.hitMarkerTimer = 0.14;
        this.audio.playHitMarker();
        this.spawnParticleBurst(hitPoint, 0xef4444, 4);
      } else if (hitRangeTarget) {
        hitRangeTarget.alive = false;
        hitRangeTarget.mesh.visible = false;
        hitRangeTarget.respawnTimer = 4.5;
        this.hitMarkerTimer = 0.16;
        this.audio.playHitMarker();
        this.spawnParticleBurst(hitPoint, 0x38bdf8, 5);
        this.cash += 120;
        this.stats.shootingRangeScore = (this.stats.shootingRangeScore || 0) + 100;
        this.addSkillXp('shooting', 10);
        this.stuntMessage = 'Zásah terča! +$120 · +100 bodov strelnice';
        this.stuntTimer = 2.0;
        this.callbacks.onCashChange(this.cash);
        this.callbacks.onStatsChange({ ...this.stats });
      } else if (hitBarrel) {
        this.detonateBarrel(hitBarrel);
        this.hitMarkerTimer = 0.14;
      } else if (hitVehicle) {
        hitVehicle.health -= def.damage;
        this.spawnParticleBurst(hitPoint, 0xfbbf24, 5);
        this.hitMarkerTimer = 0.12;
        if (hitVehicle.isPolice && !this.settings.gameplayMods.noPolice) {
          this.schedulePoliceDispatch('Poškodenie policajného vozidla VCPD', 1, 6.5);
        }
        if (hitVehicle.health <= 0 && !hitVehicle.destroyed) {
          hitVehicle.destroyed = true;
          this.triggerExplosion(hitVehicle.x, hitVehicle.z, 8);
          this.scene.remove(hitVehicle.rig.root);
        }
      } else {
        this.spawnParticleBurst(hitPoint, 0xe2e8f0, 3);
      }
    }
  }

  private damageNpc(npc: NpcEntity, dmg: number, fromTackle = false) {
    npc.health -= dmg;
    if (npc.kind === 'civilian' && npc.health > 0) {
      if (npc.hasWeapon) {
        npc.behavior = 'fight';
        if (npc.weaponMesh) npc.weaponMesh.visible = true;
      } else {
        npc.behavior = 'flee';
        npc.panicTimer = 12;
      }
    } else if (npc.kind === 'bouncer' && npc.health > 0) {
      this.alertClubBouncers(true);
    }
    if (npc.health <= 0 && npc.alive) {
      npc.alive = false;
      this.scene.remove(npc.rig.root);
      this.stats.totalEliminations += 1;
      const bounty =
        npc.kind === 'enemy' ? 220 : npc.kind === 'bouncer' ? 160 : npc.kind === 'police' ? 150 : fromTackle ? 85 : 40;
      this.cash += bounty;
      this.callbacks.onCashChange(this.cash);
      this.callbacks.onStatsChange({ ...this.stats });

      // Dropped ammo when eliminating armed NPC, club security or police officer
      if (npc.kind === 'police' || npc.kind === 'bouncer' || npc.hasWeapon) {
        const owned = this.inventory.weapons.find((w) => w.id === this.inventory.equippedWeapon);
        if (owned) {
          owned.reserveAmmo += 8;
          this.callbacks.onInventoryChange(structuredClone(this.inventory));
        }
      }

      if (fromTackle) {
        this.stuntMessage = `Zrazený cieľ! +$${bounty}`;
        this.stuntTimer = 2.0;
      }

      // Delayed Police Dispatch upon eliminating civilian, bouncer or police — gives player time to escape!
      if (!this.settings.gameplayMods.noPolice && (npc.kind === 'civilian' || npc.kind === 'police' || npc.kind === 'bouncer')) {
        this.schedulePoliceDispatch(
          npc.kind === 'police'
            ? 'Útok na príslušníka VCPD'
            : npc.kind === 'bouncer'
              ? 'Napadnutie ochranky klubu Malibu'
              : 'Nahlásený trestný čin v okrese',
          npc.kind === 'police' ? 2 : 1,
          7.5
        );
      }
    }
  }

  private detonateBarrel(b: ExplosiveBarrelEntity) {
    b.alive = false;
    b.mesh.visible = false;
    b.respawnTimer = 25;
    this.triggerExplosion(b.x, b.z, 9.5);
  }

  private triggerExplosion(x: number, z: number, radius: number) {
    this.audio.playExplosion();
    this.input.triggerVibration(320, 0.85, 1.0);
    this.spawnParticleBurst(new THREE.Vector3(x, 0.8, z), 0xf97316, 16, true);

    for (const npc of this.npcs) {
      if (!npc.alive) continue;
      const d = Math.hypot(npc.x - x, npc.z - z);
      if (d < radius) {
        this.damageNpc(npc, 140 * (1 - d / radius));
      }
    }

    for (const veh of this.vehicles) {
      if (veh.destroyed || veh === this.currentVehicle) continue;
      const d = Math.hypot(veh.x - x, veh.z - z);
      if (d < radius) {
        veh.health -= 180 * (1 - d / radius);
        if (veh.health <= 0) {
          veh.destroyed = true;
          this.scene.remove(veh.rig.root);
        }
      }
    }
  }

  private addCrimeHeat(amount: number) {
    this.wantedHeat = Math.min(250, this.wantedHeat + amount);
    const newStars =
      this.wantedHeat >= 210
        ? 5
        : this.wantedHeat >= 150
          ? 4
          : this.wantedHeat >= 95
            ? 3
            : this.wantedHeat >= 50
              ? 2
              : this.wantedHeat >= 20
                ? 1
                : 0;
    if (newStars > this.wantedStars) {
      this.wantedStars = newStars;
      this.wantedEvading = false;
      this.evasionProgress = 0;
    }
  }

  private stepWantedSystem(dt: number) {
    if (this.wantedStars <= 0) {
      this.arrestProgress = 0;
      return;
    }

    const px = this.playerRig.root.position.x;
    const pz = this.playerRig.root.position.z;

    // Count nearby alive cops & police cars
    const activePoliceUnits = this.npcs.filter((n) => n.alive && n.kind === 'police');
    const activePoliceCars = this.vehicles.filter((v) => v.isPolice && !v.occupiedByPlayer && !v.destroyed);

    this.policeSpawnTimer -= dt;
    const desiredCops = Math.min(8, this.wantedStars * 2);
    if (this.policeSpawnTimer <= 0 && activePoliceUnits.length < desiredCops) {
      this.policeSpawnTimer = 5.0;
      for (let attempt = 0; attempt < 6; attempt++) {
        const ang = Math.random() * Math.PI * 2;
        const spawnDist = 36 + Math.random() * 18;
        const sx = px + Math.cos(ang) * spawnDist;
        const sz = pz + Math.sin(ang) * spawnDist;
        if (!isIslandLandAt(sx, sz) || isWaterAt(sx, sz)) continue;
        this.spawnHostileNpc('police', sx, sz);

        if (this.wantedStars >= 2 && activePoliceCars.length < 3) {
          this.addVehicle(
            `copcar_${Date.now()}`,
            'VCPD',
            'VCPD Interceptor',
            'police',
            '#111827',
            sx,
            sz,
            Math.atan2(px - sx, pz - sz),
            true,
            false
          );
        }
        break;
      }
    }

    // Check if police can arrest player (close range + stationary/slow) or spot player
    let spotted = false;
    let copCloseForArrest = false;
    for (const c of activePoliceUnits) {
      const d = Math.hypot(c.x - px, c.z - pz);
      if (d < 44) spotted = true;
      if (d < 3.9) copCloseForArrest = true;
    }
    for (const pc of activePoliceCars) {
      const d = Math.hypot(pc.x - px, pc.z - pz);
      if (d < 48) spotted = true;
      if (d < 4.5 && pc.speed < 4) copCloseForArrest = true;
    }

    const playerSlow = !this.currentVehicle ? Math.hypot(this.playerVelX, this.playerVelZ) < 2.2 : Math.abs(this.currentVehicle.speed) < 2.8;
    if (copCloseForArrest && playerSlow) {
      this.arrestProgress += dt;
      if (this.arrestProgress >= 1.35) {
        this.bustedTimer = 3.2;
        this.exitCurrentVehicle();
        this.clearPolicePursuit();
        this.audio.playImpact(0.8);
        return;
      }
    } else {
      this.arrestProgress = Math.max(0, this.arrestProgress - dt * 1.5);
    }

    if (spotted) {
      this.wantedEvading = false;
      this.evasionProgress = Math.max(0, this.evasionProgress - dt * 15);
    } else {
      this.wantedEvading = true;
      const evasionSpeed = Math.max(8, 22 - this.wantedStars * 2.8);
      this.evasionProgress += evasionSpeed * dt;
      if (this.evasionProgress >= 100) {
        // Escaped the police!
        this.clearPolicePursuit();
        this.stats.policeEscapes += 1;
        this.callbacks.onStatsChange({ ...this.stats });
        this.audio.playUiChime('mission');
      }
    }
  }

  private stepWorldDynamics(dt: number) {
    // Respawn explosive barrels after delay
    for (const b of this.barrels) {
      if (!b.alive) {
        b.respawnTimer -= dt;
        if (b.respawnTimer <= 0) {
          b.alive = true;
          b.mesh.visible = true;
        }
      }
    }

    // Respawn shooting range targets after hit
    for (const rt of this.rangeTargets) {
      if (!rt.alive) {
        rt.respawnTimer -= dt;
        if (rt.respawnTimer <= 0) {
          rt.alive = true;
          rt.mesh.visible = true;
        }
      }
    }

    // Rockets
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.life -= dt;
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      r.z += r.vz * dt;
      r.mesh.position.set(r.x, r.y, r.z);

      let exploded = r.life <= 0 || r.y <= 0.15;
      if (!exploded) {
        for (const npc of this.npcs) {
          if (npc.alive && Math.hypot(npc.x - r.x, npc.z - r.z) < 1.6 && Math.abs(r.y - 1.0) < 1.4) {
            exploded = true;
            break;
          }
        }
      }
      if (!exploded) {
        for (const veh of this.vehicles) {
          if (!veh.destroyed && veh !== this.currentVehicle && Math.hypot(veh.x - r.x, veh.z - r.z) < 2.2) {
            exploded = true;
            break;
          }
        }
      }
      if (!exploded) {
        const col = this.resolveBuildingCollision(r.x, r.z, 0.35, Math.max(0, r.y), false);
        if (col.collided) exploded = true;
      }

      if (exploded) {
        this.triggerExplosion(r.x, r.z, 10.5);
        this.hitMarkerTimer = 0.16;
        this.scene.remove(r.mesh);
        r.mesh.geometry.dispose();
        (r.mesh.material as THREE.Material).dispose();
        this.rockets.splice(i, 1);
      }
    }

    // Pooled Tracers (zero runtime material/mesh allocation)
    for (const tr of this.tracerPool) {
      if (!tr.active) continue;
      tr.life -= dt;
      if (tr.life <= 0) {
        tr.active = false;
        tr.mesh.visible = false;
      }
    }

    // Pooled Particles (zero runtime material/mesh allocation)
    for (const pt of this.particlePool) {
      if (!pt.active) continue;
      pt.life -= dt;
      if (pt.life <= 0) {
        pt.active = false;
        pt.mesh.visible = false;
        continue;
      }
      pt.mesh.position.x += pt.vx * dt;
      pt.mesh.position.y += pt.vy * dt;
      pt.mesh.position.z += pt.vz * dt;
      pt.vy -= 9.8 * dt;
      if (pt.growSpeed > 0) {
        pt.mesh.scale.addScalar(pt.growSpeed * dt);
      }
      pt.mat.opacity = Math.max(0, pt.life / pt.maxLife);
    }
  }

  private stepMission(dt: number) {
    if (!this.activeMission) return;
    this.missionElapsedSec += dt;

    if (this.missionTimerRemaining !== null) {
      this.missionTimerRemaining -= dt;
      if (this.missionTimerRemaining <= 0) {
        this.missionNotification = {
          title: 'Misia zlyhala',
          subtitle: 'Vypršal časový limit!',
        };
        this.missionNotifTimer = 4.0;
        this.cancelMission();
        return;
      }
    }

    const stage = this.activeMission.stages[this.activeStageIndex];
    if (!stage) return;

    const px = this.playerRig.root.position.x;
    const pz = this.playerRig.root.position.z;

    if (this.pickupBriefcase.visible) {
      this.pickupBriefcase.rotation.y += dt * 2.2;
    }
    if (this.waypointGroup.visible) {
      this.waypointBeam.rotation.y += dt * 0.8;
    }

    if (stage.type === 'goto' || stage.type === 'collect') {
      const dist = Math.hypot(px - stage.targetX, pz - stage.targetZ);
      if (dist <= stage.radius && (!stage.vehicleRequired || this.currentVehicle)) {
        this.advanceMissionStage();
      }
    } else if (stage.type === 'eliminate') {
      const remainingEnemies = this.npcs.filter((n) => n.alive && n.kind === 'enemy').length;
      if (remainingEnemies === 0) {
        this.advanceMissionStage();
      }
    } else if (stage.type === 'escape_police') {
      if (this.wantedStars === 0) {
        this.advanceMissionStage();
      }
    }
  }

  private spawnTracer(start: THREE.Vector3, end: THREE.Vector3, colorHex: number) {
    const dist = start.distanceTo(end);
    if (dist < 0.2 || this.tracerPool.length === 0) return;
    const tr = this.tracerPool[this.tracerCursor % this.tracerPool.length];
    this.tracerCursor = (this.tracerCursor + 1) % this.tracerPool.length;
    tr.mat.color.setHex(colorHex);
    tr.mat.opacity = 0.85;
    tr.mesh.scale.set(1, 1, dist);
    tr.mesh.position.copy(start).lerp(end, 0.5);
    tr.mesh.lookAt(end);
    tr.mesh.visible = true;
    tr.active = true;
    tr.life = 0.065;
    tr.maxLife = 0.065;
  }

  private spawnParticleBurst(origin: THREE.Vector3, colorHex: number, count: number, isExplosion = false) {
    if (this.particlePool.length === 0) return;
    const baseScale = isExplosion ? 3.5 : 0.7;
    const lifeSec = isExplosion ? 0.55 : 0.28;
    const grow = isExplosion ? 6.5 : 0;
    for (let i = 0; i < count; i++) {
      const pt = this.particlePool[this.particleCursor % this.particlePool.length];
      this.particleCursor = (this.particleCursor + 1) % this.particlePool.length;
      pt.mat.color.setHex(colorHex);
      pt.mat.opacity = 0.95;
      pt.mesh.scale.setScalar(baseScale);
      pt.mesh.position.copy(origin);
      pt.mesh.visible = true;
      pt.active = true;
      const spd = isExplosion ? 6 + Math.random() * 10 : 2 + Math.random() * 4;
      const ang = Math.random() * Math.PI * 2;
      pt.vx = Math.cos(ang) * spd;
      pt.vy = (isExplosion ? 4 : 2) + Math.random() * 5;
      pt.vz = Math.sin(ang) * spd;
      pt.life = lifeSec;
      pt.maxLife = lifeSec;
      pt.growSpeed = grow;
    }
  }

  private updateActiveCamera(dt: number, isAiming: boolean) {
    const px = this.playerRig.root.position.x;
    const py = this.playerRig.root.position.y;
    const pz = this.playerRig.root.position.z;

    // Firm Vehicle Camera Auto-Follow + On-Foot Keyboard Auto-Follow (so player can play smoothly with pure keyboard!)
    if (this.currentVehicle && !this.activeCutscene && this.switchSwoopTimer <= 0) {
      const diff = Math.atan2(
        Math.sin(this.currentVehicle.heading - this.camYaw),
        Math.cos(this.currentVehicle.heading - this.camYaw)
      );
      if (this.cameraMode === 'first_person') {
        if (Math.abs(this.currentVehicle.speed) > 0.8 || Math.abs(this.currentVehicle.steerAngle) > 0.04) {
          this.camYaw += diff * Math.min(1, dt * 6.5);
        }
      } else if (!isAiming && (Math.abs(this.currentVehicle.speed) > 1.2 || this.taxiMode === 'passenger')) {
        const followRate = this.taxiMode === 'passenger' ? 5.2 : 6.2;
        this.camYaw += diff * Math.min(1, dt * followRate);
      }
    } else if (
      !this.currentVehicle &&
      !this.activeCutscene &&
      this.switchSwoopTimer <= 0 &&
      this.cameraMode !== 'first_person' &&
      !isAiming &&
      this.manualCameraCooldown <= 0
    ) {
      const speedXZ = Math.hypot(this.playerVelX, this.playerVelZ);
      if (speedXZ > 0.8) {
        const moveHeading = Math.atan2(this.playerVelX, this.playerVelZ);
        const diff = Math.atan2(
          Math.sin(moveHeading - this.camYaw),
          Math.cos(moveHeading - this.camYaw)
        );
        this.camYaw += diff * Math.min(1, dt * 2.1);
      }
    }

    // Dynamic FOV boost when sprinting, aiming (with Sniper optical zoom!), or driving/flying fast
    let targetFov = this.settings.graphics.fov;
    if (isAiming && !this.currentVehicle) {
      targetFov = this.inventory.equippedWeapon === 'sniper' ? 30 : targetFov - 14;
    } else if (this.currentVehicle) {
      targetFov += Math.min(16, Math.abs(this.currentVehicle.speed) * 0.35);
    }
    if (Math.abs(this.camera.fov - targetFov) > 0.1) {
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 10, dt);
      this.camera.updateProjectionMatrix();
    }

    if (this.activeCutscene) {
      // Cinematic Cutscene Orbit Camera around Speaker / Target
      const line = this.cutsceneLines[this.activeCutscene.lineIndex];
      const focusX = line?.cameraFocus === 'target' ? this.cutsceneTargetPos.x : px;
      const focusZ = line?.cameraFocus === 'target' ? this.cutsceneTargetPos.z : pz;
      const focusY = line?.cameraFocus === 'target' ? Math.max(1.5, this.cutsceneTargetPos.y) : py + 1.4;
      const orbitAng = this.elapsedSec * 0.38;
      const radius = line?.cameraFocus === 'panoramic' ? 18 : 6.5;
      const height = line?.cameraFocus === 'panoramic' ? 8.5 : 2.6;
      _camGoal.set(focusX + Math.sin(orbitAng) * radius, focusY + height, focusZ + Math.cos(orbitAng) * radius);
      _lookGoal.set(focusX, focusY + 0.6, focusZ);
    } else if (this.switchSwoopTimer > 0) {
      // Dramatic high aerial swoop on character switch!
      _camGoal.set(px, py + 38, pz + 24);
      _lookGoal.set(px, py + 1.2, pz);
    } else if (this.cameraMode === 'first_person') {
      if (this.currentVehicle) {
        const v = this.currentVehicle;
        const fwdX = Math.sin(v.heading);
        const fwdZ = Math.cos(v.heading);
        const cockpitY =
          v.kind === 'plane' || v.kind === 'fighter_jet'
            ? 1.78
            : v.kind === 'helicopter'
              ? 1.65
              : v.kind === 'boat'
                ? 1.55
                : 1.38;
        _camGoal.set(v.x + fwdX * 0.48, v.y + cockpitY, v.z + fwdZ * 0.48);
        _lookGoal.set(
          _camGoal.x + Math.sin(this.camYaw) * 14,
          _camGoal.y - Math.sin(this.camPitch) * 8,
          _camGoal.z + Math.cos(this.camYaw) * 14
        );
      } else {
        _camGoal.set(px, py + 1.56, pz);
        _lookGoal.set(
          px + Math.sin(this.camYaw) * Math.cos(this.camPitch) * 10,
          py + 1.56 - Math.sin(this.camPitch) * 10,
          pz + Math.cos(this.camYaw) * Math.cos(this.camPitch) * 10
        );
      }
    } else {
      // Third Person or Far Third Person
      const isFar = this.cameraMode === 'third_person_far';
      const isAircraft =
        this.currentVehicle?.kind === 'plane' ||
        this.currentVehicle?.kind === 'helicopter' ||
        this.currentVehicle?.kind === 'fighter_jet';
      const baseDist = isAircraft
        ? isFar
          ? 18.5
          : 13.0
        : this.currentVehicle
          ? isFar
            ? 10.5
            : 6.8
          : isFar
            ? 7.2
            : isAiming
              ? 2.5
              : 4.1;
      const baseHeight = isAircraft
        ? isFar
          ? 6.2
          : 4.3
        : this.currentVehicle
          ? isFar
            ? 4.2
            : 2.75
          : isFar
            ? 2.9
            : 1.85;
      const shoulderOffset = !this.currentVehicle && isAiming ? 0.55 : 0;

      const sinY = Math.sin(this.camYaw);
      const cosY = Math.cos(this.camYaw);

      _camGoal.set(
        px - sinY * baseDist * Math.cos(this.camPitch) + cosY * shoulderOffset,
        Math.max(0.5, py + baseHeight + Math.sin(this.camPitch) * baseDist * 0.65),
        pz - cosY * baseDist * Math.cos(this.camPitch) - sinY * shoulderOffset
      );

      _lookGoal.set(
        px + sinY * 6 + cosY * shoulderOffset,
        py + (this.currentVehicle ? 1.2 : 1.38) - Math.sin(this.camPitch) * 2.5,
        pz + cosY * 6 - sinY * shoulderOffset
      );
    }

    const dampLambda = this.cameraMode === 'first_person' ? 35 : this.switchSwoopTimer > 0 ? 5 : 14;

    // Third-person camera wall anti-clipping (spatial hash grid O(1) lookup)
    if (this.cameraMode !== 'first_person' && this.switchSwoopTimer <= 0) {
      const anchorX = px;
      const anchorY = py + (this.currentVehicle ? 1.35 : 1.48);
      const anchorZ = pz;
      const segX = _camGoal.x - anchorX;
      const segY = _camGoal.y - anchorY;
      const segZ = _camGoal.z - anchorZ;
      const segLen = Math.hypot(segX, segY, segZ);
      if (segLen > 0.4) {
        let minT = 1.0;
        const { aabbs } = this.queryNearbyColliders(
          Math.min(anchorX, _camGoal.x) - 1,
          Math.max(anchorX, _camGoal.x) + 1,
          Math.min(anchorZ, _camGoal.z) - 1,
          Math.max(anchorZ, _camGoal.z) + 1
        );
        for (const c of aabbs) {
          if (anchorY > c.height + 0.35 && _camGoal.y > c.height + 0.35) continue;
          let tmin = 0.0;
          let tmax = 1.0;
          if (Math.abs(segX) < 1e-5) {
            if (anchorX < c.minX || anchorX > c.maxX) continue;
          } else {
            const invX = 1 / segX;
            let t1 = (c.minX - 0.32 - anchorX) * invX;
            let t2 = (c.maxX + 0.32 - anchorX) * invX;
            if (t1 > t2) [t1, t2] = [t2, t1];
            tmin = Math.max(tmin, t1);
            tmax = Math.min(tmax, t2);
            if (tmin > tmax) continue;
          }
          if (Math.abs(segZ) < 1e-5) {
            if (anchorZ < c.minZ || anchorZ > c.maxZ) continue;
          } else {
            const invZ = 1 / segZ;
            let t1 = (c.minZ - 0.32 - anchorZ) * invZ;
            let t2 = (c.maxZ + 0.32 - anchorZ) * invZ;
            if (t1 > t2) [t1, t2] = [t2, t1];
            tmin = Math.max(tmin, t1);
            tmax = Math.min(tmax, t2);
            if (tmin > tmax) continue;
          }
          if (Math.abs(segY) >= 1e-5) {
            const invY = 1 / segY;
            let t1 = (-0.2 - anchorY) * invY;
            let t2 = (c.height + 0.25 - anchorY) * invY;
            if (t1 > t2) [t1, t2] = [t2, t1];
            tmin = Math.max(tmin, t1);
            tmax = Math.min(tmax, t2);
            if (tmin > tmax) continue;
          }
          if (tmin > 0.05 && tmin < minT) {
            minT = tmin;
          }
        }
        if (minT < 1.0) {
          const clampT = Math.max(0.22, minT * 0.88);
          _camGoal.set(anchorX + segX * clampT, Math.max(0.45, anchorY + segY * clampT), anchorZ + segZ * clampT);
        }
      }
    }

    this.camCurrentPos.x = THREE.MathUtils.damp(this.camCurrentPos.x, _camGoal.x, dampLambda, dt);
    this.camCurrentPos.y = THREE.MathUtils.damp(this.camCurrentPos.y, _camGoal.y, dampLambda, dt);
    this.camCurrentPos.z = THREE.MathUtils.damp(this.camCurrentPos.z, _camGoal.z, dampLambda, dt);

    this.camCurrentLook.x = THREE.MathUtils.damp(this.camCurrentLook.x, _lookGoal.x, dampLambda, dt);
    this.camCurrentLook.y = THREE.MathUtils.damp(this.camCurrentLook.y, _lookGoal.y, dampLambda, dt);
    this.camCurrentLook.z = THREE.MathUtils.damp(this.camCurrentLook.z, _lookGoal.z, dampLambda, dt);

    this.camera.position.copy(this.camCurrentPos);
    this.camera.lookAt(this.camCurrentLook);
  }

  private resolveBuildingCollision(
    x: number,
    z: number,
    radius: number,
    entityY = 0,
    ignoreVehicles = false,
    excludeVehicle?: VehicleEntity
  ): { x: number; z: number; collided: boolean; hitX: boolean; hitZ: boolean } {
    let rx = x;
    let rz = z;
    let collided = false;
    let hitX = false;
    let hitZ = false;

    const { aabbs, circles } = this.queryNearbyColliders(x - radius - 2, x + radius + 2, z - radius - 2, z + radius + 2);

    // 1. Solid AABB Colliders (Buildings, Shop Walls, Counters, Bridge Guardrails, Overpass Columns)
    for (const c of aabbs) {
      if (entityY > c.height + 0.15) continue;
      if (c.minY !== undefined && entityY + 1.65 < c.minY) continue;
      const closestX = THREE.MathUtils.clamp(rx, c.minX, c.maxX);
      const closestZ = THREE.MathUtils.clamp(rz, c.minZ, c.maxZ);
      const dx = rx - closestX;
      const dz = rz - closestZ;
      const distSq = dx * dx + dz * dz;
      if (distSq < radius * radius) {
        collided = true;
        if (distSq === 0) {
          const penLeft = Math.abs(rx - c.minX);
          const penRight = Math.abs(c.maxX - rx);
          const penTop = Math.abs(rz - c.minZ);
          const penBottom = Math.abs(c.maxZ - rz);
          const minPen = Math.min(penLeft, penRight, penTop, penBottom);
          if (minPen === penLeft) {
            rx = c.minX - radius;
            hitX = true;
          } else if (minPen === penRight) {
            rx = c.maxX + radius;
            hitX = true;
          } else if (minPen === penTop) {
            rz = c.minZ - radius;
            hitZ = true;
          } else {
            rz = c.maxZ + radius;
            hitZ = true;
          }
        } else {
          const dist = Math.sqrt(distSq);
          const push = radius - dist;
          const nx = dx / dist;
          const nz = dz / dist;
          rx += nx * push;
          rz += nz * push;
          if (Math.abs(nx) > 0.5) hitX = true;
          if (Math.abs(nz) > 0.5) hitZ = true;
        }
      }
    }

    // 2. Circle Colliders (Palm Trunks, Streetlight Poles, Umbrellas, Fountains, Yachts)
    for (const cc of circles) {
      if (entityY > cc.height + 0.15) continue;
      const dx = rx - cc.x;
      const dz = rz - cc.z;
      const minDist = radius + cc.radius;
      const distSq = dx * dx + dz * dz;
      if (distSq < minDist * minDist) {
        collided = true;
        const dist = Math.sqrt(distSq) || 0.001;
        const push = minDist - dist;
        const nx = dx / dist;
        const nz = dz / dist;
        rx += nx * push;
        rz += nz * push;
        if (Math.abs(nx) > 0.5) hitX = true;
        if (Math.abs(nz) > 0.5) hitZ = true;
      }
    }

    // 3. Explosive Barrels
    if (entityY < 1.3) {
      for (const b of this.barrels) {
        if (!b.alive) continue;
        const dx = rx - b.x;
        const dz = rz - b.z;
        const minDist = radius + 0.45;
        const distSq = dx * dx + dz * dz;
        if (distSq < minDist * minDist) {
          collided = true;
          const dist = Math.sqrt(distSq) || 0.001;
          const push = minDist - dist;
          rx += (dx / dist) * push;
          rz += (dz / dist) * push;
        }
      }
    }

    // 4. Non-occupied Vehicles (prevents walking through parked/stopped cars!)
    if (!ignoreVehicles) {
      for (const veh of this.vehicles) {
        if (veh.destroyed || veh.occupiedByPlayer || veh === excludeVehicle) continue;
        if (Math.abs(entityY - veh.y) > 2.2) continue;
        const vehR = veh.kind === 'motorcycle' ? 0.85 : veh.kind === 'boat' || veh.kind === 'plane' ? 2.4 : 1.55;
        const dx = rx - veh.x;
        const dz = rz - veh.z;
        const minDist = radius + vehR;
        const distSq = dx * dx + dz * dz;
        if (distSq < minDist * minDist) {
          collided = true;
          const dist = Math.sqrt(distSq) || 0.001;
          const push = minDist - dist;
          const nx = dx / dist;
          const nz = dz / dist;
          rx += nx * push;
          rz += nz * push;
          if (Math.abs(nx) > 0.5) hitX = true;
          if (Math.abs(nz) > 0.5) hitZ = true;
        }
      }
    }

    return { x: rx, z: rz, collided, hitX, hitZ };
  }

  private isUnderRoofAt(x: number, y: number, z: number): boolean {
    const gKey = gridKey(Math.floor(x / GRID_CELL_SIZE), Math.floor(z / GRID_CELL_SIZE));
    const cellFloors = this.floorGrid.get(gKey);
    if (cellFloors) {
      for (const fs of cellFloors) {
        if (
          x >= fs.minX - 0.8 &&
          x <= fs.maxX + 0.8 &&
          z >= fs.minZ - 0.8 &&
          z <= fs.maxZ + 0.8 &&
          y < fs.height - 0.1
        ) {
          return true;
        }
      }
    }
    const cell = this.colliderGrid.get(gKey);
    if (cell) {
      for (const c of cell.aabb) {
        if (
          c.isRoofSurface &&
          x >= c.minX - 0.6 &&
          x <= c.maxX + 0.6 &&
          z >= c.minZ - 0.6 &&
          z <= c.maxZ + 0.6 &&
          y < c.height - 0.15
        ) {
          return true;
        }
      }
    }
    const ovH = getOverpassDeckHeightAt(x, z, 999);
    if (ovH !== null && y < ovH - 0.2) return true;
    const uh = getUnderpassFloorHeightAt(x, z, -2);
    if (uh !== null && uh < -0.5 && y < 0.25) return true;
    return false;
  }

  private getGroundHeightAt(x: number, z: number, curY = 0): number {
    let maxH = getBridgeElevationAt(x, z);
    const overpassH = getOverpassDeckHeightAt(x, z, curY);
    if (overpassH !== null) maxH = Math.max(maxH, overpassH);
    const underpassH = getUnderpassFloorHeightAt(x, z, curY);
    if (underpassH !== null) maxH = Math.min(maxH, underpassH);

    // Walkable multi-floor interior slabs, balconies & rooftops (O(1) spatial grid lookup)
    const cellFloors = this.floorGrid.get(gridKey(Math.floor(x / GRID_CELL_SIZE), Math.floor(z / GRID_CELL_SIZE)));
    if (cellFloors) {
      for (const fs of cellFloors) {
        if (x >= fs.minX && x <= fs.maxX && z >= fs.minZ && z <= fs.maxZ) {
          const minSupportY = fs.minY ?? fs.height - 0.8;
          if (curY >= minSupportY - 0.7) {
            maxH = Math.max(maxH, fs.height);
          }
        }
      }
    }

    // Working 3D building elevators
    for (const el of this.elevators) {
      if (Math.hypot(x - el.x, z - el.z) <= el.radius && curY >= el.currentY - 1.3) {
        maxH = Math.max(maxH, el.currentY);
      }
    }

    // Marina wooden piers allow walking over harbor water
    if (
      x >= 550 &&
      x <= 770 &&
      (Math.abs(z - 700) <= 6.2 || Math.abs(z - 840) <= 6.2 || Math.abs(z - 960) <= 6.2)
    ) {
      maxH = Math.max(maxH, 0.6);
    }
    for (const r of this.ramps) {
      const dx = x - r.x;
      const dz = z - r.z;
      const cos = Math.cos(-r.heading);
      const sin = Math.sin(-r.heading);
      const localX = dx * cos - dz * sin;
      const localZ = dx * sin + dz * cos;
      if (Math.abs(localX) <= r.width * 0.5 && Math.abs(localZ) <= r.length * 0.5) {
        const progress = (localZ + r.length * 0.5) / r.length;
        maxH = Math.max(maxH, progress * r.height);
      }
    }
    return maxH;
  }

  private pushTelemetry(inp: ReturnType<InputManager['poll']>, nearbyPrompt: string | null) {
    const ch = this.characters[this.activeCharId];
    const owned = this.inventory.weapons.find((w) => w.id === this.inventory.equippedWeapon);
    const px = this.playerRig.root.position.x;
    const py = this.playerRig.root.position.y;
    const pz = this.playerRig.root.position.z;

    const blips: MinimapBlip[] = STATIC_MINIMAP_BLIPS.slice();
    for (const mb of this.missionStartBeacons) {
      if (mb.group.visible) {
        blips.push({ x: mb.mission.startX, z: mb.mission.startZ, type: 'mission', label: mb.mission.title });
      }
    }
    for (const sm of SIDE_DISCOVERY_MISSIONS) {
      if (this.discoveredSideMissions.has(sm.id)) {
        blips.push({ x: sm.startX, z: sm.startZ, type: 'side_mission', label: sm.title });
      }
    }
    for (const vis of this.remotePlayers.values()) {
      blips.push({
        x: vis.root.position.x,
        z: vis.root.position.z,
        type: 'friend',
        label: vis.state.displayName,
      });
    }
    for (const npc of this.npcs) {
      if (!npc.alive) continue;
      if (npc.kind === 'police') blips.push({ x: npc.x, z: npc.z, type: 'police' });
      else if (npc.kind === 'enemy' || (npc.kind === 'bouncer' && npc.behavior === 'fight')) {
        blips.push({ x: npc.x, z: npc.z, type: 'enemy' });
      }
    }
    for (const v of this.vehicles) {
      if (v.occupiedByPlayer || v.destroyed) continue;
      if (v.isPolice && this.wantedStars > 0) {
        blips.push({ x: v.x, z: v.z, type: 'police' });
      } else if (!v.isTraffic) {
        const bType: MinimapBlip['type'] =
          v.kind === 'boat'
            ? 'boat'
            : v.kind === 'plane'
              ? 'plane'
              : v.kind === 'helicopter'
                ? 'helicopter'
                : v.kind === 'fighter_jet'
                  ? 'fighter_jet'
                  : v.kind === 'taxi'
                    ? 'taxi'
                    : v.kind === 'motorcycle'
                      ? 'motorcycle'
                      : 'vehicle';
        blips.push({ x: v.x, z: v.z, type: bType, label: `${v.brand} ${v.name}` });
      }
    }

    const stage = this.activeMission?.stages[this.activeStageIndex];
    if (this.activeMission && stage && stage.type !== 'escape_police') {
      blips.push({ x: stage.targetX, z: stage.targetZ, type: 'mission', label: stage.label });
    }

    // GPS Navigation Route along Curved Highways & City Roads (cached between moves)
    let gpsTarget: GpsWaypoint | null = null;
    if (this.activeMission && stage && stage.type !== 'escape_police') {
      gpsTarget = { x: stage.targetX, z: stage.targetZ, label: stage.label };
    } else if (this.gpsWaypoint) {
      gpsTarget = this.gpsWaypoint;
    }

    if (!gpsTarget) {
      this.cachedGpsTargetKey = '';
      if (this.cachedGpsRoute.length > 0) this.cachedGpsRoute = [];
    } else {
      const targetKey = `${gpsTarget.x.toFixed(1)},${gpsTarget.z.toFixed(1)}`;
      const movedSq = (px - this.cachedGpsX) * (px - this.cachedGpsX) + (pz - this.cachedGpsZ) * (pz - this.cachedGpsZ);
      if (targetKey !== this.cachedGpsTargetKey || movedSq > 49 || this.gpsRefreshTimer <= 0) {
        this.cachedGpsTargetKey = targetKey;
        this.cachedGpsX = px;
        this.cachedGpsZ = pz;
        this.gpsRefreshTimer = 0.4;
        this.cachedGpsRoute = computeGpsRoute(px, pz, gpsTarget.x, gpsTarget.z);
      }
    }
    const gpsRoute = this.cachedGpsRoute;
    const gpsDistanceM = gpsTarget ? Math.round(Math.hypot(gpsTarget.x - px, gpsTarget.z - pz)) : 0;

    const vehicleHealthPct = this.currentVehicle
      ? Math.max(0, Math.round((this.currentVehicle.health / Math.max(1, this.currentVehicle.maxHealth)) * 100))
      : 100;
    const nearbyTuningAvailable = SHOPS.some(
      (s) => s.category === 'garage' && Math.hypot(s.doorX - px, s.doorZ - pz) < 9.5
    );

    this.callbacks.onTelemetry({
      fps: this.currentFps,
      health: Math.round(ch.health),
      maxHealth: ch.maxHealth,
      armor: Math.round(ch.armor),
      maxArmor: ch.maxArmor,
      stamina: Math.round(this.playerStamina),
      cash: Math.round(this.cash),
      skills: { ...ch.skills },
      wantedStars: this.wantedStars,
      wantedEvading: this.wantedEvading,
      evasionProgress: Math.round(this.evasionProgress),
      policeDispatchTimer: Math.max(0, Math.ceil(this.policeDispatchTimer)),
      policeDispatchReason: this.policeDispatchReason,
      autoAimLocked: this.autoAimLocked,
      inVehicle: Boolean(this.currentVehicle),
      vehicleKind: this.currentVehicle?.kind ?? null,
      vehicleBrand: this.currentVehicle?.brand || '',
      vehicleName: this.currentVehicle?.name || '',
      vehicleHealthPct,
      vehicleBurning: Boolean(this.currentVehicle && this.currentVehicle.health < this.currentVehicle.maxHealth * 0.25),
      nearbyRepairCost: this.getNearbyRepairCost(),
      nearbyTuningAvailable,
      speedKmh: this.currentVehicle ? Math.round(Math.abs(this.currentVehicle.speed) * 3.6) : 0,
      altitudeM: Math.max(0, Math.round(this.currentVehicle ? this.currentVehicle.y : py)),
      inWater: isWaterAt(px, pz) && py < 0.2,
      handbrake: Boolean(this.currentVehicle && inp.handbrakeHeld),
      isDrifting: Boolean(this.currentVehicle?.isDrifting),
      taxiMode: this.taxiMode,
      taxiFareCash: this.taxiFareCash,
      taxiDestinationLabel: this.taxiDestinationLabel,
      hangarCount: this.savedGarage.hangarVehicles.length,
      garageCount: this.savedGarage.safehouseVehicles.length,
      parkedFacilityNotice: this.parkedFacilityNotice,
      hasParachute: Boolean(this.inventory.hasParachute),
      parachuteDeployed: this.parachuteDeployed,
      godModeActive: this.godModeActive,
      cheatSessionActive: this.cheatSessionActive,
      gameClockStr: this.getGameClockString(),
      gameTimeNormalized: this.gameTimeNormalized,
      cloudCoverage: this.cloudCoverage,
      weatherType: this.weatherType,
      weatherLabel: this.getWeatherLabelSk(this.weatherType),
      rainIntensity: this.rainIntensity,
      ambientTempC: Math.round(
        26 + Math.sin((this.gameTimeNormalized - 0.25) * Math.PI * 2) * 5 - this.rainIntensity * 6
      ),
      nearestNpcDialogue: this.nearestNpcDialogue,
      controlCategory: this.getControlCategoryForVehicle(this.currentVehicle),
      equippedWeapon: this.inventory.equippedWeapon,
      ammoInClip: owned?.ammoInClip ?? 0,
      reserveAmmo: owned?.reserveAmmo ?? 0,
      isReloading: this.reloadTimer > 0,
      isAiming: inp.aimHeld,
      cameraMode: this.cameraMode,
      district: ch.district,
      nearbyPrompt,
      activeSidePrompt: this.activeSidePrompt,
      activeMissionTitle: this.activeMission?.title ?? null,
      activeObjectiveLabel: stage?.label ?? null,
      missionTimerRemaining:
        this.missionTimerRemaining !== null ? Math.max(0, Math.ceil(this.missionTimerRemaining)) : null,
      missionNotification: this.missionNotification,
      activeCutscene: this.activeCutscene,
      remotePlayersCount: this.remotePlayers.size,
      controllerConnected: inp.controllerConnected,
      controllerType: inp.controllerType,
      controllerName: inp.controllerName,
      hitMarkerActive: this.hitMarkerTimer > 0,
      damageFlashActive: this.damageFlashTimer > 0,
      stuntMessage: this.stuntMessage,
      playerX: px,
      playerZ: pz,
      playerHeading: this.currentVehicle ? this.currentVehicle.heading : this.camYaw,
      minimapBlips: blips,
      gpsWaypoint: gpsTarget,
      gpsRoute,
      gpsDistanceM,
      pointerLocked: this.input.isPointerLocked,
      isWasted: this.wastedTimer > 0,
      wastedReason: this.wastedReason,
      isBusted: this.bustedTimer > 0,
    });
  }

  public dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.resizeObserver.disconnect();
    this.input.detach();
    this.audio.dispose();
    this.textures.dispose();
    this.scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const m = obj as THREE.Mesh;
        if (
          m.geometry &&
          m.geometry !== _tracerGeo &&
          m.geometry !== _particleGeo &&
          m.geometry !== _skidGeo
        ) {
          m.geometry.dispose();
        }
        if (Array.isArray(m.material)) {
          m.material.forEach((mat) => {
            if (mat !== _skidMat) mat.dispose();
          });
        } else if (m.material && m.material !== _skidMat) {
          m.material.dispose();
        }
      }
    });
    this.composer?.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
