import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { AIRPORT_HANGAR_ZONE, SAFEHOUSE_GARAGE_ZONE, SHOPS } from '../data/defaults';
import { GpsPoint, ShopDef } from '../types/game';
import { ProceduralTextureSet } from './textures';
import { createExplosiveBarrelMesh, createYachtMesh } from './models';
import {
  BRIDGE_SPANS,
  getBridgeElevationAt,
  getIslandCoastRadius,
  getIslandOutlinePoints,
  isOnBeachAt,
  isWaterAt,
  ROAD_SEGMENTS,
  RoadSegmentDef,
} from './navigation';

export interface AABBCollider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
}

export interface CircleCollider {
  x: number;
  z: number;
  radius: number;
  height: number;
}

export interface StuntRamp {
  x: number;
  z: number;
  width: number;
  length: number;
  height: number;
  heading: number;
}

export interface ExplosiveBarrelEntity {
  id: string;
  mesh: THREE.Group;
  x: number;
  z: number;
  alive: boolean;
  respawnTimer: number;
}

export interface WorldBuildResult {
  worldGroup: THREE.Group;
  colliders: AABBCollider[];
  circleColliders: CircleCollider[];
  ramps: StuntRamp[];
  barrels: ExplosiveBarrelEntity[];
  oceanMesh: THREE.Mesh;
  skyMat: THREE.ShaderMaterial;
  roadSegments: RoadSegmentDef[];
  roadRects: { x: number; z: number; w: number; l: number }[];
  buildingFootprints: { x: number; z: number; w: number; d: number; color: string }[];
  shopRings: THREE.Mesh[];
}

export function getDistrictName(x: number, z: number): string {
  const ang = Math.atan2(z, x);
  const coastR = getIslandCoastRadius(ang);
  const dist = Math.hypot(x, z);
  if (dist > coastR + 4) return 'Vice Ocean';
  if (x >= 208 && x <= 395 && z >= 215 && z <= 315) return 'Marina Bay';
  if (x >= -108 && z >= 124 && z <= 152) return 'Vice Canal';
  if (isOnBeachAt(x, z)) return 'Pobrežie Leonida';
  if (x < -120 && z >= 175) return 'Bayshore Airport';
  if (x < -140 && z >= 15) return 'Bayshore Industrial';
  if (z < -180) return 'North Heights';
  if (x > 110 && z > 145) return 'Marina Docks';
  if (x > 110 && z < 120) return 'Coral Strip';
  if (Math.hypot(x, z + 20) < 46) return 'Slnečné námestie';
  if (x >= -120 && x <= 110 && z >= -180 && z <= 120) return 'Downtown Core';
  return 'Midtown Leonida';
}

function createRoundedRectShape(w: number, d: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const hw = w / 2;
  const hd = d / 2;
  const cr = Math.min(r, hw * 0.45, hd * 0.45);
  s.moveTo(-hw + cr, -hd);
  s.lineTo(hw - cr, -hd);
  s.quadraticCurveTo(hw, -hd, hw, -hd + cr);
  s.lineTo(hw, hd - cr);
  s.quadraticCurveTo(hw, hd, hw - cr, hd);
  s.lineTo(-hw + cr, hd);
  s.quadraticCurveTo(-hw, hd, -hw, hd - cr);
  s.lineTo(-hw, -hd + cr);
  s.quadraticCurveTo(-hw, -hd, -hw + cr, -hd);
  return s;
}

// Sutherland-Hodgman half-plane polygon clip (keeps points where nx*x + nz*z <= c)
function clipPolygonHalfPlane(
  poly: GpsPoint[],
  nx: number,
  nz: number,
  c: number
): GpsPoint[] {
  if (poly.length < 3) return [];
  const out: GpsPoint[] = [];
  const inside = (p: GpsPoint) => nx * p.x + nz * p.z <= c + 1e-4;
  const intersect = (a: GpsPoint, b: GpsPoint): GpsPoint => {
    const da = nx * a.x + nz * a.z - c;
    const db = nx * b.x + nz * b.z - c;
    const denom = da - db;
    const t = Math.abs(denom) < 1e-8 ? 0.5 : da / denom;
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
  };

  for (let i = 0; i < poly.length; i++) {
    const curr = poly[i];
    const prev = poly[(i + poly.length - 1) % poly.length];
    const currIn = inside(curr);
    const prevIn = inside(prev);
    if (currIn) {
      if (!prevIn) out.push(intersect(prev, curr));
      out.push(curr);
    } else if (prevIn) {
      out.push(intersect(prev, curr));
    }
  }
  return out;
}

function buildLandmassGeometry(
  poly: GpsPoint[],
  uvScale: number
): THREE.BufferGeometry | null {
  if (poly.length < 3) return null;
  const shape = new THREE.Shape();
  shape.moveTo(poly[0].x, -poly[0].z);
  for (let i = 1; i < poly.length; i++) {
    shape.lineTo(poly[i].x, -poly[i].z);
  }
  shape.closePath();

  const geo = new THREE.ShapeGeometry(shape, 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, pos.getX(i) * uvScale, pos.getZ(i) * uvScale);
  }
  return geo;
}

function resamplePolylineForRoad(points: GpsPoint[], closed?: boolean): GpsPoint[] {
  const src = closed ? [...points, points[0]] : points;
  const out: GpsPoint[] = [];
  for (let i = 0; i < src.length - 1; i++) {
    const a = src[i];
    const b = src[i + 1];
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(dist / 5));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  if (src.length > 0) {
    out.push(src[src.length - 1]);
  }
  return out;
}

function createCurvedRoadGeometry(
  rawPoints: GpsPoint[],
  width: number,
  closed?: boolean,
  baseY = 0.028
): THREE.BufferGeometry {
  const pts = resamplePolylineForRoad(rawPoints, closed);
  const hw = width * 0.5;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  let arcDist = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const prev = i > 0 ? pts[i - 1] : p;
    const next = i < pts.length - 1 ? pts[i + 1] : p;
    if (i > 0) {
      arcDist += Math.hypot(p.x - prev.x, p.z - prev.z);
    }
    let tx = next.x - prev.x;
    let tz = next.z - prev.z;
    const tlen = Math.hypot(tx, tz) || 1;
    tx /= tlen;
    tz /= tlen;
    // Right normal
    const nx = -tz;
    const nz = tx;

    const lx = p.x - nx * hw;
    const lz = p.z - nz * hw;
    const rx = p.x + nx * hw;
    const rz = p.z + nz * hw;

    const ly = baseY + getBridgeElevationAt(lx, lz);
    const ry = baseY + getBridgeElevationAt(rx, rz);

    positions.push(lx, ly, lz, rx, ry, rz);
    normals.push(0, 1, 0, 0, 1, 0);
    uvs.push(0, arcDist / 20, 1, arcDist / 20);

    if (i < pts.length - 1) {
      const base = i * 2;
      indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function pointToSegmentDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 1e-6) return Math.hypot(px - ax, pz - az);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lenSq));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

function distanceToRoadNetwork(x: number, z: number): number {
  let minClearance = Infinity;
  for (const seg of ROAD_SEGMENTS) {
    const pts = seg.closed ? [...seg.points, seg.points[0]] : seg.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const d = pointToSegmentDist(x, z, pts[i].x, pts[i].z, pts[i + 1].x, pts[i + 1].z);
      const clearance = d - seg.width * 0.5;
      if (clearance < minClearance) minClearance = clearance;
    }
  }
  return minClearance;
}

function createPalmCrownGeometry(): THREE.BufferGeometry {
  const fronds: THREE.BufferGeometry[] = [];
  const frondCount = 7;
  for (let i = 0; i < frondCount; i++) {
    const angle = (i / frondCount) * Math.PI * 2;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 7.6, 0),
      new THREE.Vector3(Math.cos(angle) * 1.35, 8.25, Math.sin(angle) * 1.35),
      new THREE.Vector3(Math.cos(angle) * 2.75, 7.75, Math.sin(angle) * 2.75),
      new THREE.Vector3(Math.cos(angle) * 3.7, 6.65, Math.sin(angle) * 3.7),
    ]);
    const tube = new THREE.TubeGeometry(curve, 8, 0.2, 5, false);
    tube.scale(1, 0.45, 1);
    fronds.push(tube);
  }
  return BufferGeometryUtils.mergeGeometries(fronds);
}

export function buildOpenWorld(textures: ProceduralTextureSet): WorldBuildResult {
  const worldGroup = new THREE.Group();
  const colliders: AABBCollider[] = [];
  const circleColliders: CircleCollider[] = [];
  const ramps: StuntRamp[] = [];
  const barrels: ExplosiveBarrelEntity[] = [];
  const roadRects: { x: number; z: number; w: number; l: number }[] = [];
  const buildingFootprints: { x: number; z: number; w: number; d: number; color: string }[] = [];
  const shopRings: THREE.Mesh[] = [];

  // 0. Atmospheric Vice Horizon Sky Dome (Encloses 5x Island & Endless Sea)
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTopColor: { value: new THREE.Color(0x0f172a) },
      uMidColor: { value: new THREE.Color(0x7c3aed) },
      uHorizonColor: { value: new THREE.Color(0xfb923c) },
      uSunDir: { value: new THREE.Vector3(0.68, 0.34, 0.42).normalize() },
      uSunColor: { value: new THREE.Color(0xfff1c9) },
      uSunStrength: { value: 1.0 },
    },
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform vec3 uTopColor;
      uniform vec3 uMidColor;
      uniform vec3 uHorizonColor;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform float uSunStrength;
      varying vec3 vWorldPos;
      void main() {
        vec3 dir = normalize(vWorldPos);
        float h = clamp(dir.y, 0.0, 1.0);
        vec3 col = mix(uHorizonColor, uMidColor, smoothstep(0.0, 0.28, h));
        col = mix(col, uTopColor, smoothstep(0.24, 0.82, h));
        float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
        float halo = pow(sunDot, 12.0) * 0.45 * uSunStrength;
        float corona = pow(sunDot, 140.0) * 1.15 * uSunStrength;
        float disc = smoothstep(0.9986, 0.9994, sunDot) * 2.2 * uSunStrength;
        col += uSunColor * (halo + corona + disc);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const skyDome = new THREE.Mesh(new THREE.SphereGeometry(1250, 32, 20), skyMat);
  worldGroup.add(skyDome);

  // 1. Endless Ocean Surrounding All Sides of the 5x Island (No visible walls!)
  const oceanMat = new THREE.MeshPhysicalMaterial({
    map: textures.ocean,
    normalMap: textures.oceanNormal,
    normalScale: new THREE.Vector2(0.46, 0.46),
    color: 0x0ea5e9,
    roughness: 0.07,
    metalness: 0.22,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    envMapIntensity: 1.45,
  });
  textures.ocean.repeat.set(36, 36);
  textures.oceanNormal.repeat.set(44, 44);
  const oceanMesh = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), oceanMat);
  oceanMesh.rotation.x = -Math.PI / 2;
  oceanMesh.position.set(0, -0.35, 0);
  oceanMesh.receiveShadow = true;
  worldGroup.add(oceanMesh);

  // 2. 5x Organic Island Landmass (Sandy Coastal Perimeter + Urban Inland + Vice Canal & Marina Bay Cutouts)
  const sandMat = new THREE.MeshStandardMaterial({
    map: textures.sand,
    roughness: 0.94,
    metalness: 0.02,
  });
  textures.sand.repeat.set(1, 1);

  const groundMat = new THREE.MeshStandardMaterial({
    map: textures.sidewalk,
    roughness: 0.88,
    metalness: 0.04,
  });
  textures.sidewalk.repeat.set(1, 1);

  const outerOutline = getIslandOutlinePoints(120);
  const innerOutline = outerOutline.map((p) => ({ x: p.x * 0.932, z: p.z * 0.932 }));

  const splitIslandPolygons = (poly: GpsPoint[]): GpsPoint[][] => {
    const pieces: GpsPoint[][] = [];
    // North Island (z <= 124)
    pieces.push(clipPolygonHalfPlane(poly, 0, 1, 124));
    // West Land Connector around Vice Canal (x <= -108, 124 <= z <= 152)
    let westConn = clipPolygonHalfPlane(poly, 1, 0, -108);
    westConn = clipPolygonHalfPlane(westConn, 0, -1, -124);
    westConn = clipPolygonHalfPlane(westConn, 0, 1, 152);
    pieces.push(westConn);
    // South Island West of Marina (x <= 208, z >= 152)
    let southWest = clipPolygonHalfPlane(poly, 0, -1, -152);
    southWest = clipPolygonHalfPlane(southWest, 1, 0, 208);
    pieces.push(southWest);
    // South Island East strip above Marina Harbor (x >= 208, 152 <= z <= 215)
    let southEastNorth = clipPolygonHalfPlane(poly, 0, -1, -152);
    southEastNorth = clipPolygonHalfPlane(southEastNorth, -1, 0, -208);
    southEastNorth = clipPolygonHalfPlane(southEastNorth, 0, 1, 215);
    pieces.push(southEastNorth);
    // South Island East strip below Marina Harbor (x >= 208, z >= 315)
    let southEastSouth = clipPolygonHalfPlane(poly, 0, -1, -315);
    southEastSouth = clipPolygonHalfPlane(southEastSouth, -1, 0, -208);
    pieces.push(southEastSouth);
    return pieces;
  };

  const sandGeos: THREE.BufferGeometry[] = [];
  for (const piece of splitIslandPolygons(outerOutline)) {
    const g = buildLandmassGeometry(piece, 0.045);
    if (g) sandGeos.push(g.toNonIndexed());
  }
  if (sandGeos.length > 0) {
    const mergedSand = BufferGeometryUtils.mergeGeometries(sandGeos);
    const sandMesh = new THREE.Mesh(mergedSand, sandMat);
    sandMesh.position.y = -0.025;
    sandMesh.receiveShadow = true;
    worldGroup.add(sandMesh);
    sandGeos.forEach((g) => g.dispose());
  }

  const urbanGeos: THREE.BufferGeometry[] = [];
  for (const piece of splitIslandPolygons(innerOutline)) {
    const g = buildLandmassGeometry(piece, 0.055);
    if (g) urbanGeos.push(g.toNonIndexed());
  }
  if (urbanGeos.length > 0) {
    const mergedUrban = BufferGeometryUtils.mergeGeometries(urbanGeos);
    const urbanMesh = new THREE.Mesh(mergedUrban, groundMat);
    urbanMesh.position.y = 0.0;
    urbanMesh.receiveShadow = true;
    worldGroup.add(urbanMesh);
    urbanGeos.forEach((g) => g.dispose());
  }

  // Stone Canal & Marina Quay Embankment Walls
  const canalWallMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.78 });
  const northCanalWall = new THREE.Mesh(new THREE.BoxGeometry(510, 1.5, 1.0), canalWallMat);
  northCanalWall.position.set(147, -0.68, 124);
  const southCanalWall = new THREE.Mesh(new THREE.BoxGeometry(510, 1.5, 1.0), canalWallMat);
  southCanalWall.position.set(147, -0.68, 152);
  const westCanalCap = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.5, 29), canalWallMat);
  westCanalCap.position.set(-108, -0.68, 138);
  const marinaWestWall = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.5, 102), canalWallMat);
  marinaWestWall.position.set(208, -0.68, 265);
  const marinaNorthWall = new THREE.Mesh(new THREE.BoxGeometry(156, 1.5, 1.4), canalWallMat);
  marinaNorthWall.position.set(286, -0.68, 215);
  worldGroup.add(northCanalWall, southCanalWall, westCanalCap, marinaWestWall, marinaNorthWall);

  // Scenic Roundabout Plazas & Central Water Fountains
  const plazaGrassMat = new THREE.MeshStandardMaterial({ color: 0x2f6b47, roughness: 0.9 });
  const marbleMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.35, metalness: 0.12 });
  const fountainWaterMat = new THREE.MeshPhysicalMaterial({ color: 0x38bdf8, roughness: 0.08, clearcoat: 1 });

  const addRoundaboutPlaza = (cx: number, cz: number, radius: number) => {
    const grass = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius + 0.4, 0.22, 32), plazaGrassMat);
    grass.position.set(cx, 0.11, cz);
    grass.receiveShadow = true;
    worldGroup.add(grass);

    const basin = new THREE.Mesh(new THREE.CylinderGeometry(6.8, 7.2, 0.75, 24), marbleMat);
    basin.position.set(cx, 0.45, cz);
    const pool = new THREE.Mesh(new THREE.CylinderGeometry(5.9, 5.9, 0.6, 24), fountainWaterMat);
    pool.position.set(cx, 0.62, cz);
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.8, 3.2, 16), marbleMat);
    spire.position.set(cx, 1.8, cz);
    const crown = new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.25, 10, 24), marbleMat);
    crown.rotation.x = Math.PI / 2;
    crown.position.set(cx, 3.2, cz);
    worldGroup.add(basin, pool, spire, crown);
    circleColliders.push({ x: cx, z: cz, radius: 7.4, height: 3.8 });
  };
  addRoundaboutPlaza(0, -20, 25);
  addRoundaboutPlaza(185, -20, 16.5);

  // Rolling Green Foothills in North Heights
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x2a5c3f, roughness: 0.94 });
  const northHills: [number, number, number, number][] = [
    [-255, -270, 38, 16],
    [-165, -335, 44, 21],
    [-40, -355, 52, 24],
    [85, -345, 46, 20],
    [205, -310, 42, 18],
  ];
  for (const [hx, hz, hr, hh] of northHills) {
    const hill = new THREE.Mesh(new THREE.SphereGeometry(hr, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), hillMat);
    hill.scale.set(1.25, hh / hr, 0.95);
    hill.position.set(hx, -0.5, hz);
    hill.receiveShadow = true;
    worldGroup.add(hill);
    circleColliders.push({ x: hx, z: hz, radius: hr * 0.85, height: hh });
  }

  // 3. Curved Roads, Highways & Roundabouts (Batched into clean continuous meshes!)
  const streetTex = textures.asphalt.clone();
  streetTex.needsUpdate = true;
  const streetMat = new THREE.MeshStandardMaterial({
    map: streetTex,
    normalMap: textures.asphaltNormal,
    normalScale: new THREE.Vector2(0.32, 0.32),
    roughness: 0.62,
    metalness: 0.1,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  const highwayMat = new THREE.MeshStandardMaterial({
    map: streetTex,
    normalMap: textures.asphaltNormal,
    normalScale: new THREE.Vector2(0.35, 0.35),
    color: 0xdbeafe,
    roughness: 0.55,
    metalness: 0.16,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

  const highwayGeos: THREE.BufferGeometry[] = [];
  const streetGeos: THREE.BufferGeometry[] = [];
  for (const seg of ROAD_SEGMENTS) {
    const geo = createCurvedRoadGeometry(seg.points, seg.width, seg.closed, seg.isHighway ? 0.036 : 0.028).toNonIndexed();
    if (seg.isHighway) {
      highwayGeos.push(geo);
    } else {
      streetGeos.push(geo);
    }
  }
  if (streetGeos.length > 0) {
    const m = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(streetGeos), streetMat);
    m.receiveShadow = true;
    worldGroup.add(m);
    streetGeos.forEach((g) => g.dispose());
  }
  if (highwayGeos.length > 0) {
    const m = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(highwayGeos), highwayMat);
    m.receiveShadow = true;
    worldGroup.add(m);
    highwayGeos.forEach((g) => g.dispose());
  }

  // 4. Arched Bridges over Vice Canal with Solid Guardrails
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.72 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.55, roughness: 0.36 });
  for (const b of BRIDGE_SPANS) {
    const spanLen = b.zEnd - b.zStart;
    const bridgeSegs = 10;
    const segLen = spanLen / bridgeSegs;
    for (let s = 0; s < bridgeSegs; s++) {
      const zMid = b.zStart + (s + 0.5) * segLen;
      const yMid = getBridgeElevationAt(b.x, zMid);
      const y0 = getBridgeElevationAt(b.x, b.zStart + s * segLen);
      const y1 = getBridgeElevationAt(b.x, b.zStart + (s + 1) * segLen);
      const slope = Math.atan2(y1 - y0, segLen);
      const deck = new THREE.Mesh(new THREE.BoxGeometry(b.width + 0.6, 0.38, segLen + 0.3), deckMat);
      deck.position.set(b.x, yMid - 0.14, zMid);
      deck.rotation.x = -slope;
      deck.receiveShadow = true;
      worldGroup.add(deck);
    }
    const halfW = b.width * 0.5;
    [-halfW, halfW].forEach((gx) => {
      const rail = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, spanLen - 1, 4, 8), railMat);
      rail.rotation.x = Math.PI / 2;
      rail.position.set(b.x + gx, b.peakElevation * 0.62 + 1.0, (b.zStart + b.zEnd) * 0.5);
      worldGroup.add(rail);
      colliders.push({
        minX: b.x + gx - 0.35,
        maxX: b.x + gx + 0.35,
        minZ: b.zStart + 0.5,
        maxZ: b.zEnd - 0.5,
        height: b.peakElevation + 2.5,
      });
    });
  }

  // 5. Massive Bayshore International Airport (Twin Runways, Taxiways, Lights, Control Tower, Fuel Depot & 2 Open Hangars)
  const asphaltDarkMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.78,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  const apronMat = new THREE.MeshStandardMaterial({
    color: 0x263244,
    roughness: 0.84,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });

  // Main Concrete Apron Deck
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(176, 98), apronMat);
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(-235, 0.031, 232);
  apron.receiveShadow = true;
  worldGroup.add(apron);

  // Main East-West Runway (166m x 22m at z = 256)
  const runwayMain = new THREE.Mesh(new THREE.PlaneGeometry(166, 22), asphaltDarkMat);
  runwayMain.rotation.x = -Math.PI / 2;
  runwayMain.position.set(-235, 0.038, 256);
  runwayMain.receiveShadow = true;
  worldGroup.add(runwayMain);

  // Crosswind Secondary Runway (88m x 16m at x = -172, z = 228)
  const runwayCross = new THREE.Mesh(new THREE.PlaneGeometry(16, 86), asphaltDarkMat);
  runwayCross.rotation.x = -Math.PI / 2;
  runwayCross.position.set(-172, 0.037, 230);
  runwayCross.receiveShadow = true;
  worldGroup.add(runwayCross);

  const stripeMat = new THREE.MeshBasicMaterial({ color: 0xf8fafc });
  const yellowLineMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
  for (let rx = -312; rx <= -160; rx += 11) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 0.52), stripeMat);
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(rx, 0.045, 256);
    worldGroup.add(dash);
  }
  for (let rz = 192; rz <= 268; rz += 10) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 5.4), stripeMat);
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(-172, 0.045, rz);
    worldGroup.add(dash);
  }
  // Taxiway yellow guide line connecting Hangars to Runway
  const taxiGuide = new THREE.Mesh(new THREE.PlaneGeometry(122, 0.45), yellowLineMat);
  taxiGuide.rotation.x = -Math.PI / 2;
  taxiGuide.position.set(-244, 0.044, 228);
  worldGroup.add(taxiGuide);

  // Instanced Glowing Runway Edge Lights (High FPS!)
  const runwayLightCoords: [number, number, number][] = [];
  for (let lx = -314; lx <= -156; lx += 14) {
    runwayLightCoords.push([lx, 245.5, 0x38bdf8]);
    runwayLightCoords.push([lx, 266.5, 0x38bdf8]);
  }
  for (const lz of [249, 253, 259, 263]) {
    runwayLightCoords.push([-316, lz, 0x22c55e]);
    runwayLightCoords.push([-154, lz, 0xef4444]);
  }
  if (runwayLightCoords.length > 0) {
    const rLightGeo = new THREE.SphereGeometry(0.24, 8, 6);
    rLightGeo.translate(0, 0.18, 0);
    const rLightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const rLightInst = new THREE.InstancedMesh(rLightGeo, rLightMat, runwayLightCoords.length);
    const dummy = new THREE.Object3D();
    const c = new THREE.Color();
    runwayLightCoords.forEach(([lx, lz, hex], idx) => {
      dummy.position.set(lx, 0, lz);
      dummy.updateMatrix();
      rLightInst.setMatrixAt(idx, dummy.matrix);
      c.setHex(hex);
      rLightInst.setColorAt(idx, c);
    });
    rLightInst.computeBoundingSphere();
    worldGroup.add(rLightInst);
  }

  // Helper: Open-Front 3-Wall Aircraft Hangar (Open +Z facing Main Runway — Zero Doorway Collider!)
  const addOpenHangar = (
    cx: number,
    cz: number,
    hw: number,
    hd: number,
    hh: number,
    trimHex: number,
    isPlayerStorage: boolean
  ) => {
    const hg = new THREE.Group();
    hg.position.set(cx, 0, cz);
    const hWallMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.55, roughness: 0.42 });
    const hRoofMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.62, roughness: 0.36 });
    const bayMat = new THREE.MeshBasicMaterial({ color: trimHex });
    const thick = 0.8;

    // Back wall (-Z)
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(hw, hh, thick), hWallMat);
    backWall.position.set(0, hh * 0.5, -hd * 0.5 + thick * 0.5);
    backWall.castShadow = true;
    backWall.receiveShadow = true;
    // Left wall (-X)
    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(thick, hh, hd), hWallMat);
    leftWall.position.set(-hw * 0.5 + thick * 0.5, hh * 0.5, 0);
    leftWall.castShadow = true;
    // Right wall (+X)
    const rightWall = new THREE.Mesh(new THREE.BoxGeometry(thick, hh, hd), hWallMat);
    rightWall.position.set(hw * 0.5 - thick * 0.5, hh * 0.5, 0);
    rightWall.castShadow = true;
    // Curved Barrel-Vault Roof
    const roof = new THREE.Mesh(
      new THREE.CylinderGeometry(hw * 0.5, hw * 0.5, hd, 16, 1, false, 0, Math.PI),
      hRoofMat
    );
    roof.rotation.z = Math.PI / 2;
    roof.rotation.y = Math.PI / 2;
    roof.scale.set(1, 1, 0.32);
    roof.position.set(0, hh, 0);
    roof.castShadow = true;

    // Glowing Entrance Strip + Floor Bay Perimeter
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(hw + 0.4, 0.32, 0.4), bayMat);
    lintel.position.set(0, hh + 0.15, hd * 0.5);
    const floorPad = new THREE.Mesh(new THREE.PlaneGeometry(hw - 3.2, hd - 2.6), apronMat);
    floorPad.rotation.x = -Math.PI / 2;
    floorPad.position.set(0, 0.042, 0);
    const bayRing = new THREE.Mesh(new THREE.BoxGeometry(hw - 2.4, 0.05, 0.28), bayMat);
    bayRing.position.set(0, 0.05, hd * 0.5 - 0.5);
    hg.add(backWall, leftWall, rightWall, roof, lintel, floorPad, bayRing);

    if (isPlayerStorage) {
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), bayMat);
      beacon.position.set(0, hh + 2.6, hd * 0.5);
      hg.add(beacon);
    }

    worldGroup.add(hg);
    // Add colliders ONLY for Back, Left, Right walls — Front +Z is completely open to taxi/park inside!
    colliders.push(
      { minX: cx - hw * 0.5, maxX: cx + hw * 0.5, minZ: cz - hd * 0.5, maxZ: cz - hd * 0.5 + thick + 0.15, height: hh + 2 },
      { minX: cx - hw * 0.5, maxX: cx - hw * 0.5 + thick + 0.15, minZ: cz - hd * 0.5, maxZ: cz + hd * 0.5, height: hh + 2 },
      { minX: cx + hw * 0.5 - thick - 0.15, maxX: cx + hw * 0.5, minZ: cz - hd * 0.5, maxZ: cz + hd * 0.5, height: hh + 2 }
    );
  };

  // Player Storage Hangar (AIRPORT_HANGAR_ZONE: x:-268, z:204) + Fleet Hangar
  addOpenHangar(AIRPORT_HANGAR_ZONE.x, AIRPORT_HANGAR_ZONE.z, 28, 24, 10.5, 0x06b6d4, true);
  addOpenHangar(-218, 204, 24, 22, 10.0, 0xf59e0b, false);

  // Air Traffic Control Tower + Radar Dish at West Apron Edge
  const towerStem = new THREE.Mesh(
    new THREE.CylinderGeometry(2.4, 3.1, 22, 14),
    new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.48 })
  );
  towerStem.position.set(-306, 11, 226);
  const towerCab = new THREE.Mesh(
    new THREE.CylinderGeometry(4.8, 3.6, 3.8, 16),
    new THREE.MeshPhysicalMaterial({ color: 0x06b6d4, roughness: 0.1, clearcoat: 1 })
  );
  towerCab.position.set(-306, 23.2, 226);
  const radarDish = new THREE.Mesh(
    new THREE.BoxGeometry(3.4, 0.7, 0.25),
    new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.7, roughness: 0.25 })
  );
  radarDish.position.set(-306, 26.2, 226);
  worldGroup.add(towerStem, towerCab, radarDish);
  colliders.push({ minX: -309.5, maxX: -302.5, minZ: 222.5, maxZ: 229.5, height: 26 });

  // Aviation Fuel Tanks
  [-295, -287].forEach((fx) => {
    const tank = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.2, 7.2, 14),
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.35, metalness: 0.4 })
    );
    tank.rotation.z = Math.PI / 2;
    tank.position.set(fx, 2.2, 198);
    tank.castShadow = true;
    worldGroup.add(tank);
  });
  colliders.push({ minX: -299, maxX: -283, minZ: 195.5, maxZ: 200.5, height: 4.8 });

  // Open-Front 3-Wall Safehouse Drive-In Garage (SAFEHOUSE_GARAGE_ZONE: x: 159, z: -224, open South +Z)
  {
    const gx = SAFEHOUSE_GARAGE_ZONE.x;
    const gz = SAFEHOUSE_GARAGE_ZONE.z;
    const gw = 11.2;
    const gd = 13.0;
    const gh = 4.6;
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.52, metalness: 0.12 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.45, metalness: 0.35 });
    const glowStripMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    const gg = new THREE.Group();
    gg.position.set(gx, 0, gz);

    const gBack = new THREE.Mesh(new THREE.BoxGeometry(gw, gh, 0.75), wallMat);
    gBack.position.set(0, gh * 0.5, -gd * 0.5 + 0.375);
    gBack.castShadow = true;
    const gLeft = new THREE.Mesh(new THREE.BoxGeometry(0.75, gh, gd), wallMat);
    gLeft.position.set(-gw * 0.5 + 0.375, gh * 0.5, 0);
    gLeft.castShadow = true;
    const gRight = new THREE.Mesh(new THREE.BoxGeometry(0.75, gh, gd), wallMat);
    gRight.position.set(gw * 0.5 - 0.375, gh * 0.5, 0);
    gRight.castShadow = true;
    const gRoof = new THREE.Mesh(new THREE.BoxGeometry(gw + 0.5, 0.55, gd + 0.5), trimMat);
    gRoof.position.set(0, gh + 0.275, 0);
    gRoof.castShadow = true;
    const gNeon = new THREE.Mesh(new THREE.BoxGeometry(gw + 0.2, 0.22, 0.25), glowStripMat);
    gNeon.position.set(0, gh + 0.1, gd * 0.5);
    const gFloor = new THREE.Mesh(new THREE.PlaneGeometry(gw - 1.5, gd - 1.2), apronMat);
    gFloor.rotation.x = -Math.PI / 2;
    gFloor.position.set(0, 0.04, 0);
    const gLine = new THREE.Mesh(new THREE.BoxGeometry(gw - 2.0, 0.04, 0.22), glowStripMat);
    gLine.position.set(0, 0.05, gd * 0.5 - 0.4);
    gg.add(gBack, gLeft, gRight, gRoof, gNeon, gFloor, gLine);
    worldGroup.add(gg);

    colliders.push(
      { minX: gx - gw * 0.5, maxX: gx + gw * 0.5, minZ: gz - gd * 0.5, maxZ: gz - gd * 0.5 + 0.9, height: gh + 1 },
      { minX: gx - gw * 0.5, maxX: gx - gw * 0.5 + 0.9, minZ: gz - gd * 0.5, maxZ: gz + gd * 0.5, height: gh + 1 },
      { minX: gx + gw * 0.5 - 0.9, maxX: gx + gw * 0.5, minZ: gz - gd * 0.5, maxZ: gz + gd * 0.5, height: gh + 1 }
    );
  }

  // 6. All 10 Enterable 3D Shops & Service Buildings (Including Barber Pole & Tattoo Neon)
  const addEnterableShopBuilding = (shop: ShopDef) => {
    const isGarage = shop.category === 'garage';
    const isFire = shop.category === 'fire_station';
    const isHospital = shop.category === 'hospital';
    const isPoliceStation = shop.category === 'police_station';
    const isBarber = shop.category === 'barber';
    const isTattoo = shop.category === 'tattoo';
    const isSafehouse = shop.category === 'safehouse';
    const isWide = isGarage || isFire;
    const w = isWide ? 16 : 14;
    const d = isWide ? 15 : 13;
    const h = isHospital || isPoliceStation || isFire ? 6.2 : 5.4;
    const wallThick = 0.85;
    const doorHalf = isWide ? 3.5 : 2.3;

    const g = new THREE.Group();
    g.position.set(shop.x, 0, shop.z);

    const floorMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.42, metalness: 0.15 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.5, d - 0.5), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.04;
    floor.receiveShadow = true;
    g.add(floor);

    const wallColor = isGarage
      ? 0x334155
      : isFire
        ? 0x991b1b
        : isPoliceStation
          ? 0x1e293b
          : isTattoo
            ? 0x18181b
            : isSafehouse
              ? 0xfef3c7
              : 0xf1f5f9;
    const wallMat = new THREE.MeshStandardMaterial({
      color: wallColor,
      roughness: 0.52,
      metalness: 0.16,
    });
    const neonHex = new THREE.Color(shop.color).getHex();
    const neonMat = new THREE.MeshStandardMaterial({
      color: neonHex,
      emissive: neonHex,
      emissiveIntensity: 2.2,
    });

    const dx = shop.doorX - shop.x;
    const dz = shop.doorZ - shop.z;
    const doorSide: 'west' | 'east' | 'south' | 'north' =
      Math.abs(dx) > Math.abs(dz) ? (dx < 0 ? 'west' : 'east') : dz > 0 ? 'south' : 'north';

    const addWallSeg = (lx: number, lz: number, sw: number, sd: number, sh = h, ly = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sw, sh, sd), wallMat);
      m.position.set(lx, ly + sh * 0.5, lz);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
      if (ly === 0) {
        colliders.push({
          minX: shop.x + lx - sw * 0.5 - 0.12,
          maxX: shop.x + lx + sw * 0.5 + 0.12,
          minZ: shop.z + lz - sd * 0.5 - 0.12,
          maxZ: shop.z + lz + sd * 0.5 + 0.12,
          height: sh + 0.8,
        });
      }
    };

    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.6, 0.7, d + 0.6),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.7 })
    );
    roof.position.y = h + 0.35;
    roof.castShadow = true;
    g.add(roof);

    const neonTrim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.75, 0.28, d + 0.75), neonMat);
    neonTrim.position.y = h + 0.05;
    g.add(neonTrim);

    const signZ = doorSide === 'south' ? d / 2 + 0.28 : -d / 2 - 0.28;
    if (isHospital) {
      const crossMat = new THREE.MeshStandardMaterial({ color: 0xf43f5e, emissive: 0xf43f5e, emissiveIntensity: 2.4 });
      const vBar = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 2.2, 4, 8), crossMat);
      const hBar = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 2.2, 4, 8), crossMat);
      hBar.rotation.z = Math.PI / 2;
      vBar.position.set(0, h + 1.9, signZ);
      hBar.position.set(0, h + 1.9, signZ);
      g.add(vBar, hBar);
    } else if (isPoliceStation) {
      const copBlue = new THREE.MeshStandardMaterial({ color: 0x3b82f6, emissive: 0x3b82f6, emissiveIntensity: 2.6 });
      const copRed = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xef4444, emissiveIntensity: 2.6 });
      const bL = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 2.4, 4, 8), copBlue);
      bL.rotation.z = Math.PI / 2;
      bL.position.set(-1.5, h + 1.35, signZ);
      const bR = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 2.4, 4, 8), copRed);
      bR.rotation.z = Math.PI / 2;
      bR.position.set(1.5, h + 1.35, signZ);
      g.add(bL, bR);
    } else if (isFire) {
      const goldMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xf59e0b, emissiveIntensity: 1.8 });
      const bar = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 4.6, 4, 8), goldMat);
      bar.rotation.z = Math.PI / 2;
      bar.position.set(0, h + 1.35, signZ);
      g.add(bar);
    } else if (isBarber) {
      // Classic Red-White-Blue Barber Pole flanking the doorway
      const poleColors = [0xef4444, 0xf8fafc, 0x3b82f6];
      for (let i = 0; i < 3; i++) {
        const ring = new THREE.Mesh(
          new THREE.CylinderGeometry(0.24, 0.24, 0.48, 12),
          new THREE.MeshStandardMaterial({ color: poleColors[i], emissive: poleColors[i], emissiveIntensity: 0.7 })
        );
        ring.position.set(-3.2, 1.8 + i * 0.48, signZ + 0.15);
        g.add(ring);
      }
    } else if (isTattoo) {
      // Glowing Neon Star Sign above Tattoo Parlor
      const inkNeon = new THREE.MeshStandardMaterial({ color: 0xa855f7, emissive: 0xc084fc, emissiveIntensity: 2.8 });
      const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(0.75, 0), inkNeon);
      diamond.position.set(0, h + 1.6, signZ);
      g.add(diamond);
    } else if (isSafehouse) {
      // Terrace Awning
      const awning = new THREE.Mesh(
        new THREE.BoxGeometry(5.6, 0.2, 1.8),
        new THREE.MeshStandardMaterial({ color: 0x06b6d4, roughness: 0.45 })
      );
      awning.position.set(0, 3.3, signZ + (doorSide === 'south' ? 0.65 : -0.65));
      g.add(awning);
    }

    if (doorSide !== 'north') addWallSeg(0, -d / 2 + wallThick / 2, w, wallThick);
    if (doorSide !== 'south') addWallSeg(0, d / 2 - wallThick / 2, w, wallThick);
    if (doorSide !== 'west') addWallSeg(-w / 2 + wallThick / 2, 0, wallThick, d);
    if (doorSide !== 'east') addWallSeg(w / 2 - wallThick / 2, 0, wallThick, d);

    if (doorSide === 'west' || doorSide === 'east') {
      const wx = doorSide === 'west' ? -w / 2 + wallThick / 2 : w / 2 - wallThick / 2;
      const segD = d / 2 - doorHalf;
      addWallSeg(wx, -d / 2 + segD / 2, wallThick, segD);
      addWallSeg(wx, d / 2 - segD / 2, wallThick, segD);
      addWallSeg(wx, 0, wallThick, doorHalf * 2, 1.4, h - 1.4);
    } else {
      const wz = doorSide === 'south' ? d / 2 - wallThick / 2 : -d / 2 + wallThick / 2;
      const segW = w / 2 - doorHalf;
      addWallSeg(-w / 2 + segW / 2, wz, segW, wallThick);
      addWallSeg(w / 2 - segW / 2, wz, segW, wallThick);
      addWallSeg(0, wz, doorHalf * 2, wallThick, 1.4, h - 1.4);
    }

    const counter = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.45, 3.6, 6, 12),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.4, metalness: 0.4 })
    );
    counter.rotation.z = Math.PI / 2;
    if (doorSide === 'west') {
      counter.rotation.y = Math.PI / 2;
      counter.position.set(2.4, 0.6, 0);
      colliders.push({ minX: shop.x + 1.85, maxX: shop.x + 2.95, minZ: shop.z - 2.2, maxZ: shop.z + 2.2, height: 1.5 });
    } else if (doorSide === 'east') {
      counter.rotation.y = Math.PI / 2;
      counter.position.set(-2.4, 0.6, 0);
      colliders.push({ minX: shop.x - 2.95, maxX: shop.x - 1.85, minZ: shop.z - 2.2, maxZ: shop.z + 2.2, height: 1.5 });
    } else {
      counter.position.set(0, 0.6, -2.4);
      colliders.push({ minX: shop.x - 2.2, maxX: shop.x + 2.2, minZ: shop.z - 2.95, maxZ: shop.z - 1.85, height: 1.5 });
    }
    g.add(counter);

    const interiorLight = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 3.2, 4, 8), neonMat);
    interiorLight.rotation.z = Math.PI / 2;
    interiorLight.position.set(0, h - 0.35, 0);
    g.add(interiorLight);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.15, 0.08, 10, 28),
      new THREE.MeshBasicMaterial({ color: neonHex })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(shop.doorX, 0.12, shop.doorZ);
    worldGroup.add(ring);
    shopRings.push(ring);

    worldGroup.add(g);
    buildingFootprints.push({ x: shop.x, z: shop.z, w, d, color: shop.color });
  };

  SHOPS.forEach(addEnterableShopBuilding);

  // 7. High-FPS Batched City Skyline (Merged BufferGeometries by Material for 60+ FPS across 5x Island!)
  const modernMat = new THREE.MeshPhysicalMaterial({
    map: textures.buildingModern,
    emissiveMap: textures.buildingModernEmissive,
    emissive: 0xffffff,
    emissiveIntensity: 0.72,
    roughness: 0.2,
    metalness: 0.62,
    clearcoat: 0.85,
    envMapIntensity: 1.45,
  });
  const decoMat = new THREE.MeshStandardMaterial({
    map: textures.buildingArtDeco,
    emissiveMap: textures.buildingArtDecoEmissive,
    emissive: 0xffffff,
    emissiveIntensity: 0.55,
    roughness: 0.48,
    metalness: 0.16,
  });
  const indMat = new THREE.MeshStandardMaterial({
    map: textures.buildingIndustrial,
    roughness: 0.68,
    metalness: 0.28,
  });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.78 });

  const modernGeos: THREE.BufferGeometry[] = [];
  const decoGeos: THREE.BufferGeometry[] = [];
  const indGeos: THREE.BufferGeometry[] = [];
  const roofGeos: THREE.BufferGeometry[] = [];
  const neonBuckets = new Map<number, THREE.BufferGeometry[]>();

  const canPlaceStructure = (x: number, z: number, w: number, d: number, extraPad = 2.0): boolean => {
    const rad = Math.hypot(w * 0.5, d * 0.5);
    const ang = Math.atan2(z, x);
    if (Math.hypot(x, z) + rad > getIslandCoastRadius(ang) - 24) return false;
    if (isWaterAt(x, z) || isWaterAt(x + w * 0.45, z + d * 0.45) || isWaterAt(x - w * 0.45, z - d * 0.45)) return false;
    if (z >= 115 && z <= 162 && x >= -114) return false; // canal banks
    if (x >= -332 && x <= -144 && z >= 176 && z <= 286) return false; // expanded airport complex
    if (x >= 149 && x <= 171 && z >= -236 && z <= -206) return false; // safehouse garage & driveway
    if (Math.hypot(x, z + 20) < 42 + rad || Math.hypot(x - 185, z + 20) < 32 + rad) return false; // roundabouts
    if (distanceToRoadNetwork(x, z) < rad + extraPad) return false;
    for (const s of SHOPS) {
      if (Math.hypot(x - s.x, z - s.z) < rad + 15 || Math.hypot(x - s.doorX, z - s.doorZ) < rad + 12) {
        return false;
      }
    }
    for (const fp of buildingFootprints) {
      if (Math.abs(x - fp.x) < (w + fp.w) * 0.5 + 3.5 && Math.abs(z - fp.z) < (d + fp.d) * 0.5 + 3.5) {
        return false;
      }
    }
    return true;
  };

  const tryAddBuilding = (
    x: number,
    z: number,
    w: number,
    d: number,
    h: number,
    style: 'modern' | 'deco' | 'industrial',
    neonHex?: number
  ) => {
    if (!canPlaceStructure(x, z, w, d)) return;

    const cornerR = style === 'deco' ? 4.0 : style === 'modern' ? 2.4 : 1.1;
    const baseShape = createRoundedRectShape(w, d, cornerR);
    const bodyGeo = new THREE.ExtrudeGeometry(baseShape, {
      depth: h,
      bevelEnabled: true,
      bevelThickness: 0.35,
      bevelSize: 0.35,
      bevelSegments: 2,
      curveSegments: 6,
    });
    bodyGeo.rotateX(-Math.PI / 2);
    const pos = bodyGeo.attributes.position;
    const uv = bodyGeo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, (pos.getX(i) + pos.getZ(i)) * 0.04, pos.getY(i) * 0.045);
    }
    bodyGeo.translate(x, 0, z);
    const nonIdxBody = bodyGeo.toNonIndexed();
    bodyGeo.dispose();

    if (style === 'modern') modernGeos.push(nonIdxBody);
    else if (style === 'deco') decoGeos.push(nonIdxBody);
    else indGeos.push(nonIdxBody);

    if (style === 'modern' && h >= 32) {
      const upperShape = createRoundedRectShape(w * 0.72, d * 0.72, 2.0);
      const upperGeo = new THREE.ExtrudeGeometry(upperShape, {
        depth: 4.5,
        bevelEnabled: true,
        bevelThickness: 0.2,
        bevelSize: 0.2,
        bevelSegments: 1,
        curveSegments: 5,
      });
      upperGeo.rotateX(-Math.PI / 2);
      upperGeo.translate(x, h, z);
      roofGeos.push(upperGeo.toNonIndexed());
      upperGeo.dispose();
    }

    if (neonHex !== undefined) {
      const neonShape = createRoundedRectShape(w + 0.5, d + 0.5, cornerR + 0.2);
      const neonGeo = new THREE.ExtrudeGeometry(neonShape, { depth: 0.36, bevelEnabled: false, curveSegments: 6 });
      neonGeo.rotateX(-Math.PI / 2);
      neonGeo.translate(x, Math.min(h - 1.2, 5.8), z);
      const bucket = neonBuckets.get(neonHex) || [];
      bucket.push(neonGeo.toNonIndexed());
      neonBuckets.set(neonHex, bucket);
      neonGeo.dispose();
    }

    const padMargin = 0.42;
    colliders.push({
      minX: x - w * 0.5 - padMargin,
      maxX: x + w * 0.5 + padMargin,
      minZ: z - d * 0.5 - padMargin,
      maxZ: z + d * 0.5 + padMargin,
      height: h + 1.0,
    });
    buildingFootprints.push({
      x,
      z,
      w,
      d,
      color: style === 'modern' ? '#334155' : style === 'deco' ? '#e2c4b0' : '#475569',
    });
  };

  // Curated Signature Towers & Landmarks
  const neonColors = [0x06b6d4, 0xf97316, 0xec4899, 0xf59e0b, 0x2dd4bf, 0xa855f7];
  const signatureBuildings: Array<[number, number, number, number, number, 'modern' | 'deco' | 'industrial', number?]> = [
    [-55, -142, 26, 24, 52, 'modern', 0x06b6d4],
    [48, -142, 24, 24, 48, 'modern', 0xec4899],
    [-82, -146, 22, 22, 42, 'modern', 0xf97316],
    [136, -142, 22, 22, 38, 'modern', 0x2dd4bf],
    [-58, 36, 22, 22, 36, 'modern', 0xf59e0b],
    [48, 36, 24, 22, 38, 'modern', 0x06b6d4],
    [138, 36, 20, 22, 28, 'deco', 0xec4899],
    [232, -62, 20, 24, 22, 'deco', 0x2dd4bf],
    [232, 32, 20, 22, 18, 'deco', 0xf97316],
    [236, -110, 18, 22, 20, 'deco', 0xfbbf24],
    [-190, -70, 22, 24, 24, 'modern', 0xf59e0b],
    [-190, 42, 22, 22, 16, 'industrial', 0xf97316],
    [-190, 118, 24, 22, 15, 'industrial'],
    [-82, 174, 24, 20, 18, 'industrial'],
    [48, 174, 22, 22, 22, 'modern', 0x06b6d4],
    [138, 174, 20, 22, 19, 'deco', 0xec4899],
  ];
  for (const b of signatureBuildings) {
    tryAddBuilding(b[0], b[1], b[2], b[3], b[4], b[5], b[6]);
  }

  // Procedural City Grid Fill across the entire 5x Island (respecting all curved highways, streets & shops!)
  let seed = 1337;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let gx = -310; gx <= 290; gx += 34) {
    for (let gz = -280; gz <= 290; gz += 34) {
      const jx = gx + (rand() - 0.5) * 10;
      const jz = gz + (rand() - 0.5) * 10;
      const distCenter = Math.hypot(jx, jz);
      const w = 15 + Math.floor(rand() * 10);
      const d = 15 + Math.floor(rand() * 10);

      let style: 'modern' | 'deco' | 'industrial' = 'modern';
      let h = 18 + Math.floor(rand() * 20);
      if (jx > 150) {
        style = 'deco';
        h = 12 + Math.floor(rand() * 14);
      } else if (jx < -155 && jz > 20) {
        style = 'industrial';
        h = 10 + Math.floor(rand() * 9);
      } else if (distCenter < 130) {
        style = 'modern';
        h = 26 + Math.floor(rand() * 28);
      } else if (jz < -190) {
        style = 'deco';
        h = 9 + Math.floor(rand() * 7); // Northern villa hills
      }

      const neon = rand() > 0.55 ? neonColors[Math.floor(rand() * neonColors.length)] : undefined;
      tryAddBuilding(jx, jz, w, d, h, style, neon);
    }
  }

  if (modernGeos.length > 0) {
    const m = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(modernGeos), modernMat);
    m.castShadow = true;
    m.receiveShadow = true;
    worldGroup.add(m);
    modernGeos.forEach((g) => g.dispose());
  }
  if (decoGeos.length > 0) {
    const m = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(decoGeos), decoMat);
    m.castShadow = true;
    m.receiveShadow = true;
    worldGroup.add(m);
    decoGeos.forEach((g) => g.dispose());
  }
  if (indGeos.length > 0) {
    const m = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(indGeos), indMat);
    m.castShadow = true;
    m.receiveShadow = true;
    worldGroup.add(m);
    indGeos.forEach((g) => g.dispose());
  }
  if (roofGeos.length > 0) {
    const m = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(roofGeos), roofMat);
    m.castShadow = true;
    worldGroup.add(m);
    roofGeos.forEach((g) => g.dispose());
  }
  for (const [hex, geos] of neonBuckets.entries()) {
    const mat = new THREE.MeshStandardMaterial({
      color: hex,
      emissive: hex,
      emissiveIntensity: 2.3,
      roughness: 0.2,
    });
    const m = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(geos), mat);
    worldGroup.add(m);
    geos.forEach((g) => g.dispose());
  }

  // 8. Marina Wooden Piers, Shipping Containers & Yachts (Southeast Bay: x: 205..340, z: 215..310)
  const pierMat = new THREE.MeshStandardMaterial({ color: 0x785032, roughness: 0.85 });
  const pier1 = new THREE.Mesh(new THREE.BoxGeometry(78, 0.7, 10), pierMat);
  pier1.position.set(244, 0.15, 240);
  pier1.receiveShadow = true;
  worldGroup.add(pier1);

  const pier2 = new THREE.Mesh(new THREE.BoxGeometry(78, 0.7, 10), pierMat);
  pier2.position.set(244, 0.15, 278);
  pier2.receiveShadow = true;
  worldGroup.add(pier2);

  const addContainer = (x: number, z: number, color: number) => {
    const c = new THREE.Mesh(
      new THREE.BoxGeometry(6.4, 2.7, 2.6),
      new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.35 })
    );
    c.position.set(x, 1.35, z);
    c.castShadow = true;
    c.receiveShadow = true;
    worldGroup.add(c);
    colliders.push({ minX: x - 3.2, maxX: x + 3.2, minZ: z - 1.3, maxZ: z + 1.3, height: 2.7 });
  };
  addContainer(198, 250, 0xdc2626);
  addContainer(198, 255, 0x0284c7);
  addContainer(198, 266, 0xd97706);

  const yacht1 = createYachtMesh();
  yacht1.position.set(308, -0.35, 240);
  yacht1.rotation.y = Math.PI / 2;
  worldGroup.add(yacht1);
  circleColliders.push({ x: 308, z: 240, radius: 5.5, height: 4.0 });

  const yacht2 = createYachtMesh();
  yacht2.position.set(316, -0.35, 282);
  yacht2.rotation.y = Math.PI / 2;
  worldGroup.add(yacht2);
  circleColliders.push({ x: 316, z: 282, radius: 5.5, height: 4.0 });

  // 9. Beach Umbrellas & Coastal Rocks around the Entire Island Shore (InstancedMesh!)
  const umbrellaPositions: [number, number][] = [];
  for (let i = 0; i < 42; i++) {
    const ang = (i / 42) * Math.PI * 2;
    const r = getIslandCoastRadius(ang) - 12;
    const ux = Math.cos(ang) * r;
    const uz = Math.sin(ang) * r;
    if (!isWaterAt(ux, uz) && distanceToRoadNetwork(ux, uz) > 6) {
      umbrellaPositions.push([ux, uz]);
    }
  }
  if (umbrellaPositions.length > 0) {
    const poleGeo = new THREE.CylinderGeometry(0.05, 0.05, 2.6, 8);
    poleGeo.translate(0, 1.3, 0);
    const poleInst = new THREE.InstancedMesh(
      poleGeo,
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.6 }),
      umbrellaPositions.length
    );
    const canopyGeo = new THREE.ConeGeometry(1.8, 0.68, 12);
    canopyGeo.translate(0, 2.55, 0);
    const canopyInst = new THREE.InstancedMesh(
      canopyGeo,
      new THREE.MeshStandardMaterial({ roughness: 0.7 }),
      umbrellaPositions.length
    );
    const dummy = new THREE.Object3D();
    const uPalette = [0xf43f5e, 0x06b6d4, 0xf59e0b, 0xec4899, 0x10b981];
    const col = new THREE.Color();
    umbrellaPositions.forEach(([ux, uz], idx) => {
      dummy.position.set(ux, 0, uz);
      dummy.rotation.set(0, idx * 0.8, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      poleInst.setMatrixAt(idx, dummy.matrix);
      canopyInst.setMatrixAt(idx, dummy.matrix);
      col.setHex(uPalette[idx % uPalette.length]);
      canopyInst.setColorAt(idx, col);
      circleColliders.push({ x: ux, z: uz, radius: 0.35, height: 2.8 });
    });
    poleInst.computeBoundingSphere();
    canopyInst.computeBoundingSphere();
    worldGroup.add(poleInst, canopyInst);
  }

  // 10. Stunt Jump Ramps across Highways & Canal Approaches
  const addRamp = (x: number, z: number, width: number, length: number, height: number, heading: number) => {
    const rampGroup = new THREE.Group();
    rampGroup.position.set(x, 0, z);
    rampGroup.rotation.y = heading;

    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(length, 0);
    shape.quadraticCurveTo(length * 0.65, height * 0.45, length, height);
    shape.closePath();

    const geom = new THREE.ExtrudeGeometry(shape, {
      depth: width,
      bevelEnabled: true,
      bevelThickness: 0.12,
      bevelSize: 0.1,
      bevelSegments: 2,
    });
    geom.translate(-length / 2, 0, -width / 2);
    geom.rotateY(Math.PI / 2);

    const mesh = new THREE.Mesh(
      geom,
      new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.5, metalness: 0.25 })
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    rampGroup.add(mesh);

    const strip = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.12, width * 0.78, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0xfef08a, emissive: 0xf59e0b, emissiveIntensity: 1.6 })
    );
    strip.rotation.z = Math.PI / 2;
    strip.position.set(0, height + 0.04, length * 0.45);
    rampGroup.add(strip);

    worldGroup.add(rampGroup);
    ramps.push({ x, z, width, length, height, heading });
  };

  addRamp(0, 96, 6.8, 12, 2.8, 0);
  addRamp(185, 95, 6.8, 12, 2.8, 0);
  addRamp(-140, 108, 7.2, 13, 3.0, 0);
  addRamp(45, -102, 6.5, 11, 2.5, Math.PI / 2);

  // 11. Explosive Barrels
  const barrelCoords: [number, number][] = [
    [188, 252],
    [194, 268],
    [-48, -112],
    [-56, -118],
    [-254, 224],
    [-242, 248],
    [164, 14],
    [-70, 55],
    [95, 60],
    [-145, -18],
  ];
  barrelCoords.forEach(([bx, bz], idx) => {
    const mesh = createExplosiveBarrelMesh();
    mesh.position.set(bx, 0, bz);
    worldGroup.add(mesh);
    barrels.push({
      id: `barrel_${idx}`,
      mesh,
      x: bx,
      z: bz,
      alive: true,
      respawnTimer: 0,
    });
  });

  // 12. Organic Curved Palm Trees (InstancedMesh around Coastal Ring, Boulevards & Beaches)
  const palmPositions: [number, number][] = [];
  for (let i = 0; i < 96; i++) {
    const ang = (i / 96) * Math.PI * 2;
    const r = getIslandCoastRadius(ang) - 22 - (i % 3) * 18;
    const px = Math.cos(ang) * r;
    const pz = Math.sin(ang) * r;
    if (!isWaterAt(px, pz) && distanceToRoadNetwork(px, pz) > 4.5 && canPlaceStructure(px, pz, 2.5, 2.5, 1.5)) {
      palmPositions.push([px, pz]);
    }
  }
  for (let x = -220; x <= 240; x += 34) {
    for (const z of [-185, -84, 58, 185]) {
      if (!isWaterAt(x, z) && distanceToRoadNetwork(x, z) > 4.0 && canPlaceStructure(x, z, 2.5, 2.5, 1.2)) {
        palmPositions.push([x, z]);
      }
    }
  }

  if (palmPositions.length > 0) {
    const trunkCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.28, 2.5, 0.1),
      new THREE.Vector3(0.45, 5.2, -0.08),
      new THREE.Vector3(0.0, 7.7, 0.0),
    ]);
    const trunkGeo = new THREE.TubeGeometry(trunkCurve, 10, 0.24, 8, false);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7c583a, roughness: 0.88 });
    const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, palmPositions.length);
    trunkInst.castShadow = true;

    const crownGeo = createPalmCrownGeometry();
    const crownMat = new THREE.MeshStandardMaterial({ color: 0x2f855a, roughness: 0.72 });
    const crownInst = new THREE.InstancedMesh(crownGeo, crownMat, palmPositions.length);
    crownInst.castShadow = true;

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    palmPositions.forEach(([px, pz], idx) => {
      const s = 0.88 + ((idx * 17) % 28) / 100;
      dummy.position.set(px, 0, pz);
      dummy.rotation.set(0, idx * 1.37, 0);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      trunkInst.setMatrixAt(idx, dummy.matrix);
      crownInst.setMatrixAt(idx, dummy.matrix);
      color.setHSL(0.35 + (idx % 5) * 0.015, 0.54, 0.34 + (idx % 3) * 0.04);
      crownInst.setColorAt(idx, color);
      circleColliders.push({ x: px, z: pz, radius: 0.45, height: 8.0 });
    });
    trunkInst.computeBoundingSphere();
    crownInst.computeBoundingSphere();
    worldGroup.add(trunkInst, crownInst);
  }

  // 13. Swan-Neck Curved Streetlights Along Highways & Boulevards (InstancedMesh)
  const polePlacements: { x: number; z: number; rot: number }[] = [];
  for (const seg of ROAD_SEGMENTS) {
    const stride = seg.isHighway ? 4 : 5;
    for (let i = 1; i < seg.points.length - 1; i += stride) {
      const p = seg.points[i];
      const next = seg.points[i + 1];
      const tx = next.x - p.x;
      const tz = next.z - p.z;
      const len = Math.hypot(tx, tz) || 1;
      const nx = -tz / len;
      const nz = tx / len;
      const side = (i % 2 === 0 ? 1 : -1) * (seg.width * 0.5 + 1.4);
      const lx = p.x + nx * side;
      const lz = p.z + nz * side;
      if (
        !isWaterAt(lx, lz) &&
        getBridgeElevationAt(lx, lz) === 0 &&
        !(lx <= -144 && lz >= 178 && lz <= 284)
      ) {
        const rot = Math.atan2(-nx * Math.sign(side), -nz * Math.sign(side)) - Math.PI / 2;
        polePlacements.push({ x: lx, z: lz, rot });
      }
    }
  }

  if (polePlacements.length > 0) {
    const poleCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 4.8, 0),
      new THREE.Vector3(0.35, 5.7, 0),
      new THREE.Vector3(1.1, 5.8, 0),
    ]);
    const poleGeo = new THREE.TubeGeometry(poleCurve, 10, 0.09, 7, false);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.75, roughness: 0.32 });
    const poleInst = new THREE.InstancedMesh(poleGeo, poleMat, polePlacements.length);

    const lampGeo = new THREE.CapsuleGeometry(0.14, 0.32, 4, 8);
    lampGeo.rotateZ(Math.PI / 2);
    lampGeo.translate(1.15, 5.74, 0);
    const lampMat = new THREE.MeshStandardMaterial({
      color: 0xfef3c7,
      emissive: 0xfbbf24,
      emissiveIntensity: 1.9,
    });
    const lampInst = new THREE.InstancedMesh(lampGeo, lampMat, polePlacements.length);

    const dummy = new THREE.Object3D();
    polePlacements.forEach((pl, idx) => {
      dummy.position.set(pl.x, 0, pl.z);
      dummy.rotation.set(0, pl.rot, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      poleInst.setMatrixAt(idx, dummy.matrix);
      lampInst.setMatrixAt(idx, dummy.matrix);
      circleColliders.push({ x: pl.x, z: pl.z, radius: 0.28, height: 6.0 });
    });
    poleInst.computeBoundingSphere();
    lampInst.computeBoundingSphere();
    worldGroup.add(poleInst, lampInst);
  }

  return {
    worldGroup,
    colliders,
    circleColliders,
    ramps,
    barrels,
    oceanMesh,
    skyMat,
    roadSegments: ROAD_SEGMENTS,
    roadRects,
    buildingFootprints,
    shopRings,
  };
}
