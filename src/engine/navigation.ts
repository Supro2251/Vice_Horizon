import * as THREE from 'three';
import { GpsPoint } from '../types/game';

export interface RoadSegmentDef {
  id: string;
  name: string;
  isHighway: boolean;
  isDirtTrail?: boolean;
  width: number;
  closed?: boolean;
  points: GpsPoint[];
}

export interface BridgeSpan {
  id: string;
  x: number;
  zStart: number;
  zEnd: number;
  width: number;
  peakElevation: number;
}

export interface OverpassSpan {
  id: string;
  axis: 'x' | 'z';
  centerX: number;
  centerZ: number;
  length: number;
  rampLen: number;
  width: number;
  deckHeight: number;
}

export interface UnderpassSpan {
  id: string;
  axis: 'x' | 'z';
  centerX: number;
  centerZ: number;
  length: number;
  rampLen: number;
  width: number;
  depth: number;
}

export interface ParkingLotDef {
  id: string;
  name: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  rotation: number;
  stallsPerRow: number;
}

// 15x Island Playable Area (~3.04km x 3.04km landmass, ~4.1km sea horizon)
export const ISLAND_BASE_RADIUS = 1520;
export const OUT_OF_BOUNDS_SEA_RADIUS = 2050;

export function getIslandCoastRadius(angle: number): number {
  const airportPeninsula = 185 * Math.exp(-Math.pow(angle - 2.42, 2) / 0.24);
  const northCape = 120 * Math.exp(-Math.pow(angle + 1.55, 2) / 0.3);
  return (
    ISLAND_BASE_RADIUS +
    airportPeninsula +
    northCape +
    95 * Math.sin(angle * 2 - 0.4) +
    64 * Math.cos(angle * 3 + 0.7) +
    36 * Math.sin(angle * 5)
  );
}

export function getIslandOutlinePoints(segments = 120): GpsPoint[] {
  const pts: GpsPoint[] = [];
  for (let i = 0; i < segments; i++) {
    const ang = (i / segments) * Math.PI * 2;
    const r = getIslandCoastRadius(ang);
    pts.push({ x: Math.cos(ang) * r, z: Math.sin(ang) * r });
  }
  return pts;
}

export const BRIDGE_SPANS: BridgeSpan[] = [
  { id: 'bridge_central', x: 0, zStart: 372, zEnd: 488, width: 22, peakElevation: 5.2 },
  { id: 'bridge_east_mid', x: 240, zStart: 372, zEnd: 488, width: 18, peakElevation: 4.8 },
  { id: 'bridge_coral', x: 520, zStart: 372, zEnd: 488, width: 20, peakElevation: 5.0 },
  { id: 'bridge_ring_east', x: 960, zStart: 370, zEnd: 492, width: 26, peakElevation: 6.2 },
  // North River crossings
  { id: 'bridge_north_west', x: -360, zStart: -840, zEnd: -740, width: 20, peakElevation: 4.8 },
  { id: 'bridge_north_east', x: 520, zStart: -840, zEnd: -740, width: 20, peakElevation: 4.8 },
];

export const OVERPASS_SPANS: OverpassSpan[] = [
  {
    id: 'overpass_midtown_skyway',
    axis: 'x',
    centerX: 0,
    centerZ: -255,
    length: 340,
    rampLen: 70,
    width: 18,
    deckHeight: 7.4,
  },
  {
    id: 'overpass_airport_express',
    axis: 'z',
    centerX: -620,
    centerZ: 70,
    length: 360,
    rampLen: 72,
    width: 18,
    deckHeight: 7.4,
  },
];

export const UNDERPASS_SPANS: UnderpassSpan[] = [
  {
    id: 'underpass_downtown_tunnel',
    axis: 'z',
    centerX: -195,
    centerZ: -390,
    length: 250,
    rampLen: 55,
    width: 17,
    depth: 5.2,
  },
  {
    id: 'underpass_coral_tunnel',
    axis: 'x',
    centerX: 380,
    centerZ: 195,
    length: 230,
    rampLen: 50,
    width: 16,
    depth: 4.8,
  },
];

export const PARKING_LOTS: ParkingLotDef[] = [
  { id: 'park_downtown', name: 'Centrálne parkovisko Plaza', x: -120, z: -180, width: 46, depth: 34, rotation: 0, stallsPerRow: 8 },
  { id: 'park_market', name: 'Parkovisko Ocean Market', x: -315, z: -265, width: 42, depth: 30, rotation: 0, stallsPerRow: 7 },
  { id: 'park_hospital', name: 'Parkovisko Nemocnica & VCPD', x: -240, z: -610, width: 54, depth: 34, rotation: 0, stallsPerRow: 9 },
  { id: 'park_coral', name: 'Plážové parkovisko Coral', x: 790, z: -110, width: 48, depth: 32, rotation: 0, stallsPerRow: 8 },
  { id: 'park_marina', name: 'Prístavné parkovisko Marina', x: 460, z: 680, width: 46, depth: 32, rotation: 0, stallsPerRow: 8 },
  { id: 'park_airport', name: 'Letiskové parkovisko Terminál', x: -740, z: 580, width: 64, depth: 38, rotation: 0, stallsPerRow: 10 },
];

export function isBridgeAt(x: number, z: number): boolean {
  for (const b of BRIDGE_SPANS) {
    if (z >= b.zStart && z <= b.zEnd && Math.abs(x - b.x) <= b.width * 0.56) {
      return true;
    }
  }
  return false;
}

export function getBridgeElevationAt(x: number, z: number): number {
  let maxEl = 0;
  for (const b of BRIDGE_SPANS) {
    if (z >= b.zStart && z <= b.zEnd && Math.abs(x - b.x) <= b.width * 0.56) {
      const center = (b.zStart + b.zEnd) * 0.5;
      const halfSpan = (b.zEnd - b.zStart) * 0.5;
      const t = 1 - Math.abs(z - center) / halfSpan;
      const el = Math.sin(Math.max(0, t) * Math.PI * 0.5) * b.peakElevation;
      if (el > maxEl) maxEl = el;
    }
  }
  return maxEl;
}

export function getOverpassDeckHeightAt(x: number, z: number, curY: number): number | null {
  for (const ov of OVERPASS_SPANS) {
    const along = ov.axis === 'x' ? Math.abs(x - ov.centerX) : Math.abs(z - ov.centerZ);
    const cross = ov.axis === 'x' ? Math.abs(z - ov.centerZ) : Math.abs(x - ov.centerX);
    const halfLen = ov.length * 0.5;
    if (along <= halfLen && cross <= ov.width * 0.52) {
      const flatHalf = halfLen - ov.rampLen;
      const rampH =
        along <= flatHalf
          ? ov.deckHeight
          : ov.deckHeight * Math.max(0, 1 - (along - flatHalf) / ov.rampLen);
      // Only snap onto elevated deck if entity is near/above deck or on the entry ramp
      if (along > flatHalf - 6 || curY >= rampH - 2.4) {
        return rampH;
      }
    }
  }
  return null;
}

export function getUnderpassFloorHeightAt(x: number, z: number, curY: number): number | null {
  for (const un of UNDERPASS_SPANS) {
    const along = un.axis === 'x' ? Math.abs(x - un.centerX) : Math.abs(z - un.centerZ);
    const cross = un.axis === 'x' ? Math.abs(z - un.centerZ) : Math.abs(x - un.centerX);
    const halfLen = un.length * 0.5;
    if (along <= halfLen && cross <= un.width * 0.52) {
      const flatHalf = halfLen - un.rampLen;
      const depth =
        along <= flatHalf
          ? -un.depth
          : -un.depth * Math.max(0, 1 - (along - flatHalf) / un.rampLen);
      // Only drop into tunnel if entity is below surface lid or on entry ramp
      if (along > flatHalf - 8 || curY < 0.8) {
        return depth;
      }
    }
  }
  return null;
}

export function isIslandLandAt(x: number, z: number): boolean {
  const ang = Math.atan2(z, x);
  const coastR = getIslandCoastRadius(ang);
  return Math.hypot(x, z) <= coastR;
}

export function isOnBeachAt(x: number, z: number): boolean {
  const ang = Math.atan2(z, x);
  const coastR = getIslandCoastRadius(ang);
  const r = Math.hypot(x, z);
  return r >= coastR - 72 && r <= coastR + 6;
}

export function isWaterAt(x: number, z: number): boolean {
  if (!isIslandLandAt(x, z)) return true;
  // Southeast Marina Harbor Basin
  if (x >= 560 && x <= 1280 && z >= 620 && z <= 1120) return true;
  // Vice Canal East-West waterway
  if (x >= -340 && x <= 1560 && z >= 392 && z <= 468 && !isBridgeAt(x, z)) return true;
  // North Emerald River
  if (x >= -820 && x <= 860 && z >= -815 && z <= -765 && !isBridgeAt(x, z)) return true;
  return false;
}

export function isOutOfBoundsSeaAt(x: number, z: number): boolean {
  return Math.hypot(x, z) > OUT_OF_BOUNDS_SEA_RADIUS;
}

function sampleSpline(
  ctrl: [number, number][],
  samplesPerSeg: number,
  closed = false
): GpsPoint[] {
  const vecs = ctrl.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const curve = new THREE.CatmullRomCurve3(vecs, closed, 'catmullrom', 0.45);
  const total = Math.max(10, ctrl.length * samplesPerSeg);
  const raw = curve.getPoints(total);
  return raw.map((p) => ({ x: p.x, z: p.z }));
}

function sampleCircle(cx: number, cz: number, radius: number, count = 36): GpsPoint[] {
  const pts: GpsPoint[] = [];
  for (let i = 0; i <= count; i++) {
    const a = (i / count) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * radius, z: cz + Math.sin(a) * radius });
  }
  return pts;
}

// Grand 15x Ring Highway (~8.5km full loop)
const RING_CTRL: [number, number][] = [
  [1040, -90],
  [990, 220],
  [960, 430], // East highway bridge over Vice Canal
  [900, 620],
  [650, 980],
  [240, 1080],
  [-120, 1100],
  [-490, 1060],
  [-920, 1080],
  [-1260, 860], // Airport perimeter west
  [-1220, 440],
  [-1100, -40],
  [-960, -480],
  [-740, -900],
  [-360, -1080],
  [120, -1140],
  [640, -1020],
  [940, -640],
];

const NORTH_HIGHWAY_CTRL: [number, number][] = [
  [-1080, -180],
  [-740, -480],
  [-360, -680],
  [0, -680],
  [360, -660],
  [680, -460],
  [1010, -190],
];

const S_BOULEVARD_WEST_CTRL: [number, number][] = [
  [-1100, -40],
  [-720, 40],
  [-460, -60],
  [-240, -110],
  [-60, -70],
];

const S_BOULEVARD_EAST_CTRL: [number, number][] = [
  [60, -70],
  [240, 40],
  [474, -70],
];

const S_BOULEVARD_COAST_CTRL: [number, number][] = [
  [566, -70],
  [790, -85],
  [1040, -90],
];

const TRAIL_NW_FOREST_CTRL: [number, number][] = [
  [-740, -480],
  [-860, -640],
  [-1020, -760],
  [-920, -940],
  [-680, -960],
  [-520, -840],
];

const TRAIL_NE_MEADOW_CTRL: [number, number][] = [
  [520, -640],
  [720, -860],
  [940, -940],
  [1080, -740],
  [940, -640],
];

const TRAIL_SW_PALMS_CTRL: [number, number][] = [
  [-490, 1060],
  [-420, 860],
  [-280, 740],
  [-160, 880],
  [-120, 1100],
];

export const ROAD_SEGMENTS: RoadSegmentDef[] = [
  {
    id: 'coastal_ring_highway',
    name: 'Diaľničný okruh Leonida',
    isHighway: true,
    width: 26,
    closed: true,
    points: sampleSpline(RING_CTRL, 8, true),
  },
  {
    id: 'north_foothill_highway',
    name: 'Severná horská diaľnica',
    isHighway: true,
    width: 22,
    points: sampleSpline(NORTH_HIGHWAY_CTRL, 6, false),
  },
  {
    id: 'roundabout_central',
    name: 'Kruhový objazd Slnečné námestie',
    isHighway: false,
    width: 18,
    closed: true,
    points: sampleCircle(0, -70, 60, 36),
  },
  {
    id: 'roundabout_coral',
    name: 'Kruhový objazd Coral Plaza',
    isHighway: false,
    width: 16,
    closed: true,
    points: sampleCircle(520, -70, 46, 30),
  },
  {
    id: 's_boulevard_west',
    name: 'Západná S-trieda',
    isHighway: false,
    width: 18,
    points: sampleSpline(S_BOULEVARD_WEST_CTRL, 6, false),
  },
  {
    id: 's_boulevard_east',
    name: 'Centrálna S-trieda',
    isHighway: false,
    width: 18,
    points: sampleSpline(S_BOULEVARD_EAST_CTRL, 6, false),
  },
  {
    id: 's_boulevard_coast',
    name: 'Pobrežný bulvár Coral',
    isHighway: false,
    width: 17,
    points: sampleSpline(S_BOULEVARD_COAST_CTRL, 5, false),
  },
  // North-South Arterials
  {
    id: 'ave_west_midtown',
    name: 'Bayshore Avenue',
    isHighway: false,
    width: 18,
    points: [
      { x: -360, z: -1080 },
      { x: -360, z: -790 },
      { x: -360, z: -680 },
      { x: -360, z: -290 },
      { x: -360, z: -60 },
      { x: -360, z: 220 },
      { x: -360, z: 540 },
      { x: -360, z: 1060 },
    ],
  },
  {
    id: 'ave_central_north',
    name: 'Central Avenue Sever',
    isHighway: false,
    width: 18,
    points: [
      { x: 0, z: -1140 },
      { x: 0, z: -680 },
      { x: 0, z: -290 },
      { x: 0, z: -130 },
    ],
  },
  {
    id: 'ave_central_south',
    name: 'Central Avenue Juh',
    isHighway: false,
    width: 18,
    points: [
      { x: 0, z: -10 },
      { x: 0, z: 220 },
      { x: 0, z: 430 },
      { x: 0, z: 540 },
      { x: 0, z: 1090 },
    ],
  },
  {
    id: 'ave_east_mid',
    name: 'Midtown Bridge Road',
    isHighway: false,
    width: 16,
    points: [
      { x: 240, z: -660 },
      { x: 240, z: -290 },
      { x: 240, z: 40 },
      { x: 240, z: 220 },
      { x: 240, z: 430 },
      { x: 240, z: 540 },
      { x: 240, z: 1080 },
    ],
  },
  {
    id: 'ave_coral_north',
    name: 'Coral Avenue Sever',
    isHighway: false,
    width: 17,
    points: [
      { x: 520, z: -1020 },
      { x: 520, z: -790 },
      { x: 520, z: -560 },
      { x: 520, z: -290 },
      { x: 520, z: -116 },
    ],
  },
  {
    id: 'ave_coral_south',
    name: 'Coral Avenue Juh',
    isHighway: false,
    width: 17,
    points: [
      { x: 520, z: -24 },
      { x: 520, z: 220 },
      { x: 520, z: 430 },
      { x: 520, z: 540 },
      { x: 520, z: 980 },
    ],
  },
  // East-West Cross Streets
  {
    id: 'street_civic_north',
    name: 'Nemocničná ulica',
    isHighway: false,
    width: 17,
    points: [
      { x: -640, z: -680 },
      { x: -360, z: -680 },
      { x: 0, z: -680 },
      { x: 240, z: -660 },
      { x: 520, z: -660 },
      { x: 860, z: -640 },
    ],
  },
  {
    id: 'street_midtown',
    name: 'Midtown Market Street',
    isHighway: false,
    width: 17,
    points: [
      { x: -960, z: -290 },
      { x: -360, z: -290 },
      { x: 0, z: -290 },
      { x: 240, z: -290 },
      { x: 520, z: -290 },
      { x: 960, z: -290 },
    ],
  },
  {
    id: 'street_canal_north',
    name: 'Promenáda pri kanáli',
    isHighway: false,
    width: 17,
    points: [
      { x: -1140, z: 220 },
      { x: -620, z: 220 },
      { x: -360, z: 220 },
      { x: 0, z: 220 },
      { x: 240, z: 220 },
      { x: 520, z: 220 },
      { x: 990, z: 220 },
    ],
  },
  {
    id: 'street_airport_north',
    name: 'Airport Boulevard',
    isHighway: false,
    width: 18,
    points: [
      { x: -1240, z: 540 },
      { x: -760, z: 540 },
      { x: -360, z: 540 },
      { x: 0, z: 540 },
      { x: 240, z: 540 },
      { x: 560, z: 540 },
    ],
  },
  // Dirt Trails through Forests & Meadows
  {
    id: 'trail_nw_forest',
    name: 'Borovicový lesný chodník',
    isHighway: false,
    isDirtTrail: true,
    width: 9.5,
    points: sampleSpline(TRAIL_NW_FOREST_CTRL, 6, false),
  },
  {
    id: 'trail_ne_meadow',
    name: 'Lúčna cesta Emerald Hills',
    isHighway: false,
    isDirtTrail: true,
    width: 9.5,
    points: sampleSpline(TRAIL_NE_MEADOW_CTRL, 6, false),
  },
  {
    id: 'trail_sw_palms',
    name: 'Palmová pobrežná cestička',
    isHighway: false,
    isDirtTrail: true,
    width: 9.5,
    points: sampleSpline(TRAIL_SW_PALMS_CTRL, 6, false),
  },
];

// Graph Nodes & Edges for 15x Interactive GPS Navigation
interface GraphNode {
  id: string;
  x: number;
  z: number;
  edges: { to: string; cost: number; via: GpsPoint[] }[];
}

const ROAD_GRAPH: Map<string, GraphNode> = (() => {
  const nodes = new Map<string, GraphNode>();
  const addNode = (id: string, x: number, z: number) => {
    nodes.set(id, { id, x, z, edges: [] });
  };

  addNode('ring_e', 1040, -90);
  addNode('ring_es', 990, 220);
  addNode('ring_bridge', 960, 430);
  addNode('ring_se', 900, 620);
  addNode('ring_s_coral', 650, 980);
  addNode('ring_s_mid', 240, 1080);
  addNode('ring_s_cent', 0, 1090);
  addNode('ring_sw', -490, 1060);
  addNode('ring_w_airport', -1240, 540);
  addNode('ring_w_south', -1140, 220);
  addNode('ring_w', -1100, -40);
  addNode('ring_wn', -960, -480);
  addNode('ring_nw', -740, -900);
  addNode('ring_n_west', -360, -1080);
  addNode('ring_n_cent', 0, -1140);
  addNode('ring_n_east', 520, -1020);
  addNode('ring_ne', 940, -640);

  // Roundabouts
  addNode('rc_n', 0, -130);
  addNode('rc_s', 0, -10);
  addNode('rc_w', -60, -70);
  addNode('rc_e', 60, -70);

  addNode('rco_n', 520, -116);
  addNode('rco_s', 520, -24);
  addNode('rco_w', 474, -70);
  addNode('rco_e', 566, -70);

  // West avenue
  addNode('w_civic', -360, -680);
  addNode('w_mid', -360, -290);
  addNode('w_s', -360, -60);
  addNode('w_canal', -360, 220);
  addNode('w_marina', -360, 540);

  // Central avenue
  addNode('c_civic', 0, -680);
  addNode('c_mid', 0, -290);
  addNode('c_canal', 0, 220);
  addNode('c_marina', 0, 540);

  // East mid avenue
  addNode('e_civic', 240, -660);
  addNode('e_mid', 240, -290);
  addNode('e_sb', 240, 40);
  addNode('e_canal', 240, 220);
  addNode('e_marina', 240, 540);

  // Coral avenue
  addNode('co_civic', 520, -660);
  addNode('co_mid', 520, -290);
  addNode('co_canal', 520, 220);
  addNode('co_marina', 520, 540);

  // Airport & Foothills
  addNode('air_gate', -760, 540);
  addNode('nh_w', -740, -480);
  addNode('nh_e', 680, -460);

  const connect = (aId: string, bId: string, viaCtrl?: [number, number][]) => {
    const na = nodes.get(aId);
    const nb = nodes.get(bId);
    if (!na || !nb) return;
    const pts: GpsPoint[] = viaCtrl
      ? sampleSpline([[na.x, na.z], ...viaCtrl, [nb.x, nb.z]], 4, false)
      : [
          { x: na.x, z: na.z },
          { x: nb.x, z: nb.z },
        ];
    let cost = 0;
    for (let i = 1; i < pts.length; i++) {
      cost += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    }
    na.edges.push({ to: bId, cost, via: pts });
    nb.edges.push({ to: aId, cost, via: [...pts].reverse() });
  };

  // Coastal Ring
  connect('ring_e', 'ring_es', [[1020, 70]]);
  connect('ring_es', 'ring_bridge');
  connect('ring_bridge', 'ring_se');
  connect('ring_se', 'ring_s_coral', [[800, 820]]);
  connect('ring_s_coral', 'ring_s_mid', [[440, 1050]]);
  connect('ring_s_mid', 'ring_s_cent');
  connect('ring_s_cent', 'ring_sw', [[-280, 1090]]);
  connect('ring_sw', 'ring_w_airport', [[-920, 1080], [-1260, 860]]);
  connect('ring_w_airport', 'ring_w_south', [[-1220, 400]]);
  connect('ring_w_south', 'ring_w');
  connect('ring_w', 'ring_wn', [[-1040, -260]]);
  connect('ring_wn', 'ring_nw');
  connect('ring_nw', 'ring_n_west');
  connect('ring_n_west', 'ring_n_cent');
  connect('ring_n_cent', 'ring_n_east', [[280, -1100]]);
  connect('ring_n_east', 'ring_ne', [[780, -860]]);
  connect('ring_ne', 'ring_e', [[1020, -360]]);

  // North Highway
  connect('ring_w', 'nh_w', [[-960, -220]]);
  connect('nh_w', 'w_civic');
  connect('w_civic', 'c_civic');
  connect('c_civic', 'e_civic');
  connect('e_civic', 'co_civic');
  connect('co_civic', 'nh_e');
  connect('nh_e', 'ring_e', [[880, -320]]);
  connect('co_civic', 'ring_ne');

  // Roundabouts
  connect('rc_n', 'rc_e', [[42, -112]]);
  connect('rc_e', 'rc_s', [[42, -28]]);
  connect('rc_s', 'rc_w', [[-42, -28]]);
  connect('rc_w', 'rc_n', [[-42, -112]]);

  connect('rco_n', 'rco_e', [[554, -104]]);
  connect('rco_e', 'rco_s', [[554, -36]]);
  connect('rco_s', 'rco_w', [[486, -36]]);
  connect('rco_w', 'rco_n', [[486, -104]]);

  // S-Boulevard
  connect('ring_w', 'w_s', [[-720, 40]]);
  connect('w_s', 'rc_w', [[-240, -110]]);
  connect('rc_e', 'e_sb', [[150, 10]]);
  connect('e_sb', 'rco_w', [[360, 10]]);
  connect('rco_e', 'ring_e', [[790, -85]]);

  // N-S Avenues
  connect('ring_n_west', 'w_civic');
  connect('w_civic', 'w_mid');
  connect('w_mid', 'w_s');
  connect('w_s', 'w_canal');
  connect('w_canal', 'w_marina');
  connect('w_marina', 'ring_sw');

  connect('ring_n_cent', 'c_civic');
  connect('c_civic', 'c_mid');
  connect('c_mid', 'rc_n');
  connect('rc_s', 'c_canal');
  connect('c_canal', 'c_marina');
  connect('c_marina', 'ring_s_cent');

  connect('e_civic', 'e_mid');
  connect('e_mid', 'e_sb');
  connect('e_sb', 'e_canal');
  connect('e_canal', 'e_marina');
  connect('e_marina', 'ring_s_mid');

  connect('ring_n_east', 'co_civic');
  connect('co_civic', 'co_mid');
  connect('co_mid', 'rco_n');
  connect('rco_s', 'co_canal');
  connect('co_canal', 'co_marina');
  connect('co_marina', 'ring_s_coral');

  // Cross Streets
  connect('ring_wn', 'w_mid', [[-660, -340]]);
  connect('w_mid', 'c_mid');
  connect('c_mid', 'e_mid');
  connect('e_mid', 'co_mid');
  connect('co_mid', 'ring_e', [[820, -250]]);

  connect('ring_w_south', 'w_canal', [[-620, 220]]);
  connect('w_canal', 'c_canal');
  connect('c_canal', 'e_canal');
  connect('e_canal', 'co_canal');
  connect('co_canal', 'ring_es');

  connect('ring_w_airport', 'air_gate');
  connect('air_gate', 'w_marina');
  connect('w_marina', 'c_marina');
  connect('c_marina', 'e_marina');
  connect('e_marina', 'co_marina');

  return nodes;
})();

function findNearestGraphNode(x: number, z: number): GraphNode {
  let best!: GraphNode;
  let bestD = Infinity;
  for (const n of ROAD_GRAPH.values()) {
    const d = Math.hypot(n.x - x, n.z - z);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

export function computeGpsRoute(
  startX: number,
  startZ: number,
  targetX: number,
  targetZ: number
): GpsPoint[] {
  const directDist = Math.hypot(targetX - startX, targetZ - startZ);
  if (directDist < 65) {
    return [
      { x: startX, z: startZ },
      { x: targetX, z: targetZ },
    ];
  }

  if (!isIslandLandAt(startX, startZ) || !isIslandLandAt(targetX, targetZ)) {
    return [
      { x: startX, z: startZ },
      { x: targetX, z: targetZ },
    ];
  }

  const startNode = findNearestGraphNode(startX, startZ);
  const endNode = findNearestGraphNode(targetX, targetZ);

  if (startNode.id === endNode.id) {
    return [
      { x: startX, z: startZ },
      { x: startNode.x, z: startNode.z },
      { x: targetX, z: targetZ },
    ];
  }

  const dist = new Map<string, number>();
  const prev = new Map<string, { from: string; via: GpsPoint[] } | null>();
  const unvisited = new Set<string>(ROAD_GRAPH.keys());

  for (const id of unvisited) {
    dist.set(id, Infinity);
    prev.set(id, null);
  }
  dist.set(startNode.id, 0);

  while (unvisited.size > 0) {
    let currId: string | null = null;
    let currDist = Infinity;
    for (const id of unvisited) {
      const d = dist.get(id)!;
      if (d < currDist) {
        currDist = d;
        currId = id;
      }
    }
    if (!currId || currDist === Infinity || currId === endNode.id) break;
    unvisited.delete(currId);

    const node = ROAD_GRAPH.get(currId)!;
    for (const edge of node.edges) {
      if (!unvisited.has(edge.to)) continue;
      const alt = currDist + edge.cost;
      if (alt < dist.get(edge.to)!) {
        dist.set(edge.to, alt);
        prev.set(edge.to, { from: currId, via: edge.via });
      }
    }
  }

  const route: GpsPoint[] = [];
  let trace: string | null = endNode.id;
  const edgeChains: GpsPoint[][] = [];
  while (trace) {
    const p = prev.get(trace);
    if (!p) break;
    edgeChains.unshift(p.via);
    trace = p.from;
  }

  route.push({ x: startX, z: startZ });
  for (const chain of edgeChains) {
    for (const pt of chain) {
      const last = route[route.length - 1];
      if (!last || Math.hypot(pt.x - last.x, pt.z - last.z) > 2.5) {
        route.push(pt);
      }
    }
  }
  route.push({ x: targetX, z: targetZ });
  return route;
}

// Smooth Closed Traffic Loops across the 15x Island
export const TRAFFIC_LOOP_PATHS: GpsPoint[][] = [
  sampleSpline(RING_CTRL, 10, true),
  sampleSpline([...RING_CTRL].reverse(), 10, true),
  sampleSpline(
    [
      [-1050, -160],
      [-740, -480],
      [-360, -680],
      [0, -680],
      [360, -660],
      [680, -460],
      [920, -240],
      [520, -290],
      [0, -290],
      [-360, -290],
      [-720, -240],
    ],
    7,
    true
  ),
  sampleSpline(
    [
      [0, -130],
      [60, -70],
      [240, 40],
      [240, 430],
      [240, 540],
      [520, 540],
      [520, 430],
      [520, -24],
      [474, -70],
      [240, -290],
      [0, -290],
    ],
    7,
    true
  ),
  sampleSpline(
    [
      [-360, -680],
      [0, -680],
      [0, -130],
      [-60, -70],
      [-240, -110],
      [-360, -60],
      [-360, 540],
      [-760, 540],
      [-1140, 220],
      [-720, 40],
      [-360, -290],
    ],
    7,
    true
  ),
];
