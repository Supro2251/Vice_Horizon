import * as THREE from 'three';
import { CharacterAppearance, VehicleKind, WeaponId } from '../types/game';

export interface CharacterRig {
  root: THREE.Group;
  torsoGroup: THREE.Group;
  headGroup: THREE.Group;
  leftArmPivot: THREE.Group;
  rightArmPivot: THREE.Group;
  leftLegPivot: THREE.Group;
  rightLegPivot: THREE.Group;
  weaponMount: THREE.Group;
  hairMeshes: Record<string, THREE.Object3D>;
  facialHairMeshes: Record<string, THREE.Object3D>;
  glassesMeshes: Record<string, THREE.Object3D>;
  tattooMeshes: Record<string, THREE.Object3D>;
  accessoryMeshes: Record<string, THREE.Object3D>;
  materials: {
    skin: THREE.MeshStandardMaterial;
    hair: THREE.MeshStandardMaterial;
    jacket: THREE.MeshStandardMaterial;
    shirt: THREE.MeshStandardMaterial;
    pants: THREE.MeshStandardMaterial;
    shoes: THREE.MeshStandardMaterial;
  };
  muzzlePoint: THREE.Object3D;
}

// Shared 512x512 realistic facial shading & micro-pore texture
let _sharedFaceMap: THREE.CanvasTexture | null = null;
function getSharedFaceMap(): THREE.CanvasTexture {
  if (_sharedFaceMap) return _sharedFaceMap;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 512, 512);

  // Forehead, temple & jawline anatomical ambient shading
  const topGrad = ctx.createLinearGradient(0, 0, 0, 512);
  topGrad.addColorStop(0, 'rgba(205,180,168,0.24)');
  topGrad.addColorStop(0.28, 'rgba(255,250,246,0.04)');
  topGrad.addColorStop(0.55, 'rgba(255,255,255,0)');
  topGrad.addColorStop(1, 'rgba(165,132,118,0.28)');
  ctx.fillStyle = topGrad;
  ctx.fillRect(0, 0, 512, 512);

  const addSoftRadial = (cx: number, cy: number, r: number, col: string) => {
    const g = ctx.createRadialGradient(cx, cy, 4, cx, cy, r);
    g.addColorStop(0, col);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  };

  // Warm cheekbone blush, brow shadow & subtle nasolabial warmth
  addSoftRadial(220, 294, 44, 'rgba(224,138,120,0.22)');
  addSoftRadial(292, 294, 44, 'rgba(224,138,120,0.22)');
  addSoftRadial(222, 242, 32, 'rgba(148,112,100,0.18)');
  addSoftRadial(290, 242, 32, 'rgba(148,112,100,0.18)');
  addSoftRadial(256, 355, 42, 'rgba(170,126,112,0.14)');

  // Subtle deterministic skin-pore micro-grain (soft natural skin finish)
  let seed = 4219;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let i = 0; i < 2200; i++) {
    const px = rand() * 512;
    const py = rand() * 512;
    const shade = rand() > 0.5 ? 'rgba(255,244,236,0.09)' : 'rgba(150,115,98,0.08)';
    ctx.fillStyle = shade;
    ctx.fillRect(px, py, 1.5, 1.5);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _sharedFaceMap = tex;
  return tex;
}

function createShoeGeometry(): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-0.06, -0.05);
  shape.lineTo(0.14, -0.05);
  shape.quadraticCurveTo(0.19, -0.04, 0.19, 0.0);
  shape.quadraticCurveTo(0.17, 0.035, 0.08, 0.045);
  shape.lineTo(0.01, 0.065);
  shape.lineTo(-0.065, 0.06);
  shape.quadraticCurveTo(-0.08, 0.0, -0.06, -0.05);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.075,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.018,
    bevelSegments: 3,
    curveSegments: 10,
  });
  geo.center();
  geo.rotateY(-Math.PI / 2); // Toe points +Z
  return geo;
}

function createTorsoLatheGeometry(): THREE.LatheGeometry {
  const pts = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.145, 0.02),
    new THREE.Vector2(0.14, 0.14),
    new THREE.Vector2(0.165, 0.28),
    new THREE.Vector2(0.19, 0.41),
    new THREE.Vector2(0.175, 0.5),
    new THREE.Vector2(0.095, 0.54),
    new THREE.Vector2(0.0, 0.54),
  ];
  const geo = new THREE.LatheGeometry(pts, 20);
  geo.scale(1.22, 1.0, 0.78);
  return geo;
}

export function createWeaponMesh(weaponId: WeaponId, skinColor = '#27272a'): THREE.Group {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(skinColor),
    metalness: 0.82,
    roughness: 0.22,
    clearcoat: 0.45,
  });
  const gripMat = new THREE.MeshStandardMaterial({
    color: 0x16181d,
    metalness: 0.18,
    roughness: 0.84,
  });
  const barrelMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    metalness: 0.92,
    roughness: 0.16,
  });
  const steelDarkMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    metalness: 0.86,
    roughness: 0.28,
  });
  const sightGlowMat = new THREE.MeshStandardMaterial({
    color: 0x4ade80,
    emissive: 0x22c55e,
    emissiveIntensity: 1.6,
  });
  const lensGlassMat = new THREE.MeshPhysicalMaterial({
    color: 0x0ea5e9,
    emissive: 0x0284c7,
    emissiveIntensity: 0.45,
    metalness: 0.35,
    roughness: 0.05,
    clearcoat: 1,
  });

  const addTriggerGuard = (yPos: number, zPos: number) => {
    const guard = new THREE.Mesh(new THREE.TorusGeometry(0.017, 0.0035, 6, 12, Math.PI * 1.15), steelDarkMat);
    guard.rotation.y = Math.PI / 2;
    guard.rotation.z = -Math.PI * 0.6;
    guard.position.set(0, yPos, zPos);
    const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.016, 0.006), barrelMat);
    trigger.rotation.x = 0.28;
    trigger.position.set(0, yPos + 0.004, zPos - 0.002);
    group.add(guard, trigger);
  };

  if (weaponId === 'pistol') {
    const slideShape = new THREE.Shape();
    slideShape.moveTo(-0.085, 0);
    slideShape.lineTo(0.14, 0);
    slideShape.quadraticCurveTo(0.148, 0.045, 0.132, 0.052);
    slideShape.lineTo(-0.08, 0.052);
    slideShape.closePath();
    const slideGeo = new THREE.ExtrudeGeometry(slideShape, {
      depth: 0.03,
      bevelEnabled: true,
      bevelThickness: 0.005,
      bevelSize: 0.004,
      bevelSegments: 2,
    });
    slideGeo.center();
    slideGeo.rotateY(-Math.PI / 2);
    const slide = new THREE.Mesh(slideGeo, bodyMat);
    slide.position.set(0, 0.04, 0.065);

    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.022, 0.21), gripMat);
    frame.position.set(0, 0.015, 0.075);
    const underRail = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.014, 0.07), steelDarkMat);
    underRail.position.set(0, 0.006, 0.14);

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.085, 12), barrelMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.04, 0.185);

    const frontSight = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.009, 0.01), sightGlowMat);
    frontSight.position.set(0, 0.07, 0.19);
    const rearSight = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.008, 0.009), steelDarkMat);
    rearSight.position.set(0, 0.07, -0.025);

    const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.019, 0.085, 4, 10), gripMat);
    grip.position.set(0, -0.036, 0.005);
    grip.rotation.x = 0.24;
    const basePlate = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.01, 0.04), steelDarkMat);
    basePlate.position.set(0, -0.086, -0.01);
    addTriggerGuard(-0.002, 0.058);
    group.add(slide, frame, underRail, barrel, frontSight, rearSight, grip, basePlate);
  } else if (weaponId === 'smg') {
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.068, 0.3), bodyMat);
    receiver.position.set(0, 0.036, 0.11);
    const topRail = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.01, 0.26), steelDarkMat);
    topRail.position.set(0, 0.074, 0.11);
    const redDotHousing = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.028, 0.046), steelDarkMat);
    redDotHousing.position.set(0, 0.092, 0.09);
    const redDotLens = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.012, 12), lensGlassMat);
    redDotLens.rotation.x = Math.PI / 2;
    redDotLens.position.set(0, 0.093, 0.115);

    const shroud = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.14, 12), steelDarkMat);
    shroud.rotation.x = Math.PI / 2;
    shroud.position.set(0, 0.038, 0.31);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.09, 12), barrelMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.038, 0.4);
    const foregrip = new THREE.Mesh(new THREE.CapsuleGeometry(0.013, 0.065, 4, 8), gripMat);
    foregrip.position.set(0, -0.022, 0.28);

    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.17, 0.036), steelDarkMat);
    mag.position.set(0, -0.075, 0.16);
    mag.rotation.x = 0.22;
    const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.019, 0.085, 4, 10), gripMat);
    grip.position.set(0, -0.045, 0.015);
    grip.rotation.x = 0.22;
    const wireStock = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.055, 0.16), steelDarkMat);
    wireStock.position.set(0, 0.025, -0.11);
    addTriggerGuard(-0.008, 0.068);
    group.add(receiver, topRail, redDotHousing, redDotLens, shroud, barrel, foregrip, mag, grip, wireStock);
  } else if (weaponId === 'shotgun') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.07, 0.32), bodyMat);
    body.position.set(0, 0.035, 0.12);
    const ejectionPort = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.022, 0.075), barrelMat);
    ejectionPort.position.set(0.002, 0.045, 0.15);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.48, 14), barrelMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.052, 0.38);
    const magTube = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.42, 12), steelDarkMat);
    magTube.rotation.x = Math.PI / 2;
    magTube.position.set(0, 0.018, 0.36);
    const pump = new THREE.Mesh(new THREE.CapsuleGeometry(0.025, 0.14, 6, 12), gripMat);
    pump.rotation.x = Math.PI / 2;
    pump.position.set(0, 0.01, 0.35);
    const frontBead = new THREE.Mesh(new THREE.SphereGeometry(0.005, 8, 8), sightGlowMat);
    frontBead.position.set(0, 0.072, 0.6);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.075, 0.24), gripMat);
    stock.rotation.x = 0.14;
    stock.position.set(0, -0.005, -0.14);
    addTriggerGuard(-0.008, 0.03);
    group.add(body, ejectionPort, barrel, magTube, pump, frontBead, stock);
  } else if (weaponId === 'sniper') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.068, 0.44), bodyMat);
    body.position.set(0, 0.032, 0.14);
    const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.052, 0.24), steelDarkMat);
    handguard.position.set(0, 0.038, 0.44);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.015, 0.6, 12), barrelMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.044, 0.6);
    const muzzleBrake = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.028, 0.075), steelDarkMat);
    muzzleBrake.position.set(0, 0.044, 0.91);

    // Optical Scope + Rings + Objective Glass
    const scopeTube = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.018, 0.27, 14), steelDarkMat);
    scopeTube.rotation.x = Math.PI / 2;
    scopeTube.position.set(0, 0.098, 0.17);
    const scopeLens = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.01, 14), lensGlassMat);
    scopeLens.rotation.x = Math.PI / 2;
    scopeLens.position.set(0, 0.098, 0.305);
    [0.1, 0.22].forEach((rz) => {
      const ring = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.036, 0.018), gripMat);
      ring.position.set(0, 0.078, rz);
      group.add(ring);
    });

    // Folded Bipod
    [-0.026, 0.026].forEach((bx) => {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.18, 8), steelDarkMat);
      leg.rotation.x = Math.PI / 2 - 0.15;
      leg.position.set(bx, 0.005, 0.56);
      group.add(leg);
    });

    const boxMag = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.1, 0.075), steelDarkMat);
    boxMag.position.set(0, -0.045, 0.18);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.085, 0.28), gripMat);
    stock.position.set(0, 0.015, -0.18);
    const cheekRest = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.024, 0.12), bodyMat);
    cheekRest.position.set(0, 0.065, -0.15);
    addTriggerGuard(-0.01, 0.04);
    group.add(body, handguard, barrel, muzzleBrake, scopeTube, scopeLens, boxMag, stock, cheekRest);
  } else if (weaponId === 'minigun') {
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.34, 16), bodyMat);
    housing.rotation.x = Math.PI / 2;
    housing.position.set(0, 0.02, 0.06);
    const ammoDrum = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.18, 16), gripMat);
    ammoDrum.position.set(-0.08, -0.09, 0.05);
    const topHandle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.055, 0.22), steelDarkMat);
    topHandle.position.set(0, 0.13, 0.12);
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.58, 8), barrelMat);
      b.rotation.x = Math.PI / 2;
      b.position.set(Math.cos(ang) * 0.048, 0.02 + Math.sin(ang) * 0.048, 0.49);
      group.add(b);
    }
    [0.42, 0.68].forEach((cz) => {
      const clampRing = new THREE.Mesh(new THREE.TorusGeometry(0.056, 0.012, 8, 16), gripMat);
      clampRing.position.set(0, 0.02, cz);
      group.add(clampRing);
    });
    group.add(housing, ammoDrum, topHandle);
  } else if (weaponId === 'rpg') {
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.046, 0.88, 16), bodyMat);
    tube.rotation.x = Math.PI / 2;
    tube.position.set(0, 0.05, 0.12);
    const heatShield = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.32, 14), gripMat);
    heatShield.rotation.x = Math.PI / 2;
    heatShield.position.set(0, 0.05, 0.08);
    const flare = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.068, 0.14, 16), steelDarkMat);
    flare.rotation.x = Math.PI / 2;
    flare.position.set(0, 0.05, -0.36);
    const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.09, 4, 8), gripMat);
    grip.position.set(0, -0.03, 0.18);
    const frontGrip = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.075, 4, 8), gripMat);
    frontGrip.position.set(0, -0.025, 0.35);
    const sightPost = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.042, 0.018), steelDarkMat);
    sightPost.position.set(-0.028, 0.11, 0.32);
    const warheadMat = new THREE.MeshStandardMaterial({ color: 0x3f6212, roughness: 0.42, metalness: 0.34 });
    const warhead = new THREE.Mesh(new THREE.ConeGeometry(0.058, 0.25, 14), warheadMat);
    warhead.rotation.x = Math.PI / 2;
    warhead.position.set(0, 0.05, 0.68);
    group.add(tube, heatShield, flare, grip, frontGrip, sightPost, warhead);
  } else {
    // Carbine (Apex M4)
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.072, 0.28), bodyMat);
    receiver.position.set(0, 0.036, 0.11);
    const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.054, 0.24), steelDarkMat);
    handguard.position.set(0, 0.04, 0.36);
    const topRail = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.01, 0.44), steelDarkMat);
    topRail.position.set(0, 0.076, 0.22);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.2, 12), barrelMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.042, 0.56);
    const flashHider = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.015, 0.048, 10), steelDarkMat);
    flashHider.rotation.x = Math.PI / 2;
    flashHider.position.set(0, 0.042, 0.67);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.16, 0.052), steelDarkMat);
    mag.position.set(0, -0.072, 0.2);
    mag.rotation.x = 0.22;
    const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.019, 0.085, 4, 10), gripMat);
    grip.position.set(0, -0.042, 0.02);
    grip.rotation.x = 0.24;
    const foregrip = new THREE.Mesh(new THREE.CapsuleGeometry(0.015, 0.07, 4, 8), gripMat);
    foregrip.position.set(0, -0.025, 0.36);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.088, 0.22), gripMat);
    stock.position.set(0, 0.016, -0.14);
    const optic = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.036, 0.085), steelDarkMat);
    optic.position.set(0, 0.096, 0.12);
    const opticLens = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.01, 12), lensGlassMat);
    opticLens.rotation.x = Math.PI / 2;
    opticLens.position.set(0, 0.096, 0.165);
    addTriggerGuard(-0.008, 0.068);
    group.add(
      receiver,
      handguard,
      topRail,
      barrel,
      flashHider,
      mag,
      grip,
      foregrip,
      stock,
      optic,
      opticLens
    );
  }

  group.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = true;
    }
  });
  return group;
}

export function createCharacterRig(
  appearance: CharacterAppearance,
  contactShadowTexture?: THREE.Texture
): CharacterRig {
  const root = new THREE.Group();

  const materials = {
    skin: new THREE.MeshStandardMaterial({
      color: appearance.skinTone,
      map: getSharedFaceMap(),
      roughness: 0.54,
      metalness: 0.04,
    }),
    hair: new THREE.MeshStandardMaterial({ color: appearance.hairColor, roughness: 0.72, metalness: 0.08 }),
    jacket: new THREE.MeshStandardMaterial({ color: appearance.jacketColor, roughness: 0.46, metalness: 0.14 }),
    shirt: new THREE.MeshStandardMaterial({ color: appearance.shirtColor, roughness: 0.66, metalness: 0.03 }),
    pants: new THREE.MeshStandardMaterial({ color: appearance.pantsColor, roughness: 0.72, metalness: 0.05 }),
    shoes: new THREE.MeshStandardMaterial({ color: appearance.shoesColor, roughness: 0.4, metalness: 0.12 }),
  };

  if (contactShadowTexture) {
    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(1.15, 1.15),
      new THREE.MeshBasicMaterial({
        map: contactShadowTexture,
        transparent: true,
        depthWrite: false,
        opacity: 0.5,
      })
    );
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = 0.02;
    root.add(shadowPlane);
  }

  // Pelvis
  const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 12), materials.pants);
  pelvis.scale.set(1.1, 0.62, 0.76);
  pelvis.position.y = 0.88;
  pelvis.castShadow = true;
  root.add(pelvis);

  // Articulated Sculpted Legs + Beveled Sneakers
  const shoeGeo = createShoeGeometry();
  const makeLeg = (xOffset: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(xOffset, 0.85, 0);

    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.082, 0.28, 6, 14), materials.pants);
    thigh.position.y = -0.21;

    const knee = new THREE.Mesh(new THREE.SphereGeometry(0.072, 12, 10), materials.pants);
    knee.position.y = -0.41;

    const calf = new THREE.Mesh(new THREE.CapsuleGeometry(0.064, 0.27, 6, 14), materials.pants);
    calf.position.y = -0.58;

    const shoe = new THREE.Mesh(shoeGeo, materials.shoes);
    shoe.position.set(0, -0.79, 0.035);

    [thigh, knee, calf, shoe].forEach((m) => {
      m.castShadow = true;
      m.receiveShadow = true;
    });
    pivot.add(thigh, knee, calf, shoe);
    return pivot;
  };

  const leftLegPivot = makeLeg(-0.105);
  const rightLegPivot = makeLeg(0.105);
  root.add(leftLegPivot, rightLegPivot);

  // Smooth Lathe-Sculpted Torso
  const torsoGroup = new THREE.Group();
  torsoGroup.position.set(0, 0.91, 0);
  root.add(torsoGroup);

  const torsoGeo = createTorsoLatheGeometry();
  const jacketBody = new THREE.Mesh(torsoGeo, materials.jacket);
  jacketBody.castShadow = true;
  jacketBody.receiveShadow = true;
  torsoGroup.add(jacketBody);

  const shirtChest = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.24, 6, 12), materials.shirt);
  shirtChest.scale.set(1.0, 1.0, 0.55);
  shirtChest.position.set(0, 0.34, 0.105);
  torsoGroup.add(shirtChest);

  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.028, 10, 20), materials.jacket);
  collar.rotation.x = Math.PI / 2 - 0.12;
  collar.position.set(0, 0.535, 0.005);
  torsoGroup.add(collar);

  // Rounded Articulated Arms
  const makeArm = (xOffset: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(xOffset, 0.47, 0);

    const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), materials.jacket);
    const upperArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.058, 0.2, 6, 12), materials.jacket);
    upperArm.position.y = -0.14;
    const forearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.048, 0.19, 6, 12), materials.skin);
    forearm.position.y = -0.37;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.052, 12, 10), materials.skin);
    hand.scale.set(0.85, 1.15, 0.72);
    hand.position.y = -0.52;

    [shoulder, upperArm, forearm, hand].forEach((m) => {
      m.castShadow = true;
    });
    pivot.add(shoulder, upperArm, forearm, hand);
    return pivot;
  };

  const leftArmPivot = makeArm(-0.27);
  const rightArmPivot = makeArm(0.27);
  torsoGroup.add(leftArmPivot, rightArmPivot);

  const weaponMount = new THREE.Group();
  weaponMount.position.set(0, -0.52, 0.05);
  rightArmPivot.add(weaponMount);

  const muzzlePoint = new THREE.Object3D();
  muzzlePoint.position.set(0, 0.05, 0.42);
  weaponMount.add(muzzlePoint);

  // Sculpted Expressive Human Head (Detailed Eyes, Eyelids, Eyebrows, Nose, Lips, Cheekbones, Ears)
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 0.55, 0);
  torsoGroup.add(headGroup);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.07, 0.11, 16), materials.skin);
  neck.position.y = 0.04;

  const cranium = new THREE.Mesh(new THREE.SphereGeometry(0.128, 28, 24), materials.skin);
  cranium.scale.set(0.92, 1.07, 1.0);
  cranium.position.y = 0.21;
  cranium.castShadow = true;

  const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.094, 22, 18), materials.skin);
  jaw.scale.set(0.86, 0.92, 0.94);
  jaw.position.set(0, 0.152, 0.034);

  const chin = new THREE.Mesh(new THREE.SphereGeometry(0.036, 12, 10), materials.skin);
  chin.scale.set(1.05, 0.8, 0.95);
  chin.position.set(0, 0.116, 0.092);

  // Cheekbone highlights & subtle brow arch
  [-0.056, 0.056].forEach((cx) => {
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.034, 12, 10), materials.skin);
    cheek.scale.set(1.0, 0.75, 0.85);
    cheek.position.set(cx, 0.195, 0.098);
    headGroup.add(cheek);
  });

  // Sculpted Nose (Bridge + Tip + Nostril Wings)
  const noseBridge = new THREE.Mesh(new THREE.CapsuleGeometry(0.0105, 0.032, 4, 8), materials.skin);
  noseBridge.rotation.x = -0.28;
  noseBridge.position.set(0, 0.205, 0.126);
  const noseTip = new THREE.Mesh(new THREE.SphereGeometry(0.0135, 12, 10), materials.skin);
  noseTip.scale.set(1.08, 0.82, 0.92);
  noseTip.position.set(0, 0.186, 0.135);
  [-0.011, 0.011].forEach((nx) => {
    const nostril = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 8), materials.skin);
    nostril.position.set(nx, 0.182, 0.129);
    headGroup.add(nostril);
  });

  // Sculpted Ears
  const earL = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 10), materials.skin);
  earL.scale.set(0.45, 0.95, 0.7);
  earL.position.set(-0.118, 0.205, -0.005);
  const earR = earL.clone();
  earR.position.x = 0.118;

  // Expressive Eyes (Sclera + Rich Iris + Pupil + Dual Specular Glint + Upper/Lower Eyelids + Eyebrows)
  const eyeWhiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.14 });
  const irisMat = new THREE.MeshStandardMaterial({ color: 0x3b6e8c, roughness: 0.1, metalness: 0.15 });
  const pupilMat = new THREE.MeshStandardMaterial({ color: 0x090d16, roughness: 0.05 });
  const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const lipMat = new THREE.MeshStandardMaterial({ color: 0xb0635a, roughness: 0.4, metalness: 0.04 });

  [-1, 1].forEach((side) => {
    const ex = side * 0.044;
    const sclera = new THREE.Mesh(new THREE.SphereGeometry(0.0195, 14, 12), eyeWhiteMat);
    sclera.scale.set(1.15, 0.82, 0.65);
    sclera.position.set(ex, 0.224, 0.112);

    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.012, 14, 12), irisMat);
    iris.scale.set(1.0, 1.0, 0.65);
    iris.position.set(ex, 0.224, 0.121);

    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.0068, 12, 10), pupilMat);
    pupil.position.set(ex, 0.224, 0.1255);

    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.0026, 8, 8), glintMat);
    glint.position.set(ex + 0.004, 0.228, 0.1295);

    // Upper & lower eyelid arches
    const upperLid = new THREE.Mesh(new THREE.CapsuleGeometry(0.0048, 0.028, 4, 8), materials.skin);
    upperLid.rotation.z = Math.PI / 2 - side * 0.08;
    upperLid.position.set(ex, 0.236, 0.119);

    const lowerLid = new THREE.Mesh(new THREE.CapsuleGeometry(0.0036, 0.024, 4, 8), materials.skin);
    lowerLid.rotation.z = Math.PI / 2 + side * 0.05;
    lowerLid.position.set(ex, 0.212, 0.117);

    // Expressive sculpted eyebrow
    const brow = new THREE.Mesh(new THREE.CapsuleGeometry(0.0056, 0.036, 4, 8), materials.hair);
    brow.rotation.z = Math.PI / 2 - side * 0.14;
    brow.position.set(ex, 0.252, 0.119);

    headGroup.add(sclera, iris, pupil, glint, upperLid, lowerLid, brow);
  });

  // Sculpted Upper & Lower Lips
  const upperLip = new THREE.Mesh(new THREE.CapsuleGeometry(0.0072, 0.036, 4, 10), lipMat);
  upperLip.rotation.z = Math.PI / 2;
  upperLip.position.set(0, 0.156, 0.122);
  const lowerLip = new THREE.Mesh(new THREE.CapsuleGeometry(0.0088, 0.03, 4, 10), lipMat);
  lowerLip.rotation.z = Math.PI / 2;
  lowerLip.position.set(0, 0.145, 0.12);

  headGroup.add(neck, cranium, jaw, chin, noseBridge, noseTip, earL, earR, upperLip, lowerLip);

  // Hairstyles
  const hairMeshes: Record<string, THREE.Object3D> = {};
  const makeHairCap = () => {
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.133, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.62),
      materials.hair
    );
    cap.scale.set(0.93, 1.07, 1.02);
    cap.position.set(0, 0.215, -0.005);
    cap.rotation.x = -0.18;
    return cap;
  };

  const bunGroup = new THREE.Group();
  bunGroup.add(makeHairCap());
  const bunSphere = new THREE.Mesh(new THREE.SphereGeometry(0.068, 14, 14), materials.hair);
  bunSphere.position.set(0, 0.34, -0.09);
  bunGroup.add(bunSphere);
  headGroup.add(bunGroup);
  hairMeshes.bun = bunGroup;

  const wavesGroup = new THREE.Group();
  wavesGroup.add(makeHairCap());
  const waveCrest = new THREE.Mesh(new THREE.CapsuleGeometry(0.068, 0.12, 8, 14), materials.hair);
  waveCrest.rotation.z = Math.PI / 2;
  waveCrest.rotation.y = 0.25;
  waveCrest.position.set(0.01, 0.32, 0.045);
  const backHair = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 14), materials.hair);
  backHair.scale.set(1.0, 1.25, 0.7);
  backHair.position.set(0, 0.2, -0.07);
  wavesGroup.add(waveCrest, backHair);
  headGroup.add(wavesGroup);
  hairMeshes.waves = wavesGroup;

  const fadeGroup = new THREE.Group();
  const fadeTop = new THREE.Mesh(new THREE.CapsuleGeometry(0.088, 0.09, 8, 14), materials.hair);
  fadeTop.rotation.x = Math.PI / 2 - 0.1;
  fadeTop.scale.set(1.05, 0.68, 1.0);
  fadeTop.position.set(0, 0.325, 0.005);
  fadeGroup.add(fadeTop);
  headGroup.add(fadeGroup);
  hairMeshes.fade = fadeGroup;

  const buzzMesh = makeHairCap();
  buzzMesh.scale.set(0.91, 1.04, 0.99);
  headGroup.add(buzzMesh);
  hairMeshes.buzz = buzzMesh;

  const ponytailGroup = new THREE.Group();
  ponytailGroup.add(makeHairCap());
  const tailCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.29, -0.11),
    new THREE.Vector3(0, 0.23, -0.17),
    new THREE.Vector3(0, 0.12, -0.19),
  ]);
  const tailMesh = new THREE.Mesh(new THREE.TubeGeometry(tailCurve, 12, 0.036, 10, false), materials.hair);
  ponytailGroup.add(tailMesh);
  headGroup.add(ponytailGroup);
  hairMeshes.ponytail = ponytailGroup;

  const pompGroup = new THREE.Group();
  pompGroup.add(makeHairCap());
  const pomp = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.13, 8, 14), materials.hair);
  pomp.rotation.x = Math.PI / 2 - 0.25;
  pomp.position.set(0, 0.34, 0.025);
  pompGroup.add(pomp);
  headGroup.add(pompGroup);
  hairMeshes.pompadour = pompGroup;

  // Facial Hair Meshes (Stubble, Beard, Goatee)
  const facialHairMeshes: Record<string, THREE.Object3D> = {};

  const stubble = new THREE.Mesh(
    new THREE.SphereGeometry(0.096, 16, 12, 0, Math.PI * 2, Math.PI * 0.52, Math.PI * 0.42),
    materials.hair
  );
  stubble.scale.set(0.88, 0.92, 0.97);
  stubble.position.set(0, 0.15, 0.036);
  headGroup.add(stubble);
  facialHairMeshes.stubble = stubble;

  const beardGroup = new THREE.Group();
  const fullBeard = new THREE.Mesh(
    new THREE.SphereGeometry(0.104, 16, 14, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55),
    materials.hair
  );
  fullBeard.scale.set(0.92, 1.02, 1.02);
  fullBeard.position.set(0, 0.145, 0.036);
  const mustache = new THREE.Mesh(new THREE.CapsuleGeometry(0.011, 0.052, 4, 8), materials.hair);
  mustache.rotation.z = Math.PI / 2;
  mustache.position.set(0, 0.168, 0.123);
  beardGroup.add(fullBeard, mustache);
  headGroup.add(beardGroup);
  facialHairMeshes.beard = beardGroup;

  const goateeGroup = new THREE.Group();
  const chinBeard = new THREE.Mesh(new THREE.CapsuleGeometry(0.026, 0.042, 6, 10), materials.hair);
  chinBeard.position.set(0, 0.118, 0.104);
  const stache = new THREE.Mesh(new THREE.CapsuleGeometry(0.009, 0.044, 4, 8), materials.hair);
  stache.rotation.z = Math.PI / 2;
  stache.position.set(0, 0.167, 0.123);
  goateeGroup.add(chinBeard, stache);
  headGroup.add(goateeGroup);
  facialHairMeshes.goatee = goateeGroup;

  // Glasses Meshes (Aviators, Wayfarer, Round, Visor)
  const glassesMeshes: Record<string, THREE.Object3D> = {};
  const lensMat = new THREE.MeshPhysicalMaterial({
    color: 0x090d16,
    metalness: 0.78,
    roughness: 0.06,
    clearcoat: 1,
  });
  const goldFrameMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, metalness: 0.92, roughness: 0.18 });
  const blackFrameMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.35, metalness: 0.25 });

  // Aviators
  const aviatorsGroup = new THREE.Group();
  [-0.044, 0.044].forEach((lx) => {
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.027, 0.01, 16), lensMat);
    lens.rotation.x = Math.PI / 2;
    lens.scale.set(1.15, 1, 0.85);
    lens.position.set(lx, 0.222, 0.13);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.033, 0.004, 8, 18), goldFrameMat);
    rim.scale.set(1.15, 0.85, 1);
    rim.position.set(lx, 0.222, 0.134);
    aviatorsGroup.add(lens, rim);
  });
  const avBridge = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.034, 8), goldFrameMat);
  avBridge.rotation.z = Math.PI / 2;
  avBridge.position.set(0, 0.232, 0.135);
  aviatorsGroup.add(avBridge);
  headGroup.add(aviatorsGroup);
  glassesMeshes.aviators = aviatorsGroup;

  // Wayfarer
  const wayfarerGroup = new THREE.Group();
  [-0.045, 0.045].forEach((lx) => {
    const lens = new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.036, 0.01), lensMat);
    lens.position.set(lx, 0.224, 0.131);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.064, 0.044, 0.008), blackFrameMat);
    frame.position.set(lx, 0.224, 0.128);
    wayfarerGroup.add(frame, lens);
  });
  const wfBridge = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.01, 0.008), blackFrameMat);
  wfBridge.position.set(0, 0.235, 0.13);
  wayfarerGroup.add(wfBridge);
  headGroup.add(wayfarerGroup);
  glassesMeshes.wayfarer = wayfarerGroup;

  // Round
  const roundGroup = new THREE.Group();
  [-0.044, 0.044].forEach((lx) => {
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.027, 0.009, 16), lensMat);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(lx, 0.224, 0.13);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.027, 0.0045, 8, 18), goldFrameMat);
    rim.position.set(lx, 0.224, 0.134);
    roundGroup.add(lens, rim);
  });
  const rdBridge = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.03, 8), goldFrameMat);
  rdBridge.rotation.z = Math.PI / 2;
  rdBridge.position.set(0, 0.228, 0.134);
  roundGroup.add(rdBridge);
  headGroup.add(roundGroup);
  glassesMeshes.round = roundGroup;

  // Cyber Visor
  const visorMat = new THREE.MeshPhysicalMaterial({
    color: 0x06b6d4,
    emissive: 0x0891b2,
    emissiveIntensity: 0.6,
    metalness: 0.65,
    roughness: 0.1,
    clearcoat: 1,
  });
  const visor = new THREE.Mesh(
    new THREE.CylinderGeometry(0.127, 0.127, 0.046, 20, 1, true, -0.75, 1.5),
    visorMat
  );
  visor.position.set(0, 0.228, 0.012);
  headGroup.add(visor);
  glassesMeshes.visor = visor;

  // 3D Body & Arm Tattoos
  const tattooMeshes: Record<string, THREE.Object3D> = {};
  const inkDarkMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.65 });
  const inkTealMat = new THREE.MeshStandardMaterial({ color: 0x0d9488, roughness: 0.55 });
  const inkNeonMat = new THREE.MeshStandardMaterial({
    color: 0xf43f5e,
    emissive: 0xe11d48,
    emissiveIntensity: 0.45,
    roughness: 0.5,
  });

  // Sleeve Tattoos (Full forearm + wrist bands on both arms)
  const sleeveGroup = new THREE.Group();
  [leftArmPivot, rightArmPivot].forEach((arm) => {
    for (let i = 0; i < 4; i++) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.008, 6, 14), i % 2 === 0 ? inkDarkMat : inkTealMat);
      band.rotation.x = Math.PI / 2 + (i % 2 === 0 ? 0.22 : -0.22);
      band.position.set(0, -0.3 + i * 0.05, 0);
      arm.add(band);
      // Track via sleeveGroup visibility by parenting directly on arm? Instead store array or toggle children via helper group?
      // Better: attach a sleeveSubGroup per arm and mirror visibility! Wait - easier: use userData or group array!
      band.visible = false;
      band.userData.tattooType = 'sleeve';
    }
  });
  // Keep dummy group so Object.entries handles visibility AND traverse handles per-arm tattoo tags
  tattooMeshes.sleeve = sleeveGroup;

  // Tribal Tattoos (Forearm chevrons + neck ring)
  const tribalGroup = new THREE.Group();
  const neckTribal = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.007, 6, 14), inkDarkMat);
  neckTribal.rotation.x = Math.PI / 2;
  neckTribal.position.set(0, 0.055, 0);
  headGroup.add(neckTribal);
  tribalGroup.add(neckTribal);
  [leftArmPivot, rightArmPivot].forEach((arm) => {
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.051, 0.009, 6, 12), inkDarkMat);
      ring.rotation.x = Math.PI / 2 + 0.35;
      ring.position.set(0, -0.32 + i * 0.06, 0);
      ring.visible = false;
      ring.userData.tattooType = 'tribal';
      arm.add(ring);
    }
  });
  headGroup.add(tribalGroup);
  tattooMeshes.tribal = tribalGroup;

  // Neon Dragon Tattoos
  const dragonGroup = new THREE.Group();
  const neckDragon = new THREE.Mesh(new THREE.TorusGeometry(0.061, 0.008, 6, 14), inkNeonMat);
  neckDragon.rotation.x = Math.PI / 2 - 0.15;
  neckDragon.position.set(0, 0.052, 0.005);
  dragonGroup.add(neckDragon);
  headGroup.add(dragonGroup);
  [leftArmPivot, rightArmPivot].forEach((arm) => {
    const spiral = new THREE.Mesh(new THREE.TorusKnotGeometry(0.036, 0.008, 24, 6, 2, 3), inkNeonMat);
    spiral.rotation.x = Math.PI / 2;
    spiral.position.set(0, -0.37, 0);
    spiral.visible = false;
    spiral.userData.tattooType = 'neon_dragon';
    arm.add(spiral);
  });
  tattooMeshes.neon_dragon = dragonGroup;

  // Skull Chest + Collar Tattoo
  const chestGroup = new THREE.Group();
  const chestEmblem = new THREE.Mesh(new THREE.OctahedronGeometry(0.045, 0), inkDarkMat);
  chestEmblem.scale.set(1.2, 1.3, 0.35);
  chestEmblem.position.set(0, 0.45, 0.135);
  const chestRing = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.008, 6, 16), inkTealMat);
  chestRing.rotation.x = Math.PI / 2 - 0.5;
  chestRing.position.set(0, 0.48, 0.075);
  chestGroup.add(chestEmblem, chestRing);
  torsoGroup.add(chestGroup);
  tattooMeshes.skull_chest = chestGroup;

  // Accessories (Cap, Gold Chain, Tactical Vest, Wrist Watch)
  const accessoryMeshes: Record<string, THREE.Object3D> = {};

  const capGroup = new THREE.Group();
  const capMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.62 });
  const capDome = new THREE.Mesh(
    new THREE.SphereGeometry(0.136, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.55),
    capMat
  );
  capDome.position.set(0, 0.23, 0);
  const brimShape = new THREE.Shape();
  brimShape.absarc(0, 0, 0.12, 0, Math.PI, false);
  const brimGeo = new THREE.ExtrudeGeometry(brimShape, {
    depth: 0.012,
    bevelEnabled: true,
    bevelThickness: 0.004,
    bevelSize: 0.004,
    bevelSegments: 2,
  });
  brimGeo.rotateX(Math.PI / 2 + 0.12);
  const capBrim = new THREE.Mesh(brimGeo, capMat);
  capBrim.position.set(0, 0.275, 0.075);
  capGroup.add(capDome, capBrim);
  headGroup.add(capGroup);
  accessoryMeshes.cap = capGroup;

  const chainMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, metalness: 0.95, roughness: 0.15 });
  const chain = new THREE.Mesh(new THREE.TorusGeometry(0.125, 0.013, 10, 24), chainMat);
  chain.rotation.x = Math.PI / 2 - 0.38;
  chain.position.set(0, 0.455, 0.045);
  torsoGroup.add(chain);
  accessoryMeshes.gold_chain = chain;

  const vestGeo = createTorsoLatheGeometry();
  vestGeo.scale(1.08, 0.72, 1.12);
  const vestMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.85, metalness: 0.18 });
  const vest = new THREE.Mesh(vestGeo, vestMat);
  vest.position.set(0, 0.14, 0);
  torsoGroup.add(vest);
  accessoryMeshes.tactical_vest = vest;

  const watchGroup = new THREE.Group();
  const watchBand = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.009, 8, 16), goldFrameMat);
  watchBand.rotation.x = Math.PI / 2;
  watchBand.position.set(0, -0.46, 0);
  watchGroup.add(watchBand);
  leftArmPivot.add(watchGroup);
  accessoryMeshes.watch = watchGroup;

  const rig: CharacterRig = {
    root,
    torsoGroup,
    headGroup,
    leftArmPivot,
    rightArmPivot,
    leftLegPivot,
    rightLegPivot,
    weaponMount,
    hairMeshes,
    facialHairMeshes,
    glassesMeshes,
    tattooMeshes,
    accessoryMeshes,
    materials,
    muzzlePoint,
  };

  updateCharacterRigAppearance(rig, appearance);
  return rig;
}

export function updateCharacterRigAppearance(rig: CharacterRig, appearance: CharacterAppearance) {
  rig.materials.skin.color.set(appearance.skinTone);
  rig.materials.hair.color.set(appearance.hairColor);
  rig.materials.jacket.color.set(appearance.jacketColor);
  rig.materials.shirt.color.set(appearance.shirtColor);
  rig.materials.pants.color.set(appearance.pantsColor);
  rig.materials.shoes.color.set(appearance.shoesColor);

  Object.entries(rig.hairMeshes).forEach(([key, obj]) => {
    obj.visible = key === appearance.hairStyle;
  });

  const facialHair = appearance.facialHair || 'none';
  Object.entries(rig.facialHairMeshes).forEach(([key, obj]) => {
    obj.visible = key === facialHair;
  });

  const glasses = appearance.glasses || 'none';
  Object.entries(rig.glassesMeshes).forEach(([key, obj]) => {
    obj.visible = key === glasses;
  });

  const tattoo = appearance.tattoo || 'none';
  Object.entries(rig.tattooMeshes).forEach(([key, obj]) => {
    obj.visible = key === tattoo;
  });
  [rig.leftArmPivot, rig.rightArmPivot].forEach((arm) => {
    arm.children.forEach((child) => {
      if (child.userData.tattooType) {
        child.visible = child.userData.tattooType === tattoo;
      }
    });
  });

  Object.entries(rig.accessoryMeshes).forEach(([key, obj]) => {
    obj.visible = key === appearance.accessory;
  });
}

export interface VehicleRig {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  wheels: THREE.Group[];
  frontSteerPivots: THREE.Group[];
  driverGroup?: THREE.Group;
  propeller?: THREE.Object3D;
  tailRotor?: THREE.Object3D;
  afterburners?: THREE.Mesh[];
  paintMat?: THREE.MeshPhysicalMaterial;
  redBeacon?: THREE.Mesh;
  blueBeacon?: THREE.Mesh;
  brakeLightsMat: THREE.MeshStandardMaterial;
}

type CarBodyKind =
  | 'sedan'
  | 'coupe'
  | 'supercar'
  | 'muscle'
  | 'suv'
  | 'taxi'
  | 'police'
  | 'ambulance'
  | 'firetruck';

// Create 100% Original Fictional Automotive Emblem Mesh (No Real-World Trademarks)
function createFictionalBrandBadge(
  kind: CarBodyKind,
  chromeMat: THREE.MeshStandardMaterial
): THREE.Group {
  const badge = new THREE.Group();
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, metalness: 0.94, roughness: 0.14 });
  const crimsonMat = new THREE.MeshStandardMaterial({
    color: 0xe11d48,
    emissive: 0x9f1239,
    emissiveIntensity: 0.3,
    metalness: 0.6,
    roughness: 0.25,
  });

  if (kind === 'supercar') {
    // VALKYRA — Sculpted V-Wing Chevron Emblem
    [-1, 1].forEach((s) => {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.015, 0.11), goldMat);
      wing.rotation.y = s * 0.42;
      wing.position.set(s * 0.032, 0, 0);
      badge.add(wing);
    });
  } else if (kind === 'muscle') {
    // SOLANO — Sunburst Ring + Center Bar Crest
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.012, 8, 16), chromeMat);
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.03, 0), crimsonMat);
    badge.add(ring, core);
  } else if (kind === 'coupe') {
    // KUROI — Crossed Twin Katana K Emblem
    [-1, 1].forEach((s) => {
      const blade = new THREE.Mesh(new THREE.CapsuleGeometry(0.008, 0.095, 4, 6), chromeMat);
      blade.rotation.z = s * 0.55;
      badge.add(blade);
    });
  } else if (kind === 'sedan' || kind === 'taxi') {
    // BAVARO / VICE CAB — Quattro-Diamond Crest
    const outer = new THREE.Mesh(new THREE.OctahedronGeometry(0.052, 0), chromeMat);
    outer.scale.set(1, 1, 0.25);
    const inner = new THREE.Mesh(new THREE.OctahedronGeometry(0.028, 0), goldMat);
    inner.scale.set(1, 1, 0.35);
    inner.position.z = 0.008;
    badge.add(outer, inner);
  } else {
    // TITANUS / VCPD — Armored Shield Crest
    const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.035, 0.018, 6), chromeMat);
    shield.rotation.x = Math.PI / 2;
    badge.add(shield);
  }
  return badge;
}

function createSculptedCarBodyGeometry(kind: CarBodyKind): {
  bodyGeo: THREE.ExtrudeGeometry;
  cabinGeo: THREE.ExtrudeGeometry;
  bodyLen: number;
  bodyW: number;
} {
  const isSuv = kind === 'suv';
  const isAmbulance = kind === 'ambulance';
  const isFiretruck = kind === 'firetruck';
  const isHeavy = isSuv || isAmbulance || isFiretruck;
  const isCoupe = kind === 'coupe' || kind === 'supercar';
  const isSuper = kind === 'supercar';
  const isMuscle = kind === 'muscle';
  const isSedan = kind === 'sedan' || kind === 'taxi';
  const bodyLen = isFiretruck ? 6.1 : isAmbulance ? 5.05 : isSuv ? 4.65 : isSuper ? 4.65 : isMuscle ? 4.5 : isSedan ? 4.35 : 4.4;
  const bodyW = isFiretruck ? 2.26 : isAmbulance ? 2.12 : isSuv ? 2.04 : isSuper ? 2.08 : isMuscle ? 2.0 : 1.94;
  const halfL = bodyLen * 0.5;

  const lowerShape = new THREE.Shape();
  lowerShape.moveTo(-halfL, 0.32);
  lowerShape.lineTo(halfL - 0.12, isSuper ? 0.22 : 0.29);
  lowerShape.quadraticCurveTo(
    halfL + 0.14,
    isSuper ? 0.34 : isHeavy ? 0.56 : 0.45,
    halfL - 0.05,
    isSuper ? 0.54 : isMuscle ? 0.78 : isHeavy ? 0.96 : 0.72
  );
  lowerShape.quadraticCurveTo(
    halfL * 0.52,
    isSuper ? 0.72 : isCoupe ? 0.85 : isHeavy ? 1.08 : 0.92,
    halfL * 0.22,
    isSuper ? 0.8 : isHeavy ? 1.14 : 0.94
  );
  lowerShape.lineTo(
    -halfL + 0.12,
    isFiretruck ? 1.24 : isAmbulance ? 1.18 : isSuv ? 1.06 : isSuper ? 0.94 : isMuscle ? 1.0 : 0.96
  );
  lowerShape.quadraticCurveTo(-halfL - 0.05, 0.76, -halfL, 0.32);

  const bodyGeo = new THREE.ExtrudeGeometry(lowerShape, {
    depth: bodyW - 0.26,
    bevelEnabled: true,
    bevelThickness: 0.13,
    bevelSize: 0.1,
    bevelSegments: 4,
    curveSegments: 14,
  });
  bodyGeo.center();
  bodyGeo.rotateY(-Math.PI / 2);

  const cabinShape = new THREE.Shape();
  if (isFiretruck || isAmbulance) {
    const rearZ = isFiretruck ? -2.7 : -2.25;
    const frontZ = isFiretruck ? 1.85 : 1.25;
    const cabH = isFiretruck ? 1.18 : 1.05;
    cabinShape.moveTo(rearZ, 0.0);
    cabinShape.lineTo(frontZ, 0.0);
    cabinShape.quadraticCurveTo(frontZ - 0.18, cabH * 0.88, frontZ - 0.45, cabH);
    cabinShape.lineTo(rearZ + 0.18, cabH);
    cabinShape.quadraticCurveTo(rearZ, cabH * 0.8, rearZ, 0.0);
  } else if (isSuv) {
    cabinShape.moveTo(-1.8, 0.0);
    cabinShape.lineTo(0.9, 0.0);
    cabinShape.quadraticCurveTo(0.6, 0.58, 0.28, 0.66);
    cabinShape.lineTo(-1.5, 0.66);
    cabinShape.quadraticCurveTo(-1.76, 0.46, -1.8, 0.0);
  } else if (isSuper) {
    cabinShape.moveTo(-1.35, 0.0);
    cabinShape.lineTo(1.22, 0.0);
    cabinShape.quadraticCurveTo(0.55, 0.43, 0.05, 0.44);
    cabinShape.quadraticCurveTo(-0.78, 0.42, -1.35, 0.0);
  } else if (isCoupe) {
    cabinShape.moveTo(-1.62, 0.0);
    cabinShape.lineTo(0.95, 0.0);
    cabinShape.quadraticCurveTo(0.42, 0.5, -0.05, 0.52);
    cabinShape.quadraticCurveTo(-0.92, 0.5, -1.62, 0.0);
  } else if (isMuscle) {
    cabinShape.moveTo(-1.45, 0.0);
    cabinShape.lineTo(0.88, 0.0);
    cabinShape.quadraticCurveTo(0.42, 0.49, 0.05, 0.52);
    cabinShape.lineTo(-0.98, 0.52);
    cabinShape.quadraticCurveTo(-1.32, 0.36, -1.45, 0.0);
  } else {
    cabinShape.moveTo(-1.48, 0.0);
    cabinShape.lineTo(0.95, 0.0);
    cabinShape.quadraticCurveTo(0.48, 0.54, 0.16, 0.56);
    cabinShape.lineTo(-0.98, 0.56);
    cabinShape.quadraticCurveTo(-1.28, 0.42, -1.48, 0.0);
  }

  const cabinGeo = new THREE.ExtrudeGeometry(cabinShape, {
    depth: isFiretruck || isAmbulance ? bodyW - 0.28 : bodyW - 0.46,
    bevelEnabled: true,
    bevelThickness: 0.1,
    bevelSize: 0.08,
    bevelSegments: 3,
    curveSegments: 14,
  });
  cabinGeo.center();
  cabinGeo.rotateY(-Math.PI / 2);

  return { bodyGeo, cabinGeo, bodyLen, bodyW };
}

function createMotorcycleRig(
  colorHex: string,
  paintMat: THREE.MeshPhysicalMaterial,
  trimMat: THREE.MeshStandardMaterial,
  chromeMat: THREE.MeshStandardMaterial,
  headlightMat: THREE.MeshStandardMaterial,
  brakeLightsMat: THREE.MeshStandardMaterial,
  contactShadowTexture?: THREE.Texture
): VehicleRig {
  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  if (contactShadowTexture) {
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.3, 2.5),
      new THREE.MeshBasicMaterial({
        map: contactShadowTexture,
        transparent: true,
        depthWrite: false,
        opacity: 0.52,
      })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.025;
    root.add(shadow);
  }

  const frame = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.95, 6, 12), trimMat);
  frame.rotation.x = Math.PI / 2 - 0.15;
  frame.position.set(0, 0.55, 0.0);
  frame.castShadow = true;

  const tank = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12), paintMat);
  tank.scale.set(0.88, 0.72, 1.55);
  tank.position.set(0, 0.84, 0.25);
  tank.castShadow = true;

  const cowl = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.38, 6, 12), paintMat);
  cowl.rotation.x = Math.PI / 2 - 0.55;
  cowl.position.set(0, 0.86, 0.65);

  const seat = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.52, 6, 10), trimMat);
  seat.rotation.x = Math.PI / 2 + 0.1;
  seat.scale.set(1.1, 1, 0.55);
  seat.position.set(0, 0.78, -0.28);

  const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.35, 6, 10), paintMat);
  tail.rotation.x = Math.PI / 2 - 0.28;
  tail.position.set(0, 0.84, -0.68);

  const tailLight = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.12, 4, 8), brakeLightsMat);
  tailLight.rotation.z = Math.PI / 2;
  tailLight.position.set(0, 0.87, -0.88);

  [-0.16, 0.16].forEach((ex) => {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.048, 0.75, 10), chromeMat);
    pipe.rotation.x = Math.PI / 2 - 0.22;
    pipe.position.set(ex, 0.45, -0.45);
    bodyGroup.add(pipe);
  });

  bodyGroup.add(frame, tank, cowl, seat, tail, tailLight);

  const wheels: THREE.Group[] = [];
  const frontSteerPivots: THREE.Group[] = [];
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.82 });
  const rimMat = new THREE.MeshStandardMaterial({ color: colorHex, metalness: 0.8, roughness: 0.22 });

  const makeMotoWheel = (zPos: number, isFront: boolean) => {
    const steerPivot = new THREE.Group();
    steerPivot.position.set(0, 0.34, zPos);
    const spinGroup = new THREE.Group();

    const tire = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.085, 10, 22), tireMat);
    tire.rotation.y = Math.PI / 2;
    tire.castShadow = true;

    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.1, 14), rimMat);
    hub.rotation.z = Math.PI / 2;
    spinGroup.add(tire, hub);
    steerPivot.add(spinGroup);

    if (isFront) {
      [-0.1, 0.1].forEach((fx) => {
        const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.022, 0.74, 8), chromeMat);
        fork.rotation.x = -0.35;
        fork.position.set(fx, 0.32, -0.14);
        steerPivot.add(fork);
      });
      const bar = new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.56, 4, 8), trimMat);
      bar.rotation.z = Math.PI / 2;
      bar.position.set(0, 0.65, -0.22);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 10), headlightMat);
      lamp.scale.set(1.1, 0.8, 0.7);
      lamp.position.set(0, 0.54, -0.02);
      steerPivot.add(bar, lamp);
      frontSteerPivots.push(steerPivot);
    }

    bodyGroup.add(steerPivot);
    wheels.push(spinGroup);
  };

  makeMotoWheel(0.84, true);
  makeMotoWheel(-0.78, false);

  const driverGroup = new THREE.Group();
  const driverBody = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.18, 0.34, 4, 10),
    new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.7 })
  );
  driverBody.position.set(0, 1.15, -0.18);
  driverBody.rotation.x = 0.28;
  const driverHead = new THREE.Mesh(
    new THREE.SphereGeometry(0.145, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.22, metalness: 0.5 })
  );
  driverHead.position.set(0, 1.5, -0.05);
  driverGroup.add(driverBody, driverHead);
  driverGroup.visible = false;
  bodyGroup.add(driverGroup);

  return {
    root,
    bodyGroup,
    wheels,
    frontSteerPivots,
    driverGroup,
    paintMat,
    brakeLightsMat,
  };
}

function createBoatRig(
  paintMat: THREE.MeshPhysicalMaterial,
  trimMat: THREE.MeshStandardMaterial,
  chromeMat: THREE.MeshStandardMaterial,
  brakeLightsMat: THREE.MeshStandardMaterial,
  contactShadowTexture?: THREE.Texture
): VehicleRig {
  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const deckMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.35, metalness: 0.1 });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x0f172a,
    roughness: 0.06,
    metalness: 0.3,
    clearcoat: 1,
    transparent: true,
    opacity: 0.82,
  });

  if (contactShadowTexture) {
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 7.6),
      new THREE.MeshBasicMaterial({
        map: contactShadowTexture,
        transparent: true,
        depthWrite: false,
        opacity: 0.32,
      })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    root.add(shadow);
  }

  const hullShape = new THREE.Shape();
  hullShape.moveTo(-1.25, -3.2);
  hullShape.lineTo(1.25, -3.2);
  hullShape.quadraticCurveTo(1.38, 1.0, 0, 3.6);
  hullShape.quadraticCurveTo(-1.38, 1.0, -1.25, -3.2);

  const hullGeo = new THREE.ExtrudeGeometry(hullShape, {
    depth: 0.85,
    bevelEnabled: true,
    bevelThickness: 0.16,
    bevelSize: 0.12,
    bevelSegments: 3,
    curveSegments: 12,
  });
  hullGeo.rotateX(Math.PI / 2);
  const hull = new THREE.Mesh(hullGeo, paintMat);
  hull.position.y = 0.85;
  hull.castShadow = true;

  const innerDeck = new THREE.Mesh(new THREE.CapsuleGeometry(0.88, 3.6, 6, 12), deckMat);
  innerDeck.rotation.x = Math.PI / 2;
  innerDeck.scale.set(1.05, 1, 0.12);
  innerDeck.position.set(0, 0.88, -0.3);

  const windshield = new THREE.Mesh(
    new THREE.CylinderGeometry(1.02, 1.08, 0.5, 16, 1, true, -1.1, 2.2),
    glassMat
  );
  windshield.position.set(0, 1.15, 0.35);

  const helm = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.5, 4, 10), trimMat);
  helm.rotation.z = Math.PI / 2;
  helm.position.set(0, 1.02, 0.25);

  const propGroup = new THREE.Group();
  [-0.45, 0.45].forEach((mx) => {
    const cowling = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.38, 6, 10), trimMat);
    cowling.position.set(mx, 0.95, -3.35);
    const blade = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.28, 4, 6), chromeMat);
    blade.position.set(mx, 0.28, -3.45);
    propGroup.add(blade);
    bodyGroup.add(cowling);
  });

  bodyGroup.add(hull, innerDeck, windshield, helm, propGroup);

  return {
    root,
    bodyGroup,
    wheels: [],
    frontSteerPivots: [],
    propeller: propGroup,
    paintMat,
    brakeLightsMat,
  };
}

function createPlaneRig(
  paintMat: THREE.MeshPhysicalMaterial,
  trimMat: THREE.MeshStandardMaterial,
  chromeMat: THREE.MeshStandardMaterial,
  brakeLightsMat: THREE.MeshStandardMaterial,
  contactShadowTexture?: THREE.Texture
): VehicleRig {
  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const accentMat = new THREE.MeshPhysicalMaterial({ color: 0xf8fafc, roughness: 0.22, clearcoat: 0.9 });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x0f172a,
    roughness: 0.06,
    clearcoat: 1,
    transparent: true,
    opacity: 0.85,
  });

  if (contactShadowTexture) {
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(8.8, 7.6),
      new THREE.MeshBasicMaterial({
        map: contactShadowTexture,
        transparent: true,
        depthWrite: false,
        opacity: 0.42,
      })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.03;
    root.add(shadow);
  }

  const fusePts = [
    new THREE.Vector2(0.0, -3.4),
    new THREE.Vector2(0.18, -3.2),
    new THREE.Vector2(0.32, -1.6),
    new THREE.Vector2(0.62, 0.2),
    new THREE.Vector2(0.6, 1.5),
    new THREE.Vector2(0.42, 2.65),
    new THREE.Vector2(0.18, 3.05),
    new THREE.Vector2(0.0, 3.12),
  ];
  const fuseGeo = new THREE.LatheGeometry(fusePts, 20);
  fuseGeo.rotateX(Math.PI / 2);
  const fuselage = new THREE.Mesh(fuseGeo, accentMat);
  fuselage.position.y = 1.15;
  fuselage.castShadow = true;

  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), glassMat);
  canopy.scale.set(0.9, 0.72, 2.2);
  canopy.position.set(0, 1.62, 0.45);

  const wingShape = new THREE.Shape();
  wingShape.moveTo(-4.6, -0.5);
  wingShape.lineTo(4.6, -0.5);
  wingShape.lineTo(4.3, 0.45);
  wingShape.lineTo(0.8, 0.9);
  wingShape.lineTo(-0.8, 0.9);
  wingShape.lineTo(-4.3, 0.45);
  wingShape.closePath();

  const wingGeo = new THREE.ExtrudeGeometry(wingShape, {
    depth: 0.14,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.05,
    bevelSegments: 2,
  });
  wingGeo.rotateX(Math.PI / 2);
  const wings = new THREE.Mesh(wingGeo, paintMat);
  wings.position.set(0, 1.05, 0.35);
  wings.castShadow = true;

  const hTail = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 2.4, 4, 10), paintMat);
  hTail.rotation.z = Math.PI / 2;
  hTail.scale.set(1, 1, 0.35);
  hTail.position.set(0, 1.25, -2.95);

  const vFin = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 1.1, 4, 10), paintMat);
  vFin.rotation.x = -0.32;
  vFin.scale.set(0.32, 1, 1.3);
  vFin.position.set(0, 1.85, -2.85);

  const portNav = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xef4444, emissiveIntensity: 2 })
  );
  portNav.position.set(-4.5, 1.0, 0.0);
  const stbdNav = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x22c55e, emissiveIntensity: 2 })
  );
  stbdNav.position.set(4.5, 1.0, 0.0);

  const propGroup = new THREE.Group();
  propGroup.position.set(0, 1.15, 3.16);
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.32, 12), chromeMat);
  spinner.rotation.x = Math.PI / 2;
  const blade1 = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 1.75, 4, 8), trimMat);
  blade1.scale.set(1, 1, 0.25);
  const blade2 = blade1.clone();
  blade2.rotation.z = Math.PI / 2;
  propGroup.add(spinner, blade1, blade2);

  const wheels: THREE.Group[] = [];
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.85 });
  const gearCoords: [number, number][] = [
    [0, 2.05],
    [-1.15, -0.25],
    [1.15, -0.25],
  ];
  for (const [gx, gz] of gearCoords) {
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.72, 8), chromeMat);
    strut.position.set(gx, 0.56, gz);
    const wheelGroup = new THREE.Group();
    wheelGroup.position.set(gx, 0.24, gz);
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.14, 16), tireMat);
    tire.rotation.z = Math.PI / 2;
    wheelGroup.add(tire);
    bodyGroup.add(strut, wheelGroup);
    wheels.push(wheelGroup);
  }

  bodyGroup.add(fuselage, canopy, wings, hTail, vFin, portNav, stbdNav, propGroup);

  return {
    root,
    bodyGroup,
    wheels,
    frontSteerPivots: [],
    propeller: propGroup,
    paintMat,
    brakeLightsMat,
  };
}

function createHelicopterRig(
  paintMat: THREE.MeshPhysicalMaterial,
  trimMat: THREE.MeshStandardMaterial,
  chromeMat: THREE.MeshStandardMaterial,
  brakeLightsMat: THREE.MeshStandardMaterial,
  contactShadowTexture?: THREE.Texture
): VehicleRig {
  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x0f172a,
    metalness: 0.12,
    roughness: 0.04,
    clearcoat: 1.0,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
  });
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.72 });
  const dashGlowMat = new THREE.MeshStandardMaterial({
    color: 0x22d3ee,
    emissive: 0x0891b2,
    emissiveIntensity: 1.3,
  });

  if (contactShadowTexture) {
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(5.6, 8.8),
      new THREE.MeshBasicMaterial({
        map: contactShadowTexture,
        transparent: true,
        depthWrite: false,
        opacity: 0.44,
      })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.03;
    root.add(shadow);
  }

  // Twin Skid Landing Gear
  [-0.95, 0.95].forEach((sx) => {
    const skid = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.8, 10), trimMat);
    skid.rotation.x = Math.PI / 2;
    skid.position.set(sx, 0.08, 0.25);
    const frontStrut = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.78, 8), trimMat);
    frontStrut.rotation.z = sx > 0 ? 0.32 : -0.32;
    frontStrut.position.set(sx * 0.85, 0.42, 1.05);
    const rearStrut = frontStrut.clone();
    rearStrut.position.z = -0.65;
    bodyGroup.add(skid, frontStrut, rearStrut);
  });

  // Sculpted Fuselage Cabin + Twin Turbine Cowling
  const lowerTub = new THREE.Mesh(new THREE.CapsuleGeometry(0.86, 2.3, 8, 16), paintMat);
  lowerTub.rotation.x = Math.PI / 2;
  lowerTub.scale.set(1.12, 0.78, 0.84);
  lowerTub.position.set(0, 1.08, 0.2);
  lowerTub.castShadow = true;

  const upperDeck = new THREE.Mesh(new THREE.CapsuleGeometry(0.62, 1.9, 6, 14), trimMat);
  upperDeck.rotation.x = Math.PI / 2;
  upperDeck.scale.set(0.95, 1, 0.65);
  upperDeck.position.set(0, 2.1, -0.35);

  // Visible Cockpit Interior (2 Seats + Glowing Avionics + Cyclic)
  [-0.36, 0.36].forEach((cx) => {
    const seatBack = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.56, 0.1), seatMat);
    seatBack.position.set(cx, 1.38, 0.45);
    bodyGroup.add(seatBack);
  });
  const avionics = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.22, 0.3), trimMat);
  avionics.position.set(0, 1.25, 1.22);
  const avScreen = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.12, 0.04), dashGlowMat);
  avScreen.position.set(0, 1.29, 1.06);
  bodyGroup.add(avionics, avScreen);

  // Transparent Panoramic Cockpit Bubble
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.92, 18, 14), glassMat);
  canopy.scale.set(0.96, 0.82, 1.55);
  canopy.position.set(0, 1.48, 0.88);
  canopy.renderOrder = 2;

  // Tail Boom + Stabilizers + Vertical Fin
  const tailBoom = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.34, 4.1, 14), paintMat);
  tailBoom.rotation.x = Math.PI / 2;
  tailBoom.position.set(0, 1.62, -2.75);
  tailBoom.castShadow = true;

  const hStab = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.08, 0.45), paintMat);
  hStab.position.set(0, 1.65, -3.7);
  const vFin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.05, 0.56), paintMat);
  vFin.rotation.x = -0.25;
  vFin.position.set(0, 2.02, -4.58);

  // Twin Stub Wings with Rocket Pods + Nose Cannon
  [-1.32, 1.32].forEach((wx) => {
    const stub = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.1, 0.55), paintMat);
    stub.position.set(wx, 1.32, 0.05);
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.95, 12), trimMat);
    pod.rotation.x = Math.PI / 2;
    pod.position.set(wx * 1.18, 1.18, 0.15);
    const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.75, 8), chromeMat);
    gun.rotation.x = Math.PI / 2;
    gun.position.set(wx * 0.95, 1.15, 0.65);
    bodyGroup.add(stub, pod, gun);
  });

  // Main 4-Blade Rotor
  const mainRotor = new THREE.Group();
  mainRotor.position.set(0, 2.58, 0.05);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.36, 12), chromeMat);
  mainRotor.add(mast);
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.025, 3.85), trimMat);
    const ang = (i * Math.PI) / 2;
    blade.rotation.y = ang;
    blade.position.set(Math.sin(ang) * 1.9, 0.12, Math.cos(ang) * 1.9);
    mainRotor.add(blade);
  }

  // Tail 3-Blade Rotor
  const tailRotor = new THREE.Group();
  tailRotor.position.set(0.16, 1.96, -4.65);
  for (let i = 0; i < 3; i++) {
    const tBlade = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.62, 0.09), trimMat);
    tBlade.rotation.x = (i * Math.PI * 2) / 3;
    tBlade.position.set(0, Math.cos(tBlade.rotation.x) * 0.26, Math.sin(tBlade.rotation.x) * 0.26);
    tailRotor.add(tBlade);
  }

  const navRed = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xef4444, emissiveIntensity: 2.2 })
  );
  navRed.position.set(-1.75, 1.32, 0.05);
  const navGreen = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x22c55e, emissiveIntensity: 2.2 })
  );
  navGreen.position.set(1.75, 1.32, 0.05);

  const driverGroup = new THREE.Group();
  const pilotHead = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.25, metalness: 0.5 })
  );
  pilotHead.position.set(-0.36, 1.56, 0.56);
  driverGroup.add(pilotHead);
  driverGroup.visible = false;

  bodyGroup.add(
    lowerTub,
    upperDeck,
    canopy,
    tailBoom,
    hStab,
    vFin,
    mainRotor,
    tailRotor,
    navRed,
    navGreen,
    driverGroup
  );

  return {
    root,
    bodyGroup,
    wheels: [],
    frontSteerPivots: [],
    driverGroup,
    propeller: mainRotor,
    tailRotor,
    paintMat,
    brakeLightsMat,
  };
}

function createFighterJetRig(
  paintMat: THREE.MeshPhysicalMaterial,
  trimMat: THREE.MeshStandardMaterial,
  chromeMat: THREE.MeshStandardMaterial,
  brakeLightsMat: THREE.MeshStandardMaterial,
  contactShadowTexture?: THREE.Texture
): VehicleRig {
  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x1e293b,
    metalness: 0.15,
    roughness: 0.04,
    clearcoat: 1.0,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
  });
  const hudMat = new THREE.MeshStandardMaterial({
    color: 0x4ade80,
    emissive: 0x22c55e,
    emissiveIntensity: 1.8,
    transparent: true,
    opacity: 0.72,
  });
  const afterburnerMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.85,
  });

  if (contactShadowTexture) {
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(8.6, 9.8),
      new THREE.MeshBasicMaterial({
        map: contactShadowTexture,
        transparent: true,
        depthWrite: false,
        opacity: 0.44,
      })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.03;
    root.add(shadow);
  }

  // Supersonic Fuselage + Nose Radome
  const fusePts = [
    new THREE.Vector2(0.0, -4.1),
    new THREE.Vector2(0.45, -3.9),
    new THREE.Vector2(0.68, -1.5),
    new THREE.Vector2(0.72, 0.8),
    new THREE.Vector2(0.55, 2.7),
    new THREE.Vector2(0.24, 3.85),
    new THREE.Vector2(0.0, 4.35),
  ];
  const fuseGeo = new THREE.LatheGeometry(fusePts, 20);
  fuseGeo.rotateX(Math.PI / 2);
  const fuselage = new THREE.Mesh(fuseGeo, paintMat);
  fuselage.scale.set(1.22, 0.68, 1.0);
  fuselage.position.y = 1.1;
  fuselage.castShadow = true;

  // Side Air Intakes
  [-0.78, 0.78].forEach((ix) => {
    const intake = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.42, 2.2), trimMat);
    intake.position.set(ix, 1.02, 0.45);
    bodyGroup.add(intake);
  });

  // Swept Delta Main Wings + Forward Canards
  const wingShape = new THREE.Shape();
  wingShape.moveTo(-4.1, -1.65);
  wingShape.lineTo(4.1, -1.65);
  wingShape.lineTo(3.75, -0.75);
  wingShape.lineTo(0.85, 1.55);
  wingShape.lineTo(-0.85, 1.55);
  wingShape.lineTo(-3.75, -0.75);
  wingShape.closePath();

  const wingGeo = new THREE.ExtrudeGeometry(wingShape, {
    depth: 0.12,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.04,
    bevelSegments: 2,
  });
  wingGeo.rotateX(Math.PI / 2);
  const wings = new THREE.Mesh(wingGeo, paintMat);
  wings.position.set(0, 1.08, -0.35);
  wings.castShadow = true;

  // Twin Canted Vertical Stealth Stabilizers
  [-0.75, 0.75].forEach((tx) => {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.35, 1.4), paintMat);
    fin.rotation.z = tx > 0 ? -0.36 : 0.36;
    fin.rotation.x = -0.35;
    fin.position.set(tx, 1.78, -2.95);
    fin.castShadow = true;
    bodyGroup.add(fin);
  });

  // Visible Cockpit + Ejection Seat + Green HUD + Transparent Canopy
  const hud = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.16, 0.02), hudMat);
  hud.rotation.x = -0.45;
  hud.position.set(0, 1.56, 2.25);
  const cockpitCanopy = new THREE.Mesh(new THREE.SphereGeometry(0.52, 16, 12), glassMat);
  cockpitCanopy.scale.set(0.88, 0.65, 2.5);
  cockpitCanopy.position.set(0, 1.54, 1.55);
  cockpitCanopy.renderOrder = 2;

  // Underwing Missile Rails + Twin Nose Cannons
  [-2.35, 2.35, -3.25, 3.25].forEach((mx) => {
    const missile = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.65, 10), chromeMat);
    missile.rotation.x = Math.PI / 2;
    missile.position.set(mx, 0.88, -0.45);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.22, 10), brakeLightsMat);
    tip.rotation.x = Math.PI / 2;
    tip.position.set(mx, 0.88, 0.48);
    bodyGroup.add(missile, tip);
  });

  // Twin Rear Engine Nozzles & Afterburner Plumes
  const afterburners: THREE.Mesh[] = [];
  [-0.36, 0.36].forEach((nx) => {
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.55, 14), trimMat);
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.set(nx, 1.05, -4.05);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.2, 1.25, 12), afterburnerMat);
    flame.rotation.x = -Math.PI / 2;
    flame.position.set(nx, 1.05, -4.85);
    afterburners.push(flame);
    bodyGroup.add(nozzle, flame);
  });

  // Tricycle Landing Gear
  const wheels: THREE.Group[] = [];
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.85 });
  const gearCoords: [number, number][] = [
    [0, 2.65],
    [-1.25, -0.75],
    [1.25, -0.75],
  ];
  for (const [gx, gz] of gearCoords) {
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.032, 0.72, 8), chromeMat);
    strut.position.set(gx, 0.54, gz);
    const wheelGroup = new THREE.Group();
    wheelGroup.position.set(gx, 0.22, gz);
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.14, 14), tireMat);
    tire.rotation.z = Math.PI / 2;
    wheelGroup.add(tire);
    bodyGroup.add(strut, wheelGroup);
    wheels.push(wheelGroup);
  }

  const driverGroup = new THREE.Group();
  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.2, metalness: 0.45 })
  );
  helmet.position.set(0, 1.48, 1.45);
  driverGroup.add(helmet);
  driverGroup.visible = false;

  bodyGroup.add(fuselage, wings, hud, cockpitCanopy, driverGroup);

  return {
    root,
    bodyGroup,
    wheels,
    frontSteerPivots: [],
    driverGroup,
    afterburners,
    paintMat,
    brakeLightsMat,
  };
}

export function createVehicleRig(
  kind: VehicleKind,
  colorHex: string,
  contactShadowTexture?: THREE.Texture
): VehicleRig {
  const resolvedPaint =
    kind === 'police'
      ? '#0f172a'
      : kind === 'taxi'
        ? '#facc15'
        : kind === 'ambulance'
          ? '#f8fafc'
          : kind === 'firetruck'
            ? '#dc2626'
            : kind === 'fighter_jet'
              ? '#475569'
              : kind === 'helicopter'
                ? '#1e293b'
                : colorHex;

  const paintMat = new THREE.MeshPhysicalMaterial({
    color: resolvedPaint,
    metalness: kind === 'ambulance' ? 0.35 : kind === 'taxi' ? 0.48 : 0.78,
    roughness: kind === 'ambulance' || kind === 'taxi' ? 0.18 : 0.14,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
    envMapIntensity: 1.45,
  });

  const trimMat = new THREE.MeshStandardMaterial({
    color: 0x18181b,
    metalness: 0.42,
    roughness: 0.52,
  });

  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    metalness: 0.96,
    roughness: 0.1,
    envMapIntensity: 1.5,
  });

  const headlightMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xfef3c7,
    emissiveIntensity: 1.85,
  });

  const brakeLightsMat = new THREE.MeshStandardMaterial({
    color: 0xef4444,
    emissive: 0xdc2626,
    emissiveIntensity: 0.85,
  });

  if (kind === 'motorcycle') {
    return createMotorcycleRig(
      colorHex,
      paintMat,
      trimMat,
      chromeMat,
      headlightMat,
      brakeLightsMat,
      contactShadowTexture
    );
  }
  if (kind === 'boat') {
    return createBoatRig(paintMat, trimMat, chromeMat, brakeLightsMat, contactShadowTexture);
  }
  if (kind === 'plane') {
    return createPlaneRig(paintMat, trimMat, chromeMat, brakeLightsMat, contactShadowTexture);
  }
  if (kind === 'helicopter') {
    return createHelicopterRig(paintMat, trimMat, chromeMat, brakeLightsMat, contactShadowTexture);
  }
  if (kind === 'fighter_jet') {
    return createFighterJetRig(paintMat, trimMat, chromeMat, brakeLightsMat, contactShadowTexture);
  }

  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const isSuv = kind === 'suv';
  const isTaxi = kind === 'taxi';
  const isPolice = kind === 'police';
  const isAmbulance = kind === 'ambulance';
  const isFiretruck = kind === 'firetruck';
  const isEmergency = isPolice || isAmbulance || isFiretruck;
  const isSuper = kind === 'supercar';
  const isMuscle = kind === 'muscle';
  const isCoupe = kind === 'coupe';
  const { bodyGeo, cabinGeo, bodyLen, bodyW } = createSculptedCarBodyGeometry(kind);

  if (contactShadowTexture) {
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(bodyW * 1.48, bodyLen * 1.24),
      new THREE.MeshBasicMaterial({
        map: contactShadowTexture,
        transparent: true,
        depthWrite: false,
        opacity: 0.58,
      })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.03;
    root.add(shadow);
  }

  const whiteDoorMat = new THREE.MeshPhysicalMaterial({
    color: '#f8fafc',
    metalness: 0.35,
    roughness: 0.2,
    clearcoat: 0.95,
  });

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x0f172a,
    metalness: 0.12,
    roughness: 0.03,
    clearcoat: 1.0,
    envMapIntensity: 1.75,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  });

  const chassis = new THREE.Mesh(bodyGeo, paintMat);
  chassis.position.y = isSuper ? 0.54 : isAmbulance || isFiretruck ? 0.78 : 0.62;
  chassis.castShadow = true;
  chassis.receiveShadow = true;
  bodyGroup.add(chassis);

  // Real-Inspired Distinct Exterior Styling Details per Fictional Brand
  if (isSuper) {
    const splitter = new THREE.Mesh(new THREE.BoxGeometry(bodyW * 0.98, 0.07, 0.32), trimMat);
    splitter.position.set(0, 0.24, bodyLen * 0.49);
    const diffuser = new THREE.Mesh(new THREE.BoxGeometry(bodyW * 0.92, 0.16, 0.22), trimMat);
    diffuser.position.set(0, 0.26, -bodyLen * 0.49);
    const engineLouvers = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.06, 0.85), trimMat);
    engineLouvers.position.set(0, 0.94, -1.05);
    bodyGroup.add(splitter, diffuser, engineLouvers);

    [-bodyW * 0.49, bodyW * 0.49].forEach((sx) => {
      const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.34, 0.75), trimMat);
      scoop.position.set(sx, 0.6, -0.45);
      bodyGroup.add(scoop);
    });
  } else if (isMuscle) {
    const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.14, 0.88), trimMat);
    scoop.position.set(0, 0.97, 1.05);
    const ducktail = new THREE.Mesh(new THREE.BoxGeometry(bodyW * 0.9, 0.14, 0.22), paintMat);
    ducktail.rotation.x = -0.35;
    ducktail.position.set(0, 1.02, -bodyLen * 0.46);
    bodyGroup.add(scoop, ducktail);
  } else if (isCoupe) {
    const skirtL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 2.3), trimMat);
    skirtL.position.set(-bodyW * 0.51, 0.3, 0);
    const skirtR = skirtL.clone();
    skirtR.position.x = bodyW * 0.51;
    bodyGroup.add(skirtL, skirtR);
  } else if (isSuv) {
    [-0.65, 0.65].forEach((rx) => {
      const rail = new THREE.Mesh(new THREE.CapsuleGeometry(0.032, 1.85, 4, 8), chromeMat);
      rail.rotation.x = Math.PI / 2;
      rail.position.set(rx, 1.56, -0.4);
      bodyGroup.add(rail);
    });
    const sparePod = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.22, 18), paintMat);
    sparePod.rotation.x = Math.PI / 2;
    sparePod.position.set(0, 0.86, -bodyLen * 0.51);
    bodyGroup.add(sparePod);
  } else if (kind === 'sedan' || isTaxi) {
    [-0.22, 0.22].forEach((gx) => {
      const pod = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), chromeMat);
      pod.scale.set(1.2, 0.85, 0.35);
      pod.position.set(gx, 0.52, bodyLen * 0.5);
      bodyGroup.add(pod);
    });
  }

  if (isTaxi) {
    // Checkered Vice Cab side stripe + Glowing Roof Taxi Sign
    const checkerDark = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.4 });
    const checkerWhite = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.35 });
    for (let i = 0; i < 8; i++) {
      const cz = -0.85 + i * 0.24;
      [-bodyW * 0.485, bodyW * 0.485].forEach((cx) => {
        const sqTop = new THREE.Mesh(
          new THREE.BoxGeometry(0.03, 0.08, 0.22),
          i % 2 === 0 ? checkerDark : checkerWhite
        );
        sqTop.position.set(cx, 0.66, cz);
        const sqBot = new THREE.Mesh(
          new THREE.BoxGeometry(0.03, 0.08, 0.22),
          i % 2 === 1 ? checkerDark : checkerWhite
        );
        sqBot.position.set(cx, 0.58, cz);
        bodyGroup.add(sqTop, sqBot);
      });
    }
    const signBase = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.04, 0.24), trimMat);
    signBase.position.set(0, 1.4, -0.15);
    const signGlow = new THREE.Mesh(
      new THREE.BoxGeometry(0.56, 0.14, 0.2),
      new THREE.MeshStandardMaterial({
        color: 0xfef08a,
        emissive: 0xf59e0b,
        emissiveIntensity: 1.5,
      })
    );
    signGlow.position.set(0, 1.48, -0.15);
    bodyGroup.add(signBase, signGlow);
  }

  if (isPolice) {
    const doorBand = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 1.45, 6, 12), whiteDoorMat);
    doorBand.rotation.x = Math.PI / 2;
    doorBand.scale.set((bodyW * 0.52) / 0.32, 1, 0.85);
    doorBand.position.set(0, 0.62, 0.02);
    bodyGroup.add(doorBand);
  }

  if (isAmbulance) {
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xe11d48, roughness: 0.28, metalness: 0.2 });
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(bodyW * 0.96, 0.2, bodyLen * 0.84), stripeMat);
    stripe.position.set(0, 0.92, -0.15);
    bodyGroup.add(stripe);

    const crossMat = new THREE.MeshStandardMaterial({ color: 0xe11d48, emissive: 0xbe123c, emissiveIntensity: 0.45 });
    const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.28), crossMat);
    const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.9), crossMat);
    c1.position.set(0, 2.24, -0.6);
    c2.position.set(0, 2.24, -0.6);
    bodyGroup.add(c1, c2);
  }

  if (isFiretruck) {
    const shutterMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.75, roughness: 0.28 });
    [-bodyW * 0.46, bodyW * 0.46].forEach((sx) => {
      const bay = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.85, 2.9), shutterMat);
      bay.position.set(sx, 1.35, -0.95);
      bodyGroup.add(bay);
    });
    [-0.28, 0.28].forEach((lx) => {
      const rail = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 3.6, 4, 8), chromeMat);
      rail.rotation.x = Math.PI / 2;
      rail.position.set(lx, 2.46, -0.75);
      bodyGroup.add(rail);
    });
    for (let rz = -2.3; rz <= 0.8; rz += 0.45) {
      const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.56, 8), chromeMat);
      rung.rotation.z = Math.PI / 2;
      rung.position.set(0, 2.46, rz);
      bodyGroup.add(rung);
    }
  }

  // Hollow Transparent-Glass Cabin + Detailed Interior for All Passenger Cars
  if (isAmbulance || isFiretruck) {
    const cabin = new THREE.Mesh(cabinGeo, paintMat);
    cabin.position.set(0, isFiretruck ? 1.78 : 1.68, isFiretruck ? -0.42 : -0.52);
    cabin.castShadow = true;
    bodyGroup.add(cabin);

    const windshield = new THREE.Mesh(new THREE.BoxGeometry(bodyW * 0.78, 0.55, 0.08), glassMat);
    windshield.position.set(0, isFiretruck ? 1.72 : 1.6, isFiretruck ? 1.52 : 0.92);
    windshield.rotation.x = -0.22;
    windshield.renderOrder = 2;
    bodyGroup.add(windshield);
  } else {
    const roofY = isSuv ? 1.51 : isSuper ? 1.18 : 1.34;
    const baseGlassY = isSuper ? 0.82 : isSuv ? 0.98 : 0.9;
    const glassH = roofY - baseGlassY;
    const cabinW = bodyW - 0.38;
    const cabinFrontZ = isSuper ? 0.65 : isSuv ? 0.58 : 0.54;
    const cabinRearZ = isSuv ? -1.48 : -1.18;
    const roofFrontZ = isSuper ? 0.06 : isSuv ? 0.25 : 0.14;
    const roofRearZ = isSuv ? -1.35 : -0.92;

    // Interior Tub, Sculpted Seats, Dashboard, Glowing Gauges & Steering Wheel
    const seatMat = new THREE.MeshStandardMaterial({ color: isSuper ? 0x7f1d1d : 0x1e293b, roughness: 0.72 });
    const dashMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.58 });
    const gaugeMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0ea5e9,
      emissiveIntensity: 1.4,
    });

    const interiorFloor = new THREE.Mesh(new THREE.BoxGeometry(cabinW * 0.88, 0.08, 1.85), dashMat);
    interiorFloor.position.set(0, baseGlassY - 0.24, -0.25);
    bodyGroup.add(interiorFloor);

    // Front Bucket Seats + Rear Bench
    [-0.36, 0.36].forEach((sx) => {
      const seatBase = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.44), seatMat);
      seatBase.position.set(sx, baseGlassY - 0.14, -0.05);
      const seatBack = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.48, 0.11), seatMat);
      seatBack.rotation.x = -0.18;
      seatBack.position.set(sx, baseGlassY + 0.08, -0.24);
      const headrest = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.09), seatMat);
      headrest.position.set(sx, baseGlassY + 0.35, -0.28);
      bodyGroup.add(seatBase, seatBack, headrest);
    });
    const rearBench = new THREE.Mesh(new THREE.BoxGeometry(cabinW * 0.76, 0.36, 0.42), seatMat);
    rearBench.position.set(0, baseGlassY - 0.04, -0.82);
    bodyGroup.add(rearBench);

    // Dashboard + Glowing Instrument Cluster + Steering Wheel
    const dash = new THREE.Mesh(new THREE.BoxGeometry(cabinW * 0.86, 0.24, 0.38), dashMat);
    dash.position.set(0, baseGlassY - 0.04, 0.42);
    const gaugeCluster = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.09, 0.04), gaugeMat);
    gaugeCluster.position.set(-0.36, baseGlassY + 0.04, 0.24);
    const wheelRim = new THREE.Mesh(new THREE.TorusGeometry(0.145, 0.018, 8, 16), trimMat);
    wheelRim.rotation.x = 0.42;
    wheelRim.position.set(-0.36, baseGlassY + 0.04, 0.14);
    const consoleShifter = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.56), dashMat);
    consoleShifter.position.set(0, baseGlassY - 0.1, 0.1);
    bodyGroup.add(dash, gaugeCluster, wheelRim, consoleShifter);

    // A / B / C Structural Pillars
    const pillarMat = isSuper || isCoupe ? trimMat : paintMat;
    [-cabinW * 0.47, cabinW * 0.47].forEach((px) => {
      // A-pillar
      const aPillar = new THREE.Mesh(new THREE.BoxGeometry(0.065, glassH * 1.18, 0.075), pillarMat);
      aPillar.rotation.x = -0.68;
      aPillar.position.set(px, baseGlassY + glassH * 0.5, (cabinFrontZ + roofFrontZ) * 0.5);
      // B-pillar
      const bPillar = new THREE.Mesh(new THREE.BoxGeometry(0.065, glassH, 0.08), trimMat);
      bPillar.position.set(px, baseGlassY + glassH * 0.5, -0.35);
      // C-pillar
      const cPillar = new THREE.Mesh(new THREE.BoxGeometry(0.075, glassH * 1.12, 0.14), pillarMat);
      cPillar.rotation.x = 0.58;
      cPillar.position.set(px, baseGlassY + glassH * 0.5, (cabinRearZ + roofRearZ) * 0.5);
      bodyGroup.add(aPillar, bPillar, cPillar);
    });

    // Roof Cap
    const roofShell = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.45, isSuv ? 1.35 : 0.85, 6, 14),
      isPolice ? whiteDoorMat : paintMat
    );
    roofShell.rotation.x = Math.PI / 2;
    roofShell.scale.set(1.42, 1, 0.22);
    roofShell.position.set(0, roofY, (roofFrontZ + roofRearZ) * 0.5);
    roofShell.castShadow = true;
    bodyGroup.add(roofShell);

    // Clear Transparent Glass Panes (Windshield, Rear Glass, Side Windows)
    const windshieldPane = new THREE.Mesh(
      new THREE.PlaneGeometry(cabinW * 0.88, glassH * 1.25),
      glassMat
    );
    windshieldPane.position.set(0, baseGlassY + glassH * 0.5, (cabinFrontZ + roofFrontZ) * 0.5);
    windshieldPane.rotation.x = -Math.PI / 2 + 0.68;
    windshieldPane.renderOrder = 2;

    const rearPane = new THREE.Mesh(
      new THREE.PlaneGeometry(cabinW * 0.84, glassH * 1.16),
      glassMat
    );
    rearPane.position.set(0, baseGlassY + glassH * 0.5, (cabinRearZ + roofRearZ) * 0.5);
    rearPane.rotation.x = Math.PI / 2 - 0.58;
    rearPane.renderOrder = 2;

    [-cabinW * 0.465, cabinW * 0.465].forEach((gx) => {
      const sidePane = new THREE.Mesh(
        new THREE.PlaneGeometry(Math.abs(roofFrontZ - roofRearZ) + 0.35, glassH * 0.92),
        glassMat
      );
      sidePane.rotation.y = gx > 0 ? Math.PI / 2 : -Math.PI / 2;
      sidePane.position.set(gx, baseGlassY + glassH * 0.48, (roofFrontZ + roofRearZ) * 0.5);
      sidePane.renderOrder = 2;
      bodyGroup.add(sidePane);
    });
    bodyGroup.add(windshieldPane, rearPane);
  }

  const driverGroup = new THREE.Group();
  const drvTorso = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.15, 0.24, 4, 8),
    new THREE.MeshStandardMaterial({ color: isFiretruck ? 0xd97706 : 0x1e293b, roughness: 0.8 })
  );
  drvTorso.position.set(
    -0.36,
    isFiretruck ? 1.55 : isAmbulance ? 1.45 : isSuv ? 1.05 : isSuper ? 0.82 : 0.94,
    isFiretruck ? 1.1 : isAmbulance ? 0.5 : -0.1
  );
  const drvHead = new THREE.Mesh(
    new THREE.SphereGeometry(0.125, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xc68b67, roughness: 0.55 })
  );
  drvHead.position.set(
    -0.36,
    isFiretruck ? 1.82 : isAmbulance ? 1.72 : isSuv ? 1.32 : isSuper ? 1.04 : 1.17,
    isFiretruck ? 1.1 : isAmbulance ? 0.5 : -0.1
  );
  driverGroup.add(drvTorso, drvHead);
  driverGroup.visible = false;
  bodyGroup.add(driverGroup);

  // Side Mirrors + Door Handles
  [-bodyW * 0.53, bodyW * 0.53].forEach((mx) => {
    const mirror = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.1, 4, 8), paintMat);
    mirror.rotation.z = Math.PI / 2;
    mirror.position.set(mx, isFiretruck || isAmbulance ? 1.35 : 0.94, isFiretruck ? 1.45 : 0.48);
    bodyGroup.add(mirror);
  });

  // Front Grille + Fictional Brand Emblem (Front & Rear!)
  const grille = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.11, isMuscle ? 1.05 : 0.85, 4, 10),
    isFiretruck ? chromeMat : trimMat
  );
  grille.rotation.z = Math.PI / 2;
  grille.position.set(0, isFiretruck || isAmbulance ? 0.72 : 0.48, bodyLen * 0.49);
  bodyGroup.add(grille);

  const frontBadge = createFictionalBrandBadge(kind, chromeMat);
  frontBadge.position.set(0, isSuper ? 0.54 : isFiretruck || isAmbulance ? 0.84 : 0.68, bodyLen * 0.495);
  frontBadge.rotation.x = -0.35;
  const rearBadge = createFictionalBrandBadge(kind, chromeMat);
  rearBadge.position.set(0, isSuper ? 0.72 : 0.76, -bodyLen * 0.5);
  rearBadge.rotation.y = Math.PI;
  bodyGroup.add(frontBadge, rearBadge);

  // Exhausts
  const exhaustXs = isSuper ? [-0.22, -0.08, 0.08, 0.22] : [-0.55, 0.55];
  exhaustXs.forEach((ex) => {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.046, 0.18, 12), chromeMat);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(ex, 0.34, -bodyLen * 0.5);
    bodyGroup.add(pipe);
  });

  // LED Headlights & Full/Split Taillights
  [-0.68, 0.68].forEach((lx) => {
    const hl = new THREE.Mesh(new THREE.CapsuleGeometry(0.042, 0.26, 4, 10), headlightMat);
    hl.rotation.z = Math.PI / 2;
    hl.rotation.y = lx > 0 ? -0.18 : 0.18;
    hl.position.set(lx, isSuper ? 0.54 : isFiretruck || isAmbulance ? 0.82 : 0.64, bodyLen * 0.485);
    const tl = new THREE.Mesh(new THREE.CapsuleGeometry(0.044, 0.28, 4, 10), brakeLightsMat);
    tl.rotation.z = Math.PI / 2;
    tl.position.set(lx, isSuper ? 0.68 : isFiretruck || isAmbulance ? 0.86 : 0.72, -bodyLen * 0.485);
    bodyGroup.add(hl, tl);
  });

  if (isSuper || isCoupe) {
    const lightBar = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 1.15, 4, 8), brakeLightsMat);
    lightBar.rotation.z = Math.PI / 2;
    lightBar.position.set(0, isSuper ? 0.68 : 0.72, -bodyLen * 0.49);
    bodyGroup.add(lightBar);

    const wing = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.036, isSuper ? 1.72 : 1.5, 4, 10),
      trimMat
    );
    wing.rotation.z = Math.PI / 2;
    wing.position.set(0, isSuper ? 1.1 : 1.07, -bodyLen * 0.46);
    [-0.55, 0.55].forEach((sx) => {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.2, 0.14), trimMat);
      strut.position.set(sx, isSuper ? 0.99 : 0.97, -bodyLen * 0.46);
      bodyGroup.add(strut);
    });
    bodyGroup.add(wing);
  }

  let redBeacon: THREE.Mesh | undefined;
  let blueBeacon: THREE.Mesh | undefined;
  if (isEmergency) {
    const barY = isFiretruck ? 2.4 : isAmbulance ? 2.25 : 1.46;
    const barZ = isFiretruck ? 1.35 : isAmbulance ? 0.82 : -0.2;
    const barBase = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 1.08, 4, 10), trimMat);
    barBase.rotation.z = Math.PI / 2;
    barBase.position.set(0, barY, barZ);
    const redMat = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xef4444, emissiveIntensity: 2.2 });
    const blueMat = new THREE.MeshStandardMaterial({
      color: isFiretruck ? 0xf59e0b : 0x3b82f6,
      emissive: isFiretruck ? 0xf59e0b : 0x3b82f6,
      emissiveIntensity: 2.2,
    });
    redBeacon = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.38, 4, 10), redMat);
    redBeacon.rotation.z = Math.PI / 2;
    redBeacon.position.set(-0.32, barY + 0.02, barZ);
    blueBeacon = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.38, 4, 10), blueMat);
    blueBeacon.rotation.z = Math.PI / 2;
    blueBeacon.position.set(0.32, barY + 0.02, barZ);
    bodyGroup.add(barBase, redBeacon, blueBeacon);
  }

  // 4 Multi-Spoke Wheels with Visible Brake Rotor + Red/Amber Caliper inside Steer Pivot
  const wheels: THREE.Group[] = [];
  const frontSteerPivots: THREE.Group[] = [];
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.85, metalness: 0.08 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xdbeafe, roughness: 0.16, metalness: 0.92 });
  const rotorMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.35, metalness: 0.85 });
  const caliperMat = new THREE.MeshStandardMaterial({
    color: isSuper ? 0xef4444 : isMuscle ? 0xf59e0b : 0x38bdf8,
    roughness: 0.3,
    metalness: 0.4,
  });

  const wheelRadius = isFiretruck ? 0.48 : isAmbulance || isSuv ? 0.42 : 0.37;
  const wheelZ = bodyLen * 0.31;
  const wheelX = bodyW * 0.5 - 0.04;

  const wheelPositions: [number, number, boolean][] = [
    [-wheelX, wheelZ, true],
    [wheelX, wheelZ, true],
    [-wheelX, -wheelZ, false],
    [wheelX, -wheelZ, false],
  ];

  for (const [wx, wz, isFront] of wheelPositions) {
    const steerPivot = new THREE.Group();
    steerPivot.position.set(wx, wheelRadius, wz);
    const wheelSpinGroup = new THREE.Group();

    const tire = new THREE.Mesh(new THREE.CylinderGeometry(wheelRadius, wheelRadius, 0.25, 22), tireMat);
    tire.rotation.z = Math.PI / 2;
    tire.castShadow = true;

    const sidewall = new THREE.Mesh(new THREE.TorusGeometry(wheelRadius * 0.82, 0.055, 8, 20), tireMat);
    sidewall.rotation.y = Math.PI / 2;
    sidewall.position.x = wx < 0 ? -0.1 : 0.1;

    const rim = new THREE.Mesh(new THREE.CylinderGeometry(wheelRadius * 0.62, wheelRadius * 0.62, 0.26, 16), rimMat);
    rim.rotation.z = Math.PI / 2;

    const rotor = new THREE.Mesh(new THREE.CylinderGeometry(wheelRadius * 0.46, wheelRadius * 0.46, 0.06, 14), rotorMat);
    rotor.rotation.z = Math.PI / 2;
    rotor.position.x = wx < 0 ? -0.05 : 0.05;

    for (let s = 0; s < 5; s++) {
      const spoke = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, wheelRadius * 0.95, 4, 6), rimMat);
      spoke.rotation.x = (s * Math.PI) / 5;
      spoke.position.x = wx < 0 ? -0.12 : 0.12;
      wheelSpinGroup.add(spoke);
    }

    // Brake Caliper mounted to steerPivot (stays upright when wheel spins!)
    const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.11), caliperMat);
    caliper.position.set(wx < 0 ? -0.05 : 0.05, 0.07, isFront ? -0.14 : 0.14);

    wheelSpinGroup.add(tire, sidewall, rim, rotor);
    steerPivot.add(wheelSpinGroup, caliper);
    root.add(steerPivot);
    wheels.push(wheelSpinGroup);
    if (isFront) frontSteerPivots.push(steerPivot);
  }

  return {
    root,
    bodyGroup,
    wheels,
    frontSteerPivots,
    driverGroup,
    paintMat,
    redBeacon,
    blueBeacon,
    brakeLightsMat,
  };
}

export function createExplosiveBarrelMesh(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.41, 0.41, 1.15, 18),
    new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.42, metalness: 0.36 })
  );
  body.position.y = 0.575;
  body.castShadow = true;
  const ring1 = new THREE.Mesh(
    new THREE.TorusGeometry(0.415, 0.025, 8, 20),
    new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.35 })
  );
  ring1.rotation.x = Math.PI / 2;
  ring1.position.y = 0.82;
  const ring2 = ring1.clone();
  ring2.position.y = 0.34;
  g.add(body, ring1, ring2);
  return g;
}

export function createYachtMesh(): THREE.Group {
  const g = new THREE.Group();
  const hullMat = new THREE.MeshPhysicalMaterial({ color: 0xf8fafc, roughness: 0.18, clearcoat: 1.0 });
  const deckMat = new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.62 });
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x0f172a, roughness: 0.08, clearcoat: 1.0 });

  const hullShape = new THREE.Shape();
  hullShape.moveTo(-2.1, -6.2);
  hullShape.lineTo(2.1, -6.2);
  hullShape.quadraticCurveTo(2.2, 2.0, 0, 6.8);
  hullShape.quadraticCurveTo(-2.2, 2.0, -2.1, -6.2);

  const hullGeo = new THREE.ExtrudeGeometry(hullShape, {
    depth: 1.4,
    bevelEnabled: true,
    bevelThickness: 0.25,
    bevelSize: 0.2,
    bevelSegments: 3,
  });
  hullGeo.rotateX(Math.PI / 2);
  const hull = new THREE.Mesh(hullGeo, hullMat);
  hull.position.y = 1.4;
  hull.castShadow = true;

  const deck = new THREE.Mesh(new THREE.CapsuleGeometry(1.4, 7.5, 6, 12), deckMat);
  deck.rotation.x = Math.PI / 2;
  deck.scale.set(1, 1, 0.12);
  deck.position.set(0, 1.5, -0.5);

  const cabin = new THREE.Mesh(new THREE.CapsuleGeometry(1.25, 3.6, 6, 12), hullMat);
  cabin.rotation.x = Math.PI / 2;
  cabin.scale.set(1, 1, 0.55);
  cabin.position.set(0, 2.05, -0.8);

  const bridge = new THREE.Mesh(new THREE.CapsuleGeometry(1.12, 1.8, 6, 12), glassMat);
  bridge.rotation.x = Math.PI / 2;
  bridge.scale.set(1, 1, 0.45);
  bridge.position.set(0, 2.35, 0.95);

  g.add(hull, deck, cabin, bridge);
  return g;
}
