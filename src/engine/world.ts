import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { AIRPORT_HANGAR_ZONE, SAFEHOUSE_GARAGE_ZONE, SHOPS } from '../data/defaults';
import { GpsPoint, ShopDef } from '../types/game';
import { ProceduralTextureSet } from './textures';
import {
  createCharacterRig,
  CharacterRig,
  createExplosiveBarrelMesh,
  createRangeTargetRig,
  createYachtMesh,
} from './models';
import {
  BRIDGE_SPANS,
  getBridgeElevationAt,
  getIslandCoastRadius,
  getIslandOutlinePoints,
  isOnBeachAt,
  isWaterAt,
  OVERPASS_SPANS,
  PARKING_LOTS,
  ROAD_SEGMENTS,
  RoadSegmentDef,
  UNDERPASS_SPANS,
} from './navigation';

export interface AABBCollider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
  minY?: number;
  isRoofSurface?: boolean;
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

export interface RangeTargetEntity {
  id: string;
  mesh: THREE.Group;
  x: number;
  y: number;
  z: number;
  alive: boolean;
  respawnTimer: number;
}

export interface ElevatorFloorDef {
  name: string;
  y: number;
}

export interface ElevatorEntity {
  id: string;
  label: string;
  x: number;
  z: number;
  radius: number;
  floors: ElevatorFloorDef[];
  currentFloorIndex: number;
  targetFloorIndex: number;
  currentY: number;
  cabGroup: THREE.Group;
}

export interface ClubPerformerRig {
  rig: CharacterRig;
  baseX: number;
  baseY: number;
  baseZ: number;
  phase: number;
  style: 'pole' | 'podiumL' | 'podiumR' | 'dj' | 'patron';
}

export interface ClubShowRig {
  clubX: number;
  clubZ: number;
  discoBall: THREE.Object3D;
  spotlights: THREE.Mesh[];
  eqBars: THREE.Mesh[];
  performers: ClubPerformerRig[];
}

export interface ShopInteriorGroup {
  x: number;
  z: number;
  radius: number;
  group: THREE.Group;
}

export interface WorldBuildResult {
  worldGroup: THREE.Group;
  colliders: AABBCollider[];
  floorSurfaces: AABBCollider[];
  circleColliders: CircleCollider[];
  ramps: StuntRamp[];
  barrels: ExplosiveBarrelEntity[];
  rangeTargets: RangeTargetEntity[];
  elevators: ElevatorEntity[];
  buildingWindowMaterials: THREE.Material[];
  wettableRoadMaterials: THREE.MeshStandardMaterial[];
  extraTextures: THREE.Texture[];
  clubShow: ClubShowRig | null;
  shopInteriors: ShopInteriorGroup[];
  spinners: THREE.Object3D[];
  oceanMesh: THREE.Mesh;
  skyMat: THREE.ShaderMaterial;
  cloudGroup: THREE.Group;
  cloudMaterials: THREE.MeshStandardMaterial[];
  roadSegments: RoadSegmentDef[];
  roadRects: { x: number; z: number; w: number; l: number }[];
  buildingFootprints: { x: number; z: number; w: number; d: number; color: string }[];
  shopRings: THREE.Mesh[];
}

export function getDistrictName(x: number, z: number): string {
  const ang = Math.atan2(z, x);
  const coastR = getIslandCoastRadius(ang);
  const dist = Math.hypot(x, z);
  if (dist > coastR + 10) return 'Vice Ocean';
  if (x >= 560 && x <= 1280 && z >= 620 && z <= 1120) return 'Marina Bay';
  if (x >= -340 && z >= 392 && z <= 468) return 'Vice Canal';
  if (x >= -820 && x <= 860 && z >= -815 && z <= -765) return 'Emerald River';
  if (isOnBeachAt(x, z)) return 'Pobrežie Leonida';
  if (x < -520 && z >= 460) return 'Bayshore Airport';
  if (x < -420 && z >= 40) return 'Bayshore Industrial';
  if (z < -760 && x < -100) return 'Borovicový les';
  if (z < -760 && x >= -100) return 'Emerald Hills';
  if (z < -520) return 'North Heights';
  if (x > 360 && z > 460) return 'Marina Docks';
  if (x > 340 && z < 400) return 'Coral Strip';
  if (Math.hypot(x, z + 70) < 95) return 'Slnečné námestie';
  if (x >= -420 && x <= 340 && z >= -480 && z <= 380) return 'Downtown Core';
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
  uvScale: number,
  rectHoles: { minX: number; maxX: number; minZ: number; maxZ: number }[] = []
): THREE.BufferGeometry | null {
  if (poly.length < 3) return null;
  const shape = new THREE.Shape();
  shape.moveTo(poly[0].x, -poly[0].z);
  for (let i = 1; i < poly.length; i++) {
    shape.lineTo(poly[i].x, -poly[i].z);
  }
  shape.closePath();

  // Compute polygon bbox so holes are only added to the piece that actually contains them
  let pMinX = Infinity;
  let pMaxX = -Infinity;
  let pMinZ = Infinity;
  let pMaxZ = -Infinity;
  for (const pt of poly) {
    if (pt.x < pMinX) pMinX = pt.x;
    if (pt.x > pMaxX) pMaxX = pt.x;
    if (pt.z < pMinZ) pMinZ = pt.z;
    if (pt.z > pMaxZ) pMaxZ = pt.z;
  }
  for (const h of rectHoles) {
    if (h.minX > pMinX + 4 && h.maxX < pMaxX - 4 && h.minZ > pMinZ + 4 && h.maxZ < pMaxZ - 4) {
      const hole = new THREE.Path();
      hole.moveTo(h.minX, -h.minZ);
      hole.lineTo(h.maxX, -h.minZ);
      hole.lineTo(h.maxX, -h.maxZ);
      hole.lineTo(h.minX, -h.maxZ);
      hole.closePath();
      shape.holes.push(hole);
    }
  }

  const geo = new THREE.ShapeGeometry(shape, 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, pos.getX(i) * uvScale, pos.getZ(i) * uvScale);
  }
  return geo;
}

function resamplePolylineForRoad(points: GpsPoint[], closed?: boolean, stepDist = 6.5): GpsPoint[] {
  const src = closed ? [...points, points[0]] : points;
  const out: GpsPoint[] = [];
  for (let i = 0; i < src.length - 1; i++) {
    const a = src[i];
    const b = src[i + 1];
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(dist / stepDist));
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
  baseY = 0.04,
  uvRepeatMeters = 22
): THREE.BufferGeometry {
  const pts = resamplePolylineForRoad(rawPoints, closed, 6.5);
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
    uvs.push(0, arcDist / uvRepeatMeters, 1, arcDist / uvRepeatMeters);

    if (i < pts.length - 1) {
      const base = i * 2;
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
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

function isPointInsideOtherRoad(x: number, z: number, excludeSegId: string, margin = 1.2): boolean {
  for (const other of ROAD_SEGMENTS) {
    if (other.id === excludeSegId || other.isDirtTrail) continue;
    const pts = other.closed ? [...other.points, other.points[0]] : other.points;
    const threshold = other.width * 0.5 + margin;
    for (let i = 0; i < pts.length - 1; i++) {
      if (pointToSegmentDist(x, z, pts[i].x, pts[i].z, pts[i + 1].x, pts[i + 1].z) < threshold) {
        return true;
      }
    }
  }
  return false;
}

function isSidewalkEdgeBlocked(x: number, z: number, segId: string): boolean {
  if (isWaterAt(x, z) || getBridgeElevationAt(x, z) > 0.05) return true;
  if (x >= -1385 && x <= -535 && z >= 565 && z <= 1015) return true; // Airport tarmac & runways
  if (isPointInsideOtherRoad(x, z, segId, 2.2)) return true;

  for (const b of BRIDGE_SPANS) {
    const zMid = (b.zStart + b.zEnd) * 0.5;
    const halfSpan = (b.zEnd - b.zStart) * 0.5;
    const dx = x - b.x;
    const dz = z - zMid;
    const ang = -(b.angle ?? 0);
    const lx = dx * Math.cos(ang) - dz * Math.sin(ang);
    const lz = dx * Math.sin(ang) + dz * Math.cos(ang);
    if (Math.abs(lz) <= halfSpan + 10 && Math.abs(lx) <= b.width * 0.65 + 4) return true;
  }
  for (const ov of OVERPASS_SPANS) {
    const along = ov.axis === 'x' ? Math.abs(x - ov.centerX) : Math.abs(z - ov.centerZ);
    const cross = ov.axis === 'x' ? Math.abs(z - ov.centerZ) : Math.abs(x - ov.centerX);
    if (along <= ov.length * 0.5 + 8 && cross <= ov.width * 0.6 + 6) return true;
  }
  for (const un of UNDERPASS_SPANS) {
    const along = un.axis === 'x' ? Math.abs(x - un.centerX) : Math.abs(z - un.centerZ);
    const cross = un.axis === 'x' ? Math.abs(z - un.centerZ) : Math.abs(x - un.centerX);
    if (along <= un.length * 0.5 + 8 && cross <= un.width * 0.6 + 6) return true;
  }
  for (const p of PARKING_LOTS) {
    if (Math.abs(x - p.x) < p.width * 0.5 + 2.5 && Math.abs(z - p.z) < p.depth * 0.5 + 2.5) return true;
  }
  if (Math.abs(x - SAFEHOUSE_GARAGE_ZONE.x) < 12 && Math.abs(z - SAFEHOUSE_GARAGE_ZONE.z) < 13) return true;
  for (const s of SHOPS) {
    if (Math.abs(x - s.x) < 20 && Math.abs(z - s.z) < 18) return true;
  }
  return false;
}

function buildCurvedStripGeometry(
  leftPts: { x: number; y: number; z: number }[],
  rightPts: { x: number; y: number; z: number }[],
  arcDists: number[],
  uvScaleV: number
): THREE.BufferGeometry | null {
  if (leftPts.length < 2) return null;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < leftPts.length; i++) {
    const l = leftPts[i];
    const r = rightPts[i];
    positions.push(l.x, l.y, l.z, r.x, r.y, r.z);
    uvs.push(0, arcDists[i] * uvScaleV, 1, arcDists[i] * uvScaleV);
    if (i < leftPts.length - 1) {
      const b = i * 2;
      indices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo.toNonIndexed();
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
  const floorSurfaces: AABBCollider[] = [];
  const circleColliders: CircleCollider[] = [];
  const ramps: StuntRamp[] = [];
  const barrels: ExplosiveBarrelEntity[] = [];
  const rangeTargets: RangeTargetEntity[] = [];
  const elevators: ElevatorEntity[] = [];
  const buildingWindowMaterials: THREE.Material[] = [];
  const wettableRoadMaterials: THREE.MeshStandardMaterial[] = [];
  const extraTextures: THREE.Texture[] = [];
  let clubShow: ClubShowRig | null = null;
  const shopInteriors: ShopInteriorGroup[] = [];
  const spinners: THREE.Object3D[] = [];
  const roadRects: { x: number; z: number; w: number; l: number }[] = [];
  const buildingFootprints: { x: number; z: number; w: number; d: number; color: string }[] = [];
  const shopRings: THREE.Mesh[] = [];

  // 0. Atmospheric Vice Horizon Sky Dome (Encloses 15x Island & Endless Sea)
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
  const skyDome = new THREE.Mesh(new THREE.SphereGeometry(2850, 32, 20), skyMat);
  worldGroup.add(skyDome);

  // Dynamic Volumetric-Look 3D Sky Clouds (Layered Clusters that wax/wane in coverage)
  const cloudGroup = new THREE.Group();
  const cloudMaterials: THREE.MeshStandardMaterial[] = [];
  const cloudMatA = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.95,
    metalness: 0.0,
    transparent: true,
    opacity: 0.68,
    depthWrite: false,
  });
  const cloudMatB = cloudMatA.clone();
  cloudMaterials.push(cloudMatA, cloudMatB);

  const puffGeo = new THREE.SphereGeometry(1, 10, 8);
  let cSeed = 8821;
  const crand = () => {
    cSeed = (cSeed * 16807) % 2147483647;
    return (cSeed - 1) / 2147483646;
  };
  for (let i = 0; i < 48; i++) {
    const cluster = new THREE.Group();
    const cx = (crand() - 0.5) * 3200;
    const cy = 220 + crand() * 140;
    const cz = (crand() - 0.5) * 3200;
    cluster.position.set(cx, cy, cz);
    const mat = i % 2 === 0 ? cloudMatA : cloudMatB;
    const puffs = 3 + (i % 3);
    for (let p = 0; p < puffs; p++) {
      const puff = new THREE.Mesh(puffGeo, mat);
      puff.position.set((crand() - 0.5) * 52, (crand() - 0.5) * 10, (crand() - 0.5) * 38);
      puff.scale.set(28 + crand() * 34, 9 + crand() * 8, 22 + crand() * 28);
      cluster.add(puff);
    }
    cluster.userData.speed = 3.5 + crand() * 5.0;
    cloudGroup.add(cluster);
  }
  worldGroup.add(cloudGroup);

  // 1. Endless Open Ocean (6000m x 6000m)
  const oceanMat = new THREE.MeshPhysicalMaterial({
    map: textures.ocean,
    normalMap: textures.oceanNormal,
    normalScale: new THREE.Vector2(0.42, 0.42),
    color: 0x0284c7,
    roughness: 0.14,
    metalness: 0.16,
    clearcoat: 0.85,
    clearcoatRoughness: 0.1,
    envMapIntensity: 0.72,
  });
  textures.ocean.repeat.set(90, 90);
  textures.oceanNormal.repeat.set(110, 110);
  const oceanMesh = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), oceanMat);
  oceanMesh.rotation.x = -Math.PI / 2;
  oceanMesh.position.set(0, -0.45, 0);
  oceanMesh.receiveShadow = true;
  worldGroup.add(oceanMesh);

  // 2. Photorealistic 15x Island Landscape (Multi-Scale Grass + Organic Beach Sand Transition + Hills)
  const terrainMat = new THREE.MeshStandardMaterial({
    map: textures.meadowGrass,
    normalMap: textures.grassNormal,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughness: 0.94,
    metalness: 0.02,
    envMapIntensity: 0.45,
  });
  terrainMat.onBeforeCompile = (shader) => {
    shader.uniforms.uSandTex = { value: textures.sand };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vTerrainWorldPos;`
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
vTerrainWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vTerrainWorldPos;
uniform sampler2D uSandTex;

float tHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float tNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(tHash(i + vec2(0.0, 0.0)), tHash(i + vec2(1.0, 0.0)), u.x),
    mix(tHash(i + vec2(0.0, 1.0)), tHash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float tFbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    v += a * tNoise(p);
    p = rot * p * 2.04 + vec2(13.7, 29.3);
    a *= 0.5;
  }
  return v;
}`
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
#ifdef USE_MAP
  vec2 grassUv2 = vec2(
    vTerrainWorldPos.x * 0.019 - vTerrainWorldPos.z * 0.011,
    vTerrainWorldPos.x * 0.011 + vTerrainWorldPos.z * 0.019
  );
  vec3 grassMacro = texture2D(map, grassUv2).rgb;
  float patchMix = tFbm(vTerrainWorldPos.xz * 0.016);
  vec3 grassCol = mix(diffuseColor.rgb, grassMacro, 0.45 * patchMix + 0.15);

  float macroNoise = tFbm(vTerrainWorldPos.xz * 0.0045);
  float detailNoise = tNoise(vTerrainWorldPos.xz * 0.075);
  vec3 lushTint = vec3(0.84, 1.08, 0.78);
  vec3 warmTint = vec3(1.16, 1.05, 0.72);
  grassCol *= mix(lushTint, warmTint, smoothstep(0.28, 0.75, macroNoise));
  grassCol *= (0.86 + 0.28 * detailNoise);

  float forestMask = smoothstep(-700.0, -900.0, vTerrainWorldPos.z);
  grassCol = mix(grassCol, grassCol * vec3(0.76, 0.80, 0.65), forestMask * 0.62);

  float ang = atan(vTerrainWorldPos.z, vTerrainWorldPos.x);
  float dAir = ang - 2.42;
  float dCape = ang + 1.55;
  float airPen = 185.0 * exp(-(dAir * dAir) / 0.24);
  float nCape = 120.0 * exp(-(dCape * dCape) / 0.30);
  float coastR = 1520.0 + airPen + nCape
    + 95.0 * sin(ang * 2.0 - 0.4)
    + 64.0 * cos(ang * 3.0 + 0.7)
    + 36.0 * sin(ang * 5.0);
  float distToCoast = coastR - length(vTerrainWorldPos.xz);
  float sandNoise = (tFbm(vTerrainWorldPos.xz * 0.022) - 0.5) * 34.0;
  float elevationMask = 1.0 - smoothstep(2.5, 10.0, vTerrainWorldPos.y);
  float beachFactor = smoothstep(82.0, 44.0, distToCoast + sandNoise) * elevationMask;

  vec3 sandA = texture2D(uSandTex, vTerrainWorldPos.xz * 0.036).rgb;
  vec3 sandB = texture2D(uSandTex, vTerrainWorldPos.xz * 0.013 + vec2(0.41, 0.23)).rgb;
  vec3 sandCol = mix(sandA, sandB, 0.45);
  float wetSand = smoothstep(24.0, 3.0, distToCoast);
  sandCol *= mix(1.0, 0.72, wetSand);

  diffuseColor.rgb = mix(grassCol, sandCol, beachFactor);
#endif`
      );
  };

  const outerOutline = getIslandOutlinePoints(120);

  const splitIslandPolygons = (poly: GpsPoint[]): GpsPoint[][] => {
    const pieces: GpsPoint[][] = [];
    // North of North Emerald River (z <= -815)
    pieces.push(clipPolygonHalfPlane(poly, 0, 1, -815));
    // River West Connector (x <= -820, -815 <= z <= -765)
    let rWest = clipPolygonHalfPlane(poly, 1, 0, -820);
    rWest = clipPolygonHalfPlane(rWest, 0, -1, 815);
    rWest = clipPolygonHalfPlane(rWest, 0, 1, -765);
    pieces.push(rWest);
    // River East Connector (x >= 860, -815 <= z <= -765)
    let rEast = clipPolygonHalfPlane(poly, -1, 0, -860);
    rEast = clipPolygonHalfPlane(rEast, 0, -1, 815);
    rEast = clipPolygonHalfPlane(rEast, 0, 1, -765);
    pieces.push(rEast);
    // Central Band between North River and Vice Canal (-765 <= z <= 392)
    let centralBand = clipPolygonHalfPlane(poly, 0, -1, 765);
    centralBand = clipPolygonHalfPlane(centralBand, 0, 1, 392);
    pieces.push(centralBand);
    // West Land Connector around Vice Canal (x <= -340, 392 <= z <= 468)
    let westConn = clipPolygonHalfPlane(poly, 1, 0, -340);
    westConn = clipPolygonHalfPlane(westConn, 0, -1, -392);
    westConn = clipPolygonHalfPlane(westConn, 0, 1, 468);
    pieces.push(westConn);
    // South Island West of Marina (x <= 560, z >= 468)
    let southWest = clipPolygonHalfPlane(poly, 0, -1, -468);
    southWest = clipPolygonHalfPlane(southWest, 1, 0, 560);
    pieces.push(southWest);
    // South East strip above Marina Harbor (x >= 560, 468 <= z <= 620)
    let seNorth = clipPolygonHalfPlane(poly, 0, -1, -468);
    seNorth = clipPolygonHalfPlane(seNorth, -1, 0, -560);
    seNorth = clipPolygonHalfPlane(seNorth, 0, 1, 620);
    pieces.push(seNorth);
    // South East strip below Marina Harbor (x >= 560, z >= 1120)
    let seSouth = clipPolygonHalfPlane(poly, 0, -1, -1120);
    seSouth = clipPolygonHalfPlane(seSouth, -1, 0, -560);
    pieces.push(seSouth);
    return pieces;
  };

  const underpassHoles = UNDERPASS_SPANS.map((un) => {
    const halfW = un.width * 0.5 + 0.5;
    const halfL = un.length * 0.5;
    return un.axis === 'x'
      ? { minX: un.centerX - halfL, maxX: un.centerX + halfL, minZ: un.centerZ - halfW, maxZ: un.centerZ + halfW }
      : { minX: un.centerX - halfW, maxX: un.centerX + halfW, minZ: un.centerZ - halfL, maxZ: un.centerZ + halfL };
  });

  const terrainGeos: THREE.BufferGeometry[] = [];
  for (const piece of splitIslandPolygons(outerOutline)) {
    const g = buildLandmassGeometry(piece, 0.055, underpassHoles);
    if (g) terrainGeos.push(g.toNonIndexed());
  }
  if (terrainGeos.length > 0) {
    const mergedTerrain = BufferGeometryUtils.mergeGeometries(terrainGeos);
    const terrainMesh = new THREE.Mesh(mergedTerrain, terrainMat);
    terrainMesh.position.y = 0.0;
    terrainMesh.receiveShadow = true;
    worldGroup.add(terrainMesh);
    terrainGeos.forEach((g) => g.dispose());
  }

  // Urban Weathered Concrete Material for Sidewalks, Curbs & Downtown Block Plazas
  const sidewalkTex = textures.sidewalk;
  const concretePlazaTex = textures.sidewalk.clone();
  concretePlazaTex.repeat.set(1, 1);
  concretePlazaTex.generateMipmaps = true;
  concretePlazaTex.minFilter = THREE.LinearMipmapLinearFilter;
  concretePlazaTex.magFilter = THREE.LinearFilter;
  concretePlazaTex.needsUpdate = true;
  extraTextures.push(concretePlazaTex);

  const sidewalkDeckMat = new THREE.MeshStandardMaterial({
    map: sidewalkTex,
    normalMap: textures.sidewalkNormal,
    normalScale: new THREE.Vector2(0.45, 0.45),
    color: 0xcbd5e1,
    roughness: 0.86,
    metalness: 0.03,
  });

  const urbanPlazaMat = new THREE.MeshStandardMaterial({
    map: concretePlazaTex,
    normalMap: textures.sidewalkNormal,
    normalScale: new THREE.Vector2(0.38, 0.38),
    color: 0xbac2cc,
    roughness: 0.88,
    metalness: 0.03,
    polygonOffset: true,
    polygonOffsetFactor: 1,
  });

  const curbStoneMat = new THREE.MeshStandardMaterial({
    color: 0x828993,
    normalMap: textures.sidewalkNormal,
    normalScale: new THREE.Vector2(0.32, 0.32),
    roughness: 0.82,
    metalness: 0.04,
  });

  // Stone Canal & Marina Embankment Walls
  const canalWallMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.78 });
  const addEmbankment = (x: number, z: number, w: number, d: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.8, d), canalWallMat);
    m.position.set(x, -0.75, z);
    worldGroup.add(m);
  };
  addEmbankment(590, 392, 1860, 1.6);
  addEmbankment(590, 468, 1860, 1.6);
  addEmbankment(-340, 430, 1.6, 78);
  addEmbankment(20, -815, 1680, 1.6);
  addEmbankment(20, -765, 1680, 1.6);
  addEmbankment(560, 870, 1.8, 504);
  addEmbankment(920, 620, 720, 1.8);

  // Scenic Roundabout Plazas & Central Fountains (Textured Grass Lawns + Granite Rim)
  const plazaGrassTex = textures.meadowGrass.clone();
  plazaGrassTex.repeat.set(5, 5);
  plazaGrassTex.generateMipmaps = true;
  plazaGrassTex.minFilter = THREE.LinearMipmapLinearFilter;
  plazaGrassTex.magFilter = THREE.LinearFilter;
  plazaGrassTex.needsUpdate = true;
  extraTextures.push(plazaGrassTex);
  const plazaGrassMat = new THREE.MeshStandardMaterial({
    map: plazaGrassTex,
    normalMap: textures.grassNormal,
    normalScale: new THREE.Vector2(0.48, 0.48),
    color: 0xd9f2d0,
    roughness: 0.9,
  });
  const marbleMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.35, metalness: 0.12 });
  const fountainWaterMat = new THREE.MeshPhysicalMaterial({ color: 0x38bdf8, roughness: 0.08, clearcoat: 1 });

  const addRoundaboutPlaza = (cx: number, cz: number, radius: number) => {
    const curbRing = new THREE.Mesh(new THREE.CylinderGeometry(radius + 0.9, radius + 1.2, 0.22, 40), curbStoneMat);
    curbRing.position.set(cx, 0.09, cz);
    curbRing.receiveShadow = true;
    const grass = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius + 0.1, 0.25, 40), plazaGrassMat);
    grass.position.set(cx, 0.11, cz);
    grass.receiveShadow = true;
    worldGroup.add(curbRing, grass);

    const basin = new THREE.Mesh(new THREE.CylinderGeometry(9.2, 9.8, 0.9, 24), marbleMat);
    basin.position.set(cx, 0.5, cz);
    const pool = new THREE.Mesh(new THREE.CylinderGeometry(8.1, 8.1, 0.75, 24), fountainWaterMat);
    pool.position.set(cx, 0.68, cz);
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.2, 4.4, 16), marbleMat);
    spire.position.set(cx, 2.3, cz);
    const crown = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.32, 10, 24), marbleMat);
    crown.rotation.x = Math.PI / 2;
    crown.position.set(cx, 4.2, cz);
    worldGroup.add(basin, pool, spire, crown);
    circleColliders.push({ x: cx, z: cz, radius: 9.9, height: 5.0 });
  };
  addRoundaboutPlaza(0, -70, 42);
  addRoundaboutPlaza(520, -70, 30);

  // Rolling Green Hills in Northern Highlands (Textured with Terrain Grass Shader)
  const northHills: [number, number, number, number][] = [
    [-980, -1080, 120, 42],
    [-540, -1240, 145, 58],
    [-40, -1320, 155, 62],
    [460, -1220, 140, 52],
    [940, -1040, 130, 44],
  ];
  for (const [hx, hz, hr, hh] of northHills) {
    const hillGeo = new THREE.SphereGeometry(hr, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.5);
    const uvAttr = hillGeo.attributes.uv;
    const posAttr = hillGeo.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      uvAttr.setXY(i, (hx + posAttr.getX(i) * 1.25) * 0.055, (hz + posAttr.getZ(i) * 0.95) * 0.055);
    }
    const hill = new THREE.Mesh(hillGeo, terrainMat);
    hill.scale.set(1.25, hh / hr, 0.95);
    hill.position.set(hx, -1.0, hz);
    hill.receiveShadow = true;
    worldGroup.add(hill);
    circleColliders.push({ x: hx, z: hz, radius: hr * 0.85, height: hh });
  }

  // 3. Curved Roads, Multi-Lane Highways, Raised Sidewalks, Curbs, Crosswalks & Forest Dirt Trails
  const streetTex = textures.asphalt;
  const streetMat = new THREE.MeshStandardMaterial({
    map: streetTex,
    normalMap: textures.asphaltNormal,
    normalScale: new THREE.Vector2(0.45, 0.45),
    roughness: 0.64,
    metalness: 0.08,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  const highwayMat = new THREE.MeshStandardMaterial({
    map: textures.highwayAsphalt,
    normalMap: textures.asphaltNormal,
    normalScale: new THREE.Vector2(0.48, 0.48),
    roughness: 0.58,
    metalness: 0.12,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });

  const dirtMat = new THREE.MeshStandardMaterial({
    map: textures.dirtTrail,
    normalMap: textures.grassNormal,
    normalScale: new THREE.Vector2(0.28, 0.28),
    roughness: 0.94,
    metalness: 0.02,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  wettableRoadMaterials.push(streetMat, highwayMat, urbanPlazaMat);

  const highwayGeos: THREE.BufferGeometry[] = [];
  const streetGeos: THREE.BufferGeometry[] = [];
  const trailGeos: THREE.BufferGeometry[] = [];
  const sidewalkGeos: THREE.BufferGeometry[] = [];
  const curbGeos: THREE.BufferGeometry[] = [];
  const crosswalkPlacements: { x: number; z: number; angle: number; roadWidth: number }[] = [];

  for (const seg of ROAD_SEGMENTS) {
    const geo = createCurvedRoadGeometry(
      seg.points,
      seg.width,
      seg.closed,
      seg.isHighway ? 0.05 : seg.isDirtTrail ? 0.036 : 0.042,
      seg.isHighway ? 26 : 20
    ).toNonIndexed();
    if (seg.isDirtTrail) {
      trailGeos.push(geo);
      continue;
    }
    if (seg.isHighway) highwayGeos.push(geo);
    else streetGeos.push(geo);

    // Build flanking Concrete Curbs & Raised Sidewalks (or Highway Shoulders) cleanly clipped at intersections
    const pts = resamplePolylineForRoad(seg.points, seg.closed, 6.5);
    const swWidth = seg.isHighway ? 2.1 : 3.6;
    const curbFaceW = 0.28;
    const curbTopY = seg.isHighway ? 0.08 : 0.11;
    const gutterY = seg.isHighway ? 0.048 : 0.038;
    const swOuterY = -0.02;
    const isRoundabout = seg.id.startsWith('roundabout_');
    const rbCenter = seg.id === 'roundabout_central' ? { x: 0, z: -70 } : { x: 520, z: -70 };

    const normalsArr: { nx: number; nz: number }[] = [];
    const arcDists: number[] = [];
    let arcDist = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const prev = i > 0 ? pts[i - 1] : p;
      const next = i < pts.length - 1 ? pts[i + 1] : p;
      if (i > 0) arcDist += Math.hypot(p.x - prev.x, p.z - prev.z);
      arcDists.push(arcDist);
      let tx = next.x - prev.x;
      let tz = next.z - prev.z;
      const tlen = Math.hypot(tx, tz) || 1;
      tx /= tlen;
      tz /= tlen;
      normalsArr.push({ nx: -tz, nz: tx });
    }

    const hw = seg.width * 0.5;
    for (const side of [-1, 1] as const) {
      const validMask = pts.map((p, i) => {
        const nx = normalsArr[i].nx * side;
        const nz = normalsArr[i].nz * side;
        if (isRoundabout) {
          const toOutX = p.x - rbCenter.x;
          const toOutZ = p.z - rbCenter.z;
          if (nx * toOutX + nz * toOutZ < 0) return false;
        }
        const innerX = p.x + nx * (hw + 0.85);
        const innerZ = p.z + nz * (hw + 0.85);
        const checkX = p.x + nx * (hw + swWidth * 0.52);
        const checkZ = p.z + nz * (hw + swWidth * 0.52);
        const outerX = p.x + nx * (hw + curbFaceW + swWidth);
        const outerZ = p.z + nz * (hw + curbFaceW + swWidth);
        return (
          !isSidewalkEdgeBlocked(innerX, innerZ, seg.id) &&
          !isSidewalkEdgeBlocked(checkX, checkZ, seg.id) &&
          !isSidewalkEdgeBlocked(outerX, outerZ, seg.id)
        );
      });

      // Extract continuous runs of valid sidewalk samples
      let runStart = -1;
      for (let i = 0; i <= pts.length; i++) {
        const isOk = i < pts.length && validMask[i];
        if (isOk && runStart === -1) {
          runStart = i;
        } else if (!isOk && runStart !== -1) {
          const runEnd = i - 1;
          if (runEnd - runStart >= 1) {
            const curbL: { x: number; y: number; z: number }[] = [];
            const curbR: { x: number; y: number; z: number }[] = [];
            const swL: { x: number; y: number; z: number }[] = [];
            const swR: { x: number; y: number; z: number }[] = [];
            const skirtR: { x: number; y: number; z: number }[] = [];
            const runArcs: number[] = [];

            for (let k = runStart; k <= runEnd; k++) {
              const p = pts[k];
              const nx = normalsArr[k].nx * side;
              const nz = normalsArr[k].nz * side;
              const ix = p.x + nx * (hw - 0.04);
              const iz = p.z + nz * (hw - 0.04);
              const cx = p.x + nx * (hw + curbFaceW);
              const cz = p.z + nz * (hw + curbFaceW);
              const ox = p.x + nx * (hw + curbFaceW + swWidth);
              const oz = p.z + nz * (hw + curbFaceW + swWidth);
              const sx = p.x + nx * (hw + curbFaceW + swWidth + 0.14);
              const sz = p.z + nz * (hw + curbFaceW + swWidth + 0.14);

              curbL.push({ x: ix, y: gutterY, z: iz });
              curbR.push({ x: cx, y: curbTopY, z: cz });
              swL.push({ x: cx, y: curbTopY, z: cz });
              swR.push({ x: ox, y: curbTopY, z: oz });
              skirtR.push({ x: sx, y: swOuterY, z: sz });
              runArcs.push(arcDists[k]);
            }

            // Consistent triangle winding regardless of left (-1) or right (+1) side
            const cg =
              side === 1
                ? buildCurvedStripGeometry(curbL, curbR, runArcs, 0.12)
                : buildCurvedStripGeometry(curbR, curbL, runArcs, 0.12);
            if (cg) curbGeos.push(cg);

            const sg =
              side === 1
                ? buildCurvedStripGeometry(swL, swR, runArcs, 0.125)
                : buildCurvedStripGeometry(swR, swL, runArcs, 0.125);
            if (sg) {
              if (seg.isHighway) curbGeos.push(sg);
              else sidewalkGeos.push(sg);
            }

            const skg =
              side === 1
                ? buildCurvedStripGeometry(swR, skirtR, runArcs, 0.12)
                : buildCurvedStripGeometry(skirtR, swR, runArcs, 0.12);
            if (skg) curbGeos.push(skg);

            // Spawn a crosswalk at city street intersection transitions
            if (!seg.isHighway && !isRoundabout && side === 1) {
              if (runEnd < pts.length - 2) {
                const p = pts[runEnd];
                const nx = normalsArr[runEnd].nx;
                const nz = normalsArr[runEnd].nz;
                if (!isWaterAt(p.x, p.z) && getBridgeElevationAt(p.x, p.z) === 0 && !isPointInsideOtherRoad(p.x, p.z, seg.id, 0.5)) {
                  crosswalkPlacements.push({
                    x: p.x,
                    z: p.z,
                    angle: Math.atan2(-nz, nx),
                    roadWidth: seg.width,
                  });
                }
              }
              if (runStart > 1) {
                const p = pts[runStart];
                const nx = normalsArr[runStart].nx;
                const nz = normalsArr[runStart].nz;
                if (!isWaterAt(p.x, p.z) && getBridgeElevationAt(p.x, p.z) === 0 && !isPointInsideOtherRoad(p.x, p.z, seg.id, 0.5)) {
                  crosswalkPlacements.push({
                    x: p.x,
                    z: p.z,
                    angle: Math.atan2(-nz, nx),
                    roadWidth: seg.width,
                  });
                }
              }
            }
          }
          runStart = -1;
        }
      }
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
  if (trailGeos.length > 0) {
    const m = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(trailGeos), dirtMat);
    m.receiveShadow = true;
    worldGroup.add(m);
    trailGeos.forEach((g) => g.dispose());
  }
  if (sidewalkGeos.length > 0) {
    const m = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(sidewalkGeos), sidewalkDeckMat);
    m.receiveShadow = true;
    worldGroup.add(m);
    sidewalkGeos.forEach((g) => g.dispose());
  }
  if (curbGeos.length > 0) {
    const m = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(curbGeos), curbStoneMat);
    m.receiveShadow = true;
    worldGroup.add(m);
    curbGeos.forEach((g) => g.dispose());
  }

  // White Zebra Crosswalks at City Street Intersections (InstancedMesh with polygonOffset)
  if (crosswalkPlacements.length > 0) {
    const dedupedCrosswalks: typeof crosswalkPlacements = [];
    for (const cw of crosswalkPlacements) {
      if (!dedupedCrosswalks.some((o) => Math.hypot(o.x - cw.x, o.z - cw.z) < 8.5)) {
        dedupedCrosswalks.push(cw);
      }
    }
    const barGeos: THREE.BufferGeometry[] = [];
    const barCount = 7;
    for (let b = 0; b < barCount; b++) {
      const offset = (b - (barCount - 1) * 0.5) * 2.0;
      const g = new THREE.PlaneGeometry(0.95, 3.0);
      g.rotateX(-Math.PI / 2);
      g.translate(offset, 0.056, 0);
      barGeos.push(g);
    }
    const zebraGeo = BufferGeometryUtils.mergeGeometries(barGeos);
    barGeos.forEach((g) => g.dispose());
    const zebraMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      roughness: 0.78,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    const zebraInst = new THREE.InstancedMesh(zebraGeo, zebraMat, dedupedCrosswalks.length);
    const dummy = new THREE.Object3D();
    dedupedCrosswalks.forEach((cw, idx) => {
      dummy.position.set(cw.x, 0, cw.z);
      dummy.rotation.set(0, cw.angle, 0);
      dummy.scale.set(Math.min(1.0, (cw.roadWidth - 3.0) / 14.0), 1, 1);
      dummy.updateMatrix();
      zebraInst.setMatrixAt(idx, dummy.matrix);
    });
    zebraInst.computeBoundingSphere();
    worldGroup.add(zebraInst);
  }

  // Clean Dark Tarmac Intersection Junction Pads (cover overlapping centerlines inside junctions)
  const junctionCoords: [number, number][] = [
    [-360, -680], [0, -680], [240, -660], [520, -660],
    [-360, -290], [0, -290], [240, -290], [520, -290],
    [-360, 220], [0, 220], [240, 220], [520, 220],
    [-760, 540], [-360, 540], [0, 540], [240, 540], [520, 540],
    [-360, -60], [240, 40],
  ];
  {
    const jGeo = new THREE.PlaneGeometry(18.5, 18.5);
    jGeo.rotateX(-Math.PI / 2);
    const jMat = new THREE.MeshStandardMaterial({
      color: 0x1e222a,
      normalMap: textures.asphaltNormal,
      normalScale: new THREE.Vector2(0.42, 0.42),
      roughness: 0.66,
      metalness: 0.08,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const jInst = new THREE.InstancedMesh(jGeo, jMat, junctionCoords.length);
    const dummy = new THREE.Object3D();
    junctionCoords.forEach(([jx, jz], idx) => {
      dummy.position.set(jx, 0.045, jz);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      jInst.setMatrixAt(idx, dummy.matrix);
    });
    jInst.computeBoundingSphere();
    worldGroup.add(jInst);
  }

  // Dedicated Paved Parking Lots with Painted Stalls & Curbs
  const parkingMat = new THREE.MeshStandardMaterial({
    map: textures.parkingLot,
    normalMap: textures.asphaltNormal,
    normalScale: new THREE.Vector2(0.32, 0.32),
    roughness: 0.68,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  wettableRoadMaterials.push(parkingMat);
  const curbMat = curbStoneMat;
  for (const p of PARKING_LOTS) {
    const lot = new THREE.Mesh(new THREE.PlaneGeometry(p.width, p.depth), parkingMat);
    lot.rotation.x = -Math.PI / 2;
    lot.rotation.z = p.rotation;
    lot.position.set(p.x, 0.044, p.z);
    lot.receiveShadow = true;
    worldGroup.add(lot);
    const backCurb = new THREE.Mesh(new THREE.BoxGeometry(p.width + 0.6, 0.24, 0.65), curbMat);
    backCurb.position.set(p.x, 0.12, p.z - p.depth * 0.5);
    const frontCurbL = new THREE.Mesh(new THREE.BoxGeometry(p.width * 0.34, 0.24, 0.65), curbMat);
    frontCurbL.position.set(p.x - p.width * 0.33, 0.12, p.z + p.depth * 0.5);
    const frontCurbR = new THREE.Mesh(new THREE.BoxGeometry(p.width * 0.34, 0.24, 0.65), curbMat);
    frontCurbR.position.set(p.x + p.width * 0.33, 0.12, p.z + p.depth * 0.5);
    worldGroup.add(backCurb, frontCurbL, frontCurbR);
  }

  // 4. Bridges, Elevated Overpasses (Nadchody) & Sunken Underpasses (Podchody)
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.72 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.55, roughness: 0.36 });
  for (const b of BRIDGE_SPANS) {
    const spanLen = b.zEnd - b.zStart;
    const zMidCenter = (b.zStart + b.zEnd) * 0.5;
    const halfSpan = spanLen * 0.5;
    const bridgeSegs = 12;
    const segLen = spanLen / bridgeSegs;
    const bGroup = new THREE.Group();
    bGroup.position.set(b.x, 0, zMidCenter);
    const bAng = b.angle ?? 0;
    bGroup.rotation.y = bAng;

    const evalLocalEl = (lz: number) => {
      const t = 1 - Math.abs(lz) / halfSpan;
      return Math.sin(Math.max(0, t) * Math.PI * 0.5) * b.peakElevation;
    };

    for (let s = 0; s < bridgeSegs; s++) {
      const lz0 = -halfSpan + s * segLen;
      const lz1 = -halfSpan + (s + 1) * segLen;
      const lzMid = (lz0 + lz1) * 0.5;
      const yMid = evalLocalEl(lzMid);
      const y0 = evalLocalEl(lz0);
      const y1 = evalLocalEl(lz1);
      const slope = Math.atan2(y1 - y0, segLen);
      const deck = new THREE.Mesh(new THREE.BoxGeometry(b.width + 2.8, 0.48, segLen + 0.35), deckMat);
      deck.position.set(0, yMid - 0.34, lzMid);
      deck.rotation.x = -slope;
      deck.receiveShadow = true;
      bGroup.add(deck);
    }
    const halfW = b.width * 0.5 + 1.4;
    const cosA = Math.cos(bAng);
    const sinA = Math.sin(bAng);
    [-halfW, halfW].forEach((gx) => {
      const rail = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, spanLen - 1, 4, 8), railMat);
      rail.rotation.x = Math.PI / 2;
      rail.position.set(gx, b.peakElevation * 0.62 + 1.0, 0);
      bGroup.add(rail);
      // Sample rail collision points along span so angled bridges have accurate colliders outside driving lanes
      const railSegs = 5;
      for (let r = 0; r < railSegs; r++) {
        const lz = -halfSpan + ((r + 0.5) / railSegs) * spanLen;
        const wx = b.x + gx * cosA + lz * sinA;
        const wz = zMidCenter - gx * sinA + lz * cosA;
        colliders.push({
          minX: wx - 0.55,
          maxX: wx + 0.55,
          minZ: wz - 0.55,
          maxZ: wz + 0.55,
          height: b.peakElevation + 2.5,
        });
      }
    });
    worldGroup.add(bGroup);
  }

  // Elevated Highway Overpasses (Nadchody) with Drive-Up Ramps & Road-Safe Pillars
  for (const ov of OVERPASS_SPANS) {
    const ovGroup = new THREE.Group();
    const flatLen = ov.length - ov.rampLen * 2;
    const flatDeck = new THREE.Mesh(
      new THREE.BoxGeometry(
        ov.axis === 'x' ? flatLen : ov.width,
        0.75,
        ov.axis === 'x' ? ov.width : flatLen
      ),
      deckMat
    );
    flatDeck.position.set(ov.centerX, ov.deckHeight - 0.35, ov.centerZ);
    flatDeck.castShadow = true;
    flatDeck.receiveShadow = true;
    ovGroup.add(flatDeck);

    // Asphalt driving surface on top of overpass
    const roadTop = new THREE.Mesh(
      new THREE.PlaneGeometry(ov.axis === 'x' ? flatLen : ov.width - 1.2, ov.axis === 'x' ? ov.width - 1.2 : flatLen),
      highwayMat
    );
    roadTop.rotation.x = -Math.PI / 2;
    roadTop.position.set(ov.centerX, ov.deckHeight + 0.04, ov.centerZ);
    ovGroup.add(roadTop);

    // Support pillars spaced so traffic passes freely beneath (never inside any road)
    for (const offset of [-flatLen * 0.42, -flatLen * 0.16, flatLen * 0.16, flatLen * 0.42]) {
      const px = ov.axis === 'x' ? ov.centerX + offset : ov.centerX;
      const pz = ov.axis === 'x' ? ov.centerZ : ov.centerZ + offset;
      for (const side of [-ov.width * 0.38, ov.width * 0.38]) {
        const sx = ov.axis === 'x' ? px : px + side;
        const sz = ov.axis === 'x' ? pz + side : pz;
        if (distanceToRoadNetwork(sx, sz) < 3.6) continue;
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.85, ov.deckHeight, 12), canalWallMat);
        pillar.position.set(sx, ov.deckHeight * 0.5, sz);
        pillar.castShadow = true;
        ovGroup.add(pillar);
        circleColliders.push({ x: sx, z: sz, radius: 0.9, height: ov.deckHeight });
      }
    }

    // Two Gentle Entry/Exit Ramps
    const slopeAngle = Math.atan2(ov.deckHeight, ov.rampLen);
    const slopeLen = Math.hypot(ov.rampLen, ov.deckHeight);
    [-1, 1].forEach((dir) => {
      const rampMesh = new THREE.Mesh(
        new THREE.BoxGeometry(ov.axis === 'x' ? slopeLen : ov.width, 0.65, ov.axis === 'x' ? ov.width : slopeLen),
        highwayMat
      );
      const midOffset = dir * (flatLen * 0.5 + ov.rampLen * 0.5);
      rampMesh.position.set(
        ov.axis === 'x' ? ov.centerX + midOffset : ov.centerX,
        ov.deckHeight * 0.5 - 0.3,
        ov.axis === 'x' ? ov.centerZ : ov.centerZ + midOffset
      );
      if (ov.axis === 'x') rampMesh.rotation.z = -dir * slopeAngle;
      else rampMesh.rotation.x = dir * slopeAngle;
      rampMesh.receiveShadow = true;
      ovGroup.add(rampMesh);
    });
    worldGroup.add(ovGroup);
  }

  // Sunken Underpasses (Podchody) with Cutout Trench, Concrete Retaining Walls, Ramps & Roof Bridge
  const tunnelLightMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24 });
  for (const un of UNDERPASS_SPANS) {
    const flatLen = un.length - un.rampLen * 2;
    const roofDeck = new THREE.Mesh(
      new THREE.BoxGeometry(
        un.axis === 'x' ? flatLen * 0.65 : un.width + 4,
        0.55,
        un.axis === 'x' ? un.width + 4 : flatLen * 0.65
      ),
      deckMat
    );
    roofDeck.position.set(un.centerX, -0.25, un.centerZ);
    roofDeck.receiveShadow = true;
    worldGroup.add(roofDeck);

    // Interior tunnel floor strip
    const floorStrip = new THREE.Mesh(
      new THREE.PlaneGeometry(un.axis === 'x' ? flatLen : un.width, un.axis === 'x' ? un.width : flatLen),
      streetMat
    );
    floorStrip.rotation.x = -Math.PI / 2;
    floorStrip.position.set(un.centerX, -un.depth + 0.04, un.centerZ);
    worldGroup.add(floorStrip);

    // Two sloped entry/exit ramps into the sunken tunnel
    const slopeAngle = Math.atan2(un.depth, un.rampLen);
    const slopeLen = Math.hypot(un.rampLen, un.depth);
    [-1, 1].forEach((dir) => {
      const rampMesh = new THREE.Mesh(
        new THREE.BoxGeometry(un.axis === 'x' ? slopeLen : un.width, 0.32, un.axis === 'x' ? un.width : slopeLen),
        streetMat
      );
      const midOffset = dir * (flatLen * 0.5 + un.rampLen * 0.5);
      rampMesh.position.set(
        un.axis === 'x' ? un.centerX + midOffset : un.centerX,
        -un.depth * 0.5 - 0.14,
        un.axis === 'x' ? un.centerZ : un.centerZ + midOffset
      );
      if (un.axis === 'x') rampMesh.rotation.z = dir * slopeAngle;
      else rampMesh.rotation.x = -dir * slopeAngle;
      rampMesh.receiveShadow = true;
      worldGroup.add(rampMesh);
    });

    // Retaining concrete side walls along trench perimeter
    const wallH = un.depth + 0.35;
    [-1, 1].forEach((side) => {
      const wThick = 0.85;
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(
          un.axis === 'x' ? un.length : wThick,
          wallH,
          un.axis === 'x' ? wThick : un.length
        ),
        canalWallMat
      );
      const lat = side * (un.width * 0.5 + wThick * 0.5);
      wall.position.set(
        un.axis === 'x' ? un.centerX : un.centerX + lat,
        -un.depth * 0.5 + 0.15,
        un.axis === 'x' ? un.centerZ + lat : un.centerZ
      );
      wall.receiveShadow = true;
      worldGroup.add(wall);
    });

    for (let t = -flatLen * 0.35; t <= flatLen * 0.35; t += 24) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.16, 0.45), tunnelLightMat);
      lamp.position.set(
        un.axis === 'x' ? un.centerX + t : un.centerX,
        -0.58,
        un.axis === 'x' ? un.centerZ : un.centerZ + t
      );
      worldGroup.add(lamp);
    }
  }

  // 5. Expanded 15x Bayshore International Airport (Twin 800m Runways, Hangars & Control Tower)
  const asphaltDarkMat = new THREE.MeshStandardMaterial({
    color: 0x1e2530,
    normalMap: textures.asphaltNormal,
    normalScale: new THREE.Vector2(0.36, 0.36),
    roughness: 0.78,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  const apronConcreteTex = textures.sidewalk.clone();
  apronConcreteTex.repeat.set(38, 20);
  apronConcreteTex.generateMipmaps = true;
  apronConcreteTex.minFilter = THREE.LinearMipmapLinearFilter;
  apronConcreteTex.magFilter = THREE.LinearFilter;
  apronConcreteTex.needsUpdate = true;
  extraTextures.push(apronConcreteTex);
  const apronMat = new THREE.MeshStandardMaterial({
    map: apronConcreteTex,
    normalMap: textures.sidewalkNormal,
    normalScale: new THREE.Vector2(0.28, 0.28),
    color: 0x4b5563,
    roughness: 0.85,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });

  const apron = new THREE.Mesh(new THREE.PlaneGeometry(820, 420), apronMat);
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(-960, 0.032, 790);
  apron.receiveShadow = true;
  worldGroup.add(apron);

  const runway1 = new THREE.Mesh(new THREE.PlaneGeometry(780, 32), asphaltDarkMat);
  runway1.rotation.x = -Math.PI / 2;
  runway1.position.set(-960, 0.04, 790);
  runway1.receiveShadow = true;
  worldGroup.add(runway1);

  const runway2 = new THREE.Mesh(new THREE.PlaneGeometry(720, 28), asphaltDarkMat);
  runway2.rotation.x = -Math.PI / 2;
  runway2.position.set(-960, 0.04, 920);
  runway2.receiveShadow = true;
  worldGroup.add(runway2);

  const stripeMat = new THREE.MeshBasicMaterial({ color: 0xf8fafc });
  const yellowLineMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
  for (let rx = -1320; rx <= -600; rx += 22) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(11, 0.8), stripeMat);
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(rx, 0.048, 790);
    worldGroup.add(dash);
    if (rx >= -1290 && rx <= -630) {
      const dash2 = dash.clone();
      dash2.position.z = 920;
      worldGroup.add(dash2);
    }
  }
  const taxiGuide = new THREE.Mesh(new THREE.PlaneGeometry(460, 0.7), yellowLineMat);
  taxiGuide.rotation.x = -Math.PI / 2;
  taxiGuide.position.set(-920, 0.045, 700);
  worldGroup.add(taxiGuide);

  // Runway lights InstancedMesh
  const rLightCoords: [number, number, number][] = [];
  for (let lx = -1330; lx <= -590; lx += 32) {
    rLightCoords.push([lx, 773, 0x38bdf8], [lx, 807, 0x38bdf8], [lx, 905, 0x38bdf8], [lx, 935, 0x38bdf8]);
  }
  if (rLightCoords.length > 0) {
    const rLightGeo = new THREE.SphereGeometry(0.38, 6, 6);
    rLightGeo.translate(0, 0.25, 0);
    const rLightInst = new THREE.InstancedMesh(
      rLightGeo,
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      rLightCoords.length
    );
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    rLightCoords.forEach(([lx, lz, hex], idx) => {
      dummy.position.set(lx, 0, lz);
      dummy.updateMatrix();
      rLightInst.setMatrixAt(idx, dummy.matrix);
      col.setHex(hex);
      rLightInst.setColorAt(idx, col);
    });
    rLightInst.computeBoundingSphere();
    worldGroup.add(rLightInst);
  }

  // Open-Front 3-Wall Aircraft Hangars (Open +Z facing Main Runways)
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
    const thick = 1.2;

    const backWall = new THREE.Mesh(new THREE.BoxGeometry(hw, hh, thick), hWallMat);
    backWall.position.set(0, hh * 0.5, -hd * 0.5 + thick * 0.5);
    backWall.castShadow = true;
    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(thick, hh, hd), hWallMat);
    leftWall.position.set(-hw * 0.5 + thick * 0.5, hh * 0.5, 0);
    leftWall.castShadow = true;
    const rightWall = new THREE.Mesh(new THREE.BoxGeometry(thick, hh, hd), hWallMat);
    rightWall.position.set(hw * 0.5 - thick * 0.5, hh * 0.5, 0);
    rightWall.castShadow = true;
    const roof = new THREE.Mesh(
      new THREE.CylinderGeometry(hw * 0.5, hw * 0.5, hd, 16, 1, false, 0, Math.PI),
      hRoofMat
    );
    roof.rotation.z = Math.PI / 2;
    roof.rotation.y = Math.PI / 2;
    roof.scale.set(1, 1, 0.32);
    roof.position.set(0, hh, 0);
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(hw + 0.5, 0.42, 0.5), bayMat);
    lintel.position.set(0, hh + 0.2, hd * 0.5);
    const floorPad = new THREE.Mesh(new THREE.PlaneGeometry(hw - 4, hd - 3), apronMat);
    floorPad.rotation.x = -Math.PI / 2;
    floorPad.position.set(0, 0.046, 0);
    const bayRing = new THREE.Mesh(new THREE.BoxGeometry(hw - 3, 0.06, 0.4), bayMat);
    bayRing.position.set(0, 0.06, hd * 0.5 - 0.6);
    hg.add(backWall, leftWall, rightWall, roof, lintel, floorPad, bayRing);
    if (isPlayerStorage) {
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.65, 10, 8), bayMat);
      beacon.position.set(0, hh + 3.2, hd * 0.5);
      hg.add(beacon);
    }
    worldGroup.add(hg);
    colliders.push(
      { minX: cx - hw * 0.5, maxX: cx + hw * 0.5, minZ: cz - hd * 0.5, maxZ: cz - hd * 0.5 + thick + 0.2, height: hh + 2 },
      { minX: cx - hw * 0.5, maxX: cx - hw * 0.5 + thick + 0.2, minZ: cz - hd * 0.5, maxZ: cz + hd * 0.5, height: hh + 2 },
      { minX: cx + hw * 0.5 - thick - 0.2, maxX: cx + hw * 0.5, minZ: cz - hd * 0.5, maxZ: cz + hd * 0.5, height: hh + 2 }
    );
    floorSurfaces.push({
      minX: cx - hw * 0.5,
      maxX: cx + hw * 0.5,
      minZ: cz - hd * 0.5,
      maxZ: cz + hd * 0.5,
      minY: hh - 0.5,
      height: hh + 2.5,
      isRoofSurface: true,
    });
  };

  addOpenHangar(AIRPORT_HANGAR_ZONE.x, AIRPORT_HANGAR_ZONE.z, 60, 48, 15, 0x06b6d4, true);
  addOpenHangar(-850, 640, 46, 42, 13.5, 0xf59e0b, false);

  // Helper to construct a real animated 3D Elevator + Shaft + Call Pads
  const addElevator = (
    id: string,
    label: string,
    ex: number,
    ez: number,
    floors: ElevatorFloorDef[],
    accentHex: number
  ) => {
    const topY = floors[floors.length - 1].y;
    const shaftGroup = new THREE.Group();
    shaftGroup.position.set(ex, 0, ez);

    const glassWallMat = new THREE.MeshPhysicalMaterial({
      color: 0x0f172a,
      roughness: 0.12,
      metalness: 0.2,
      transparent: true,
      opacity: 0.28,
      envMapIntensity: 0.65,
    });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.75, roughness: 0.3 });
    const glowMat = new THREE.MeshStandardMaterial({
      color: accentHex,
      emissive: accentHex,
      emissiveIntensity: 1.45,
    });

    // 4 Corner Pillars
    [
      [-1.7, -1.7],
      [1.7, -1.7],
      [-1.7, 1.7],
      [1.7, 1.7],
    ].forEach(([px, pz]) => {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, topY + 2.8, 0.2), frameMat);
      post.position.set(px, (topY + 2.8) * 0.5, pz);
      shaftGroup.add(post);
    });

    // Back glass panel so front (+Z) and sides stay easy to walk in
    const backGlass = new THREE.Mesh(new THREE.BoxGeometry(3.3, topY + 2.5, 0.12), glassWallMat);
    backGlass.position.set(0, (topY + 2.5) * 0.5, -1.72);
    shaftGroup.add(backGlass);

    // Call button pads on every floor
    floors.forEach((fl) => {
      const pad = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.07, 8, 22), glowMat);
      pad.rotation.x = Math.PI / 2;
      pad.position.set(0, fl.y + 0.08, 0);
      shaftGroup.add(pad);
    });

    // Moving Elevator Cab Platform
    const cabGroup = new THREE.Group();
    cabGroup.position.set(0, floors[0].y, 0);
    const cabFloor = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 0.28, 3.2),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.6, roughness: 0.35 })
    );
    cabFloor.position.y = -0.14;
    const cabRim = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.12, 3.3), glowMat);
    cabRim.position.y = -0.02;
    const cabCanopy = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.16, 3.2), frameMat);
    cabCanopy.position.y = 2.65;
    cabGroup.add(cabFloor, cabRim, cabCanopy);
    shaftGroup.add(cabGroup);

    worldGroup.add(shaftGroup);
    elevators.push({
      id,
      label,
      x: ex,
      z: ez,
      radius: 2.35,
      floors,
      currentFloorIndex: 0,
      targetFloorIndex: 0,
      currentY: floors[0].y,
      cabGroup,
    });
  };

  // Air Traffic Control Tower (-1060, 670) with Sky Radar Deck & Elevator
  {
    const tx = -1060;
    const tz = 670;
    const towerStem = new THREE.Mesh(
      new THREE.CylinderGeometry(3.4, 4.5, 32, 14),
      new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.52 })
    );
    towerStem.position.set(tx, 16, tz);
    const towerDeck = new THREE.Mesh(
      new THREE.CylinderGeometry(8.2, 6.2, 1.2, 16),
      new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.48, metalness: 0.45 })
    );
    towerDeck.position.set(tx, 32.4, tz);
    const towerCab = new THREE.Mesh(
      new THREE.CylinderGeometry(6.4, 5.4, 4.6, 16),
      new THREE.MeshPhysicalMaterial({ color: 0x06b6d4, roughness: 0.16, clearcoat: 0.85, transparent: true, opacity: 0.42 })
    );
    towerCab.position.set(tx, 35.3, tz);
    const towerRoof = new THREE.Mesh(
      new THREE.CylinderGeometry(6.8, 6.8, 0.6, 16),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5 })
    );
    towerRoof.position.set(tx, 37.9, tz);

    // Rotating Airport Surveillance Radar Dish on ATC roof
    const radarGroup = new THREE.Group();
    radarGroup.position.set(tx, 39.2, tz);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 2.2, 8), new THREE.MeshStandardMaterial({ color: 0x94a3b8 }));
    const dish = new THREE.Mesh(new THREE.BoxGeometry(5.6, 1.3, 0.45), new THREE.MeshStandardMaterial({ color: 0xf8fafc, emissive: 0x38bdf8, emissiveIntensity: 0.5 }));
    dish.position.y = 1.1;
    radarGroup.add(mast, dish);
    worldGroup.add(towerStem, towerDeck, towerCab, towerRoof, radarGroup);
    spinners.push(radarGroup);

    colliders.push({ minX: tx - 4.0, maxX: tx + 4.0, minZ: tz - 4.0, maxZ: tz + 4.0, height: 32.0 });
    floorSurfaces.push({ minX: tx - 7.5, maxX: tx + 7.5, minZ: tz - 7.5, maxZ: tz + 7.5, minY: 31.8, height: 33.1, isRoofSurface: true });
    addElevator(
      'elev_atc',
      'Riadiaca veža ATC',
      tx + 5.8,
      tz,
      [
        { name: 'Prízemie letiska', y: 0 },
        { name: 'Vyhliadková paluba ATC (33 m)', y: 33.0 },
      ],
      0x06b6d4
    );
  }

  // Bayshore Airport Terminal Concourse (Walk-in Hall + Upper Departure Terrace + Fuel Farm)
  {
    const termX = -980;
    const termZ = 568;
    const tw = 66;
    const td = 24;
    const th = 7.4;
    const tg = new THREE.Group();
    tg.position.set(termX, 0, termZ);

    const tWallMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.45, metalness: 0.15 });
    const tGlassMat = new THREE.MeshPhysicalMaterial({ color: 0x0ea5e9, roughness: 0.14, transparent: true, opacity: 0.32, envMapIntensity: 0.7 });
    const tFloorMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.36, metalness: 0.2 });
    const tNeonMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0ea5e9, emissiveIntensity: 1.5 });

    const tFloor = new THREE.Mesh(new THREE.PlaneGeometry(tw, td), tFloorMat);
    tFloor.rotation.x = -Math.PI / 2;
    tFloor.position.y = 0.045;
    const tRoof = new THREE.Mesh(new THREE.BoxGeometry(tw + 2, 0.7, td + 2), new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.6 }));
    tRoof.position.y = th + 0.35;
    const tFacade = new THREE.Mesh(new THREE.BoxGeometry(tw, th, 0.4), tGlassMat);
    tFacade.position.set(0, th * 0.5, td * 0.5 - 0.3);
    const tBack = new THREE.Mesh(new THREE.BoxGeometry(tw, th, 0.9), tWallMat);
    tBack.position.set(0, th * 0.5, -td * 0.5 + 0.45);
    const tLeft = new THREE.Mesh(new THREE.BoxGeometry(0.9, th, td), tWallMat);
    tLeft.position.set(-tw * 0.5 + 0.45, th * 0.5, 0);
    const tRight = new THREE.Mesh(new THREE.BoxGeometry(0.9, th, td), tWallMat);
    tRight.position.set(tw * 0.5 - 0.45, th * 0.5, 0);
    const tSign = new THREE.Mesh(new THREE.BoxGeometry(28, 0.45, 0.45), tNeonMat);
    tSign.position.set(0, th + 0.9, td * 0.5 + 0.2);

    // Check-in Counters & Baggage Carousel inside Terminal
    [-16, -4, 8].forEach((cx) => {
      const desk = new THREE.Mesh(new THREE.BoxGeometry(7.2, 1.15, 2.2), new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.4 }));
      desk.position.set(cx, 0.58, -5.5);
      tg.add(desk);
      colliders.push({ minX: termX + cx - 3.6, maxX: termX + cx + 3.6, minZ: termZ - 6.6, maxZ: termZ - 4.4, height: 1.4 });
    });
    const carousel = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.65, 8, 24), new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5 }));
    carousel.rotation.x = Math.PI / 2;
    carousel.position.set(20, 0.42, 0);
    tg.add(tFloor, tRoof, tBack, tLeft, tRight, tSign, carousel);
    // Open south concourse doorway (left & right wing glass walls)
    const wingGlassL = new THREE.Mesh(new THREE.BoxGeometry(22, th, 0.4), tGlassMat);
    wingGlassL.position.set(-22, th * 0.5, td * 0.5 - 0.3);
    const wingGlassR = new THREE.Mesh(new THREE.BoxGeometry(22, th, 0.4), tGlassMat);
    wingGlassR.position.set(22, th * 0.5, td * 0.5 - 0.3);
    tg.add(wingGlassL, wingGlassR);
    void tFacade;

    worldGroup.add(tg);
    colliders.push(
      { minX: termX - tw * 0.5, maxX: termX + tw * 0.5, minZ: termZ - td * 0.5, maxZ: termZ - td * 0.5 + 1.0, height: th + 0.8 },
      { minX: termX - tw * 0.5, maxX: termX - tw * 0.5 + 1.0, minZ: termZ - td * 0.5, maxZ: termZ + td * 0.5, height: th + 0.8 },
      { minX: termX + tw * 0.5 - 1.0, maxX: termX + tw * 0.5, minZ: termZ - td * 0.5, maxZ: termZ + td * 0.5, height: th + 0.8 },
      { minX: termX - tw * 0.5, maxX: termX - 11, minZ: termZ + td * 0.5 - 0.8, maxZ: termZ + td * 0.5 + 0.4, height: th + 0.8 },
      { minX: termX + 11, maxX: termX + tw * 0.5, minZ: termZ + td * 0.5 - 0.8, maxZ: termZ + td * 0.5 + 0.4, height: th + 0.8 }
    );
    floorSurfaces.push({ minX: termX - tw * 0.5, maxX: termX + tw * 0.5, minZ: termZ - td * 0.5, maxZ: termZ + td * 0.5, minY: th - 0.2, height: th + 0.75, isRoofSurface: true });
    addElevator(
      'elev_terminal',
      'Terminál Bayshore',
      termX + 26,
      termZ + 6,
      [
        { name: 'Odletová hala', y: 0 },
        { name: 'Vyhliadková terasa letiska', y: th + 0.7 },
      ],
      0x38bdf8
    );

    // Airport Aviation Fuel Tanks
    [-1220, -1196].forEach((fx) => {
      const tank = new THREE.Mesh(
        new THREE.CylinderGeometry(5.2, 5.2, 7.5, 18),
        new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.42, metalness: 0.35 })
      );
      tank.position.set(fx, 3.75, 580);
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(5.28, 5.28, 0.7, 18), new THREE.MeshStandardMaterial({ color: 0xf59e0b }));
      stripe.position.set(fx, 5.6, 580);
      worldGroup.add(tank, stripe);
      circleColliders.push({ x: fx, z: 580, radius: 5.4, height: 8.0 });
    });
  }

  // Open-Front Safehouse Drive-In Garage (SAFEHOUSE_GARAGE_ZONE: x: 522, z: -620)
  {
    const gx = SAFEHOUSE_GARAGE_ZONE.x;
    const gz = SAFEHOUSE_GARAGE_ZONE.z;
    const gw = 18;
    const gd = 20;
    const gh = 5.4;
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.52, metalness: 0.12 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.45, metalness: 0.35 });
    const glowStripMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    const gg = new THREE.Group();
    gg.position.set(gx, 0, gz);

    const gBack = new THREE.Mesh(new THREE.BoxGeometry(gw, gh, 0.9), wallMat);
    gBack.position.set(0, gh * 0.5, -gd * 0.5 + 0.45);
    const gLeft = new THREE.Mesh(new THREE.BoxGeometry(0.9, gh, gd), wallMat);
    gLeft.position.set(-gw * 0.5 + 0.45, gh * 0.5, 0);
    const gRight = new THREE.Mesh(new THREE.BoxGeometry(0.9, gh, gd), wallMat);
    gRight.position.set(gw * 0.5 - 0.45, gh * 0.5, 0);
    const gRoof = new THREE.Mesh(new THREE.BoxGeometry(gw + 0.6, 0.65, gd + 0.6), trimMat);
    gRoof.position.set(0, gh + 0.32, 0);
    const gNeon = new THREE.Mesh(new THREE.BoxGeometry(gw + 0.3, 0.25, 0.3), glowStripMat);
    gNeon.position.set(0, gh + 0.12, gd * 0.5);
    const gFloor = new THREE.Mesh(new THREE.PlaneGeometry(gw - 2, gd - 2), apronMat);
    gFloor.rotation.x = -Math.PI / 2;
    gFloor.position.set(0, 0.046, 0);
    const gLine = new THREE.Mesh(new THREE.BoxGeometry(gw - 2.5, 0.06, 0.28), glowStripMat);
    gLine.position.set(0, 0.06, gd * 0.5 - 0.5);
    gg.add(gBack, gLeft, gRight, gRoof, gNeon, gFloor, gLine);
    worldGroup.add(gg);

    colliders.push(
      { minX: gx - gw * 0.5, maxX: gx + gw * 0.5, minZ: gz - gd * 0.5, maxZ: gz - gd * 0.5 + 1.0, height: gh + 1 },
      { minX: gx - gw * 0.5, maxX: gx - gw * 0.5 + 1.0, minZ: gz - gd * 0.5, maxZ: gz + gd * 0.5, height: gh + 1 },
      { minX: gx + gw * 0.5 - 1.0, maxX: gx + gw * 0.5, minZ: gz - gd * 0.5, maxZ: gz + gd * 0.5, height: gh + 1 }
    );
    floorSurfaces.push({
      minX: gx - gw * 0.5,
      maxX: gx + gw * 0.5,
      minZ: gz - gd * 0.5,
      maxZ: gz + gd * 0.5,
      minY: gh,
      height: gh + 0.65,
      isRoofSurface: true,
    });
  }

  // 6. All 14 Enlarged Walk-In Shops, Drive-In Garages, Multi-Floor Buildings with Elevators & Malibu Neon Lounge
  const rackMetalMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.72, roughness: 0.28 });
  const woodShelfMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.7 });
  const chromeMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.85, roughness: 0.18 });
  const clothPalette = [0xf43f5e, 0x06b6d4, 0xf59e0b, 0xec4899, 0x10b981, 0x6366f1];
  const clothMats = clothPalette.map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.78 }));
  const boxColors = [0xef4444, 0x3b82f6, 0x22c55e, 0xfbbf24, 0xa855f7];
  const boxMats = boxColors.map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
  const hospBedMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.4 });
  const hospPillowMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.7 });
  const hospMonMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, emissive: 0x10b981, emissiveIntensity: 0.85 });
  const pcMonitorMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, emissive: 0x38bdf8, emissiveIntensity: 0.7 });
  const fireLockerMat = new THREE.MeshStandardMaterial({ color: 0x7f1d1d, roughness: 0.5 });
  const fireHelmetMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.3 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.85 });
  const counterMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.4, metalness: 0.4 });

  const addEnterableShopBuilding = (shop: ShopDef) => {
    const isGarage = shop.category === 'garage';
    const isFire = shop.category === 'fire_station';
    const isRange = shop.category === 'shooting_range';
    const isHospital = shop.category === 'hospital';
    const isPoliceStation = shop.category === 'police_station';
    const isBarber = shop.category === 'barber';
    const isTattoo = shop.category === 'tattoo';
    const isSafehouse = shop.category === 'safehouse';
    const isBoutique = shop.category === 'wardrobe';
    const isMarket = shop.category === 'supplies';
    const isWeapons = shop.category === 'weapons';
    const isLounge = shop.category === 'lounge';

    const w = isRange ? 30 : isBoutique || isMarket || isLounge ? 36 : isGarage || isFire ? 34 : isHospital || isPoliceStation || isSafehouse ? 30 : 28;
    const d = isRange ? 36 : isBoutique || isMarket || isLounge ? 28 : isGarage || isFire ? 26 : isHospital || isPoliceStation || isSafehouse ? 26 : 24;
    const isMultiFloor = isHospital || isPoliceStation || isSafehouse || isLounge;
    const h = isMultiFloor ? 12.6 : isFire ? 7.6 : 6.6;
    const floor2Y = 6.2;
    const wallThick = 0.9;
    const doorHalf = isGarage || isFire ? 6.4 : 4.2;

    const g = new THREE.Group();
    g.position.set(shop.x, 0, shop.z);

    const floorMat = new THREE.MeshStandardMaterial({
      color: isBoutique ? 0x262938 : isSafehouse ? 0x3b2c20 : isLounge ? 0x170f28 : 0x1e293b,
      roughness: 0.44,
      metalness: 0.14,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.6, d - 0.6), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.045;
    floor.receiveShadow = true;
    g.add(floor);

    const wallColor = isGarage
      ? 0x334155
      : isFire
        ? 0x991b1b
        : isPoliceStation
          ? 0x1e293b
          : isTattoo || isLounge
            ? 0x18181b
            : isSafehouse
              ? 0xfef3c7
              : isRange
                ? 0x27272a
                : 0xe2e8f0;
    const wallMat = new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.58, metalness: 0.12 });
    const neonHex = new THREE.Color(shop.color).getHex();
    const neonMat = new THREE.MeshStandardMaterial({
      color: neonHex,
      emissive: neonHex,
      emissiveIntensity: 1.75,
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

    // Walkable/Landable Rooftop
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.6, 0.7, d + 0.6),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.72 })
    );
    roof.position.y = h + 0.35;
    roof.castShadow = true;
    roof.receiveShadow = true;
    g.add(roof);
    floorSurfaces.push({
      minX: shop.x - w * 0.5,
      maxX: shop.x + w * 0.5,
      minZ: shop.z - d * 0.5,
      maxZ: shop.z + d * 0.5,
      minY: h - 0.1,
      height: h + 0.7,
      isRoofSurface: true,
    });

    // Multi-Floor Interior Mezzanine + Working Elevator inside Large Civic & VIP Buildings!
    if (isMultiFloor) {
      const mezzW = w - 8.5;
      const mezzD = d - 4.0;
      const mezz = new THREE.Mesh(
        new THREE.BoxGeometry(mezzW, 0.45, mezzD),
        new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.5 })
      );
      mezz.position.set(-2.2, floor2Y - 0.22, 0);
      mezz.receiveShadow = true;
      g.add(mezz);
      floorSurfaces.push({
        minX: shop.x - 2.2 - mezzW * 0.5,
        maxX: shop.x - 2.2 + mezzW * 0.5,
        minZ: shop.z - mezzD * 0.5,
        maxZ: shop.z + mezzD * 0.5,
        minY: floor2Y - 0.5,
        height: floor2Y,
        isRoofSurface: true,
      });

      const elevOffsetX = doorSide === 'west' ? w * 0.5 - 3.6 : w * 0.5 - 3.4;
      const elevOffsetZ = doorSide === 'south' ? -d * 0.5 + 3.6 : d * 0.5 - 3.6;
      addElevator(
        `elev_${shop.id}`,
        shop.name,
        shop.x + elevOffsetX,
        shop.z + elevOffsetZ,
        [
          { name: 'Prízemie', y: 0 },
          { name: isHospital ? 'Operačná sála (2. posch.)' : isPoliceStation ? 'Veliteľstvo VCPD (2. posch.)' : isLounge ? 'VIP Balkón (2. posch.)' : 'Horizont Galéria (2. posch.)', y: floor2Y },
          { name: 'Strešná terasa / Heliport', y: h + 0.7 },
        ],
        neonHex
      );
    }

    const neonTrim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.75, 0.3, d + 0.75), neonMat);
    neonTrim.position.y = h + 0.06;
    g.add(neonTrim);

    const signZ = doorSide === 'south' ? d / 2 + 0.3 : -d / 2 - 0.3;
    if (isHospital) {
      const crossMat = new THREE.MeshStandardMaterial({ color: 0xf43f5e, emissive: 0xf43f5e, emissiveIntensity: 2.0 });
      const vBar = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 2.5, 4, 8), crossMat);
      const hBar = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 2.5, 4, 8), crossMat);
      hBar.rotation.z = Math.PI / 2;
      vBar.position.set(0, h + 2.1, signZ);
      hBar.position.set(0, h + 2.1, signZ);
      g.add(vBar, hBar);
    } else if (isPoliceStation) {
      const copBlue = new THREE.MeshStandardMaterial({ color: 0x3b82f6, emissive: 0x3b82f6, emissiveIntensity: 2.1 });
      const copRed = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xef4444, emissiveIntensity: 2.1 });
      const bL = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 2.8, 4, 8), copBlue);
      bL.rotation.z = Math.PI / 2;
      bL.position.set(-1.7, h + 1.5, signZ);
      const bR = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 2.8, 4, 8), copRed);
      bR.rotation.z = Math.PI / 2;
      bR.position.set(1.7, h + 1.5, signZ);
      g.add(bL, bR);
    } else if (isBarber) {
      const poleColors = [0xef4444, 0xf8fafc, 0x3b82f6];
      for (let i = 0; i < 3; i++) {
        const ring = new THREE.Mesh(
          new THREE.CylinderGeometry(0.26, 0.26, 0.55, 12),
          new THREE.MeshStandardMaterial({ color: poleColors[i], emissive: poleColors[i], emissiveIntensity: 0.7 })
        );
        ring.position.set(-5.2, 2.0 + i * 0.55, signZ + 0.15);
        g.add(ring);
      }
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
      addWallSeg(wx, 0, wallThick, doorHalf * 2, Math.max(1.4, h - 4.4), 4.4);
    } else {
      const wz = doorSide === 'south' ? d / 2 - wallThick / 2 : -d / 2 + wallThick / 2;
      const segW = w / 2 - doorHalf;
      addWallSeg(-w / 2 + segW / 2, wz, segW, wallThick);
      addWallSeg(w / 2 - segW / 2, wz, segW, wallThick);
      addWallSeg(0, wz, doorHalf * 2, wallThick, Math.max(1.4, h - 4.4), 4.4);
    }

    // Authentic Detailed Spacious Walk-In Interior Furniture by Category (inside proximity-culled group)
    const interiorG = new THREE.Group();
    g.add(interiorG);
    shopInteriors.push({ x: shop.x, z: shop.z, radius: isLounge ? 95 : 75, group: interiorG });

    if (isBoutique) {
      // Multi-aisle Boutique with 8 clothing racks + mannequins + fitting booths + velvet ottoman + tall mirror
      const rackPositions: [number, number][] = [
        [-8.5, -7.2],
        [-8.5, -2.0],
        [-8.5, 3.2],
        [-8.5, 8.0],
        [4.5, -7.2],
        [4.5, -2.0],
        [4.5, 3.2],
        [4.5, 8.0],
      ];
      const barGeo = new THREE.CylinderGeometry(0.05, 0.05, 4.4, 8);
      const legGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.65, 8);
      const garmentGeo = new THREE.BoxGeometry(0.32, 0.98, 0.56);
      rackPositions.forEach(([rx, rz], rIdx) => {
        const bar = new THREE.Mesh(barGeo, chromeMat);
        bar.rotation.z = Math.PI / 2;
        bar.position.set(rx, 1.65, rz);
        const legL = new THREE.Mesh(legGeo, chromeMat);
        legL.position.set(rx - 2.15, 0.82, rz);
        const legR = new THREE.Mesh(legGeo, chromeMat);
        legR.position.set(rx + 2.15, 0.82, rz);
        interiorG.add(bar, legL, legR);
        for (let c = 0; c < 7; c++) {
          const garment = new THREE.Mesh(garmentGeo, clothMats[(rIdx + c) % clothMats.length]);
          garment.position.set(rx - 1.65 + c * 0.55, 1.15, rz);
          interiorG.add(garment);
        }
        colliders.push({ minX: shop.x + rx - 2.2, maxX: shop.x + rx + 2.2, minZ: shop.z + rz - 0.35, maxZ: shop.z + rz + 0.35, height: 1.7 });
      });
      // Center Velvet Ottoman + 2 Fashion Mannequins on pedestals
      const ottoman = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.5, 0.55, 16), new THREE.MeshStandardMaterial({ color: 0x831843, roughness: 0.75 }));
      ottoman.position.set(-2.0, 0.28, 0);
      interiorG.add(ottoman);
      [-5.5, 5.5].forEach((mz, mIdx) => {
        const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, 0.32, 12), chromeMat);
        ped.position.set(11.5, 0.16, mz);
        const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.75, 4, 8), new THREE.MeshStandardMaterial({ color: mIdx === 0 ? 0xec4899 : 0x06b6d4, roughness: 0.45 }));
        torso.position.set(11.5, 1.1, mz);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), chromeMat);
        head.position.set(11.5, 1.76, mz);
        interiorG.add(ped, torso, head);
      });
      const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.28, 3.2, 4.6), chromeMat);
      mirror.position.set(w * 0.5 - 1.4, 1.6, 0);
      interiorG.add(mirror);
    } else if (isMarket) {
      // 4 Supermarket Aisles with colorful stocked boxes + glowing cold drink fridges along back wall + promo island
      const itemGeo = new THREE.BoxGeometry(1.52, 0.42, 1.1);
      [-9.5, -3.5, 3.5, 9.5].forEach((ax, aIdx) => {
        const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.3, 13.5), woodShelfMat);
        shelf.position.set(ax, 1.15, 0);
        const topTrim = new THREE.Mesh(new THREE.BoxGeometry(1.46, 0.18, 13.54), neonMat);
        topTrim.position.set(ax, 2.35, 0);
        interiorG.add(shelf, topTrim);
        for (let b = -5.5; b <= 5.5; b += 2.2) {
          const item = new THREE.Mesh(itemGeo, boxMats[(aIdx + Math.round(b + 6)) % boxMats.length]);
          item.position.set(ax, 1.45, b);
          interiorG.add(item);
        }
        colliders.push({ minX: shop.x + ax - 0.75, maxX: shop.x + ax + 0.75, minZ: shop.z - 6.75, maxZ: shop.z + 6.75, height: 2.4 });
      });
      // Illuminated Cold Beverage Coolers on east interior wall
      const cooler = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.8, 12), new THREE.MeshStandardMaterial({ color: 0x0ea5e9, emissive: 0x0284c7, emissiveIntensity: 0.65, roughness: 0.2 }));
      cooler.position.set(w * 0.5 - 2.0, 1.4, 0);
      interiorG.add(cooler);
    } else if (isWeapons) {
      // Tactical Gun Walls with mounted weapon bars, green/amber ammo crates & Kevlar armor stands
      const gunBarGeo = new THREE.BoxGeometry(0.85, 0.22, 1.4);
      [-11.5, 11.5].forEach((wx) => {
        const rack = new THREE.Mesh(new THREE.BoxGeometry(0.7, 3.2, 14.0), rackMetalMat);
        rack.position.set(wx, 1.6, 0);
        const glow = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.16, 14.0), neonMat);
        glow.position.set(wx, 3.2, 0);
        interiorG.add(rack, glow);
        for (let rz = -5; rz <= 5; rz += 2.5) {
          const gunBar = new THREE.Mesh(gunBarGeo, chromeMat);
          gunBar.position.set(wx, 1.85, rz);
          interiorG.add(gunBar);
        }
      });
      // Green military ammo crates & ballistic armor stand
      const crateMat = new THREE.MeshStandardMaterial({ color: 0x3f6212, roughness: 0.75 });
      [-6.5, 6.5].forEach((cx) => {
        const crate = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.95, 1.4), crateMat);
        crate.position.set(cx, 0.48, 5.5);
        interiorG.add(crate);
      });
      const vestStand = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 1.55, 10), new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.65 }));
      vestStand.position.set(0, 0.78, 5.5);
      interiorG.add(vestStand);
    } else if (isRange) {
      const firingBench = new THREE.Mesh(new THREE.BoxGeometry(w - 4, 1.05, 1.2), rackMetalMat);
      firingBench.position.set(0, 0.52, -5.5);
      interiorG.add(firingBench);
      colliders.push({ minX: shop.x - (w - 4) * 0.5, maxX: shop.x + (w - 4) * 0.5, minZ: shop.z - 6.1, maxZ: shop.z - 4.9, height: 1.2 });
      // Lane dividers & ammo trays along shooting stalls
      const divGeo = new THREE.BoxGeometry(0.16, 2.2, 2.4);
      [-6.75, -2.25, 2.25, 6.75].forEach((dx) => {
        const div = new THREE.Mesh(divGeo, wallMat);
        div.position.set(dx, 1.1, -6.2);
        interiorG.add(div);
      });

      [-9, -4.5, 0, 4.5, 9].forEach((tx, tIdx) => {
        const tMesh = createRangeTargetRig();
        const wz = tIdx % 2 === 0 ? 8.5 : 13.0;
        tMesh.position.set(shop.x + tx, 0.05, shop.z + wz);
        tMesh.rotation.y = Math.PI;
        worldGroup.add(tMesh);
        rangeTargets.push({
          id: `range_target_${tIdx}`,
          mesh: tMesh,
          x: shop.x + tx,
          y: 0.05,
          z: shop.z + wz,
          alive: true,
          respawnTimer: 0,
        });
      });
    } else if (isBarber || isTattoo) {
      const chairMat = new THREE.MeshStandardMaterial({ color: isTattoo ? 0x14b8a6 : 0x7f1d1d, roughness: 0.45 });
      [-7.5, -2.5, 2.5, 7.5].forEach((cx) => {
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.52, 0.35, 12), chromeMat);
        base.position.set(cx, 0.18, 2.6);
        const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.25, isTattoo ? 2.0 : 0.95), chairMat);
        cushion.position.set(cx, 0.65, 2.6);
        const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.85, 0.22), chairMat);
        backrest.position.set(cx, 1.05, 2.15);
        const mirror = new THREE.Mesh(new THREE.BoxGeometry(1.9, 2.2, 0.16), chromeMat);
        mirror.position.set(cx, 1.9, 6.2);
        const frameGlow = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.1, 0.2), neonMat);
        frameGlow.position.set(cx, 3.05, 6.2);
        interiorG.add(base, cushion, backrest, mirror, frameGlow);
      });
      // Waiting bench
      const waitSofa = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.75, 1.3), chairMat);
      waitSofa.position.set(6.5, 0.38, -7.2);
      interiorG.add(waitSofa);
    } else if (isHospital) {
      // Hospital beds + IV drip stands + vital monitors + reception glass divider
      [-8.5, -3.5, 2.5].forEach((bx) => {
        const bed = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.75, 4.2), hospBedMat);
        bed.position.set(bx, 0.4, 2.0);
        const pillow = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.18, 0.65), hospPillowMat);
        pillow.position.set(bx, 0.84, 0.35);
        const ivPole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.1, 8), chromeMat);
        ivPole.position.set(bx + 1.3, 1.05, 0.5);
        const monitor = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.45, 0.35), hospMonMat);
        monitor.position.set(bx - 1.3, 1.35, 0.4);
        interiorG.add(bed, pillow, ivPole, monitor);
        colliders.push({ minX: shop.x + bx - 1.1, maxX: shop.x + bx + 1.1, minZ: shop.z - 0.1, maxZ: shop.z + 4.1, height: 1.0 });
      });
    } else if (isPoliceStation) {
      // Police briefing room: 2 barred holding cells on west wall + glowing evidence board + officer desks
      const barMat = chromeMat;
      for (let z = -7; z <= 3; z += 5) {
        const desk = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.85, 1.5), rackMetalMat);
        desk.position.set(-7.5, 0.42, z);
        const pc = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.48, 0.12), pcMonitorMat);
        pc.position.set(-7.5, 1.1, z);
        interiorG.add(desk, pc);
      }
      // Barred Holding Cell enclosure on back-west side
      const barGeo = new THREE.CylinderGeometry(0.05, 0.05, 3.6, 6);
      for (let bx = -12; bx <= -4; bx += 0.9) {
        const bar = new THREE.Mesh(barGeo, barMat);
        bar.position.set(bx, 1.8, -8.5);
        interiorG.add(bar);
      }
      const crimeBoard = new THREE.Mesh(new THREE.BoxGeometry(0.25, 2.4, 5.2), new THREE.MeshStandardMaterial({ color: 0x1e3a8a, emissive: 0x2563eb, emissiveIntensity: 0.55 }));
      crimeBoard.position.set(12.8, 2.2, 0);
      interiorG.add(crimeBoard);
    } else if (isFire) {
      // VCFD Fire Station: Turnout gear lockers with red coats/helmets & coiled hose wall racks
      const lockerGeo = new THREE.BoxGeometry(1.4, 2.8, 2.6);
      const helmetGeo = new THREE.SphereGeometry(0.26, 8, 6);
      for (let lz = -7; lz <= 7; lz += 3.5) {
        const locker = new THREE.Mesh(lockerGeo, fireLockerMat);
        locker.position.set(-13.5, 1.4, lz);
        const helmet = new THREE.Mesh(helmetGeo, fireHelmetMat);
        helmet.position.set(-13.1, 2.1, lz);
        interiorG.add(locker, helmet);
      }
      const dispatchTable = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.95, 2.0), rackMetalMat);
      dispatchTable.position.set(10.5, 0.48, -6.5);
      interiorG.add(dispatchTable);
    } else if (isSafehouse) {
      const sofa = new THREE.Mesh(
        new THREE.BoxGeometry(5.6, 0.95, 2.0),
        new THREE.MeshStandardMaterial({ color: 0x0ea5e9, roughness: 0.7 })
      );
      sofa.position.set(-7.5, 0.48, 3.0);
      const coffeeTable = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.45, 1.3), chromeMat);
      coffeeTable.position.set(-7.5, 0.24, 0.4);
      const tvScreen = new THREE.Mesh(new THREE.BoxGeometry(4.6, 2.3, 0.2), new THREE.MeshStandardMaterial({ color: 0x090d16, emissive: 0x38bdf8, emissiveIntensity: 0.45 }));
      tvScreen.position.set(-7.5, 2.1, -11.4);
      const closetRack = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.6, 6.4), woodShelfMat);
      closetRack.position.set(-11.5, 1.3, -4.0);
      // 2nd Floor Luxury Bedroom Suit on Mezzanine
      const bed = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.75, 4.4), new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.75 }));
      bed.position.set(-7.0, floor2Y + 0.38, -2.5);
      const rug = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 6.5), new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.85 }));
      rug.rotation.x = -Math.PI / 2;
      rug.position.set(-7.0, floor2Y + 0.04, -2.5);
      interiorG.add(sofa, coffeeTable, tvScreen, closetRack, bed, rug);
      colliders.push(
        { minX: shop.x - 10.3, maxX: shop.x - 4.7, minZ: shop.z + 2.0, maxZ: shop.z + 4.0, height: 1.0 },
        { minX: shop.x - 12.2, maxX: shop.x - 10.8, minZ: shop.z - 7.2, maxZ: shop.z - 0.8, height: 2.6 }
      );
    } else if (isLounge) {
      // Malibu Neon Lounge: Glowing Stage + Chrome Dance Pole + Twin Side Podiums + DJ Booth + Disco Ball + Spotlights + Clothed Dancers & Patrons!
      const stage = new THREE.Mesh(
        new THREE.CylinderGeometry(4.8, 5.2, 0.65, 28),
        new THREE.MeshStandardMaterial({ color: 0x2e1065, roughness: 0.28, metalness: 0.48 })
      );
      stage.position.set(-5.0, 0.32, 0);
      const stageRing = new THREE.Mesh(new THREE.TorusGeometry(4.9, 0.12, 8, 28), neonMat);
      stageRing.rotation.x = Math.PI / 2;
      stageRing.position.set(-5.0, 0.66, 0);

      // Chrome central stage pole + Twin glowing side podiums
      const dancePole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 5.6, 12), chromeMat);
      dancePole.position.set(-5.0, 3.4, 0);
      const podiumL = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.65, 0.55, 18), new THREE.MeshStandardMaterial({ color: 0x4c1d95, roughness: 0.3 }));
      podiumL.position.set(-3.2, 0.28, -5.8);
      const podiumLRing = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.08, 6, 20), neonMat);
      podiumLRing.rotation.x = Math.PI / 2;
      podiumLRing.position.set(-3.2, 0.57, -5.8);
      const podiumR = podiumL.clone();
      podiumR.position.set(-3.2, 0.28, 5.8);
      const podiumRRing = podiumLRing.clone();
      podiumRRing.position.set(-3.2, 0.57, 5.8);

      // DJ Booth + Turntables + Speaker Stacks + Equalizer Wall Bars
      const djBooth = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.35, 6.4), rackMetalMat);
      djBooth.position.set(-12.5, 0.68, 0);
      [-1.1, 1.1].forEach((tz) => {
        const deckPlate = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.08, 16), chromeMat);
        deckPlate.position.set(-12.2, 1.4, tz);
        interiorG.add(deckPlate);
      });
      const spkMat = new THREE.MeshStandardMaterial({ color: 0x090d16, roughness: 0.5 });
      [-4.8, 4.8].forEach((sz) => {
        const spk = new THREE.Mesh(new THREE.BoxGeometry(1.6, 3.6, 1.8), spkMat);
        spk.position.set(-13.8, 1.8, sz);
        const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.14, 14), neonMat);
        cone.rotation.z = Math.PI / 2;
        cone.position.set(-12.95, 2.3, sz);
        interiorG.add(spk, cone);
      });
      const eqBars: THREE.Mesh[] = [];
      const eqMatA = new THREE.MeshBasicMaterial({ color: 0xd946ef });
      const eqMatB = new THREE.MeshBasicMaterial({ color: 0x06b6d4 });
      const eqGeo = new THREE.BoxGeometry(0.25, 1.0, 0.48);
      for (let i = 0; i < 9; i++) {
        const eq = new THREE.Mesh(eqGeo, i % 2 === 0 ? eqMatA : eqMatB);
        eq.position.set(-16.2, 2.4, (i - 4) * 1.15);
        interiorG.add(eq);
        eqBars.push(eq);
      }

      // Disco Ball suspended over central stage
      const discoGroup = new THREE.Group();
      discoGroup.position.set(-5.0, 5.1, 0);
      const discoCore = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.68, 1),
        new THREE.MeshStandardMaterial({ color: 0xf8fafc, metalness: 0.96, roughness: 0.08, flatShading: true })
      );
      const discoChain = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.2, 6), chromeMat);
      discoChain.position.y = 0.9;
      discoGroup.add(discoCore, discoChain);
      interiorG.add(discoGroup);

      // Sweeping Additive Spotlight Cones above the stage
      const spotlights: THREE.Mesh[] = [];
      const spotColors = [0xec4899, 0x06b6d4, 0xa855f7];
      [
        [-5.0, 5.8, -4.0],
        [-5.0, 5.8, 4.0],
        [-1.0, 5.8, 0.0],
      ].forEach(([sx, sy, sz], sIdx) => {
        const coneGeo = new THREE.ConeGeometry(2.5, 5.6, 16, 1, true);
        coneGeo.translate(0, -2.8, 0);
        const coneMat = new THREE.MeshBasicMaterial({
          color: spotColors[sIdx],
          transparent: true,
          opacity: 0.14,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        const cone = new THREE.Mesh(coneGeo, coneMat);
        cone.position.set(sx, sy, sz);
        interiorG.add(cone);
        spotlights.push(cone);
      });

      // Clothed Glamorous Stage Dancers, DJ & Cheering VIP Patrons (ZERO nudity — full stylish clubwear!)
      const dancersMeta: {
        baseX: number;
        baseY: number;
        baseZ: number;
        phase: number;
        style: ClubPerformerRig['style'];
        jacketColor: string;
        shirtColor: string;
        pantsColor: string;
        hairColor: string;
      }[] = [
        { baseX: -5.0, baseY: 0.65, baseZ: 0.65, phase: 0, style: 'pole', jacketColor: '#ec4899', shirtColor: '#fbcfe8', pantsColor: '#be185d', hairColor: '#271a14' },
        { baseX: -3.2, baseY: 0.56, baseZ: -5.8, phase: 1.8, style: 'podiumL', jacketColor: '#06b6d4', shirtColor: '#e0f2fe', pantsColor: '#0e7490', hairColor: '#f59e0b' },
        { baseX: -3.2, baseY: 0.56, baseZ: 5.8, phase: 3.4, style: 'podiumR', jacketColor: '#a855f7', shirtColor: '#f3e8ff', pantsColor: '#6b21a8', hairColor: '#111827' },
        { baseX: -14.1, baseY: 0.05, baseZ: 0.0, phase: 0.5, style: 'dj', jacketColor: '#0f172a', shirtColor: '#38bdf8', pantsColor: '#1e293b', hairColor: '#1f2937' },
        { baseX: 2.0, baseY: 0.05, baseZ: -5.2, phase: 1.1, style: 'patron', jacketColor: '#f97316', shirtColor: '#fff7ed', pantsColor: '#334155', hairColor: '#3b281c' },
        { baseX: 2.2, baseY: 0.05, baseZ: 4.8, phase: 2.7, style: 'patron', jacketColor: '#e2e8f0', shirtColor: '#ec4899', pantsColor: '#0f172a', hairColor: '#1c1917' },
      ];
      const performers: ClubPerformerRig[] = [];
      for (const dm of dancersMeta) {
        const rig = createCharacterRig({
          skinTone: '#d49a73',
          hairStyle: dm.style === 'dj' ? 'fade' : 'waves',
          hairColor: dm.hairColor,
          facialHair: 'none',
          glasses: dm.style === 'dj' ? 'visor' : 'none',
          tattoo: 'none',
          jacketStyle: 'bomber',
          jacketColor: dm.jacketColor,
          shirtColor: dm.shirtColor,
          pantsColor: dm.pantsColor,
          shoesColor: '#f8fafc',
          accessory: 'gold_chain',
        });
        rig.root.position.set(dm.baseX, dm.baseY, dm.baseZ);
        if (dm.style === 'dj') rig.root.rotation.y = Math.PI / 2;
        else if (dm.style === 'patron') rig.root.rotation.y = -Math.PI / 2;
        interiorG.add(rig.root);
        performers.push({ rig, baseX: dm.baseX, baseY: dm.baseY, baseZ: dm.baseZ, phase: dm.phase, style: dm.style });
      }

      // Barstools along East VIP Bar Counter + Backlit Bottle Rack
      for (let bz = -2.2; bz <= 2.2; bz += 1.45) {
        const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.24, 0.85, 10), chromeMat);
        stool.position.set(w * 0.5 - 7.1, 0.42, bz);
        interiorG.add(stool);
      }
      const bottleShelf = new THREE.Mesh(new THREE.BoxGeometry(0.4, 2.2, 5.2), new THREE.MeshStandardMaterial({ color: 0x06b6d4, emissive: 0x0891b2, emissiveIntensity: 0.75 }));
      bottleShelf.position.set(w * 0.5 - 1.6, 1.8, 0);
      interiorG.add(bottleShelf);

      interiorG.add(stage, stageRing, dancePole, podiumL, podiumLRing, podiumR, podiumRRing, djBooth);
      colliders.push(
        { minX: shop.x - 13.6, maxX: shop.x - 11.4, minZ: shop.z - 3.1, maxZ: shop.z + 3.1, height: 1.4 }
      );
      // VIP Sofas along north/south walls
      const vipBoothMat = new THREE.MeshStandardMaterial({ color: 0x701a75, roughness: 0.65 });
      [-8.5, 8.5].forEach((vz) => {
        const booth = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.9, 2.0), vipBoothMat);
        booth.position.set(1.5, 0.45, vz);
        interiorG.add(booth);
        colliders.push({ minX: shop.x - 1.9, maxX: shop.x + 4.9, minZ: shop.z + vz - 1.0, maxZ: shop.z + vz + 1.0, height: 1.0 });
      });

      clubShow = {
        clubX: shop.x,
        clubZ: shop.z,
        discoBall: discoGroup,
        spotlights,
        eqBars,
        performers,
      };
    } else if (isGarage) {
      // Spacious Drive-In Customs Bay: Hydraulic Lift Posts + Tool Cabinets + Tire Stacks + Engine Hoist + Illuminated Bay Pad
      const bayPad = new THREE.Mesh(new THREE.RingGeometry(3.2, 3.65, 28), neonMat);
      bayPad.rotation.x = -Math.PI / 2;
      bayPad.position.set(0, 0.06, 0);
      interiorG.add(bayPad);
      [-8.5, 8.5].forEach((px) => {
        [-3.5, 3.5].forEach((pz) => {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 4.2, 0.5), neonMat);
          post.position.set(px, 2.1, pz);
          interiorG.add(post);
        });
      });
      const toolCab = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.3, 0.9), new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.4 }));
      toolCab.position.set(-12.5, 0.65, -9.2);
      interiorG.add(toolCab);
      const tireGeo = new THREE.TorusGeometry(0.42, 0.16, 8, 16);
      for (let t = 0; t < 3; t++) {
        const tire = new THREE.Mesh(tireGeo, tireMat);
        tire.rotation.x = Math.PI / 2;
        tire.position.set(12.2, 0.16 + t * 0.32, -9.0);
        interiorG.add(tire);
      }
    }

    // Service Desk / Counter (positioned away from doorway & garage drive-in path)
    if (!isRange && !isGarage) {
      const counter = new THREE.Mesh(new THREE.CapsuleGeometry(0.48, 4.4, 6, 12), counterMat);
      counter.rotation.z = Math.PI / 2;
      if (doorSide === 'west') {
        counter.rotation.y = Math.PI / 2;
        counter.position.set(w * 0.5 - 5.5, 0.6, 0);
        colliders.push({ minX: shop.x + w * 0.5 - 6.1, maxX: shop.x + w * 0.5 - 4.9, minZ: shop.z - 2.6, maxZ: shop.z + 2.6, height: 1.5 });
      } else if (doorSide === 'east') {
        counter.rotation.y = Math.PI / 2;
        counter.position.set(-w * 0.5 + 5.5, 0.6, 0);
        colliders.push({ minX: shop.x - w * 0.5 + 4.9, maxX: shop.x - w * 0.5 + 6.1, minZ: shop.z - 2.6, maxZ: shop.z + 2.6, height: 1.5 });
      } else if (doorSide === 'south') {
        counter.position.set(-2.5, 0.6, -d * 0.5 + 4.2);
        colliders.push({ minX: shop.x - 5.1, maxX: shop.x + 0.1, minZ: shop.z - d * 0.5 + 3.6, maxZ: shop.z - d * 0.5 + 4.8, height: 1.5 });
      } else {
        counter.position.set(-2.5, 0.6, d * 0.5 - 4.2);
        colliders.push({ minX: shop.x - 5.1, maxX: shop.x + 0.1, minZ: shop.z + d * 0.5 - 4.8, maxZ: shop.z + d * 0.5 - 3.6, height: 1.5 });
      }
      interiorG.add(counter);
    }

    const interiorLight = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 6.2, 4, 8), neonMat);
    interiorLight.rotation.z = Math.PI / 2;
    interiorLight.position.set(0, h - 0.35, 0);
    interiorG.add(interiorLight);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(isGarage ? 2.1 : 1.45, 0.1, 10, 28),
      new THREE.MeshBasicMaterial({ color: neonHex })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(isGarage ? shop.x : shop.doorX, 0.14, isGarage ? shop.z : shop.doorZ);
    worldGroup.add(ring);
    shopRings.push(ring);

    worldGroup.add(g);
    buildingFootprints.push({ x: shop.x, z: shop.z, w, d, color: shop.color });
  };

  SHOPS.forEach(addEnterableShopBuilding);

  // Paved Architectural Concrete Plazas around Non-Safehouse Shops & Downtown Towers
  const urbanPlazaGeos: THREE.BufferGeometry[] = [];
  const addUrbanPlazaPad = (px: number, pz: number, pw: number, pd: number) => {
    const g = new THREE.PlaneGeometry(pw, pd);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    const uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, (px + pos.getX(i)) * 0.125, (pz + pos.getZ(i)) * 0.125);
    }
    g.translate(px, 0.02, pz);
    urbanPlazaGeos.push(g.toNonIndexed());
  };
  for (const shop of SHOPS) {
    if (shop.category === 'safehouse') {
      // Safehouse patio directly under villa + walkway to front door
      addUrbanPlazaPad(shop.x, shop.z, 34, 30);
    } else {
      addUrbanPlazaPad(shop.x, shop.z, 40, 34);
    }
  }

  // Accessible Downtown Horizon Skyscraper Deck with Scenic Glass Elevator (-110, -400)
  addElevator(
    'elev_horizon_tower',
    'Horizon Sky Tower',
    -84,
    -400,
    [
      { name: 'Námestie Horizon', y: 0 },
      { name: 'Vyhliadková terasa (42 m)', y: 42 },
      { name: 'Strešný heliport (82.5 m)', y: 82.5 },
    ],
    0x06b6d4
  );
  {
    const midDeck = new THREE.Mesh(
      new THREE.BoxGeometry(12, 0.5, 12),
      new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.45, metalness: 0.45 })
    );
    midDeck.position.set(-84, 41.75, -400);
    worldGroup.add(midDeck);
    floorSurfaces.push({ minX: -90, maxX: -78, minZ: -406, maxZ: -394, minY: 41.4, height: 42.1, isRoofSurface: true });
    floorSurfaces.push({ minX: -132, maxX: -78, minZ: -420, maxZ: -380, minY: 81.8, height: 82.7, isRoofSurface: true });
  }

  // 7. High-FPS Batched 15x City Skyline (Calibrated PBR — No Daylight White Overexposure!)
  const modernMat = new THREE.MeshPhysicalMaterial({
    map: textures.buildingModern,
    emissiveMap: textures.buildingModernEmissive,
    emissive: 0xffffff,
    emissiveIntensity: 0.05,
    roughness: 0.28,
    metalness: 0.45,
    clearcoat: 0.65,
    clearcoatRoughness: 0.14,
    envMapIntensity: 0.52,
  });
  const decoMat = new THREE.MeshStandardMaterial({
    map: textures.buildingArtDeco,
    emissiveMap: textures.buildingArtDecoEmissive,
    emissive: 0xffffff,
    emissiveIntensity: 0.04,
    roughness: 0.55,
    metalness: 0.14,
    envMapIntensity: 0.42,
  });
  const indMat = new THREE.MeshStandardMaterial({
    map: textures.buildingIndustrial,
    roughness: 0.72,
    metalness: 0.24,
    envMapIntensity: 0.4,
  });
  buildingWindowMaterials.push(modernMat, decoMat);
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.78 });

  const modernGeos: THREE.BufferGeometry[] = [];
  const decoGeos: THREE.BufferGeometry[] = [];
  const indGeos: THREE.BufferGeometry[] = [];
  const roofGeos: THREE.BufferGeometry[] = [];
  const neonBuckets = new Map<number, THREE.BufferGeometry[]>();

  const canPlaceStructure = (x: number, z: number, w: number, d: number, extraPad = 6.8): boolean => {
    const rad = Math.hypot(w * 0.5, d * 0.5);
    const ang = Math.atan2(z, x);
    if (Math.hypot(x, z) + rad > getIslandCoastRadius(ang) - 55) return false;
    if (isWaterAt(x, z) || isWaterAt(x + w * 0.48, z + d * 0.48) || isWaterAt(x - w * 0.48, z - d * 0.48)) return false;
    if (z >= 365 && z <= 495 && x >= -360) return false; // canal banks
    if (z >= -845 && z <= -735 && x >= -840 && x <= 880) return false; // north river banks
    if (x >= -1380 && x <= -520 && z >= 520 && z <= 1020) return false; // airport complex
    if (
      x >= SAFEHOUSE_GARAGE_ZONE.minX - 18 &&
      x <= SAFEHOUSE_GARAGE_ZONE.maxX + 18 &&
      z >= SAFEHOUSE_GARAGE_ZONE.minZ - 18 &&
      z <= SAFEHOUSE_GARAGE_ZONE.maxZ + 28
    ) {
      return false; // safehouse garage & driveway
    }
    if (Math.hypot(x, z + 70) < 76 + rad || Math.hypot(x - 520, z + 70) < 62 + rad) return false;
    for (const p of PARKING_LOTS) {
      if (Math.abs(x - p.x) < (w + p.width) * 0.5 + 8 && Math.abs(z - p.z) < (d + p.depth) * 0.5 + 8) return false;
    }
    for (const ov of OVERPASS_SPANS) {
      const ox = ov.axis === 'x' ? ov.length * 0.5 + 10 : ov.width + 12;
      const oz = ov.axis === 'x' ? ov.width + 12 : ov.length * 0.5 + 10;
      if (Math.abs(x - ov.centerX) < ox + w * 0.5 && Math.abs(z - ov.centerZ) < oz + d * 0.5) return false;
    }
    for (const un of UNDERPASS_SPANS) {
      const ux = un.axis === 'x' ? un.length * 0.5 + 10 : un.width + 12;
      const uz = un.axis === 'x' ? un.width + 12 : un.length * 0.5 + 10;
      if (Math.abs(x - un.centerX) < ux + w * 0.5 && Math.abs(z - un.centerZ) < uz + d * 0.5) return false;
    }
    if (distanceToRoadNetwork(x, z) < rad + extraPad) return false;
    for (const s of SHOPS) {
      if (Math.hypot(x - s.x, z - s.z) < rad + 30 || Math.hypot(x - s.doorX, z - s.doorZ) < rad + 26) {
        return false;
      }
    }
    for (const fp of buildingFootprints) {
      if (Math.abs(x - fp.x) < (w + fp.w) * 0.5 + 10 && Math.abs(z - fp.z) < (d + fp.d) * 0.5 + 10) {
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

    const cornerR = style === 'deco' ? 4.2 : style === 'modern' ? 2.6 : 1.2;
    const baseShape = createRoundedRectShape(w, d, cornerR);
    const bodyGeo = new THREE.ExtrudeGeometry(baseShape, {
      depth: h,
      bevelEnabled: true,
      bevelThickness: 0.4,
      bevelSize: 0.4,
      bevelSegments: 2,
      curveSegments: 5,
    });
    bodyGeo.rotateX(-Math.PI / 2);
    const pos = bodyGeo.attributes.position;
    const uv = bodyGeo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, (pos.getX(i) + pos.getZ(i)) * 0.035, pos.getY(i) * 0.04);
    }
    bodyGeo.translate(x, 0, z);
    const nonIdxBody = bodyGeo.toNonIndexed();
    bodyGeo.dispose();

    if (style === 'modern') modernGeos.push(nonIdxBody);
    else if (style === 'deco') decoGeos.push(nonIdxBody);
    else indGeos.push(nonIdxBody);

    // Concrete plaza apron directly around city buildings so towers never float on raw grass
    addUrbanPlazaPad(x, z, w + 9.5, d + 9.5);

    if (style === 'modern' && h >= 36) {
      const upperShape = createRoundedRectShape(w * 0.68, d * 0.68, 2.0);
      const upperGeo = new THREE.ExtrudeGeometry(upperShape, {
        depth: 4.5,
        bevelEnabled: false,
        curveSegments: 4,
      });
      upperGeo.rotateX(-Math.PI / 2);
      upperGeo.translate(x, h, z);
      roofGeos.push(upperGeo.toNonIndexed());
      upperGeo.dispose();
    }

    if (neonHex !== undefined) {
      const neonShape = createRoundedRectShape(w + 0.6, d + 0.6, cornerR + 0.2);
      const neonGeo = new THREE.ExtrudeGeometry(neonShape, { depth: 0.42, bevelEnabled: false, curveSegments: 5 });
      neonGeo.rotateX(-Math.PI / 2);
      neonGeo.translate(x, Math.min(h - 1.4, 7.2), z);
      const bucket = neonBuckets.get(neonHex) || [];
      bucket.push(neonGeo.toNonIndexed());
      neonBuckets.set(neonHex, bucket);
      neonGeo.dispose();
    }

    const padMargin = 0.5;
    colliders.push({
      minX: x - w * 0.5 - padMargin,
      maxX: x + w * 0.5 + padMargin,
      minZ: z - d * 0.5 - padMargin,
      maxZ: z + d * 0.5 + padMargin,
      height: h + 0.5,
      isRoofSurface: true,
    });
    buildingFootprints.push({
      x,
      z,
      w,
      d,
      color: style === 'modern' ? '#334155' : style === 'deco' ? '#e2c4b0' : '#475569',
    });
  };

  // Curated Signature Towers across Downtown & Coral Strip
  const neonColors = [0x06b6d4, 0xf97316, 0xec4899, 0xf59e0b, 0x2dd4bf, 0xa855f7];
  const signatureBuildings: Array<[number, number, number, number, number, 'modern' | 'deco' | 'industrial', number?]> = [
    [-110, -400, 44, 40, 82, 'modern', 0x06b6d4],
    [110, -420, 40, 40, 76, 'modern', 0xec4899],
    [-250, -410, 38, 38, 68, 'modern', 0xf97316],
    [360, -400, 38, 38, 62, 'modern', 0x2dd4bf],
    [-120, 80, 38, 36, 56, 'modern', 0xf59e0b],
    [120, 80, 40, 36, 60, 'modern', 0x06b6d4],
    [380, 80, 34, 36, 44, 'deco', 0xec4899],
    [660, -180, 34, 38, 32, 'deco', 0x2dd4bf],
    [660, 80, 34, 36, 28, 'deco', 0xf97316],
    [-490, -160, 36, 38, 36, 'modern', 0xf59e0b],
    [-490, 290, 40, 38, 22, 'industrial'],
    [120, 310, 38, 34, 32, 'modern', 0x06b6d4],
  ];
  for (const b of signatureBuildings) {
    tryAddBuilding(b[0], b[1], b[2], b[3], b[4], b[5], b[6]);
  }

  // Urban Districts Fill (leaving Emerald Forest & North/South Countryside spacious & green!)
  let seed = 1337;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let gx = -940; gx <= 940; gx += 82) {
    for (let gz = -720; gz <= 740; gz += 82) {
      const jx = gx + (rand() - 0.5) * 18;
      const jz = gz + (rand() - 0.5) * 18;
      const distCenter = Math.hypot(jx, jz);
      const w = 24 + Math.floor(rand() * 18);
      const d = 24 + Math.floor(rand() * 18);

      let style: 'modern' | 'deco' | 'industrial' = 'modern';
      let h = 22 + Math.floor(rand() * 26);
      if (jx > 420) {
        style = 'deco';
        h = 14 + Math.floor(rand() * 18);
      } else if (jx < -440 && jz > 60) {
        style = 'industrial';
        h = 12 + Math.floor(rand() * 12);
      } else if (distCenter < 360) {
        style = 'modern';
        h = 34 + Math.floor(rand() * 44);
      } else if (jz < -460) {
        style = 'deco';
        h = 11 + Math.floor(rand() * 9);
      }

      const neon = rand() > 0.52 ? neonColors[Math.floor(rand() * neonColors.length)] : undefined;
      tryAddBuilding(jx, jz, w, d, h, style, neon);
    }
  }

  if (urbanPlazaGeos.length > 0) {
    const m = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(urbanPlazaGeos), urbanPlazaMat);
    m.receiveShadow = true;
    worldGroup.add(m);
    urbanPlazaGeos.forEach((g) => g.dispose());
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

  // 8. Marina Wooden Piers, Containers & Yachts (x: 560..1240, z: 620..1100)
  const pierMat = new THREE.MeshStandardMaterial({ color: 0x785032, roughness: 0.85 });
  [700, 840, 960].forEach((pz) => {
    const pier = new THREE.Mesh(new THREE.BoxGeometry(220, 0.8, 12), pierMat);
    pier.position.set(660, 0.2, pz);
    pier.receiveShadow = true;
    worldGroup.add(pier);
  });

  const addContainer = (x: number, z: number, color: number) => {
    const c = new THREE.Mesh(
      new THREE.BoxGeometry(8.5, 3.2, 3.2),
      new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.35 })
    );
    c.position.set(x, 1.6, z);
    c.castShadow = true;
    worldGroup.add(c);
    colliders.push({ minX: x - 4.3, maxX: x + 4.3, minZ: z - 1.6, maxZ: z + 1.6, height: 3.2, isRoofSurface: true });
  };
  addContainer(536, 730, 0xdc2626);
  addContainer(546, 752, 0x0284c7);
  addContainer(536, 770, 0xd97706);

  const yacht1 = createYachtMesh();
  yacht1.position.set(860, -0.45, 700);
  yacht1.rotation.y = Math.PI / 2;
  worldGroup.add(yacht1);
  circleColliders.push({ x: 860, z: 700, radius: 6.5, height: 4.5 });

  const yacht2 = createYachtMesh();
  yacht2.position.set(920, -0.45, 860);
  yacht2.rotation.y = Math.PI / 2;
  worldGroup.add(yacht2);
  circleColliders.push({ x: 920, z: 860, radius: 6.5, height: 4.5 });

  // 9. Beach Umbrellas (InstancedMesh)
  const umbrellaPositions: [number, number][] = [];
  for (let i = 0; i < 64; i++) {
    const ang = (i / 64) * Math.PI * 2;
    const r = getIslandCoastRadius(ang) - 28;
    const ux = Math.cos(ang) * r;
    const uz = Math.sin(ang) * r;
    if (!isWaterAt(ux, uz) && distanceToRoadNetwork(ux, uz) > 10) {
      umbrellaPositions.push([ux, uz]);
    }
  }
  if (umbrellaPositions.length > 0) {
    const poleGeo = new THREE.CylinderGeometry(0.06, 0.06, 2.8, 6);
    poleGeo.translate(0, 1.4, 0);
    const poleInst = new THREE.InstancedMesh(
      poleGeo,
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.6 }),
      umbrellaPositions.length
    );
    const canopyGeo = new THREE.ConeGeometry(2.1, 0.78, 10);
    canopyGeo.translate(0, 2.75, 0);
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
      circleColliders.push({ x: ux, z: uz, radius: 0.4, height: 2.9 });
    });
    poleInst.computeBoundingSphere();
    canopyInst.computeBoundingSphere();
    worldGroup.add(poleInst, canopyInst);
  }

  // 10. Realistic Stunt Jump Ramps (Smooth gentle slope — no flying above airplanes!)
  const addRamp = (x: number, z: number, width: number, length: number, height: number, heading: number) => {
    const rampGroup = new THREE.Group();
    rampGroup.position.set(x, 0, z);
    rampGroup.rotation.y = heading;

    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(length, 0);
    shape.lineTo(length, height);
    shape.closePath();

    const geom = new THREE.ExtrudeGeometry(shape, {
      depth: width,
      bevelEnabled: false,
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
      new THREE.CapsuleGeometry(0.14, width * 0.82, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0xfef08a, emissive: 0xf59e0b, emissiveIntensity: 1.6 })
    );
    strip.rotation.z = Math.PI / 2;
    strip.position.set(0, height + 0.05, length * 0.46);
    rampGroup.add(strip);

    worldGroup.add(rampGroup);
    ramps.push({ x, z, width, length, height, heading });
  };

  addRamp(-140, 340, 8.2, 22, 2.7, 0);
  addRamp(455, 635, 8.2, 22, 2.7, 0);
  addRamp(-820, 740, 8.5, 22, 2.8, Math.PI / 2);
  addRamp(830, -20, 7.6, 20, 2.5, Math.PI);

  // 11. Explosive Barrels
  const barrelCoords: [number, number][] = [
    [526, 695],
    [540, 735],
    [-125, -365],
    [-150, -395],
    [-935, 725],
    [-910, 755],
    [495, -45],
    [-180, 145],
    [240, 140],
    [-370, -70],
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

  // 12. Palm Trees (Coast & Boulevards) + Pine Forest Groves (Northern Highlands) via InstancedMesh
  const palmPositions: [number, number][] = [];
  for (let i = 0; i < 140; i++) {
    const ang = (i / 140) * Math.PI * 2;
    const r = getIslandCoastRadius(ang) - 42 - (i % 3) * 34;
    const px = Math.cos(ang) * r;
    const pz = Math.sin(ang) * r;
    if (!isWaterAt(px, pz) && distanceToRoadNetwork(px, pz) > 8 && canPlaceStructure(px, pz, 3, 3, 2)) {
      palmPositions.push([px, pz]);
    }
  }
  for (let x = -600; x <= 680; x += 88) {
    for (const z of [-460, -180, 140, 580]) {
      if (!isWaterAt(x, z) && distanceToRoadNetwork(x, z) > 7 && canPlaceStructure(x, z, 3, 3, 2)) {
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
    const trunkGeo = new THREE.TubeGeometry(trunkCurve, 8, 0.24, 6, false);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7c583a, roughness: 0.88 });
    const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, palmPositions.length);
    const crownGeo = createPalmCrownGeometry();
    const crownMat = new THREE.MeshStandardMaterial({ color: 0x2f855a, roughness: 0.72 });
    const crownInst = new THREE.InstancedMesh(crownGeo, crownMat, palmPositions.length);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    palmPositions.forEach(([px, pz], idx) => {
      const s = 0.9 + ((idx * 17) % 28) / 100;
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

  // Dense Pine Forest Trees in North-West & North-East Countryside
  const pinePositions: [number, number][] = [];
  for (let i = 0; i < 190; i++) {
    const px = -1140 + ((i * 193) % 2280);
    const pz = -1260 + ((i * 97) % 440);
    if (!isWaterAt(px, pz) && isIslandLandAtCheck(px, pz) && distanceToRoadNetwork(px, pz) > 9 && canPlaceStructure(px, pz, 4, 4, 2)) {
      pinePositions.push([px, pz]);
    }
  }
  if (pinePositions.length > 0) {
    const pineTrunkGeo = new THREE.CylinderGeometry(0.28, 0.42, 4.5, 6);
    pineTrunkGeo.translate(0, 2.25, 0);
    const pineCrownGeo = new THREE.ConeGeometry(2.6, 8.2, 8);
    pineCrownGeo.translate(0, 7.2, 0);
    const ptInst = new THREE.InstancedMesh(
      pineTrunkGeo,
      new THREE.MeshStandardMaterial({ color: 0x5c3d28, roughness: 0.9 }),
      pinePositions.length
    );
    const pcInst = new THREE.InstancedMesh(
      pineCrownGeo,
      new THREE.MeshStandardMaterial({ color: 0x1e5232, roughness: 0.8 }),
      pinePositions.length
    );
    const dummy = new THREE.Object3D();
    pinePositions.forEach(([px, pz], idx) => {
      const s = 0.85 + ((idx * 13) % 40) / 100;
      dummy.position.set(px, 0, pz);
      dummy.rotation.set(0, idx * 0.9, 0);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      ptInst.setMatrixAt(idx, dummy.matrix);
      pcInst.setMatrixAt(idx, dummy.matrix);
      circleColliders.push({ x: px, z: pz, radius: 0.55, height: 10.5 });
    });
    ptInst.computeBoundingSphere();
    pcInst.computeBoundingSphere();
    worldGroup.add(ptInst, pcInst);
  }

  // 12B. Dense 3D Grass Tufts & Ornamental Park/Roadside Shrubs (InstancedMesh)
  const isGrassSpotClear = (gx: number, gz: number): boolean => {
    const ang = Math.atan2(gz, gx);
    if (Math.hypot(gx, gz) > getIslandCoastRadius(ang) - 68) return false;
    if (isWaterAt(gx, gz)) return false;
    if (gx >= -1385 && gx <= -525 && gz >= 540 && gz <= 1020) return false; // airport
    if (distanceToRoadNetwork(gx, gz) < 5.2) return false;
    for (const p of PARKING_LOTS) {
      if (Math.abs(gx - p.x) < p.width * 0.5 + 3 && Math.abs(gz - p.z) < p.depth * 0.5 + 3) return false;
    }
    for (const fp of buildingFootprints) {
      if (Math.abs(gx - fp.x) < fp.w * 0.5 + 6.0 && Math.abs(gz - fp.z) < fp.d * 0.5 + 6.0) return false;
    }
    return true;
  };

  const grassCoords: [number, number][] = [];
  for (let i = 0; i < 3600 && grassCoords.length < 2200; i++) {
    const gx = (rand() - 0.5) * 2800;
    const gz = (rand() - 0.5) * 2700;
    if (isGrassSpotClear(gx, gz)) {
      grassCoords.push([gx, gz]);
    }
  }
  if (grassCoords.length > 0) {
    const tuftCards: THREE.BufferGeometry[] = [];
    for (let c = 0; c < 3; c++) {
      const card = new THREE.PlaneGeometry(0.95, 0.52);
      card.translate(0, 0.24, 0);
      card.rotateY((c / 3) * Math.PI);
      tuftCards.push(card.toNonIndexed());
      card.dispose();
    }
    const tuftGeo = BufferGeometryUtils.mergeGeometries(tuftCards);
    tuftCards.forEach((g) => g.dispose());
    const tuftMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.92,
      side: THREE.DoubleSide,
    });
    const tuftInst = new THREE.InstancedMesh(tuftGeo, tuftMat, grassCoords.length);
    const dummy = new THREE.Object3D();
    const gCol = new THREE.Color();
    grassCoords.forEach(([gx, gz], idx) => {
      const s = 0.75 + ((idx * 19) % 55) / 100;
      dummy.position.set(gx, 0, gz);
      dummy.rotation.set(0, idx * 1.13, 0);
      dummy.scale.set(s, s * (0.85 + ((idx * 7) % 35) / 100), s);
      dummy.updateMatrix();
      tuftInst.setMatrixAt(idx, dummy.matrix);
      gCol.setHSL(0.28 + ((idx * 11) % 7) * 0.011, 0.42, 0.25 + ((idx * 5) % 4) * 0.035);
      tuftInst.setColorAt(idx, gCol);
    });
    tuftInst.computeBoundingSphere();
    worldGroup.add(tuftInst);
  }

  const shrubCoords: [number, number][] = [];
  // Line roundabout plaza outer lawns & roadside parks with lush ornamental bushes
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    shrubCoords.push([Math.cos(a) * 33, -70 + Math.sin(a) * 33]);
  }
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    shrubCoords.push([520 + Math.cos(a) * 23, -70 + Math.sin(a) * 23]);
  }
  for (let i = 0; i < 900 && shrubCoords.length < 480; i++) {
    const sx = (rand() - 0.5) * 2500;
    const sz = (rand() - 0.5) * 2450;
    if (isGrassSpotClear(sx, sz)) {
      shrubCoords.push([sx, sz]);
    }
  }
  if (shrubCoords.length > 0) {
    const lobes: THREE.BufferGeometry[] = [];
    const lobeOffsets: [number, number, number, number][] = [
      [0, 0.48, 0, 0.68],
      [-0.42, 0.36, 0.22, 0.5],
      [0.4, 0.38, -0.2, 0.52],
    ];
    for (const [ox, oy, oz, r] of lobeOffsets) {
      const l = new THREE.IcosahedronGeometry(r, 1);
      l.scale(1.15, 0.85, 1.15);
      l.translate(ox, oy, oz);
      lobes.push(l.toNonIndexed());
      l.dispose();
    }
    const shrubGeo = BufferGeometryUtils.mergeGeometries(lobes);
    lobes.forEach((g) => g.dispose());
    const shrubMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88 });
    const shrubInst = new THREE.InstancedMesh(shrubGeo, shrubMat, shrubCoords.length);
    const dummy = new THREE.Object3D();
    const sCol = new THREE.Color();
    shrubCoords.forEach(([sx, sz], idx) => {
      const sc = 0.8 + ((idx * 23) % 45) / 100;
      dummy.position.set(sx, 0, sz);
      dummy.rotation.set(0, idx * 0.91, 0);
      dummy.scale.set(sc, sc, sc);
      dummy.updateMatrix();
      shrubInst.setMatrixAt(idx, dummy.matrix);
      sCol.setHSL(0.32 + (idx % 4) * 0.018, 0.48, 0.22 + (idx % 3) * 0.045);
      shrubInst.setColorAt(idx, sCol);
    });
    shrubInst.computeBoundingSphere();
    worldGroup.add(shrubInst);
  }

  // 13. Streetlights & Sidewalk Street Furniture (Benches & Curbs Bins)
  const polePlacements: { x: number; z: number; rot: number }[] = [];
  const benchPlacements: { x: number; z: number; rot: number }[] = [];
  const binPlacements: { x: number; z: number }[] = [];

  for (const seg of ROAD_SEGMENTS) {
    if (seg.isDirtTrail) continue;
    const stride = seg.isHighway ? 4 : 5;
    for (let i = 1; i < seg.points.length - 1; i += stride) {
      const p = seg.points[i];
      const next = seg.points[i + 1];
      const tx = next.x - p.x;
      const tz = next.z - p.z;
      const len = Math.hypot(tx, tz) || 1;
      const nx = -tz / len;
      const nz = tx / len;
      const dirSign = i % 2 === 0 ? 1 : -1;
      const offsetDist = seg.isHighway ? seg.width * 0.5 + 1.85 : seg.width * 0.5 + 3.15;
      const lx = p.x + nx * dirSign * offsetDist;
      const lz = p.z + nz * dirSign * offsetDist;
      if (!isSidewalkEdgeBlocked(lx, lz, seg.id)) {
        const rot = Math.atan2(-nx * dirSign, -nz * dirSign) - Math.PI / 2;
        polePlacements.push({ x: lx, z: lz, rot });
        if (!seg.isHighway && i % 2 === 0 && benchPlacements.length < 90) {
          const bx = p.x + nx * -dirSign * (seg.width * 0.5 + 2.95);
          const bz = p.z + nz * -dirSign * (seg.width * 0.5 + 2.95);
          if (!isSidewalkEdgeBlocked(bx, bz, seg.id)) {
            benchPlacements.push({ x: bx, z: bz, rot: Math.atan2(nx * dirSign, nz * dirSign) });
          }
        }
        if (!seg.isHighway && i % 3 === 1 && binPlacements.length < 110) {
          const txp = p.x + nx * dirSign * (seg.width * 0.5 + 2.45);
          const tzp = p.z + nz * dirSign * (seg.width * 0.5 + 2.45);
          if (!isSidewalkEdgeBlocked(txp, tzp, seg.id)) {
            binPlacements.push({ x: txp, z: tzp });
          }
        }
      }
    }
  }

  if (benchPlacements.length > 0) {
    const benchParts: THREE.BufferGeometry[] = [];
    const seat = new THREE.BoxGeometry(1.9, 0.1, 0.56);
    seat.translate(0, 0.54, 0);
    const back = new THREE.BoxGeometry(1.9, 0.42, 0.08);
    back.translate(0, 0.82, -0.24);
    const legL = new THREE.BoxGeometry(0.12, 0.46, 0.52);
    legL.translate(-0.78, 0.31, 0);
    const legR = legL.clone();
    legR.translate(1.56, 0, 0);
    benchParts.push(seat.toNonIndexed(), back.toNonIndexed(), legL.toNonIndexed(), legR.toNonIndexed());
    seat.dispose();
    back.dispose();
    legL.dispose();
    legR.dispose();
    const benchGeo = BufferGeometryUtils.mergeGeometries(benchParts);
    benchParts.forEach((g) => g.dispose());
    const benchInst = new THREE.InstancedMesh(
      benchGeo,
      new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.78 }),
      benchPlacements.length
    );
    const dummy = new THREE.Object3D();
    benchPlacements.forEach((b, idx) => {
      dummy.position.set(b.x, 0, b.z);
      dummy.rotation.set(0, b.rot, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      benchInst.setMatrixAt(idx, dummy.matrix);
    });
    benchInst.computeBoundingSphere();
    worldGroup.add(benchInst);
  }

  if (binPlacements.length > 0) {
    const binGeo = new THREE.CylinderGeometry(0.26, 0.22, 0.85, 8);
    binGeo.translate(0, 0.52, 0);
    const binInst = new THREE.InstancedMesh(
      binGeo,
      new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.55, roughness: 0.42 }),
      binPlacements.length
    );
    const dummy = new THREE.Object3D();
    binPlacements.forEach((b, idx) => {
      dummy.position.set(b.x, 0, b.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      binInst.setMatrixAt(idx, dummy.matrix);
    });
    binInst.computeBoundingSphere();
    worldGroup.add(binInst);
  }

  if (polePlacements.length > 0) {
    const poleCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 5.2, 0),
      new THREE.Vector3(0.4, 6.2, 0),
      new THREE.Vector3(1.2, 6.3, 0),
    ]);
    const poleGeo = new THREE.TubeGeometry(poleCurve, 8, 0.1, 6, false);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.75, roughness: 0.32 });
    const poleInst = new THREE.InstancedMesh(poleGeo, poleMat, polePlacements.length);

    const lampGeo = new THREE.CapsuleGeometry(0.16, 0.36, 4, 6);
    lampGeo.rotateZ(Math.PI / 2);
    lampGeo.translate(1.25, 6.22, 0);
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
      circleColliders.push({ x: pl.x, z: pl.z, radius: 0.3, height: 6.4 });
    });
    poleInst.computeBoundingSphere();
    lampInst.computeBoundingSphere();
    worldGroup.add(poleInst, lampInst);
  }

  // Freeze static scene graph matrices once so Three.js skips traversing 1,000+ static road/building/prop transforms every frame,
  // while keeping dynamic animated nodes & their ancestor chains unfrozen.
  worldGroup.updateMatrixWorld(true);
  worldGroup.traverse((obj) => {
    obj.matrixAutoUpdate = false;
    obj.matrixWorldAutoUpdate = false;
  });
  const unfreezeChain = (node: THREE.Object3D | null | undefined, includeSubtree = false) => {
    if (!node) return;
    if (includeSubtree) {
      node.traverse((child) => {
        child.matrixAutoUpdate = true;
        child.matrixWorldAutoUpdate = true;
      });
    } else {
      node.matrixAutoUpdate = true;
      node.matrixWorldAutoUpdate = true;
    }
    let p = node.parent;
    while (p) {
      p.matrixWorldAutoUpdate = true;
      p = p.parent;
    }
  };
  worldGroup.matrixAutoUpdate = true;
  worldGroup.matrixWorldAutoUpdate = true;
  unfreezeChain(cloudGroup, true);
  for (const el of elevators) unfreezeChain(el.cabGroup, true);
  for (const sp of spinners) unfreezeChain(sp, true);
  for (const sr of shopRings) unfreezeChain(sr, false);
  for (const b of barrels) unfreezeChain(b.mesh, true);
  for (const rt of rangeTargets) unfreezeChain(rt.mesh, true);
  const activeClubShow = clubShow as ClubShowRig | null;
  if (activeClubShow) {
    unfreezeChain(activeClubShow.discoBall, true);
    for (const sl of activeClubShow.spotlights) unfreezeChain(sl, false);
    for (const eq of activeClubShow.eqBars) unfreezeChain(eq, false);
    for (const pf of activeClubShow.performers) unfreezeChain(pf.rig.root, true);
  }

  return {
    worldGroup,
    colliders,
    floorSurfaces,
    circleColliders,
    ramps,
    barrels,
    rangeTargets,
    elevators,
    buildingWindowMaterials,
    wettableRoadMaterials,
    extraTextures,
    clubShow,
    shopInteriors,
    spinners,
    oceanMesh,
    skyMat,
    cloudGroup,
    cloudMaterials,
    roadSegments: ROAD_SEGMENTS,
    roadRects,
    buildingFootprints,
    shopRings,
  };
}

function isIslandLandAtCheck(x: number, z: number): boolean {
  const ang = Math.atan2(z, x);
  return Math.hypot(x, z) <= getIslandCoastRadius(ang) - 65;
}
