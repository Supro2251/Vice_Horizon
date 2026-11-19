import * as THREE from 'three';
import { GpsPoint } from '../types/game';

export interface RoadSegmentDef {
  id: string;
  name: string;
  isHighway: boolean;
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

// 5x Island Dimensions (~820m x 820m landmass surrounded by endless open ocean)
export const ISLAND_BASE_RADIUS = 408;
export const OUT_OF_BOUNDS_SEA_RADIUS = 565;

export function getIslandCoastRadius(angle: number): number {
  const airportPeninsula = 42 * Math.exp(-Math.pow(angle - 2.38, 2) / 0.28);
  return (
    ISLAND_BASE_RADIUS +
    airportPeninsula +
    26 * Math.sin(angle * 2 - 0.4) +
    18 * Math.cos(angle * 3 + 0.7) +
    10 * Math.sin(angle * 5)
  );
}

export function getIslandOutlinePoints(segments = 96): GpsPoint[] {
  const pts: GpsPoint[] = [];
  for (let i = 0; i < segments; i++) {
    const ang = (i / segments) * Math.PI * 2;
    const r = getIslandCoastRadius(ang);
    pts.push({ x: Math.cos(ang) * r, z: Math.sin(ang) * r });
  }
  return pts;
}

export const BRIDGE_SPANS: BridgeSpan[] = [
  { id: 'bridge_central', x: 0, zStart: 118, zEnd: 158, width: 17, peakElevation: 2.3 },
  { id: 'bridge_east_mid', x: 95, zStart: 118, zEnd: 158, width: 15, peakElevation: 2.1 },
  { id: 'bridge_coral', x: 185, zStart: 118, zEnd: 158, width: 16, peakElevation: 2.2 },
  { id: 'bridge_ring_east', x: 304, zStart: 116, zEnd: 160, width: 22, peakElevation: 2.6 },
];

export function isBridgeAt(x: number, z: number): boolean {
  for (const b of BRIDGE_SPANS) {
    if (z >= b.zStart && z <= b.zEnd && Math.abs(x - b.x) <= b.width * 0.52) {
      return true;
    }
  }
  return false;
}

export function getBridgeElevationAt(x: number, z: number): number {
  for (const b of BRIDGE_SPANS) {
    if (z >= b.zStart && z <= b.zEnd && Math.abs(x - b.x) <= b.width * 0.56) {
      const center = (b.zStart + b.zEnd) * 0.5;
      const halfSpan = (b.zEnd - b.zStart) * 0.5;
      const t = 1 - Math.abs(z - center) / halfSpan;
      return Math.sin(Math.max(0, t) * Math.PI * 0.5) * b.peakElevation;
    }
  }
  return 0;
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
  return r >= coastR - 28 && r <= coastR + 2;
}

export function isWaterAt(x: number, z: number): boolean {
  // Open Ocean surrounding the entire island
  if (!isIslandLandAt(x, z)) return true;
  // Southeast Marina Harbor Basin
  if (x >= 208 && x <= 395 && z >= 215 && z <= 315) return true;
  // Vice Canal cutting East-West across southern mid-island (excluding bridges)
  if (x >= -108 && x <= 420 && z >= 124 && z <= 152 && !isBridgeAt(x, z)) return true;
  return false;
}

export function isOutOfBoundsSeaAt(x: number, z: number): boolean {
  return Math.hypot(x, z) > OUT_OF_BOUNDS_SEA_RADIUS;
}

// Helper to sample smooth Catmull-Rom curves into dense polylines
function sampleSpline(
  ctrl: [number, number][],
  samplesPerSeg: number,
  closed = false
): GpsPoint[] {
  const vecs = ctrl.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const curve = new THREE.CatmullRomCurve3(vecs, closed, 'catmullrom', 0.45);
  const total = Math.max(8, ctrl.length * samplesPerSeg);
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

// Build Curved Highways, S-Avenues, Roundabouts, and Urban Streets
const RING_CTRL: [number, number][] = [
  [306, -20],
  [292, 85],
  [304, 138], // East highway bridge over Vice Canal
  [272, 202],
  [185, 292],
  [65, 315],
  [-55, 315],
  [-185, 292],
  [-288, 286],
  [-332, 220],
  [-325, 110],
  [-325, -15],
  [-295, -145],
  [-210, -255],
  [-85, -305],
  [55, -308],
  [188, -268],
  [276, -165],
];

const NORTH_HIGHWAY_CTRL: [number, number][] = [
  [-318, -55],
  [-235, -162],
  [-130, -208],
  [0, -206],
  [135, -192],
  [230, -140],
  [298, -60],
];

const S_BOULEVARD_WEST_CTRL: [number, number][] = [
  [-325, -15],
  [-230, 12],
  [-140, -22],
  [-82, -48],
  [-36, -20],
];

const S_BOULEVARD_EAST_CTRL: [number, number][] = [
  [36, -20],
  [95, 16],
  [159, -20],
];

const S_BOULEVARD_COAST_CTRL: [number, number][] = [
  [211, -20],
  [262, -28],
  [306, -20],
];

export const ROAD_SEGMENTS: RoadSegmentDef[] = [
  {
    id: 'coastal_ring_highway',
    name: 'Diaľničný okruh Leonida',
    isHighway: true,
    width: 22,
    closed: true,
    points: sampleSpline(RING_CTRL, 6, true),
  },
  {
    id: 'north_foothill_highway',
    name: 'Severná horská diaľnica',
    isHighway: true,
    width: 19,
    points: sampleSpline(NORTH_HIGHWAY_CTRL, 6, false),
  },
  {
    id: 'roundabout_central',
    name: 'Kruhový objazd Slnečné námestie',
    isHighway: false,
    width: 16,
    closed: true,
    points: sampleCircle(0, -20, 36, 36),
  },
  {
    id: 'roundabout_coral',
    name: 'Kruhový objazd Coral Plaza',
    isHighway: false,
    width: 14,
    closed: true,
    points: sampleCircle(185, -20, 26, 30),
  },
  {
    id: 's_boulevard_west',
    name: 'Západná S-trieda',
    isHighway: false,
    width: 16,
    points: sampleSpline(S_BOULEVARD_WEST_CTRL, 6, false),
  },
  {
    id: 's_boulevard_east',
    name: 'Centrálna S-trieda',
    isHighway: false,
    width: 16,
    points: sampleSpline(S_BOULEVARD_EAST_CTRL, 6, false),
  },
  {
    id: 's_boulevard_coast',
    name: 'Pobrežný bulvár',
    isHighway: false,
    width: 15,
    points: sampleSpline(S_BOULEVARD_COAST_CTRL, 5, false),
  },
  // North-South Arterials
  {
    id: 'ave_west_midtown',
    name: 'Bayshore Avenue',
    isHighway: false,
    width: 16,
    points: [
      { x: -140, z: -288 },
      { x: -140, z: -206 },
      { x: -140, z: -102 },
      { x: -140, z: -22 },
      { x: -140, z: 75 },
      { x: -140, z: 202 },
      { x: -140, z: 298 },
    ],
  },
  {
    id: 'ave_central_north',
    name: 'Central Avenue Sever',
    isHighway: false,
    width: 16,
    points: [
      { x: 0, z: -308 },
      { x: 0, z: -206 },
      { x: 0, z: -102 },
      { x: 0, z: -56 },
    ],
  },
  {
    id: 'ave_central_south',
    name: 'Central Avenue Juh',
    isHighway: false,
    width: 16,
    points: [
      { x: 0, z: 16 },
      { x: 0, z: 75 },
      { x: 0, z: 138 },
      { x: 0, z: 202 },
      { x: 0, z: 315 },
    ],
  },
  {
    id: 'ave_east_mid',
    name: 'Midtown Bridge Road',
    isHighway: false,
    width: 14,
    points: [
      { x: 95, z: -198 },
      { x: 95, z: -102 },
      { x: 95, z: 16 },
      { x: 95, z: 75 },
      { x: 95, z: 138 },
      { x: 95, z: 202 },
      { x: 95, z: 310 },
    ],
  },
  {
    id: 'ave_coral_north',
    name: 'Coral Avenue Sever',
    isHighway: false,
    width: 15,
    points: [
      { x: 185, z: -268 },
      { x: 185, z: -165 },
      { x: 185, z: -102 },
      { x: 185, z: -46 },
    ],
  },
  {
    id: 'ave_coral_south',
    name: 'Coral Avenue Juh',
    isHighway: false,
    width: 15,
    points: [
      { x: 185, z: 6 },
      { x: 185, z: 75 },
      { x: 185, z: 138 },
      { x: 185, z: 202 },
      { x: 185, z: 292 },
    ],
  },
  // Cross Streets
  {
    id: 'street_civic_north',
    name: 'Nemocničná ulica',
    isHighway: false,
    width: 15,
    points: [
      { x: -255, z: -206 },
      { x: -140, z: -206 },
      { x: 0, z: -206 },
      { x: 95, z: -198 },
      { x: 245, z: -198 },
    ],
  },
  {
    id: 'street_midtown',
    name: 'Midtown Market Street',
    isHighway: false,
    width: 15,
    points: [
      { x: -292, z: -102 },
      { x: -140, z: -102 },
      { x: 0, z: -102 },
      { x: 95, z: -102 },
      { x: 185, z: -102 },
      { x: 288, z: -102 },
    ],
  },
  {
    id: 'street_canal_north',
    name: 'Promenáda pri kanáli',
    isHighway: false,
    width: 15,
    points: [
      { x: -315, z: 75 },
      { x: -225, z: 75 },
      { x: -140, z: 75 },
      { x: 0, z: 75 },
      { x: 95, z: 75 },
      { x: 185, z: 75 },
      { x: 294, z: 75 },
    ],
  },
  {
    id: 'street_airport_north',
    name: 'Airport Boulevard',
    isHighway: false,
    width: 15,
    points: [
      { x: -326, z: 174 },
      { x: -235, z: 174 },
      { x: -140, z: 174 },
    ],
  },
  {
    id: 'street_marina_south',
    name: 'Marina & Airport Road',
    isHighway: false,
    width: 15,
    points: [
      { x: -140, z: 202 },
      { x: 0, z: 202 },
      { x: 95, z: 202 },
      { x: 200, z: 202 },
    ],
  },
];

// Graph Nodes & Curved Polyline Edges for Interactive GPS Navigation
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

  // Ring & Highway junction nodes
  addNode('ring_e', 306, -20);
  addNode('ring_es', 292, 85);
  addNode('ring_bridge', 304, 138);
  addNode('ring_se', 272, 202);
  addNode('ring_s_coral', 185, 292);
  addNode('ring_s_mid', 65, 315);
  addNode('ring_s_cent', 0, 315);
  addNode('ring_sw', -185, 292);
  addNode('ring_w_airport', -332, 220);
  addNode('ring_w_south', -325, 110);
  addNode('ring_w', -325, -15);
  addNode('ring_wn', -295, -145);
  addNode('ring_nw', -210, -255);
  addNode('ring_n_west', -140, -288);
  addNode('ring_n_cent', 0, -308);
  addNode('ring_n_east', 185, -268);
  addNode('ring_ne', 276, -165);

  // Roundabouts
  addNode('rc_n', 0, -56);
  addNode('rc_s', 0, 16);
  addNode('rc_w', -36, -20);
  addNode('rc_e', 36, -20);

  addNode('rco_n', 185, -46);
  addNode('rco_s', 185, 6);
  addNode('rco_w', 159, -20);
  addNode('rco_e', 211, -20);

  // Inner city intersections
  addNode('w_civic', -140, -206);
  addNode('w_mid', -140, -102);
  addNode('w_s', -140, -22);
  addNode('w_canal', -140, 75);
  addNode('w_marina', -140, 202);

  addNode('c_civic', 0, -206);
  addNode('c_mid', 0, -102);
  addNode('c_canal', 0, 75);
  addNode('c_marina', 0, 202);

  addNode('e_civic', 95, -198);
  addNode('e_mid', 95, -102);
  addNode('e_sb', 95, 16);
  addNode('e_canal', 95, 75);
  addNode('e_marina', 95, 202);

  addNode('co_civic', 185, -165);
  addNode('co_mid', 185, -102);
  addNode('co_canal', 185, 75);
  addNode('co_marina', 185, 202);

  addNode('nh_w', -235, -162);
  addNode('nh_e', 230, -140);
  addNode('sh_far_e', 245, -198);

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

  // Ring Highway Connections (smooth curved segments)
  connect('ring_e', 'ring_es', [[302, 32]]);
  connect('ring_es', 'ring_bridge');
  connect('ring_bridge', 'ring_se', [[292, 174]]);
  connect('ring_se', 'ring_s_coral', [[236, 256]]);
  connect('ring_s_coral', 'ring_s_mid', [[128, 310]]);
  connect('ring_s_mid', 'ring_s_cent');
  connect('ring_s_cent', 'ring_sw', [[-95, 312]]);
  connect('ring_sw', 'ring_w_airport', [[-288, 286]]);
  connect('ring_w_airport', 'ring_w_south', [[-332, 165]]);
  connect('ring_w_south', 'ring_w', [[-330, 48]]);
  connect('ring_w', 'ring_wn', [[-318, -82]]);
  connect('ring_wn', 'ring_nw', [[-260, -210]]);
  connect('ring_nw', 'ring_n_west', [[-176, -276]]);
  connect('ring_n_west', 'ring_n_cent', [[-75, -306]]);
  connect('ring_n_cent', 'ring_n_east', [[98, -296]]);
  connect('ring_n_east', 'ring_ne', [[238, -225]]);
  connect('ring_ne', 'ring_e', [[298, -96]]);

  // North Foothill Highway
  connect('ring_w', 'nh_w', [[-312, -62]]);
  connect('nh_w', 'w_civic', [[-188, -190]]);
  connect('w_civic', 'c_civic');
  connect('c_civic', 'e_civic');
  connect('e_civic', 'co_civic');
  connect('co_civic', 'nh_e');
  connect('nh_e', 'ring_e', [[285, -80]]);
  connect('e_civic', 'sh_far_e');
  connect('sh_far_e', 'ring_ne');

  // Roundabouts arcs
  connect('rc_n', 'rc_e', [[26, -46]]);
  connect('rc_e', 'rc_s', [[26, 6]]);
  connect('rc_s', 'rc_w', [[-26, 6]]);
  connect('rc_w', 'rc_n', [[-26, -46]]);

  connect('rco_n', 'rco_e', [[204, -39]]);
  connect('rco_e', 'rco_s', [[204, -1]]);
  connect('rco_s', 'rco_w', [[166, -1]]);
  connect('rco_w', 'rco_n', [[166, -39]]);

  // S-Boulevard
  connect('ring_w', 'w_s', [[-230, 12]]);
  connect('w_s', 'rc_w', [[-82, -48]]);
  connect('rc_e', 'e_sb', [[68, 4]]);
  connect('e_sb', 'rco_w', [[128, 4]]);
  connect('rco_e', 'ring_e', [[262, -28]]);

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

  // Cross-streets
  connect('w_mid', 'c_mid');
  connect('c_mid', 'e_mid');
  connect('e_mid', 'co_mid');
  connect('co_mid', 'ring_ne', [[260, -108]]);
  connect('w_mid', 'ring_wn', [[-245, -106]]);

  connect('ring_w_south', 'w_canal', [[-235, 78]]);
  connect('w_canal', 'c_canal');
  connect('c_canal', 'e_canal');
  connect('e_canal', 'co_canal');
  connect('co_canal', 'ring_es');

  connect('ring_w_airport', 'w_marina', [[-326, 174], [-235, 174], [-140, 174]]);
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
  if (directDist < 34) {
    return [
      { x: startX, z: startZ },
      { x: targetX, z: targetZ },
    ];
  }

  // Direct route if player or destination is out on open ocean
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
      if (!last || Math.hypot(pt.x - last.x, pt.z - last.z) > 1.5) {
        route.push(pt);
      }
    }
  }
  route.push({ x: targetX, z: targetZ });
  return route;
}

// Smooth Closed Traffic Loops for Autonomous Curved Driving (Highway, Inner S-Loop, Cross-Bridge Loop)
export const TRAFFIC_LOOP_PATHS: GpsPoint[][] = [
  // Loop 1: Coastal Ring Highway (Clockwise)
  sampleSpline(RING_CTRL, 8, true),
  // Loop 2: Coastal Ring Highway (Counter-Clockwise)
  sampleSpline([...RING_CTRL].reverse(), 8, true),
  // Loop 3: North Highway + Midtown Loop
  sampleSpline(
    [
      [-310, -45],
      [-235, -162],
      [-140, -206],
      [0, -206],
      [135, -192],
      [230, -140],
      [285, -65],
      [270, -20],
      [185, -102],
      [0, -102],
      [-140, -102],
      [-240, -100],
    ],
    6,
    true
  ),
  // Loop 4: Central Bridges & Marina Loop
  sampleSpline(
    [
      [0, -56],
      [28, -42],
      [95, 16],
      [95, 138],
      [95, 202],
      [185, 202],
      [185, 138],
      [185, 6],
      [159, -20],
      [95, -102],
      [0, -102],
    ],
    6,
    true
  ),
  // Loop 5: West Downtown & Airport Loop
  sampleSpline(
    [
      [-140, -206],
      [0, -206],
      [0, -56],
      [-36, -20],
      [-82, -48],
      [-140, -22],
      [-140, 202],
      [-245, 202],
      [-285, 120],
      [-230, 12],
      [-140, -102],
    ],
    6,
    true
  ),
];
