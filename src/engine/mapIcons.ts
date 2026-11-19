import type { ShopDef } from '../types/game';

/**
 * Draws a crisp, expressive rounded pin/badge with a custom vector icon inside
 * for every shop and accessible building category on both the full interactive map
 * and the HUD minimap.
 */
export function drawShopMapIcon(
  ctx: CanvasRenderingContext2D,
  category: ShopDef['category'],
  x: number,
  y: number,
  color: string,
  size = 10,
  isHighlighted = false,
): void {
  ctx.save();
  ctx.translate(x, y);

  // Subtle shadow & highlight halo
  if (isHighlighted) {
    ctx.beginPath();
    ctx.arc(0, 0, size * 1.48, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }

  // Outer badge circle
  ctx.beginPath();
  ctx.arc(0, 0, size, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = Math.max(1.25, size * 0.16);
  ctx.strokeStyle = '#070b14';
  ctx.stroke();

  // Inner subtle gloss rim
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.84, 0, Math.PI * 2);
  ctx.lineWidth = 0.7;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.32)';
  ctx.stroke();

  // Draw crisp white vector glyph inside
  const s = size * 0.56;
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1.2, size * 0.16);

  switch (category) {
    case 'hospital': {
      // Bold medical cross
      const t = s * 0.38;
      ctx.fillRect(-t, -s, t * 2, s * 2);
      ctx.fillRect(-s, -t, s * 2, t * 2);
      break;
    }
    case 'police_station': {
      // Police shield + central star dot
      ctx.beginPath();
      ctx.moveTo(0, -s * 1.05);
      ctx.lineTo(s * 0.88, -s * 0.62);
      ctx.lineTo(s * 0.74, s * 0.24);
      ctx.quadraticCurveTo(0, s * 1.08, 0, s * 1.08);
      ctx.quadraticCurveTo(0, s * 1.08, -s * 0.74, s * 0.24);
      ctx.lineTo(-s * 0.88, -s * 0.62);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -s * 0.08, s * 0.26, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'fire_station': {
      // Stylized flame silhouette
      ctx.beginPath();
      ctx.moveTo(0, -s * 1.05);
      ctx.bezierCurveTo(s * 0.75, -s * 0.35, s * 0.95, s * 0.45, 0, s * 1.0);
      ctx.bezierCurveTo(-s * 0.95, s * 0.45, -s * 0.75, -s * 0.35, 0, -s * 1.05);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, s * 0.34, s * 0.26, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      break;
    }
    case 'weapons': {
      // Tactical crosshair target
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.72, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -s * 1.05);
      ctx.lineTo(0, -s * 0.35);
      ctx.moveTo(0, s * 0.35);
      ctx.lineTo(0, s * 1.05);
      ctx.moveTo(-s * 1.05, 0);
      ctx.lineTo(-s * 0.35, 0);
      ctx.moveTo(s * 0.35, 0);
      ctx.lineTo(s * 1.05, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.18, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'wardrobe': {
      // Stylish t-shirt / jacket silhouette
      ctx.beginPath();
      ctx.moveTo(-s * 0.42, -s * 0.85);
      ctx.lineTo(-s * 1.02, -s * 0.35);
      ctx.lineTo(-s * 0.78, s * 0.08);
      ctx.lineTo(-s * 0.52, -s * 0.08);
      ctx.lineTo(-s * 0.52, s * 0.92);
      ctx.lineTo(s * 0.52, s * 0.92);
      ctx.lineTo(s * 0.52, -s * 0.08);
      ctx.lineTo(s * 0.78, s * 0.08);
      ctx.lineTo(s * 1.02, -s * 0.35);
      ctx.lineTo(s * 0.42, -s * 0.85);
      ctx.quadraticCurveTo(0, -s * 0.56, -s * 0.42, -s * 0.85);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'supplies': {
      // Shopping bag with handle
      ctx.beginPath();
      ctx.rect(-s * 0.72, -s * 0.35, s * 1.44, s * 1.25);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, -s * 0.38, s * 0.42, Math.PI, 0);
      ctx.stroke();
      break;
    }
    case 'safehouse': {
      // Villa / house with roof + door
      ctx.beginPath();
      ctx.moveTo(0, -s * 1.0);
      ctx.lineTo(s * 0.95, -s * 0.12);
      ctx.lineTo(s * 0.68, -s * 0.12);
      ctx.lineTo(s * 0.68, s * 0.88);
      ctx.lineTo(-s * 0.68, s * 0.88);
      ctx.lineTo(-s * 0.68, -s * 0.12);
      ctx.lineTo(-s * 0.95, -s * 0.12);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = color;
      ctx.fillRect(-s * 0.2, s * 0.25, s * 0.4, s * 0.63);
      break;
    }
    case 'garage': {
      // Wrench silhouette
      ctx.beginPath();
      ctx.moveTo(-s * 0.68, s * 0.68);
      ctx.lineTo(s * 0.32, -s * 0.32);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(s * 0.48, -s * 0.48, s * 0.42, 0.35 * Math.PI, 1.85 * Math.PI);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-s * 0.68, s * 0.68, s * 0.24, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'barber': {
      // Crossed scissors blades + finger loops
      ctx.beginPath();
      ctx.moveTo(-s * 0.42, s * 0.56);
      ctx.lineTo(s * 0.68, -s * 0.72);
      ctx.moveTo(s * 0.42, s * 0.56);
      ctx.lineTo(-s * 0.68, -s * 0.72);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-s * 0.55, s * 0.68, s * 0.28, 0, Math.PI * 2);
      ctx.arc(s * 0.55, s * 0.68, s * 0.28, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'tattoo': {
      // 4-point ink star / tattoo needle diamond
      ctx.beginPath();
      ctx.moveTo(0, -s * 1.05);
      ctx.lineTo(s * 0.28, -s * 0.28);
      ctx.lineTo(s * 1.05, 0);
      ctx.lineTo(s * 0.28, s * 0.28);
      ctx.lineTo(0, s * 1.05);
      ctx.lineTo(-s * 0.28, s * 0.28);
      ctx.lineTo(-s * 1.05, 0);
      ctx.lineTo(-s * 0.28, -s * 0.28);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.18, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      break;
    }
  }

  ctx.restore();
}
