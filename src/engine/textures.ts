import * as THREE from 'three';

export interface ProceduralTextureSet {
  asphalt: THREE.CanvasTexture;
  asphaltNormal: THREE.CanvasTexture;
  sidewalk: THREE.CanvasTexture;
  sand: THREE.CanvasTexture;
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

  const register = (canvas: HTMLCanvasElement, repeatX = 1, repeatY = 1, isColor = true) => {
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
    tex.anisotropy = Math.min(8, maxAnisotropy || 1);
    if (isColor) {
      tex.colorSpace = THREE.SRGBColorSpace;
    }
    created.push(tex);
    return tex;
  };

  // 1. GTA-Grade Asphalt Road Texture + Tangent Normal Map
  const asphaltCanvas = document.createElement('canvas');
  asphaltCanvas.width = 512;
  asphaltCanvas.height = 512;
  const actx = asphaltCanvas.getContext('2d')!;
  actx.fillStyle = '#20252e';
  actx.fillRect(0, 0, 512, 512);

  // Subtle worn tire track bands
  const trackGradL = actx.createLinearGradient(80, 0, 210, 0);
  trackGradL.addColorStop(0, 'rgba(15,18,24,0)');
  trackGradL.addColorStop(0.5, 'rgba(12,15,20,0.34)');
  trackGradL.addColorStop(1, 'rgba(15,18,24,0)');
  actx.fillStyle = trackGradL;
  actx.fillRect(80, 0, 130, 512);

  const trackGradR = actx.createLinearGradient(300, 0, 430, 0);
  trackGradR.addColorStop(0, 'rgba(15,18,24,0)');
  trackGradR.addColorStop(0.5, 'rgba(12,15,20,0.34)');
  trackGradR.addColorStop(1, 'rgba(15,18,24,0)');
  actx.fillStyle = trackGradR;
  actx.fillRect(300, 0, 130, 512);

  for (let i = 0; i < 11000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const v = 26 + Math.floor(Math.random() * 32);
    actx.fillStyle = `rgb(${v},${v + 2},${v + 5})`;
    actx.fillRect(x, y, 2, 2);
  }
  // Crisp outer white lines & double yellow center dashes
  actx.fillStyle = '#f1f5f9';
  actx.fillRect(14, 0, 10, 512);
  actx.fillRect(488, 0, 10, 512);
  actx.fillStyle = '#facc15';
  for (let y = 12; y < 512; y += 64) {
    actx.fillRect(247, y, 6, 38);
    actx.fillRect(259, y, 6, 38);
  }
  const asphalt = register(asphaltCanvas, 1, 1, true);

  const asphaltNormCanvas = heightMapToNormalCanvas(
    256,
    (x, y) => {
      const n = Math.sin(x * 1.9 + y * 0.7) * Math.cos(y * 2.1 - x * 0.5);
      return n * 0.5 + (((x * 73 + y * 137) % 19) / 19 - 0.5);
    },
    1.1
  );
  const asphaltNormal = register(asphaltNormCanvas, 2, 2, false);

  // 2. Sidewalk Promenade Paving Stone Grid
  const swCanvas = document.createElement('canvas');
  swCanvas.width = 256;
  swCanvas.height = 256;
  const sctx = swCanvas.getContext('2d')!;
  sctx.fillStyle = '#a4adb9';
  sctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 64) {
    for (let x = 0; x < 256; x += 64) {
      const shade = 152 + ((x * 7 + y * 13) % 16);
      sctx.fillStyle = `rgb(${shade},${shade + 5},${shade + 12})`;
      sctx.fillRect(x + 2, y + 2, 60, 60);
    }
  }
  sctx.strokeStyle = '#64748b';
  sctx.lineWidth = 3;
  for (let i = 0; i <= 256; i += 64) {
    sctx.beginPath();
    sctx.moveTo(i, 0);
    sctx.lineTo(i, 256);
    sctx.stroke();
    sctx.beginPath();
    sctx.moveTo(0, i);
    sctx.lineTo(256, i);
    sctx.stroke();
  }
  for (let i = 0; i < 1600; i++) {
    sctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
    sctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  const sidewalk = register(swCanvas, 22, 22, true);

  // 3. Golden Beach Sand with Ripples
  const sandCanvas = document.createElement('canvas');
  sandCanvas.width = 256;
  sandCanvas.height = 256;
  const sdctx = sandCanvas.getContext('2d')!;
  sdctx.fillStyle = '#e7cda3';
  sdctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 8) {
    sdctx.strokeStyle = 'rgba(186, 148, 92, 0.14)';
    sdctx.lineWidth = 2;
    sdctx.beginPath();
    sdctx.moveTo(0, y);
    sdctx.bezierCurveTo(64, y - 3, 192, y + 3, 256, y);
    sdctx.stroke();
  }
  for (let i = 0; i < 4200; i++) {
    sdctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,244,220,0.22)' : 'rgba(176,142,92,0.18)';
    sdctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  const sand = register(sandCanvas, 16, 16, true);

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
    // Structural floor slab spandrel
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

      // Subtle window mullion highlight
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
  created.push(contactShadow);

  return {
    asphalt,
    asphaltNormal,
    sidewalk,
    sand,
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
