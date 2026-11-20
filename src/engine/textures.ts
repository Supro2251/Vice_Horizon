import * as THREE from 'three';

export interface ProceduralTextureSet {
  asphalt: THREE.CanvasTexture;
  highwayAsphalt: THREE.CanvasTexture;
  asphaltNormal: THREE.CanvasTexture;
  dirtTrail: THREE.CanvasTexture;
  meadowGrass: THREE.CanvasTexture;
  grassNormal: THREE.CanvasTexture;
  parkingLot: THREE.CanvasTexture;
  sidewalk: THREE.CanvasTexture;
  sidewalkNormal: THREE.CanvasTexture;
  sand: THREE.CanvasTexture;
  sandNormal: THREE.CanvasTexture;
  ocean: THREE.CanvasTexture;
  oceanNormal: THREE.CanvasTexture;
  buildingModern: THREE.CanvasTexture;
  buildingModernEmissive: THREE.CanvasTexture;
  buildingArtDeco: THREE.CanvasTexture;
  buildingArtDecoEmissive: THREE.CanvasTexture;
  buildingIndustrial: THREE.CanvasTexture;
  contactShadow: THREE.CanvasTexture;
  dispose: () => void;
}

function makeSeededRandom(initialSeed: number): () => number {
  let seed = initialSeed >>> 0;
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function heightMapToNormalCanvas(
  size: number,
  heightFn: (x: number, y: number) => number,
  strength: number
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const data = img.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const hL = heightFn((x - 1 + size) % size, y);
      const hR = heightFn((x + 1) % size, y);
      const hD = heightFn(x, (y - 1 + size) % size);
      const hU = heightFn(x, (y + 1) % size);

      let nx = (hL - hR) * strength;
      let ny = (hD - hU) * strength;
      let nz = 1.0;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;

      const idx = (y * size + x) * 4;
      data[idx] = Math.round((nx * 0.5 + 0.5) * 255);
      data[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export function createProceduralTextures(maxAnisotropy: number): ProceduralTextureSet {
  const created: THREE.CanvasTexture[] = [];
  const rand = makeSeededRandom(421337);

  const register = (canvas: HTMLCanvasElement, repeatX = 1, repeatY = 1, isColor = true) => {
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = Math.min(8, maxAnisotropy || 1);
    if (isColor) {
      tex.colorSpace = THREE.SRGBColorSpace;
    }
    tex.needsUpdate = true;
    created.push(tex);
    return tex;
  };

  const paintAsphaltBase = (ctx: CanvasRenderingContext2D, size: number, lanes: 2 | 4) => {
    ctx.fillStyle = '#20242c';
    ctx.fillRect(0, 0, size, size);

    // Subtle aggregate & tarmac tonal patches
    for (let i = 0; i < 48; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const r = 18 + rand() * 55;
      const g = ctx.createRadialGradient(x, y, 2, x, y, r);
      const tone = rand() > 0.5 ? 'rgba(42,47,57,0.22)' : 'rgba(20,23,29,0.24)';
      g.addColorStop(0, tone);
      g.addColorStop(1, 'rgba(32,36,44,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }

    // Realistic rubber tire-wear polishing along driving lanes
    const laneCenters = lanes === 4 ? [78, 178, 334, 434] : [132, 380];
    for (const cx of laneCenters) {
      const wearGrad = ctx.createLinearGradient(cx - 46, 0, cx + 46, 0);
      wearGrad.addColorStop(0, 'rgba(14,17,22,0)');
      wearGrad.addColorStop(0.5, 'rgba(13,16,21,0.34)');
      wearGrad.addColorStop(1, 'rgba(14,17,22,0)');
      ctx.fillStyle = wearGrad;
      ctx.fillRect(cx - 46, 0, 92, size);
    }

    // Crushed granite / basalt mineral aggregate grain (wrapped vertically)
    for (let i = 0; i < 22000; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const v = 22 + Math.floor(rand() * 34);
      const tint = rand() > 0.85 ? 8 : 2;
      ctx.fillStyle = `rgb(${v},${v + tint},${v + tint + 3})`;
      ctx.fillRect(x, y, 1.5, 1.5);
    }

    // Subtle sealed tar cracks
    ctx.strokeStyle = 'rgba(11,13,17,0.48)';
    ctx.lineWidth = 1.2;
    for (let c = 0; c < 6; c++) {
      let cx = 36 + rand() * (size - 72);
      let cy = rand() * size;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      for (let s = 0; s < 8; s++) {
        cx += (rand() - 0.5) * 26;
        cy += 12 + rand() * 18;
        ctx.lineTo(cx, cy);
      }
      ctx.stroke();
    }
  };

  // 1A. City Street 2-Lane Asphalt Texture
  const asphaltCanvas = document.createElement('canvas');
  asphaltCanvas.width = 512;
  asphaltCanvas.height = 512;
  const actx = asphaltCanvas.getContext('2d')!;
  paintAsphaltBase(actx, 512, 2);
  // Subtle gutter darkening + crisp off-white shoulder stripes
  actx.fillStyle = 'rgba(14,17,22,0.55)';
  actx.fillRect(0, 0, 14, 512);
  actx.fillRect(498, 0, 14, 512);
  actx.fillStyle = 'rgba(226,232,240,0.85)';
  actx.fillRect(14, 0, 8, 512);
  actx.fillRect(490, 0, 8, 512);
  // Warm amber broken centerline
  actx.fillStyle = 'rgba(234,179,8,0.92)';
  for (let y = 16; y < 512; y += 64) {
    actx.fillRect(251, y, 10, 36);
  }
  const asphalt = register(asphaltCanvas, 1, 1, true);

  // 1B. Multi-Lane Highway Asphalt Texture
  const hwyCanvas = document.createElement('canvas');
  hwyCanvas.width = 512;
  hwyCanvas.height = 512;
  const hctx = hwyCanvas.getContext('2d')!;
  paintAsphaltBase(hctx, 512, 4);
  hctx.fillStyle = 'rgba(226,232,240,0.9)';
  hctx.fillRect(16, 0, 9, 512);
  hctx.fillRect(487, 0, 9, 512);
  // Dashed white lane dividers
  hctx.fillStyle = 'rgba(226,232,240,0.82)';
  for (let y = 14; y < 512; y += 64) {
    hctx.fillRect(130, y, 6, 32);
    hctx.fillRect(376, y, 6, 32);
  }
  // Solid double yellow median strip
  hctx.fillStyle = 'rgba(234,179,8,0.94)';
  hctx.fillRect(247, 0, 6, 512);
  hctx.fillRect(259, 0, 6, 512);
  const highwayAsphalt = register(hwyCanvas, 1, 1, true);

  const asphaltNormCanvas = heightMapToNormalCanvas(
    256,
    (x, y) => {
      const u = (x / 256) * Math.PI * 2;
      const v = (y / 256) * Math.PI * 2;
      const micro = (((x * 97 + y * 193 + (x ^ y) * 31) % 29) / 29 - 0.5) * 1.1;
      const grain = Math.sin(u * 14 + v * 9) * Math.cos(v * 17 - u * 11) * 0.45;
      return micro + grain;
    },
    1.55
  );
  const asphaltNormal = register(asphaltNormCanvas, 3, 3, false);

  // 2. Dirt Forest & Mountain Trail Texture (feathered organic wheel ruts + gravel)
  const dirtCanvas = document.createElement('canvas');
  dirtCanvas.width = 512;
  dirtCanvas.height = 512;
  const dtctx = dirtCanvas.getContext('2d')!;
  dtctx.fillStyle = '#5e4733';
  dtctx.fillRect(0, 0, 512, 512);
  for (const rx of [128, 384]) {
    const rut = dtctx.createLinearGradient(rx - 64, 0, rx + 64, 0);
    rut.addColorStop(0, 'rgba(60,42,28,0)');
    rut.addColorStop(0.5, 'rgba(54,37,23,0.48)');
    rut.addColorStop(1, 'rgba(60,42,28,0)');
    dtctx.fillStyle = rut;
    dtctx.fillRect(rx - 64, 0, 128, 512);
  }
  for (let i = 0; i < 14000; i++) {
    const x = rand() * 512;
    const y = rand() * 512;
    const s = 1 + rand() * 2.2;
    dtctx.fillStyle = rand() > 0.52 ? 'rgba(130,98,66,0.28)' : 'rgba(46,32,21,0.28)';
    dtctx.fillRect(x, y, s, s);
  }
  // Grassy shoulder edges blending onto dirt trail
  const edgeL = dtctx.createLinearGradient(0, 0, 56, 0);
  edgeL.addColorStop(0, 'rgba(52,88,48,0.65)');
  edgeL.addColorStop(1, 'rgba(52,88,48,0)');
  dtctx.fillStyle = edgeL;
  dtctx.fillRect(0, 0, 56, 512);
  const edgeR = dtctx.createLinearGradient(456, 0, 512, 0);
  edgeR.addColorStop(0, 'rgba(52,88,48,0)');
  edgeR.addColorStop(1, 'rgba(52,88,48,0.65)');
  dtctx.fillStyle = edgeR;
  dtctx.fillRect(456, 0, 56, 512);
  const dirtTrail = register(dirtCanvas, 1, 1, true);

  // 3. Seamless Photorealistic Multi-Tone Grass Texture + Grass Normal Map
  const grassCanvas = document.createElement('canvas');
  grassCanvas.width = 512;
  grassCanvas.height = 512;
  const gctx = grassCanvas.getContext('2d')!;
  gctx.fillStyle = '#2c4c2b';
  gctx.fillRect(0, 0, 512, 512);

  // Organic soil & lush turf blotches (wrapped cleanly across 512 border)
  for (let i = 0; i < 64; i++) {
    const x = rand() * 512;
    const y = rand() * 512;
    const r = 24 + rand() * 52;
    const c =
      rand() > 0.65
        ? 'rgba(72,102,48,0.24)'
        : rand() > 0.3
          ? 'rgba(34,64,34,0.26)'
          : 'rgba(64,56,36,0.18)';
    for (const ox of [-512, 0, 512]) {
      for (const oy of [-512, 0, 512]) {
        const px = x + ox;
        const py = y + oy;
        if (px + r < 0 || px - r > 512 || py + r < 0 || py - r > 512) continue;
        const gr = gctx.createRadialGradient(px, py, 2, px, py, r);
        gr.addColorStop(0, c);
        gr.addColorStop(1, 'rgba(44,76,43,0)');
        gctx.fillStyle = gr;
        gctx.fillRect(px - r, py - r, r * 2, r * 2);
      }
    }
  }

  // Wrapped fine grass blades in emerald, olive, and sun-kissed bermuda tones
  const bladeColors = [
    'rgba(58,104,50,0.52)',
    'rgba(74,118,54,0.44)',
    'rgba(40,76,38,0.55)',
    'rgba(92,118,58,0.34)',
    'rgba(96,86,52,0.22)',
  ];
  for (let i = 0; i < 19000; i++) {
    const x = rand() * 512;
    const y = rand() * 512;
    const angle = (rand() - 0.5) * 1.4;
    const len = 3 + rand() * 6.5;
    const dx = Math.sin(angle) * len;
    const dy = Math.cos(angle) * len;
    gctx.strokeStyle = bladeColors[Math.floor(rand() * bladeColors.length)];
    gctx.lineWidth = 1.0 + rand() * 0.8;
    for (const ox of [0, x > 500 ? -512 : x < 12 ? 512 : 9999]) {
      if (ox === 9999) continue;
      for (const oy of [0, y > 500 ? -512 : y < 12 ? 512 : 9999]) {
        if (oy === 9999) continue;
        gctx.beginPath();
        gctx.moveTo(x + ox, y + oy);
        gctx.lineTo(x + ox + dx, y + oy + dy);
        gctx.stroke();
      }
    }
  }
  const meadowGrass = register(grassCanvas, 1, 1, true);

  const grassNormCanvas = heightMapToNormalCanvas(
    256,
    (x, y) => {
      const u = (x / 256) * Math.PI * 2;
      const v = (y / 256) * Math.PI * 2;
      const tuft =
        Math.sin(u * 12 + v * 5) * 0.35 +
        Math.cos(u * 21 - v * 16) * 0.28 +
        Math.sin(u * 35 + v * 29) * 0.18;
      const micro = (((x * 131 + y * 257 + ((x * y) % 17)) % 23) / 23 - 0.5) * 0.9;
      return tuft + micro;
    },
    1.25
  );
  const grassNormal = register(grassNormCanvas, 4, 4, false);

  // 4. Parking Lot Tarmac + Painted Stalls
  const parkCanvas = document.createElement('canvas');
  parkCanvas.width = 512;
  parkCanvas.height = 512;
  const pctx = parkCanvas.getContext('2d')!;
  pctx.fillStyle = '#20252f';
  pctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 8500; i++) {
    const v = 26 + Math.floor(rand() * 24);
    pctx.fillStyle = `rgb(${v},${v + 2},${v + 5})`;
    pctx.fillRect(rand() * 512, rand() * 512, 2, 2);
  }
  // Subtle oil stain ovals inside parking bays
  for (const bx of [64, 192, 320, 448]) {
    const oil = pctx.createRadialGradient(bx, 110, 3, bx, 110, 34);
    oil.addColorStop(0, 'rgba(8,10,14,0.45)');
    oil.addColorStop(1, 'rgba(8,10,14,0)');
    pctx.fillStyle = oil;
    pctx.fillRect(bx - 36, 74, 72, 72);
  }
  pctx.fillStyle = 'rgba(226,232,240,0.86)';
  for (let x = 0; x <= 512; x += 128) {
    pctx.fillRect(Math.min(504, x), 20, 7, 176);
    pctx.fillRect(Math.min(504, x), 316, 7, 176);
  }
  pctx.fillStyle = 'rgba(234,179,8,0.9)';
  pctx.fillRect(0, 250, 512, 10);
  const parkingLot = register(parkCanvas, 2, 1, true);

  // 5. Realistic Brushed Weathered Concrete Sidewalk Slabs (NO glaring white checkerboard!)
  const swCanvas = document.createElement('canvas');
  swCanvas.width = 512;
  swCanvas.height = 512;
  const sctx = swCanvas.getContext('2d')!;
  sctx.fillStyle = '#737880';
  sctx.fillRect(0, 0, 512, 512);

  // Subtle slab-to-slab warm grey concrete variation (128px slabs -> ~2m real scale)
  for (let sy = 0; sy < 512; sy += 128) {
    for (let sx = 0; sx < 512; sx += 128) {
      const shade = 112 + ((sx * 5 + sy * 11) % 11);
      sctx.fillStyle = `rgb(${shade + 2},${shade + 1},${shade - 1})`;
      sctx.fillRect(sx + 1, sy + 1, 126, 126);
    }
  }

  // Brushed concrete broom finish + fine aggregate speckles
  for (let i = 0; i < 16000; i++) {
    const x = rand() * 512;
    const y = rand() * 512;
    const light = rand() > 0.5;
    sctx.fillStyle = light ? 'rgba(210,206,198,0.08)' : 'rgba(42,46,52,0.1)';
    sctx.fillRect(x, y, 3 + rand() * 5, 1.2);
  }

  // Subtle rainwater weathering blotches
  for (let i = 0; i < 24; i++) {
    const wx = rand() * 512;
    const wy = rand() * 512;
    const wr = 18 + rand() * 44;
    const wg = sctx.createRadialGradient(wx, wy, 2, wx, wy, wr);
    wg.addColorStop(0, 'rgba(48,50,54,0.12)');
    wg.addColorStop(1, 'rgba(48,50,54,0)');
    sctx.fillStyle = wg;
    sctx.fillRect(wx - wr, wy - wr, wr * 2, wr * 2);
  }

  // Hairline architectural expansion joints (soft groove, no loud grid!)
  sctx.fillStyle = 'rgba(54,58,64,0.52)';
  for (let i = 0; i < 512; i += 128) {
    sctx.fillRect(i, 0, 2, 512);
    sctx.fillRect(0, i, 512, 2);
  }
  sctx.fillStyle = 'rgba(155,158,162,0.22)';
  for (let i = 0; i < 512; i += 128) {
    sctx.fillRect(i + 2, 0, 1, 512);
    sctx.fillRect(0, i + 2, 512, 1);
  }
  const sidewalk = register(swCanvas, 1, 1, true);

  const swNormCanvas = heightMapToNormalCanvas(
    256,
    (x, y) => {
      const jointX = x % 64 < 2 ? -0.8 : 0;
      const jointY = y % 64 < 2 ? -0.8 : 0;
      const broom = (((x * 23 + y * 131) % 17) / 17 - 0.5) * 0.25;
      return Math.min(0, jointX + jointY) + broom;
    },
    1.1
  );
  const sidewalkNormal = register(swNormCanvas, 1, 1, false);

  // 6. Natural Coastal Beach Sand + Dune Normal Map
  const sandCanvas = document.createElement('canvas');
  sandCanvas.width = 512;
  sandCanvas.height = 512;
  const sdctx = sandCanvas.getContext('2d')!;
  sdctx.fillStyle = '#c8af86';
  sdctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 38; i++) {
    const sx = rand() * 512;
    const sy = rand() * 512;
    const sr = 28 + rand() * 64;
    const tone = rand() > 0.5 ? 'rgba(218,196,158,0.22)' : 'rgba(164,136,94,0.2)';
    for (const ox of [-512, 0, 512]) {
      for (const oy of [-512, 0, 512]) {
        const px = sx + ox;
        const py = sy + oy;
        if (px + sr < 0 || px - sr > 512 || py + sr < 0 || py - sr > 512) continue;
        const sg = sdctx.createRadialGradient(px, py, 2, px, py, sr);
        sg.addColorStop(0, tone);
        sg.addColorStop(1, 'rgba(200,175,134,0)');
        sdctx.fillStyle = sg;
        sdctx.fillRect(px - sr, py - sr, sr * 2, sr * 2);
      }
    }
  }
  for (let i = 0; i < 18000; i++) {
    sdctx.fillStyle = rand() > 0.5 ? 'rgba(242,226,196,0.24)' : 'rgba(138,112,72,0.2)';
    sdctx.fillRect(rand() * 512, rand() * 512, 1.5, 1.5);
  }
  const sand = register(sandCanvas, 1, 1, true);

  const sandNormCanvas = heightMapToNormalCanvas(
    256,
    (x, y) => {
      const u = (x / 256) * Math.PI * 2;
      const v = (y / 256) * Math.PI * 2;
      const ripple = Math.sin(v * 10 + Math.sin(u * 2) * 1.4) * 0.35;
      const grain = (((x * 59 + y * 107) % 13) / 13 - 0.5) * 0.25;
      return ripple + grain;
    },
    0.85
  );
  const sandNormal = register(sandNormCanvas, 6, 6, false);

  // 4. Turquoise Ocean Albedo + Seamless Wave Normal Map
  const oceanCanvas = document.createElement('canvas');
  oceanCanvas.width = 256;
  oceanCanvas.height = 256;
  const octx = oceanCanvas.getContext('2d')!;
  const grad = octx.createLinearGradient(0, 0, 256, 256);
  grad.addColorStop(0, '#06b6d4');
  grad.addColorStop(0.5, '#0284c7');
  grad.addColorStop(1, '#0369a1');
  octx.fillStyle = grad;
  octx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 44; i++) {
    octx.strokeStyle = 'rgba(224, 242, 254, 0.2)';
    octx.lineWidth = 1.6;
    const y = (i / 44) * 256;
    octx.beginPath();
    octx.moveTo(0, y);
    octx.bezierCurveTo(64, y - 6, 192, y + 6, 256, y);
    octx.stroke();
  }
  const ocean = register(oceanCanvas, 20, 20, true);

  const oceanNormCanvas = heightMapToNormalCanvas(
    256,
    (x, y) => {
      const u = (x / 256) * Math.PI * 2;
      const v = (y / 256) * Math.PI * 2;
      return (
        Math.sin(u * 3 + v * 2) * 0.45 +
        Math.cos(u * 5 - v * 4) * 0.3 +
        Math.sin(u * 9 + v * 7) * 0.18
      );
    },
    1.8
  );
  const oceanNormal = register(oceanNormCanvas, 28, 28, false);

  // 5. GTA-Grade Glass Skyscraper Windows (Albedo + Emissive Map)
  const modCanvas = document.createElement('canvas');
  modCanvas.width = 512;
  modCanvas.height = 512;
  const mctx = modCanvas.getContext('2d')!;
  const modEmisCanvas = document.createElement('canvas');
  modEmisCanvas.width = 512;
  modEmisCanvas.height = 512;
  const mectx = modEmisCanvas.getContext('2d')!;

  mctx.fillStyle = '#182234';
  mctx.fillRect(0, 0, 512, 512);
  mectx.fillStyle = '#000000';
  mectx.fillRect(0, 0, 512, 512);

  for (let y = 10; y < 502; y += 32) {
    mctx.fillStyle = '#0f172a';
    mctx.fillRect(0, y + 24, 512, 8);
    for (let x = 8; x < 504; x += 28) {
      const r = Math.random();
      const glassGrad = mctx.createLinearGradient(x, y, x + 22, y + 22);
      if (r > 0.7) {
        const warm = r > 0.87;
        glassGrad.addColorStop(0, warm ? '#fde68a' : '#7dd3fc');
        glassGrad.addColorStop(1, warm ? '#f59e0b' : '#38bdf8');
        mectx.fillStyle = warm ? 'rgba(253, 224, 130, 0.72)' : 'rgba(125, 211, 252, 0.55)';
        mectx.fillRect(x + 1, y + 1, 20, 21);
      } else {
        glassGrad.addColorStop(0, '#334155');
        glassGrad.addColorStop(0.5, '#1e293b');
        glassGrad.addColorStop(1, '#475569');
      }
      mctx.fillStyle = glassGrad;
      mctx.fillRect(x, y, 22, 23);
      mctx.fillStyle = 'rgba(255,255,255,0.12)';
      mctx.fillRect(x, y, 22, 2);
    }
  }
  const buildingModern = register(modCanvas, 1, 2, true);
  const buildingModernEmissive = register(modEmisCanvas, 1, 2, true);

  // 6. Art Deco Pastel Coastal Hotel Facade (Albedo + Emissive Map)
  const decoCanvas = document.createElement('canvas');
  decoCanvas.width = 512;
  decoCanvas.height = 512;
  const dctx = decoCanvas.getContext('2d')!;
  const decoEmisCanvas = document.createElement('canvas');
  decoEmisCanvas.width = 512;
  decoEmisCanvas.height = 512;
  const dectx = decoEmisCanvas.getContext('2d')!;

  dctx.fillStyle = '#f5efe6';
  dctx.fillRect(0, 0, 512, 512);
  dectx.fillStyle = '#000000';
  dectx.fillRect(0, 0, 512, 512);

  dctx.fillStyle = '#f472b6';
  dctx.fillRect(0, 14, 512, 14);
  dctx.fillStyle = '#2dd4bf';
  dctx.fillRect(0, 34, 512, 8);
  dectx.fillStyle = 'rgba(244, 114, 182, 0.4)';
  dectx.fillRect(0, 14, 512, 14);

  for (let y = 72; y < 480; y += 72) {
    for (let x = 24; x < 488; x += 68) {
      dctx.fillStyle = '#1e293b';
      dctx.fillRect(x, y, 42, 46);
      const lit = Math.random() > 0.45;
      dctx.fillStyle = lit ? '#fed7aa' : '#93c5fd';
      dctx.fillRect(x + 4, y + 4, 34, 38);
      if (lit) {
        dectx.fillStyle = 'rgba(253, 186, 116, 0.65)';
        dectx.fillRect(x + 4, y + 4, 34, 38);
      }
    }
  }
  const buildingArtDeco = register(decoCanvas, 1, 1, true);
  const buildingArtDecoEmissive = register(decoEmisCanvas, 1, 1, true);

  // 7. Industrial Warehouse Facade
  const indCanvas = document.createElement('canvas');
  indCanvas.width = 256;
  indCanvas.height = 256;
  const ictx = indCanvas.getContext('2d')!;
  ictx.fillStyle = '#475569';
  ictx.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x += 16) {
    ictx.fillStyle = x % 32 === 0 ? '#3b475a' : '#56647a';
    ictx.fillRect(x, 0, 14, 256);
  }
  ictx.fillStyle = '#f59e0b';
  ictx.fillRect(0, 210, 256, 12);
  const buildingIndustrial = register(indCanvas, 2, 1, true);

  // 8. Soft Radial Contact Shadow
  const shadCanvas = document.createElement('canvas');
  shadCanvas.width = 128;
  shadCanvas.height = 128;
  const shctx = shadCanvas.getContext('2d')!;
  const rgrad = shctx.createRadialGradient(64, 64, 4, 64, 64, 60);
  rgrad.addColorStop(0, 'rgba(0,0,0,0.62)');
  rgrad.addColorStop(0.55, 'rgba(0,0,0,0.26)');
  rgrad.addColorStop(1, 'rgba(0,0,0,0)');
  shctx.fillStyle = rgrad;
  shctx.fillRect(0, 0, 128, 128);
  const contactShadow = new THREE.CanvasTexture(shadCanvas);
  contactShadow.generateMipmaps = true;
  contactShadow.minFilter = THREE.LinearMipmapLinearFilter;
  contactShadow.magFilter = THREE.LinearFilter;
  contactShadow.needsUpdate = true;
  created.push(contactShadow);

  return {
    asphalt,
    highwayAsphalt,
    asphaltNormal,
    dirtTrail,
    meadowGrass,
    grassNormal,
    parkingLot,
    sidewalk,
    sidewalkNormal,
    sand,
    sandNormal,
    ocean,
    oceanNormal,
    buildingModern,
    buildingModernEmissive,
    buildingArtDeco,
    buildingArtDecoEmissive,
    buildingIndustrial,
    contactShadow,
    dispose: () => {
      created.forEach((t) => t.dispose());
    },
  };
}
