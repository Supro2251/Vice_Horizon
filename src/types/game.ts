export type CharacterId = 'lucia' | 'mateo' | 'kairo';

export type CameraMode = 'first_person' | 'third_person' | 'third_person_far';

export type WeaponId =
  | 'pistol'
  | 'smg'
  | 'shotgun'
  | 'carbine'
  | 'sniper'
  | 'minigun'
  | 'rpg';

export type VehicleKind =
  | 'sedan'
  | 'suv'
  | 'muscle'
  | 'coupe'
  | 'supercar'
  | 'taxi'
  | 'van'
  | 'police'
  | 'ambulance'
  | 'firetruck'
  | 'motorcycle'
  | 'boat'
  | 'plane'
  | 'helicopter'
  | 'fighter_jet';

export type EmergencyRole = 'police_heli' | 'rescue_heli' | 'fire_heli';

export type VehicleControlCategory =
  | 'foot'
  | 'car'
  | 'motorcycle'
  | 'boat'
  | 'plane'
  | 'fighter_jet'
  | 'helicopter';

export interface StickControlConfig {
  moveStick: 'left' | 'right';
  pitchInvert: boolean;
  yawSource: 'bumpers' | 'left_x' | 'right_x';
}

export interface VehicleUpgrades {
  engineLevel: 0 | 1 | 2 | 3;
  turbo: boolean;
  armorLevel: 0 | 1 | 2;
  suspensionLevel: 0 | 1 | 2;
}

export interface StoredVehicleRecord {
  id: string;
  brand: string;
  name: string;
  kind: VehicleKind;
  color: string;
  x: number;
  z: number;
  heading: number;
  upgrades?: VehicleUpgrades;
}

export interface SavedGarageState {
  hangarVehicles: StoredVehicleRecord[];
  safehouseVehicles: StoredVehicleRecord[];
}

export type ShopId =
  | 'ammu_nation'
  | 'boutique'
  | 'market_247'
  | 'safehouse'
  | 'customs_garage'
  | 'customs_east'
  | 'customs_north'
  | 'hospital'
  | 'police_station'
  | 'fire_station'
  | 'barbershop'
  | 'tattoo_parlor'
  | 'shooting_range'
  | 'malibu_lounge';

export interface ShopDef {
  id: ShopId;
  name: string;
  subtitle: string;
  category:
    | 'weapons'
    | 'wardrobe'
    | 'supplies'
    | 'safehouse'
    | 'garage'
    | 'hospital'
    | 'police_station'
    | 'fire_station'
    | 'barber'
    | 'tattoo'
    | 'shooting_range'
    | 'lounge';
  x: number;
  z: number;
  doorX: number;
  doorZ: number;
  color: string;
}

export type HairStyle = 'bun' | 'waves' | 'fade' | 'buzz' | 'ponytail' | 'pompadour';

export type FacialHairType = 'none' | 'stubble' | 'beard' | 'goatee';

export type GlassesType = 'none' | 'aviators' | 'wayfarer' | 'round' | 'visor';

export type TattooType = 'none' | 'sleeve' | 'tribal' | 'neon_dragon' | 'skull_chest';

export type AccessoryType = 'none' | 'cap' | 'gold_chain' | 'tactical_vest' | 'watch';

export type JacketStyle = 'bomber' | 'cuban' | 'tech' | 'suit' | 'tank';

export interface CharacterAppearance {
  skinTone: string;
  hairStyle: HairStyle;
  hairColor: string;
  facialHair: FacialHairType;
  glasses: GlassesType;
  tattoo: TattooType;
  jacketStyle: JacketStyle;
  jacketColor: string;
  shirtColor: string;
  pantsColor: string;
  shoesColor: string;
  accessory: AccessoryType;
}

export interface CustomOutfit {
  id: string;
  name: string;
  appearance: CharacterAppearance;
}

export interface CharacterSkills {
  driving: number; // 0..100
  shooting: number; // 0..100
  flying: number; // 0..100
  stamina: number; // 0..100
}

export interface CharacterState {
  id: CharacterId;
  name: string;
  role: string;
  perkLabel: string;
  weaknessLabel: string;
  portraitUrl: string;
  district: string;
  cash: number;
  health: number;
  maxHealth: number;
  armor: number;
  maxArmor: number;
  skills: CharacterSkills;
  posX: number;
  posY: number;
  posZ: number;
  heading: number;
  appearance: CharacterAppearance;
  customOutfits: CustomOutfit[];
}

export interface WeaponDef {
  id: WeaponId;
  name: string;
  category: string;
  damage: number;
  fireRateMs: number;
  clipSize: number;
  pellets: number;
  spread: number;
  range: number;
  price: number;
  description: string;
}

export interface OwnedWeapon {
  id: WeaponId;
  unlocked: boolean;
  ammoInClip: number;
  reserveAmmo: number;
  skinColor: string;
}

export interface ConsumableItem {
  id: string;
  name: string;
  description: string;
  effectType: 'heal' | 'armor' | 'stamina';
  amount: number;
  quantity: number;
  price: number;
}

export interface ContrabandItem {
  id: string;
  name: string;
  value: number;
  quantity: number;
}

export interface InventoryState {
  equippedWeapon: WeaponId;
  hasParachute: boolean;
  weapons: OwnedWeapon[];
  consumables: ConsumableItem[];
  contraband: ContrabandItem[];
}

export type GraphicsPreset = 'low' | 'balanced' | 'high' | 'ultra';

export interface GraphicsSettings {
  preset: GraphicsPreset;
  renderScale: number;
  shadowQuality: 'off' | 'low' | 'medium' | 'high';
  trafficDensity: 'low' | 'medium' | 'high';
  viewDistance: number;
  fov: number;
  envReflections: boolean;
  showFps: boolean;
}

export type RadioStationId =
  | 'off'
  | 'vice_synth'
  | 'leonida_hiphop'
  | 'coral_rock'
  | 'havana_latin'
  | 'horizon_techno'
  | 'midnight_jazz';

export interface AudioSettings {
  muted: boolean;
  master: number;
  music: number;
  sfx: number;
  engine: number;
  siren: number;
  ui: number;
}

export type KeyAction =
  | 'moveForward'
  | 'moveBackward'
  | 'moveLeft'
  | 'moveRight'
  | 'sprint'
  | 'jump'
  | 'shoot'
  | 'aim'
  | 'reload'
  | 'enterVehicle'
  | 'switchCamera'
  | 'characterWheel'
  | 'inventory'
  | 'wardrobe'
  | 'missions'
  | 'openMap'
  | 'horn'
  | 'toggleDock'
  | 'phone';

export type GamepadButtonAction =
  | 'shoot'
  | 'aim'
  | 'jump'
  | 'reload'
  | 'enterVehicle'
  | 'sprint'
  | 'switchCamera'
  | 'inventory'
  | 'characterWheel'
  | 'openMap'
  | 'pause'
  | 'toggleDock'
  | 'phone';

export interface VehicleControlProfile {
  keyBindings: Partial<Record<KeyAction, string>>;
  gamepadBindings: Partial<Record<GamepadButtonAction, number>>;
  stickConfig?: Partial<StickControlConfig>;
}

export interface ControlSettings {
  keyBindings: Record<KeyAction, string>;
  gamepadBindings: Record<GamepadButtonAction, number>;
  vehicleOverrides?: Partial<Record<VehicleControlCategory, VehicleControlProfile>>;
  mouseSensitivity: number;
  gamepadSensitivity: number;
  deadzone: number;
  invertY: boolean;
  vibration: boolean;
  glyphMode: 'auto' | 'playstation' | 'xbox' | 'keyboard';
}

export type HudThemeId = 'vice_sunset' | 'neon_noir' | 'tactical_minimal' | 'retro_80s';

export interface HudModSettings {
  theme: HudThemeId;
  accentColor: string;
  showMinimap: boolean;
  showSpeedometer: boolean;
  showMissionTracker: boolean;
  showControlsHint: boolean;
  crosshairStyle: 'tactical' | 'dot' | 'circle';
  hudScale: number;
  hudOpacity: number;
}

export type WeatherType =
  | 'clear'
  | 'partly_cloudy'
  | 'overcast'
  | 'rain'
  | 'storm'
  | 'foggy';

export interface GameplayModSettings {
  lowGravity: boolean;
  infiniteAmmo: boolean;
  rapidFire: boolean;
  turboVehicles: boolean;
  noPolice: boolean;
  timeOfDay: 'auto' | 'sunset' | 'noon' | 'night';
  weatherOverride?: 'auto' | WeatherType;
}

export type LanguageCode =
  | 'en'
  | 'sk'
  | 'cs'
  | 'nb'
  | 'en-AU'
  | 'zh'
  | 'ja'
  | 'ko'
  | 'ar'
  | 'ru';

export interface GameSettings {
  language: LanguageCode;
  graphics: GraphicsSettings;
  audio: AudioSettings;
  controls: ControlSettings;
  hudMod: HudModSettings;
  gameplayMods: GameplayModSettings;
}

export interface MissionStage {
  id: string;
  type: 'goto' | 'eliminate' | 'collect' | 'escape_police';
  label: string;
  targetX: number;
  targetZ: number;
  radius: number;
  enemyCount?: number;
  vehicleRequired?: boolean;
}

export interface MissionCutsceneLine {
  speaker: string;
  text: string;
  cameraFocus: 'player' | 'target' | 'panoramic';
}

export interface MissionDef {
  id: string;
  storyOrder: number;
  title: string;
  subtitle: string;
  giver: string;
  rewardCash: number;
  startX: number;
  startZ: number;
  wantedOnStart?: number;
  timeLimitSec?: number;
  difficulty?: 'Ľahká' | 'Stredná' | 'Ťažká' | 'Extrémna';
  estimatedMinutes?: string;
  isSideDiscovery?: boolean;
  alwaysUnlocked?: boolean;
  requiresGslCourier?: boolean;
  cutsceneIntro?: MissionCutsceneLine[];
  cutsceneOutro?: MissionCutsceneLine[];
  stages: MissionStage[];
}

export interface MissionProgressRecord {
  id: string;
  status: 'available' | 'active' | 'completed';
  completedCount: number;
  bestTimeSec: number;
}

export interface GpsPoint {
  x: number;
  z: number;
}

export interface GpsWaypoint {
  x: number;
  z: number;
  label: string;
}

export interface MinimapBlip {
  x: number;
  z: number;
  type:
    | 'police'
    | 'enemy'
    | 'vehicle'
    | 'taxi'
    | 'boat'
    | 'plane'
    | 'helicopter'
    | 'fighter_jet'
    | 'motorcycle'
    | 'mission'
    | 'side_mission'
    | 'shop'
    | 'parking'
    | 'shooting_range'
    | 'pickup'
    | 'passenger'
    | 'friend'
    | 'player';
  heading?: number;
  label?: string;
  shopCategory?: ShopDef['category'];
  color?: string;
}

export interface ActiveCutsceneState {
  title: string;
  speaker: string;
  text: string;
  lineIndex: number;
  totalLines: number;
}

export interface FriendRecord {
  uid: string;
  displayName: string;
  nickname?: string;
  email?: string;
  friendCode: string;
  addedAt: string;
}

export interface OnlinePlayerInfo {
  uid: string;
  displayName: string;
  friendCode?: string;
}

export interface RemotePlayerState {
  uid: string;
  displayName: string;
  characterId: CharacterId;
  x: number;
  y: number;
  z: number;
  heading: number;
  vehicleKind: VehicleKind | null;
  vehicleColor: string;
  health: number;
  activeMissionId: string | null;
  isShooting?: boolean;
  appearance?: CharacterAppearance;
  updatedAt?: number;
}

export interface MissionInvite {
  inviteId: string;
  fromUid: string;
  fromName: string;
  missionId: string;
  missionTitle: string;
  timestamp: number;
}

export interface HudTelemetry {
  fps: number;
  health: number;
  maxHealth: number;
  armor: number;
  maxArmor: number;
  stamina: number;
  cash: number;
  skills: CharacterSkills;
  wantedStars: number;
  wantedEvading: boolean;
  evasionProgress: number;
  policeDispatchTimer: number;
  policeDispatchReason: string | null;
  autoAimLocked: boolean;
  inVehicle: boolean;
  vehicleKind: VehicleKind | null;
  emergencyRole?: EmergencyRole;
  waterTankPct?: number;
  vehicleBrand: string;
  vehicleName: string;
  vehicleHealthPct: number;
  vehicleBurning: boolean;
  nearbyRepairCost: number;
  nearbyTuningAvailable: boolean;
  speedKmh: number;
  altitudeM: number;
  inWater: boolean;
  handbrake: boolean;
  isDrifting: boolean;
  taxiMode: 'none' | 'passenger' | 'driver_offer' | 'driver_waiting' | 'driver_active';
  taxiFareCash: number;
  taxiDestinationLabel: string | null;
  taxiTripDistM?: number;
  taxiPickupLabel?: string | null;
  courierStatus?: {
    active: boolean;
    boarded: boolean;
    onRoad: boolean;
    packageDamagePct: number;
    vehicleDamagePct: number;
  } | null;
  hangarCount: number;
  garageCount: number;
  parkedFacilityNotice: string | null;
  hasParachute: boolean;
  parachuteDeployed: boolean;
  godModeActive: boolean;
  cheatSessionActive: boolean;
  gameClockStr: string;
  gameTimeNormalized: number;
  cloudCoverage: number;
  weatherType: WeatherType;
  weatherLabel: string;
  rainIntensity: number;
  ambientTempC: number;
  radioStation: RadioStationId;
  radioStationName: string;
  radioGenre: string;
  radioTrack: string;
  nearestNpcDialogue: { speaker: string; text: string; behavior: string } | null;
  controlCategory: VehicleControlCategory;
  equippedWeapon: WeaponId;
  ammoInClip: number;
  reserveAmmo: number;
  isReloading: boolean;
  isAiming: boolean;
  cameraMode: CameraMode;
  district: string;
  nearbyPrompt: string | null;
  activeSidePrompt: string | null;
  activeMissionTitle: string | null;
  activeObjectiveLabel: string | null;
  missionTimerRemaining: number | null;
  missionNotification: { title: string; subtitle: string; reward?: number } | null;
  activeCutscene: ActiveCutsceneState | null;
  remotePlayersCount: number;
  controllerConnected: boolean;
  controllerType: 'playstation' | 'xbox' | 'none';
  controllerName: string;
  hitMarkerActive: boolean;
  damageFlashActive: boolean;
  stuntMessage: string | null;
  playerX: number;
  playerZ: number;
  playerHeading: number;
  minimapBlips: MinimapBlip[];
  gpsWaypoint: GpsWaypoint | null;
  gpsRoute: GpsPoint[];
  gpsDistanceM: number;
  pointerLocked: boolean;
  isWasted: boolean;
  wastedReason: string | null;
  isBusted: boolean;
}

export interface GameStats {
  totalEliminations: number;
  policeEscapes: number;
  stuntJumps: number;
  shootingRangeScore?: number;
}
