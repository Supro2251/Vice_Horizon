import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import {
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
  MissionDef,
  MissionProgressRecord,
  ShopDef,
  VehicleKind,
  WeaponId,
} from '../types/game';
import {
  DEFAULT_MISSIONS,
  HOSPITAL_RESPAWN,
  isMissionUnlocked,
  MISSIONS,
  POLICE_STATION_RESPAWN,
  SHOPS,
  WEAPON_CATALOG,
} from '../data/defaults';
import { ProceduralAudioEngine } from './audio';
import { InputManager } from './input';
import { createProceduralTextures, ProceduralTextureSet } from './textures';
import {
  CharacterRig,
  createCharacterRig,
  createVehicleRig,
  createWeaponMesh,
  updateCharacterRigAppearance,
  VehicleRig,
} from './models';
import {
  AABBCollider,
  buildOpenWorld,
  CircleCollider,
  ExplosiveBarrelEntity,
  getDistrictName,
  StuntRamp,
} from './world';
import {
  computeGpsRoute,
  getBridgeElevationAt,
  isBridgeAt,
  isIslandLandAt,
  isOnBeachAt,
  isOutOfBoundsSeaAt,
  isWaterAt,
  RoadSegmentDef,
  TRAFFIC_LOOP_PATHS,
} from './navigation';

// Module-scope reusable math helpers & pooled geometries (Zero GC in render loop)
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
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

interface VehicleEntity {
  id: string;
  brand: string;
  name: string;
  kind: VehicleKind;
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
  destroyed: boolean;
}

interface NpcEntity {
  id: string;
  rig: CharacterRig;
  x: number;
  y: number;
  z: number;
  heading: number;
  health: number;
  kind: 'civilian' | 'police' | 'enemy';
  behavior: 'wander' | 'flee' | 'fight';
  activity: 'stroll' | 'chat' | 'chill';
  chatTargetX?: number;
  chatTargetZ?: number;
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
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  growSpeed: number;
}

export interface EngineCallbacks {
  onTelemetry: (t: HudTelemetry) => void;
  onInventoryChange: (inv: InventoryState) => void;
  onCashChange: (cash: number) => void;
  onCharactersChange: (chars: Record<CharacterId, CharacterState>, activeId: CharacterId) => void;
  onStatsChange: (stats: GameStats) => void;
  onMissionComplete: (missionId: string, elapsedSec: number, reward: number) => void;
  onShopInteract: (shop: ShopDef) => void;
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
  private circleColliders: CircleCollider[] = [];
  private colliderGrid = new Map<string, { aabb: AABBCollider[]; circle: CircleCollider[] }>();
  private ramps: StuntRamp[] = [];
  private barrels: ExplosiveBarrelEntity[] = [];
  private shopRings: THREE.Mesh[] = [];
  private oceanMesh!: THREE.Mesh;
  private skyMat!: THREE.ShaderMaterial;
  public roadSegments: RoadSegmentDef[] = [];
  public roadRects: { x: number; z: number; w: number; l: number }[] = [];
  public buildingFootprints: { x: number; z: number; w: number; d: number; color: string }[] = [];

  private characters: Record<CharacterId, CharacterState>;
  private activeCharId: CharacterId;
  private playerRig!: CharacterRig;
  private firstPersonWeaponGroup: THREE.Group;
  private muzzleFlashMesh: THREE.Mesh;
  private muzzleFlashTimer = 0;

  private vehicles: VehicleEntity[] = [];
  private npcs: NpcEntity[] = [];
  private tracers: BulletTracer[] = [];
  private rockets: RocketProjectile[] = [];
  private particles: ParticleBurst[] = [];
  private skidPool: THREE.Mesh[] = [];
  private skidCursor = 0;
  private skidEmitTimer = 0;
  private currentDriftIntensity = 0;

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

  // Combat & Wanted
  private inventory: InventoryState;
  private cash: number;
  private stats: GameStats;
  private settings: GameSettings;
  private fireCooldown = 0;
  private reloadTimer = 0;
  private hitMarkerTimer = 0;
  private damageFlashTimer = 0;
  private stuntMessage: string | null = null;
  private stuntTimer = 0;
  private wastedTimer = 0;
  private wastedReason: string | null = null;
  private bustedTimer = 0;

  private wantedStars = 0;
  private wantedHeat = 0;
  private wantedEvading = false;
  private evasionProgress = 0;
  private arrestProgress = 0;
  private policeSpawnTimer = 0;

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
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = !this.isSoftwareGl && this.settings.graphics.shadowQuality !== 'off';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
      950
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
        0.26,
        0.4,
        0.92
      );
      composer.addPass(bloom);
      composer.addPass(new OutputPass());
      this.composer = composer;
      this.bloomPass = bloom;
    }

    // Lighting (Sun + Cool Rim Fill for crisp GTA contrast)
    this.hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x334155, 0.88);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xffedd5, 2.25);
    this.sunLight.position.set(80, 95, 60);
    this.sunLight.castShadow = !this.isSoftwareGl;
    this.sunLight.shadow.mapSize.set(1024, 1024);
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 230;
    const d = 56;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.025;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    this.rimLight = new THREE.DirectionalLight(0x7dd3fc, 0.52);
    this.rimLight.position.set(-70, 50, -65);
    this.rimLight.castShadow = false;
    this.scene.add(this.rimLight);

    // 4. World & Procedural Textures
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.textures = createProceduralTextures(maxAniso);
    const world = buildOpenWorld(this.textures);
    this.scene.add(world.worldGroup);
    this.colliders = world.colliders;
    this.circleColliders = world.circleColliders;
    this.ramps = world.ramps;
    this.barrels = world.barrels;
    this.shopRings = world.shopRings;
    this.oceanMesh = world.oceanMesh;
    this.skyMat = world.skyMat;
    this.roadSegments = world.roadSegments;
    this.roadRects = world.roadRects;
    this.buildingFootprints = world.buildingFootprints;
    this.buildColliderGrid();

    // Pooled asphalt drift skid-mark meshes (Zero GC)
    for (let i = 0; i < 120; i++) {
      const m = new THREE.Mesh(_skidGeo, _skidMat);
      m.visible = false;
      this.scene.add(m);
      this.skidPool.push(m);
    }

    // 5. Player Rig & First Person Weapon Viewmodel
    const activeChar = this.characters[this.activeCharId];
    this.playerRig = createCharacterRig(activeChar.appearance, this.textures.contactShadow);
    this.playerRig.root.position.set(activeChar.posX, activeChar.posY, activeChar.posZ);
    this.camYaw = activeChar.heading;
    this.scene.add(this.playerRig.root);

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

    // 6. Waypoint Beacon, Story Start Beacons & Mission Briefcase
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

    // 7. Spawn Initial Diverse Fleet (Cars, Supercars, Motorcycles, Boats, Planes) & Civilians
    this.spawnInitialVehicles();
    this.spawnAmbientCivilians();

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

    // Pre-compile shaders on hardware GPUs
    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
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
    const insertCell = (cx: number, cz: number, itemAabb?: AABBCollider, itemCircle?: CircleCollider) => {
      const key = `${cx},${cz}`;
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
  }

  private queryNearbyColliders(minX: number, maxX: number, minZ: number, maxZ: number) {
    const aabbs = new Set<AABBCollider>();
    const circles = new Set<CircleCollider>();
    const minCx = Math.floor(minX / GRID_CELL_SIZE);
    const maxCx = Math.floor(maxX / GRID_CELL_SIZE);
    const minCz = Math.floor(minZ / GRID_CELL_SIZE);
    const maxCz = Math.floor(maxZ / GRID_CELL_SIZE);
    for (let gx = minCx; gx <= maxCx; gx++) {
      for (let gz = minCz; gz <= maxCz; gz++) {
        const cell = this.colliderGrid.get(`${gx},${gz}`);
        if (!cell) continue;
        for (const a of cell.aabb) aabbs.add(a);
        for (const c of cell.circle) circles.add(c);
      }
    }
    return { aabbs, circles };
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
      // Supercars (Valkyra)
      { kind: 'supercar', brand: 'Valkyra', name: 'Aether RS', color: '#fbbf24', x: 175, z: -48, heading: 0 },
      { kind: 'supercar', brand: 'Valkyra', name: 'Solaris GT', color: '#ec4899', x: 14, z: -64, heading: Math.PI / 2 },
      // Muscle Cars (Solano)
      { kind: 'muscle', brand: 'Solano', name: 'Hellhound V8', color: '#e11d48', x: 102, z: 185, heading: Math.PI / 2 },
      { kind: 'muscle', brand: 'Solano', name: 'Mojave 440', color: '#f97316', x: -130, z: -18, heading: 0 },
      // Sport Coupes (Kuroi)
      { kind: 'coupe', brand: 'Kuroi', name: 'Shinobi GT', color: '#06b6d4', x: 162, z: -64, heading: 0 },
      { kind: 'coupe', brand: 'Kuroi', name: 'Ronin Spec-R', color: '#14b8a6', x: 185, z: -108, heading: Math.PI },
      // Sedans (Bavaro)
      { kind: 'sedan', brand: 'Bavaro', name: 'M50 Touring', color: '#94a3b8', x: 14, z: -108, heading: Math.PI / 2 },
      { kind: 'sedan', brand: 'Bavaro', name: '320 Berlina', color: '#475569', x: -130, z: 68, heading: 0 },
      // SUVs (Titanus)
      { kind: 'suv', brand: 'Titanus', name: 'Apex G-Line', color: '#0ea5e9', x: -46, z: -56, heading: -Math.PI / 2 },
      { kind: 'suv', brand: 'Titanus', name: 'Overland 4x4', color: '#a855f7', x: 88, z: -185, heading: 0 },
      // Motorcycles (Zeta)
      { kind: 'motorcycle', brand: 'Zeta', name: 'Viper RR', color: '#ef4444', x: 152, z: -42, heading: -Math.PI / 2 },
      { kind: 'motorcycle', brand: 'Zeta', name: 'Cross 450', color: '#22c55e', x: -148, z: 188, heading: Math.PI },
      { kind: 'motorcycle', brand: 'Zeta', name: 'Volt S', color: '#38bdf8', x: 86, z: 192, heading: 0 },
      // Emergency Fleet stationed outside Hospital, Police Station & Fire Station
      { kind: 'police', brand: 'VCPD', name: 'VCPD Interceptor', color: '#111827', x: -162, z: -198, heading: Math.PI },
      { kind: 'police', brand: 'VCPD', name: 'VCPD Interceptor', color: '#111827', x: -12, z: -108, heading: Math.PI / 2 },
      { kind: 'ambulance', brand: 'VEMS', name: 'VEMS Sanitka', color: '#f8fafc', x: -20, z: -198, heading: Math.PI },
      { kind: 'firetruck', brand: 'VCFD', name: 'VCFD Hasičské auto', color: '#dc2626', x: 96, z: 184, heading: 0 },
      // Speedboats (Pelican) in Vice Canal, Marina Harbor & Beaches
      { kind: 'boat', brand: 'Pelican', name: 'Speeder 320', color: '#06b6d4', x: 138, z: 138, heading: Math.PI / 2 },
      { kind: 'boat', brand: 'Pelican', name: 'Offshore 45', color: '#f43f5e', x: 262, z: 226, heading: Math.PI / 2 },
      { kind: 'boat', brand: 'Pelican', name: 'Marlin Sport', color: '#f59e0b', x: 266, z: 294, heading: 0 },
      { kind: 'boat', brand: 'Pelican', name: 'Coral Wave', color: '#10b981', x: 432, z: -12, heading: 0 },
      // Planes on Bayshore International Airport Runway (z = 235)
      { kind: 'plane', brand: 'Pelican', name: 'Skylark Coastal', color: '#f97316', x: -258, z: 235, heading: Math.PI / 2 },
      { kind: 'plane', brand: 'Zeta', name: 'Stunt Jet X1', color: '#38bdf8', x: -198, z: 235, heading: Math.PI / 2 },
    ];

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

    // Autonomous Curved-Path Traffic across the 5x Island (Highways, Roundabouts, Boulevards)
    const fleetPalette: Array<[VehicleKind, string, string, string]> = [
      ['sedan', 'Bavaro', 'Bavaro 320', '#64748b'],
      ['coupe', 'Kuroi', 'Kuroi Shinobi', '#ef4444'],
      ['muscle', 'Solano', 'Solano V8', '#3b82f6'],
      ['suv', 'Titanus', 'Titanus Apex', '#f8fafc'],
      ['supercar', 'Valkyra', 'Valkyra Aether', '#fbbf24'],
      ['coupe', 'Kuroi', 'Kuroi Ronin', '#ec4899'],
      ['sedan', 'Bavaro', 'Bavaro M50', '#10b981'],
      ['motorcycle', 'Zeta', 'Zeta Viper', '#f43f5e'],
      ['ambulance', 'VEMS', 'VEMS Sanitka', '#f8fafc'],
      ['firetruck', 'VCFD', 'VCFD Hasičské auto', '#dc2626'],
    ];

    let tIdx = 0;
    TRAFFIC_LOOP_PATHS.forEach((path, pIdx) => {
      const carsOnLoop = pIdx < 2 ? 5 : 4;
      for (let k = 0; k < carsOnLoop; k++) {
        const wpIdx = Math.floor((k / carsOnLoop) * path.length) % path.length;
        const nextIdx = (wpIdx + 1) % path.length;
        const cur = path[wpIdx];
        const nxt = path[nextIdx];
        const heading = Math.atan2(nxt.x - cur.x, nxt.z - cur.z);
        const spec = fleetPalette[tIdx % fleetPalette.length];
        const veh = this.addVehicle(
          `traffic_${tIdx}`,
          spec[1],
          spec[2],
          spec[0],
          spec[3],
          cur.x,
          cur.z,
          heading,
          false,
          true,
          pIdx,
          nextIdx
        );
        veh.speed = 10 + (tIdx % 4) * 1.5;
        tIdx += 1;
      }
    });

    // Autonomous Offshore Boats circling the Island Coastline
    for (let b = 0; b < 3; b++) {
      const ang = (b / 3) * Math.PI * 2;
      const r = 468;
      this.addVehicle(
        `traffic_boat_${b}`,
        'Pelican',
        'Pelican Cruiser',
        'boat',
        b === 0 ? '#0ea5e9' : b === 1 ? '#f43f5e' : '#fbbf24',
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
    const startY = kind === 'boat' ? -0.35 : getBridgeElevationAt(x, z);
    rig.root.position.set(x, startY, z);
    rig.root.rotation.y = heading;
    const hasDriver = isTraffic && kind !== 'boat';
    if (rig.driverGroup) {
      rig.driverGroup.visible = hasDriver;
    }
    this.scene.add(rig.root);

    const speedTable: Record<VehicleKind, [number, number]> = {
      sedan: [26, 13],
      suv: [29, 15],
      muscle: [39, 22],
      police: [44, 25],
      ambulance: [35, 17],
      firetruck: [32, 14],
      coupe: [45, 25],
      supercar: [58, 33],
      motorcycle: [48, 30],
      boat: [38, 19],
      plane: [74, 27],
    };
    const [maxSpeed, accel] = speedTable[kind];

    const v: VehicleEntity = {
      id,
      brand,
      name,
      kind,
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
      speed: isTraffic ? 9.5 : 0,
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
      health: kind === 'plane' || kind === 'boat' || kind === 'firetruck' ? 280 : kind === 'ambulance' ? 220 : 160,
      destroyed: false,
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
    const npc: NpcEntity = {
      id: `civ_${Date.now()}_${idxSeed}_${Math.random().toString(36).slice(2, 5)}`,
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
    // Conversing pairs near Coral Strip, Slnečné námestie, Downtown & Beaches
    const pairs: [number, number][] = [
      [154, -44],
      [172, -32],
      [-28, -44],
      [26, 12],
      [120, -96],
      [-125, -88],
      [345, -18],
      [182, 194],
    ];
    pairs.forEach(([px, pz], i) => {
      if (!isWaterAt(px, pz)) {
        this.spawnCivilianAt(px - 0.75, pz, i * 2, 'wander', 0, 'chat', px + 0.75, pz);
        this.spawnCivilianAt(px + 0.75, pz, i * 2 + 1, 'wander', 0, 'chat', px - 0.75, pz);
      }
    });

    // Strolling & chilling pedestrians across the 5x Island
    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * Math.PI * 2;
      const r = 45 + (i % 5) * 65;
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
      this.bloomPass.strength = settings.graphics.preset === 'ultra' ? 0.34 : 0.24;
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

    // Time of Day, Sky Dome Sun Disc & Horizon Fog
    const tod = settings.gameplayMods.timeOfDay;
    const fogDensity = Math.max(0.0012, 0.28 / settings.graphics.viewDistance);
    if (tod === 'sunset') {
      const horizon = new THREE.Color(0xfb923c);
      const mid = new THREE.Color(0x9333ea).lerp(new THREE.Color(0x334155), 0.35);
      const top = new THREE.Color(0x0f172a);
      this.skyMat.uniforms.uHorizonColor.value.copy(horizon);
      this.skyMat.uniforms.uMidColor.value.copy(mid);
      this.skyMat.uniforms.uTopColor.value.copy(top);
      this.skyMat.uniforms.uSunDir.value.set(0.76, 0.24, 0.56).normalize();
      this.skyMat.uniforms.uSunColor.value.set(0xffedd5);
      this.skyMat.uniforms.uSunStrength.value = 1.05;
      this.scene.background = horizon.clone().lerp(mid, 0.3);
      this.scene.fog = new THREE.FogExp2(horizon.clone().lerp(mid, 0.25).getHex(), fogDensity);
      this.sunLight.color.set(0xfdba74);
      this.sunLight.intensity = 2.45;
      this.sunLight.position.set(110, 58, 70);
      this.rimLight.color.set(0x38bdf8);
      this.rimLight.intensity = 0.55;
      this.hemiLight.color.set(0x7dd3fc);
      this.hemiLight.groundColor.set(0x334155);
      this.hemiLight.intensity = 0.92;
      this.renderer.toneMappingExposure = 1.14;
    } else if (tod === 'noon') {
      const horizon = new THREE.Color(0xbae6fd);
      const mid = new THREE.Color(0x38bdf8);
      const top = new THREE.Color(0x0284c7);
      this.skyMat.uniforms.uHorizonColor.value.copy(horizon);
      this.skyMat.uniforms.uMidColor.value.copy(mid);
      this.skyMat.uniforms.uTopColor.value.copy(top);
      this.skyMat.uniforms.uSunDir.value.set(0.38, 0.88, 0.34).normalize();
      this.skyMat.uniforms.uSunColor.value.set(0xfffbeb);
      this.skyMat.uniforms.uSunStrength.value = 0.9;
      this.scene.background = horizon;
      this.scene.fog = new THREE.FogExp2(horizon.getHex(), fogDensity * 0.72);
      this.sunLight.color.set(0xfffbeb);
      this.sunLight.intensity = 2.65;
      this.sunLight.position.set(50, 120, 45);
      this.rimLight.color.set(0xe0f2fe);
      this.rimLight.intensity = 0.48;
      this.hemiLight.color.set(0xbae6fd);
      this.hemiLight.groundColor.set(0x475569);
      this.hemiLight.intensity = 0.96;
      this.renderer.toneMappingExposure = 1.1;
    } else {
      const horizon = new THREE.Color(0x1e1b4b);
      const mid = new THREE.Color(0x0f172a);
      const top = new THREE.Color(0x030712);
      this.skyMat.uniforms.uHorizonColor.value.copy(horizon);
      this.skyMat.uniforms.uMidColor.value.copy(mid);
      this.skyMat.uniforms.uTopColor.value.copy(top);
      this.skyMat.uniforms.uSunDir.value.set(-0.55, 0.65, -0.45).normalize();
      this.skyMat.uniforms.uSunColor.value.set(0xc7d2fe);
      this.skyMat.uniforms.uSunStrength.value = 0.35;
      this.scene.background = horizon;
      this.scene.fog = new THREE.FogExp2(horizon.getHex(), fogDensity * 1.1);
      this.sunLight.color.set(0x93c5fd);
      this.sunLight.intensity = 0.95;
      this.sunLight.position.set(-70, 90, -50);
      this.rimLight.color.set(0x818cf8);
      this.rimLight.intensity = 0.42;
      this.hemiLight.color.set(0x1e3a8a);
      this.hemiLight.groundColor.set(0x0f172a);
      this.hemiLight.intensity = 0.62;
      this.renderer.toneMappingExposure = 1.02;
    }

    if (settings.gameplayMods.noPolice && this.wantedStars > 0) {
      this.clearPolicePursuit();
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
      b.group.visible = !this.activeMission && unlocked;
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

    this.npcs = this.npcs.filter((n) => {
      if (n.kind === 'police') {
        this.scene.remove(n.rig.root);
        return false;
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

  public repairAndRepaintVehicle(colorHex?: string): boolean {
    const target = this.currentVehicle || this.lastLandVehicle;
    if (!target || target.destroyed) return false;
    target.health = target.kind === 'plane' || target.kind === 'boat' || target.kind === 'firetruck' ? 280 : 180;
    if (colorHex && target.rig.paintMat) {
      target.rig.paintMat.color.set(colorHex);
    }
    this.stuntMessage = `Servis: ${target.name} opravený a prelakovaný!`;
    this.stuntTimer = 3.0;
    this.audio.playUiChime('mission');
    return true;
  }

  public startMission(missionId: string) {
    const def = MISSIONS.find((m) => m.id === missionId);
    if (!def) return;
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
        const dist = 5 + (i % 3) * 3.5;
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
      const completedId = this.activeMission.id;
      const reward = this.activeMission.rewardCash;
      this.cash += reward;
      this.callbacks.onCashChange(this.cash);
      this.callbacks.onMissionComplete(
        completedId,
        Math.round(this.missionElapsedSec),
        reward
      );
      this.missionNotification = {
        title: `Misia splnená: ${this.activeMission.title}`,
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

    // Keep sun shadow frustum centered near player
    const px = this.playerRig.root.position.x;
    const pz = this.playerRig.root.position.z;
    this.sunLight.target.position.set(px, 0, pz);
    this.sunLight.position.set(px + 65, 85, pz + 45);

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

  private stepSimulation(dt: number, inp: ReturnType<InputManager['poll']>) {
    const activeChar = this.characters[this.activeCharId];

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
        this.camYaw = HOSPITAL_RESPAWN.heading;
        activeChar.posX = HOSPITAL_RESPAWN.x;
        activeChar.posY = 0;
        activeChar.posZ = HOSPITAL_RESPAWN.z;
        activeChar.heading = HOSPITAL_RESPAWN.heading;
        this.stuntMessage = wasDrowned
          ? 'Zachránený pobrežnou strážou pred nemocnicou (-$350)'
          : 'Prepustený z nemocnice Vice Central (-$350)';
        this.stuntTimer = 3.2;
        this.callbacks.onCashChange(this.cash);
        this.callbacks.onCharactersChange(structuredClone(this.characters), this.activeCharId);
      }
      this.pushTelemetry(inp, null);
      return;
    }

    // Look angles
    this.camYaw -= inp.lookDeltaX;
    this.camPitch = THREE.MathUtils.clamp(this.camPitch + inp.lookDeltaY, -0.55, 0.85);

    // Timers
    if (this.fireCooldown > 0) this.fireCooldown -= dt;
    if (this.hitMarkerTimer > 0) this.hitMarkerTimer -= dt;
    if (this.damageFlashTimer > 0) this.damageFlashTimer -= dt;
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

    // Animate shop rings & unlocked story beacons
    for (const sr of this.shopRings) {
      sr.rotation.z += dt * 1.4;
    }
    for (const mb of this.missionStartBeacons) {
      if (mb.group.visible) {
        mb.group.children[1].rotation.y += dt * 2.0;
      }
    }

    const px = this.playerRig.root.position.x;
    const pz = this.playerRig.root.position.z;

    // Auto-clear custom GPS waypoint when player arrives
    if (!this.activeMission && this.gpsWaypoint) {
      if (Math.hypot(px - this.gpsWaypoint.x, pz - this.gpsWaypoint.z) < 8) {
        this.stuntMessage = `Cieľ GPS dosiahnutý: ${this.gpsWaypoint.label}`;
        this.stuntTimer = 2.8;
        this.clearGpsWaypoint();
      }
    }

    // Find nearby vehicle, enterable shop, or unlocked story mission marker
    let nearbyVehicle: VehicleEntity | null = null;
    let bestVehDist = 5.0;
    if (!this.currentVehicle) {
      for (const v of this.vehicles) {
        if (v.destroyed) continue;
        // Allow grabbing any stopped or slow-moving vehicle (including stopped traffic!)
        if (Math.abs(v.speed) > 12) continue;
        const maxR = v.kind === 'plane' || v.kind === 'boat' ? 6.2 : 4.8;
        const d = Math.hypot(v.x - px, v.z - pz);
        if (d < maxR && d < bestVehDist) {
          bestVehDist = d;
          nearbyVehicle = v;
        }
      }
    }

    let nearbyShop: ShopDef | null = null;
    let bestShopDist = 4.8;
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
    if (!this.activeMission && !this.currentVehicle) {
      for (const b of this.missionStartBeacons) {
        if (!b.group.visible) continue;
        if (Math.hypot(b.mission.startX - px, b.mission.startZ - pz) < 4.5) {
          nearbyMission = b.mission;
          break;
        }
      }
    }

    // Interact / Enter / Carjack / Exit Vehicle
    if (inp.enterVehiclePressed) {
      if (this.currentVehicle) {
        if (nearbyShop?.category === 'garage') {
          this.callbacks.onShopInteract(nearbyShop);
        } else {
          this.exitCurrentVehicle();
        }
      } else if (nearbyShop && (!nearbyVehicle || bestShopDist <= bestVehDist)) {
        this.callbacks.onShopInteract(nearbyShop);
      } else if (nearbyVehicle) {
        this.enterVehicle(nearbyVehicle);
      } else if (nearbyMission) {
        this.startMission(nearbyMission.id);
      }
    }

    // Movement: On Foot vs Driving / Flying / Boating
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

    // Shooting (allowed on foot & drive-by!)
    if (inp.reloadPressed && this.reloadTimer <= 0) {
      this.startReload();
    }
    if (inp.shootHeld && this.fireCooldown <= 0 && this.reloadTimer <= 0) {
      this.fireEquippedWeapon();
    }

    // Step Vehicles (Autonomous Curved Traffic & Police Cars)
    this.stepOtherVehicles(dt, inp);

    // Step NPCs (Civilians, Cops, Syndicate Enemies)
    this.stepNpcs(dt);

    // Maintain lively ambient city crowd around player across 5x Island (60+ FPS streaming!)
    this.crowdMaintainTimer += dt;
    if (this.crowdMaintainTimer >= 2.5) {
      this.crowdMaintainTimer = 0;
      const curPx = this.playerRig.root.position.x;
      const curPz = this.playerRig.root.position.z;
      this.npcs = this.npcs.filter((n) => {
        if (!n.alive) return false;
        if (n.kind === 'civilian' && Math.hypot(n.x - curPx, n.z - curPz) > 175) {
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

    // Step Explosive Barrels, Rockets, Tracers, Particles
    this.stepWorldDynamics(dt);

    // Step Mission Objectives
    this.stepMission(dt);

    // Update Camera smoothly (with spatial-grid wall anti-clipping)
    this.updateActiveCamera(dt, inp.aimHeld);

    // Update Audio Engine (including realistic tire screech during drift!)
    const speedKmh = this.currentVehicle ? Math.abs(this.currentVehicle.speed) * 3.6 : 0;
    this.audio.updateContinuous(
      Boolean(this.currentVehicle),
      speedKmh,
      this.wantedStars,
      this.elapsedSec,
      this.currentDriftIntensity
    );

    // Sync active character coordinates
    activeChar.posX = this.playerRig.root.position.x;
    activeChar.posY = this.playerRig.root.position.y;
    activeChar.posZ = this.playerRig.root.position.z;
    activeChar.heading = this.camYaw;

    // Push Telemetry to React HUD (~25Hz)
    this.telemetryTimer += dt;
    if (this.telemetryTimer >= 0.04) {
      this.telemetryTimer = 0;
      let prompt: string | null = null;
      if (this.currentVehicle && nearbyShop?.category === 'garage') {
        prompt = `Vstúpiť do servisu ${nearbyShop.name}`;
      } else if (!this.currentVehicle) {
        if (nearbyShop && (!nearbyVehicle || bestShopDist <= bestVehDist)) {
          prompt = `Vstúpiť: ${nearbyShop.name}`;
        } else if (nearbyVehicle) {
          const isEmerg =
            nearbyVehicle.kind === 'police' ||
            nearbyVehicle.kind === 'ambulance' ||
            nearbyVehicle.kind === 'firetruck';
          const emergTag = isEmerg ? ' (! Zásah polície)' : '';
          if (nearbyVehicle.hasDriver) {
            prompt = `Vyhodiť vodiča a ukradnúť ${nearbyVehicle.name}${emergTag}`;
          } else {
            const verb =
              nearbyVehicle.kind === 'plane'
                ? 'Nastúpiť do lietadla'
                : nearbyVehicle.kind === 'boat'
                  ? 'Nastúpiť na loď'
                  : nearbyVehicle.kind === 'motorcycle'
                    ? 'Nasadať na motorku'
                    : 'Nastúpiť do';
            prompt = `${verb} ${nearbyVehicle.name}${emergTag}`;
          }
        } else if (nearbyMission) {
          prompt = `Spustiť príbeh: ${nearbyMission.title}`;
        }
      }
      this.pushTelemetry(inp, prompt);
    }
  }

  private stepPlayerOnFoot(dt: number, inp: ReturnType<InputManager['poll']>) {
    const ch = this.characters[this.activeCharId];
    const hasSpeed = Math.abs(inp.moveX) > 0.05 || Math.abs(inp.moveY) > 0.05;
    const isSprinting = inp.sprint && hasSpeed && this.playerStamina > 4 && !inp.aimHeld;
    this.isPlayerSprinting = isSprinting;

    if (isSprinting) {
      this.playerStamina = Math.max(0, this.playerStamina - 22 * dt);
    } else {
      const regen = this.activeCharId === 'kairo' ? 28 : 18;
      this.playerStamina = Math.min(100, this.playerStamina + regen * dt);
    }

    const curInWater = isWaterAt(this.playerRig.root.position.x, this.playerRig.root.position.z) &&
      this.playerRig.root.position.y < 0.1;
    const moveSpeed = curInWater
      ? isSprinting
        ? 6.4
        : 4.3
      : inp.aimHeld
        ? 4.2
        : isSprinting
          ? 10.2
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
    const accelFactor = this.playerGrounded ? 14 : 5;
    this.playerVelX = THREE.MathUtils.damp(this.playerVelX, dirX * moveSpeed, accelFactor, dt);
    this.playerVelZ = THREE.MathUtils.damp(this.playerVelZ, dirZ * moveSpeed, accelFactor, dt);

    // Jump, Parachute glide & Gravity
    const grav = this.settings.gameplayMods.lowGravity ? -9.8 : -24.0;
    if (inp.jumpPressed && this.playerGrounded && !curInWater) {
      this.playerVelY = this.settings.gameplayMods.lowGravity ? 10.5 : 8.2;
      this.playerGrounded = false;
    }
    this.playerVelY += grav * dt;
    if (!this.playerGrounded && this.playerRig.root.position.y > 4) {
      this.playerVelY = Math.max(-5.5, this.playerVelY); // gentle skydiving descent if bailed from plane
    }

    let nx = this.playerRig.root.position.x + this.playerVelX * dt;
    let ny = this.playerRig.root.position.y + this.playerVelY * dt;
    let nz = this.playerRig.root.position.z + this.playerVelZ * dt;

    // Invisible Deep-Ocean Boundary (No visible wall — crossing causes drowning & Hospital respawn!)
    if (isOutOfBoundsSeaAt(nx, nz)) {
      this.triggerDeepOceanDeath();
      return;
    }

    // Watertight Building, Circle Prop & Vehicle Collision Sliding
    const resolved = this.resolveBuildingCollision(nx, nz, 0.45, Math.max(0, ny), false);
    nx = resolved.x;
    nz = resolved.z;

    const groundH = this.getGroundHeightAt(nx, nz);
    const waterHere = isWaterAt(nx, nz) && groundH <= 0.05;
    const floorY = waterHere ? -0.82 : groundH;
    if (ny <= floorY) {
      ny = floorY;
      this.playerVelY = 0;
      this.playerGrounded = true;
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

    // Procedural limb walk / swim / aim animation
    const horizSpeed = Math.hypot(this.playerVelX, this.playerVelZ);
    const swing = horizSpeed > 0.3 ? Math.sin(this.elapsedSec * (isSprinting ? 13 : 8.5)) * 0.65 : 0;
    if (waterHere && ny < -0.3) {
      const stroke = Math.sin(this.elapsedSec * 5.5) * 0.85;
      this.playerRig.leftArmPivot.rotation.x = -Math.PI / 2 + stroke;
      this.playerRig.rightArmPivot.rotation.x = -Math.PI / 2 - stroke;
      this.playerRig.leftLegPivot.rotation.x = stroke * 0.4;
      this.playerRig.rightLegPivot.rotation.x = -stroke * 0.4;
    } else {
      this.playerRig.leftLegPivot.rotation.x = swing;
      this.playerRig.rightLegPivot.rotation.x = -swing;
      this.playerRig.leftArmPivot.rotation.x = -swing * 0.7;

      if (inp.aimHeld || this.muzzleFlashTimer > 0) {
        this.playerRig.rightArmPivot.rotation.x = -Math.PI / 2 + this.camPitch * 0.7;
      } else {
        this.playerRig.rightArmPivot.rotation.x = swing * 0.7;
      }
    }

    // Hide character body in 1st person so camera never clips inside head
    const isFp = this.cameraMode === 'first_person';
    this.playerRig.headGroup.visible = !isFp;
    this.playerRig.torsoGroup.visible = !isFp;
    this.playerRig.leftLegPivot.visible = !isFp;
    this.playerRig.rightLegPivot.visible = !isFp;
    this.firstPersonWeaponGroup.visible = isFp && !this.currentVehicle;

    // Gentle weapon sway in 1P
    if (isFp) {
      this.firstPersonWeaponGroup.position.x = (inp.aimHeld ? 0.0 : 0.24) + Math.sin(this.elapsedSec * 7) * horizSpeed * 0.002;
      this.firstPersonWeaponGroup.position.y = (inp.aimHeld ? -0.15 : -0.22) + Math.abs(Math.cos(this.elapsedSec * 7)) * horizSpeed * 0.002;
    }

    ch.district = getDistrictName(nx, nz);
  }

  private enterVehicle(v: VehicleEntity) {
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
    if (v.kind !== 'boat' && v.kind !== 'plane') {
      this.lastLandVehicle = v;
    }
    v.occupiedByPlayer = true;
    v.isTraffic = false;
    // Keep player visible seated on motorcycles & speedboats!
    const riderVisible = v.kind === 'motorcycle' || v.kind === 'boat';
    this.playerRig.root.visible = riderVisible;
    this.firstPersonWeaponGroup.visible = false;
    this.audio.playUiChime('click');

    // Entering Police Car, Ambulance or Firetruck is strictly punished with police pursuit!
    const isEmergencyVehicle = v.kind === 'police' || v.kind === 'ambulance' || v.kind === 'firetruck';
    if (isEmergencyVehicle && !this.settings.gameplayMods.noPolice) {
      this.addCrimeHeat(42);
      this.stuntMessage = `Krádež zásahového vozidla (${v.name})! Polícia zahájila prenasledovanie!`;
      this.stuntTimer = 3.5;
    }
  }

  private exitCurrentVehicle() {
    if (!this.currentVehicle) return;
    const v = this.currentVehicle;
    v.occupiedByPlayer = false;
    const sideOffset = v.kind === 'plane' ? 4.8 : v.kind === 'boat' ? 2.6 : 2.2;
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
    this.playerGrounded = v.y <= 0.5;
    this.currentVehicle = null;
  }

  private stepPlayerDriving(dt: number, inp: ReturnType<InputManager['poll']>, v: VehicleEntity) {
    const ch = this.characters[this.activeCharId];
    const luciaBonus = this.activeCharId === 'lucia' ? 1.15 : 1.0;
    const turbo = this.settings.gameplayMods.turboVehicles ? 1.55 : 1.0;

    const maxSpd = v.maxSpeed * luciaBonus * turbo;
    const accel = v.accel * luciaBonus * turbo;

    // 1. AIRCRAFT 3D FLIGHT PHYSICS
    if (v.kind === 'plane') {
      if (inp.throttle > 0.05) {
        v.speed += accel * inp.throttle * dt;
      } else {
        v.speed *= Math.exp(-0.22 * dt);
      }
      if (inp.brake > 0.05) {
        v.speed -= accel * 0.95 * inp.brake * dt;
      }
      v.speed = THREE.MathUtils.clamp(v.speed, -6, maxSpd);

      const groundH = isWaterAt(v.x, v.z) ? -0.35 : this.getGroundHeightAt(v.x, v.z);
      const isAirborne = v.y > groundH + 0.35;

      // Spin propeller
      if (v.rig.propeller) {
        v.rig.propeller.rotation.z += (8 + Math.abs(v.speed) * 1.15) * dt;
      }

      // Climb (Space/X) & Dive (Shift/Circle)
      if (v.speed >= 18 && inp.jumpHeld) {
        v.pitch = THREE.MathUtils.clamp(v.pitch + 0.72 * dt, -0.45, 0.48);
      } else if (isAirborne && inp.sprint) {
        v.pitch = THREE.MathUtils.clamp(v.pitch - 0.72 * dt, -0.45, 0.48);
      } else {
        v.pitch = THREE.MathUtils.damp(v.pitch, isAirborne ? 0.01 : 0, 3.5, dt);
      }

      const targetRoll = -inp.moveX * (isAirborne ? 0.58 : 0.08);
      v.roll = THREE.MathUtils.damp(v.roll, targetRoll, 6, dt);

      const turnFactor = isAirborne ? 1.35 : Math.min(1, Math.abs(v.speed) / 10) * 1.1;
      v.heading -= inp.moveX * turnFactor * dt;

      const cosP = Math.cos(v.pitch);
      v.vx = Math.sin(v.heading) * v.speed * cosP;
      v.vz = Math.cos(v.heading) * v.speed * cosP;

      if (v.speed >= 18 && (v.pitch > 0.04 || isAirborne)) {
        v.vy = Math.sin(v.pitch) * Math.max(v.speed, 22) - (v.speed < 20 ? 3.5 : 0.25);
      } else {
        v.vy += -18 * dt;
      }

      let nx = v.x + v.vx * dt;
      let ny = THREE.MathUtils.clamp(v.y + v.vy * dt, groundH, 165);
      let nz = v.z + v.vz * dt;

      if (isOutOfBoundsSeaAt(nx, nz)) {
        this.triggerDeepOceanDeath();
        return;
      }

      if (ny <= groundH) {
        ny = groundH;
        v.vy = 0;
        if (v.pitch < 0) v.pitch = 0;
      }

      if (ny < 62) {
        const planeCol = this.resolveBuildingCollision(nx, nz, 2.5, Math.max(0, ny), true, v);
        if (planeCol.collided) {
          nx = planeCol.x;
          nz = planeCol.z;
          v.speed *= 0.6;
          this.audio.playImpact(0.65);
          this.input.triggerVibration(180, 0.55, 0.65);
        }
      }

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
      ch.district = v.y > 14 ? 'Vzdušný priestor Leonida' : getDistrictName(v.x, v.z);
      return;
    }

    // 2. WATER SPEEDBOAT PHYSICS (Open Sea around Entire 5x Island)
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

    // 3. CARS & MOTORCYCLES GROUND / BRIDGE / DRIFT ("ŠMYK") PHYSICS
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

    const handbrake = inp.jumpHeld;
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

    // Authentic Drift Physics: Handbrake or high-speed sharp turns reduce rear lateral grip so tail kicks out smoothly!
    const highSpeedCorner = Math.abs(vForward) > 16 && Math.abs(v.steerAngle) > 0.34;
    const lateralGrip = handbrake
      ? 1.55
      : highSpeedCorner
        ? 4.4
        : v.kind === 'motorcycle'
          ? 11.2
          : 8.6;
    vLateral *= Math.exp(-lateralGrip * dt);

    const newFwdX = Math.sin(v.heading);
    const newFwdZ = Math.cos(v.heading);
    const newRightX = Math.cos(v.heading);
    const newRightZ = -Math.sin(v.heading);

    v.vx = newFwdX * vForward + newRightX * vLateral;
    v.vz = newFwdZ * vForward + newRightZ * vLateral;
    v.speed = vForward;

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
      if (col.hitX) v.vx *= -0.35;
      if (col.hitZ) v.vz *= -0.35;
      nx = col.x;
      nz = col.z;
    }

    const waterUnder = isWaterAt(nx, nz);
    const groundH = waterUnder ? -0.45 : this.getGroundHeightAt(nx, nz);
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

    // Suspension roll, pitch & drift visual feedback (skid marks + tire smoke + audio screech!)
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

      if (v.isPolice && this.wantedStars > 0 && !this.settings.gameplayMods.noPolice) {
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
        v.vx = Math.sin(v.heading) * v.speed;
        v.vz = Math.cos(v.heading) * v.speed;

        const nx = v.x + v.vx * dt;
        const nz = v.z + v.vz * dt;
        if (!isWaterAt(nx, nz) || isBridgeAt(nx, nz)) {
          const col = this.resolveBuildingCollision(nx, nz, 1.5, Math.max(0, v.y), true, v);
          v.x = col.x;
          v.z = col.z;
        }
        v.y = getBridgeElevationAt(v.x, v.z);
        v.rig.root.position.set(v.x, v.y, v.z);
        v.rig.root.rotation.y = v.heading;
        v.wheelSpin += (v.speed / 0.36) * dt;
        v.rig.wheels.forEach((w) => (w.rotation.x = v.wheelSpin));
        v.rig.frontSteerPivots.forEach((p) => (p.rotation.y = v.steerAngle * 0.8));
      } else if (v.isTraffic) {
        activeTrafficCount += 1;
        v.rig.root.visible = activeTrafficCount <= trafficCap;
        if (!v.rig.root.visible) continue;
        this.updateVehicleBeacon(v);

        if (v.kind === 'boat') {
          // Autonomous Boats Orbiting Around the 5x Island Coastline
          v.speed = THREE.MathUtils.damp(v.speed, 13.5, 2.5, dt);
          const orbitAng = Math.atan2(v.z, v.x) + 0.032 * dt;
          const targetR = 468;
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

        // Autonomous Curved-Path City & Highway Traffic
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
            if (other === v || other.destroyed || other.kind === 'boat' || other.kind === 'plane') continue;
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
        // Right-hand driving lane offset (+3.1m)
        const targetX = wp.x + -segZ * 3.1;
        const targetZ = wp.z + segX * 3.1;

        if (Math.hypot(targetX - v.x, targetZ - v.z) < 8.5) {
          v.waypointIndex = (v.waypointIndex + 1) % path.length;
        }

        const desiredHeading = Math.atan2(targetX - v.x, targetZ - v.z);
        let hDiff = desiredHeading - v.heading;
        while (hDiff > Math.PI) hDiff -= Math.PI * 2;
        while (hDiff < -Math.PI) hDiff += Math.PI * 2;
        v.steerAngle = THREE.MathUtils.damp(v.steerAngle, THREE.MathUtils.clamp(hDiff * 1.4, -0.5, 0.5), 8, dt);
        v.heading += THREE.MathUtils.clamp(hDiff, -2.4 * dt, 2.4 * dt);

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
        const col = this.resolveBuildingCollision(nx, nz, v.kind === 'motorcycle' ? 0.85 : 1.4, Math.max(0, v.y), true, v);
        v.x = col.x;
        v.z = col.z;

        v.vx = Math.sin(v.heading) * v.speed;
        v.vz = Math.cos(v.heading) * v.speed;
        v.y = getBridgeElevationAt(v.x, v.z);
        v.rig.root.position.set(v.x, v.y, v.z);
        v.rig.root.rotation.y = v.heading;
        v.wheelSpin += (v.speed / 0.36) * dt;
        v.rig.wheels.forEach((w) => (w.rotation.x = v.wheelSpin));
        v.rig.frontSteerPivots.forEach((p) => (p.rotation.y = v.steerAngle * 0.8));
      }

      // Vehicle-to-Player-Car elastic bump collision
      if (this.currentVehicle) {
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
      const dist = Math.hypot(dx, dz);

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
          if (npc.panicTimer <= 0 && npc.behavior === 'flee') {
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
              const swing = Math.sin(this.elapsedSec * 9) * 0.55;
              npc.rig.leftLegPivot.rotation.x = swing;
              npc.rig.rightLegPivot.rotation.x = -swing;
            } else {
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
            const swing = Math.sin(this.elapsedSec * 11) * 0.6;
            npc.rig.leftLegPivot.rotation.x = swing;
            npc.rig.rightLegPivot.rotation.x = -swing;
            npc.rig.rightArmPivot.rotation.x = -Math.PI / 2.6 + swing;
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
          const swing = Math.sin(this.elapsedSec * 14) * 0.7;
          npc.rig.leftLegPivot.rotation.x = swing;
          npc.rig.rightLegPivot.rotation.x = -swing;
          npc.rig.leftArmPivot.rotation.x = -swing * 0.85;
          npc.rig.rightArmPivot.rotation.x = swing * 0.85;
        } else if (npc.activity === 'chat' && npc.chatTargetX !== undefined && npc.chatTargetZ !== undefined) {
          // Conversing pedestrians stand facing partner with subtle lifelike gestures
          npc.heading = Math.atan2(npc.chatTargetX - npc.x, npc.chatTargetZ - npc.z);
          npc.rig.leftLegPivot.rotation.x = 0;
          npc.rig.rightLegPivot.rotation.x = 0;
          const phase = (npc.id.charCodeAt(4) || 1) * 0.7;
          const gesture = Math.sin(this.elapsedSec * 2.6 + phase) * 0.22;
          npc.rig.leftArmPivot.rotation.x = -0.25 + gesture;
          npc.rig.rightArmPivot.rotation.x = -0.35 - gesture;
        } else if (npc.activity === 'chill') {
          // Relaxed coastal/plaza idle stance
          npc.rig.leftLegPivot.rotation.x = 0;
          npc.rig.rightLegPivot.rotation.x = 0;
          npc.rig.leftArmPivot.rotation.x = Math.sin(this.elapsedSec * 1.3 + npc.x) * 0.06;
          npc.rig.rightArmPivot.rotation.x = -Math.sin(this.elapsedSec * 1.3 + npc.z) * 0.06;
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
          const swing = Math.sin(this.elapsedSec * 4.5) * 0.42;
          npc.rig.leftLegPivot.rotation.x = swing;
          npc.rig.rightLegPivot.rotation.x = -swing;
          npc.rig.leftArmPivot.rotation.x = -swing * 0.5;
          npc.rig.rightArmPivot.rotation.x = swing * 0.5;
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
            const swing = Math.sin(this.elapsedSec * 9) * 0.55;
            npc.rig.leftLegPivot.rotation.x = swing;
            npc.rig.rightLegPivot.rotation.x = -swing;
          } else {
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

  private enemyFireAtPlayer(npc: NpcEntity, dist: number) {
    this.audio.playGunshot(npc.weaponId || 'pistol');
    const origin = _rayOrigin.set(npc.x, 1.45, npc.z);
    const target = _rayDir.set(
      this.playerRig.root.position.x + (Math.random() - 0.5) * 1.4,
      1.2,
      this.playerRig.root.position.z + (Math.random() - 0.5) * 1.4
    );
    this.spawnTracer(origin, target, 0xef4444);

    // Hit chance scales with distance & cover
    const hitChance = Math.max(0.15, 0.55 - dist * 0.012);
    if (Math.random() < hitChance) {
      this.damagePlayer(npc.kind === 'police' ? 8 : npc.kind === 'civilian' ? 7 : 10);
    }
  }

  private damagePlayer(amount: number) {
    if (this.wastedTimer > 0 || this.bustedTimer > 0) return;
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

  private fireEquippedWeapon() {
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

    // Subtle recoil pitch kick
    this.camPitch = THREE.MathUtils.clamp(this.camPitch - (def.id === 'shotgun' ? 0.032 : 0.011), -0.55, 0.85);

    // Firing into the air scatters nearby crowd, without spawning random police!
    this.alertNearbyCrowd(this.playerRig.root.position.x, this.playerRig.root.position.z, 26, true);

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

    // Aim ray from camera center
    const mateoSpreadMult = this.activeCharId === 'mateo' ? 0.78 : 1.0;
    const spread = def.spread * mateoSpreadMult;

    // Rocket Launcher fires a 3D explosive projectile!
    if (def.id === 'rpg') {
      _rayDir.set(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
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
      _rayDir.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
      _rayDir.x += (Math.random() - 0.5) * spread;
      _rayDir.y += (Math.random() - 0.5) * spread;
      _rayDir.z += (Math.random() - 0.5) * spread;
      _rayDir.normalize();

      const rayOrigin = this.camera.position;
      let bestDist = def.range;
      let hitPoint = _v2.copy(rayOrigin).addScaledVector(_rayDir, bestDist);
      let hitNpc: NpcEntity | null = null;
      let hitBarrel: ExplosiveBarrelEntity | null = null;
      let hitVehicle: VehicleEntity | null = null;

      // 1. Check NPCs
      for (const npc of this.npcs) {
        if (!npc.alive) continue;
        _v3.set(npc.x, 1.05, npc.z);
        const t = _v3.clone().sub(rayOrigin).dot(_rayDir);
        if (t > 1 && t < bestDist) {
          const closest = _rayOrigin.copy(rayOrigin).addScaledVector(_rayDir, t);
          if (closest.distanceTo(_v3) < 0.78) {
            bestDist = t;
            hitPoint.copy(closest);
            hitNpc = npc;
          }
        }
      }

      // 2. Check Explosive Barrels
      for (const b of this.barrels) {
        if (!b.alive) continue;
        _v3.set(b.x, 0.6, b.z);
        const t = _v3.clone().sub(rayOrigin).dot(_rayDir);
        if (t > 1 && t < bestDist) {
          const closest = _rayOrigin.copy(rayOrigin).addScaledVector(_rayDir, t);
          if (closest.distanceTo(_v3) < 0.72) {
            bestDist = t;
            hitPoint.copy(closest);
            hitBarrel = b;
            hitNpc = null;
          }
        }
      }

      // 3. Check Vehicles
      for (const veh of this.vehicles) {
        if (veh === this.currentVehicle || veh.destroyed) continue;
        _v3.set(veh.x, veh.y + 0.85, veh.z);
        const t = _v3.clone().sub(rayOrigin).dot(_rayDir);
        if (t > 1 && t < bestDist) {
          const closest = _rayOrigin.copy(rayOrigin).addScaledVector(_rayDir, t);
          if (closest.distanceTo(_v3) < 1.65) {
            bestDist = t;
            hitPoint.copy(closest);
            hitVehicle = veh;
            hitBarrel = null;
            hitNpc = null;
          }
        }
      }

      this.spawnTracer(muzzleWorld, hitPoint, 0xfef08a);

      if (hitNpc) {
        this.damageNpc(hitNpc, def.damage);
        this.hitMarkerTimer = 0.14;
        this.audio.playHitMarker();
        this.spawnParticleBurst(hitPoint, 0xef4444, 4);
      } else if (hitBarrel) {
        this.detonateBarrel(hitBarrel);
        this.hitMarkerTimer = 0.14;
      } else if (hitVehicle) {
        hitVehicle.health -= def.damage;
        this.spawnParticleBurst(hitPoint, 0xfbbf24, 5);
        this.hitMarkerTimer = 0.12;
        if (hitVehicle.isPolice && !this.settings.gameplayMods.noPolice) {
          this.addCrimeHeat(18);
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
    }
    if (npc.health <= 0 && npc.alive) {
      npc.alive = false;
      this.scene.remove(npc.rig.root);
      this.stats.totalEliminations += 1;
      const bounty = npc.kind === 'enemy' ? 220 : npc.kind === 'police' ? 150 : fromTackle ? 85 : 40;
      this.cash += bounty;
      this.callbacks.onCashChange(this.cash);
      this.callbacks.onStatsChange({ ...this.stats });

      // Dropped ammo when eliminating armed NPC or police officer
      if (npc.kind === 'police' || npc.hasWeapon) {
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

      // Police chase triggers ONLY upon killing someone (civilian or police), not randomly!
      if (!this.settings.gameplayMods.noPolice && (npc.kind === 'civilian' || npc.kind === 'police')) {
        this.addCrimeHeat(npc.kind === 'police' ? 48 : 32);
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
        const col = this.resolveBuildingCollision(r.x, r.z, 0.35);
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

    // Tracers (reuse pooled module-level _tracerGeo)
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.life -= dt;
      if (tr.life <= 0) {
        this.scene.remove(tr.mesh);
        (tr.mesh.material as THREE.Material).dispose();
        this.tracers.splice(i, 1);
      }
    }

    // Particles (reuse pooled module-level _particleGeo)
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.life -= dt;
      pt.mesh.position.x += pt.vx * dt;
      pt.mesh.position.y += pt.vy * dt;
      pt.mesh.position.z += pt.vz * dt;
      pt.vy -= 9.8 * dt;
      if (pt.growSpeed > 0) {
        pt.mesh.scale.addScalar(pt.growSpeed * dt);
      }
      (pt.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, pt.life / pt.maxLife);
      if (pt.life <= 0) {
        this.scene.remove(pt.mesh);
        (pt.mesh.material as THREE.Material).dispose();
        this.particles.splice(i, 1);
      }
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
    if (dist < 0.2) return;
    const mat = new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.85 });
    const mesh = new THREE.Mesh(_tracerGeo, mat);
    mesh.scale.set(1, 1, dist);
    mesh.position.copy(start).lerp(end, 0.5);
    mesh.lookAt(end);
    this.scene.add(mesh);
    this.tracers.push({ mesh, life: 0.065, maxLife: 0.065 });
  }

  private spawnParticleBurst(origin: THREE.Vector3, colorHex: number, count: number, isExplosion = false) {
    const baseScale = isExplosion ? 3.5 : 0.7;
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.95 });
      const mesh = new THREE.Mesh(_particleGeo, mat);
      mesh.scale.setScalar(baseScale);
      mesh.position.copy(origin);
      this.scene.add(mesh);
      const spd = isExplosion ? 6 + Math.random() * 10 : 2 + Math.random() * 4;
      const ang = Math.random() * Math.PI * 2;
      this.particles.push({
        mesh,
        vx: Math.cos(ang) * spd,
        vy: (isExplosion ? 4 : 2) + Math.random() * 5,
        vz: Math.sin(ang) * spd,
        life: isExplosion ? 0.55 : 0.28,
        maxLife: isExplosion ? 0.55 : 0.28,
        growSpeed: isExplosion ? 6.5 : 0,
      });
    }
  }

  private updateActiveCamera(dt: number, isAiming: boolean) {
    const px = this.playerRig.root.position.x;
    const py = this.playerRig.root.position.y;
    const pz = this.playerRig.root.position.z;

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

    if (this.switchSwoopTimer > 0) {
      // Dramatic high aerial swoop on character switch!
      _camGoal.set(px, py + 38, pz + 24);
      _lookGoal.set(px, py + 1.2, pz);
    } else if (this.cameraMode === 'first_person') {
      if (this.currentVehicle) {
        const v = this.currentVehicle;
        const fwdX = Math.sin(v.heading);
        const fwdZ = Math.cos(v.heading);
        const cockpitY = v.kind === 'plane' ? 1.82 : v.kind === 'boat' ? 1.55 : 1.38;
        _camGoal.set(v.x + fwdX * 0.45, v.y + cockpitY, v.z + fwdZ * 0.45);
        _lookGoal.set(
          _camGoal.x + Math.sin(this.camYaw) * 12,
          _camGoal.y - Math.sin(this.camPitch) * 8,
          _camGoal.z + Math.cos(this.camYaw) * 12
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
      const isPlane = this.currentVehicle?.kind === 'plane';
      const baseDist = isPlane
        ? isFar
          ? 17.5
          : 12.5
        : this.currentVehicle
          ? isFar
            ? 10.5
            : 6.8
          : isFar
            ? 7.2
            : isAiming
              ? 2.5
              : 4.1;
      const baseHeight = isPlane
        ? isFar
          ? 5.8
          : 4.0
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

    // 1. Solid AABB Colliders (Buildings, Shop Walls, Counters, Bridge Guardrails)
    for (const c of aabbs) {
      if (entityY > c.height + 0.15) continue;
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

  private getGroundHeightAt(x: number, z: number): number {
    let maxH = getBridgeElevationAt(x, z);
    // Marina wooden piers allow walking over harbor water (x: 204..284, z: 240 & z: 278)
    if (x >= 204 && x <= 284 && ((z >= 234.5 && z <= 245.5) || (z >= 272.5 && z <= 283.5))) {
      maxH = Math.max(maxH, 0.52);
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

    const blips: MinimapBlip[] = [];
    for (const shop of SHOPS) {
      blips.push({
        x: shop.x,
        z: shop.z,
        type: 'shop',
        label: shop.name,
        shopCategory: shop.category,
        color: shop.color,
      });
    }
    for (const mb of this.missionStartBeacons) {
      if (mb.group.visible) {
        blips.push({ x: mb.mission.startX, z: mb.mission.startZ, type: 'mission', label: mb.mission.title });
      }
    }
    for (const npc of this.npcs) {
      if (!npc.alive) continue;
      if (npc.kind === 'police') blips.push({ x: npc.x, z: npc.z, type: 'police' });
      else if (npc.kind === 'enemy') blips.push({ x: npc.x, z: npc.z, type: 'enemy' });
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

    // GPS Navigation Route along Curved Highways & City Roads
    let gpsTarget: GpsWaypoint | null = null;
    if (this.activeMission && stage && stage.type !== 'escape_police') {
      gpsTarget = { x: stage.targetX, z: stage.targetZ, label: stage.label };
    } else if (this.gpsWaypoint) {
      gpsTarget = this.gpsWaypoint;
    }

    const gpsRoute = gpsTarget ? computeGpsRoute(px, pz, gpsTarget.x, gpsTarget.z) : [];
    const gpsDistanceM = gpsTarget ? Math.round(Math.hypot(gpsTarget.x - px, gpsTarget.z - pz)) : 0;

    this.callbacks.onTelemetry({
      fps: this.currentFps,
      health: Math.round(ch.health),
      maxHealth: ch.maxHealth,
      armor: Math.round(ch.armor),
      maxArmor: ch.maxArmor,
      stamina: Math.round(this.playerStamina),
      cash: Math.round(this.cash),
      wantedStars: this.wantedStars,
      wantedEvading: this.wantedEvading,
      evasionProgress: Math.round(this.evasionProgress),
      inVehicle: Boolean(this.currentVehicle),
      vehicleKind: this.currentVehicle?.kind ?? null,
      vehicleBrand: this.currentVehicle?.brand || '',
      vehicleName: this.currentVehicle?.name || '',
      speedKmh: this.currentVehicle ? Math.round(Math.abs(this.currentVehicle.speed) * 3.6) : 0,
      altitudeM: Math.max(0, Math.round(this.currentVehicle ? this.currentVehicle.y : py)),
      inWater: isWaterAt(px, pz) && py < 0.2,
      handbrake: Boolean(this.currentVehicle && inp.jumpHeld),
      isDrifting: Boolean(this.currentVehicle?.isDrifting),
      equippedWeapon: this.inventory.equippedWeapon,
      ammoInClip: owned?.ammoInClip ?? 0,
      reserveAmmo: owned?.reserveAmmo ?? 0,
      isReloading: this.reloadTimer > 0,
      isAiming: inp.aimHeld,
      cameraMode: this.cameraMode,
      district: ch.district,
      nearbyPrompt,
      activeMissionTitle: this.activeMission?.title ?? null,
      activeObjectiveLabel: stage?.label ?? null,
      missionTimerRemaining:
        this.missionTimerRemaining !== null ? Math.max(0, Math.ceil(this.missionTimerRemaining)) : null,
      missionNotification: this.missionNotification,
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
