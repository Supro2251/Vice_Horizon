import React, { useEffect, useRef, useState } from 'react';
import { Anchor, Lock, MapPin, Navigation, Plane, Trash2, X } from 'lucide-react';
import {
  GpsPoint,
  GpsWaypoint,
  HudTelemetry,
  LanguageCode,
  MissionDef,
  MissionProgressRecord,
  ShopDef,
} from '../types/game';
import { isMissionUnlocked, MISSIONS, SHOPS } from '../data/defaults';
import {
  BRIDGE_SPANS,
  getIslandOutlinePoints,
  OVERPASS_SPANS,
  PARKING_LOTS,
  RoadSegmentDef,
} from '../engine/navigation';
import { drawShopMapIcon } from '../engine/mapIcons';
import { t } from '../i18n/translations';

interface MapModalProps {
  telemetry: HudTelemetry;
  missionsProgress: Record<string, MissionProgressRecord>;
  roadSegments: RoadSegmentDef[];
  buildingFootprints: { x: number; z: number; w: number; d: number; color: string }[];
  accentColor: string;
  lang: LanguageCode;
  onSetGps: (x: number, z: number, label: string) => void;
  onClearGps: () => void;
  onStartMission: (missionId: string) => void;
  onClose: () => void;
}

const WORLD_MIN = -1820;
const WORLD_MAX = 1820;
const ISLAND_COAST = getIslandOutlinePoints(140);

type HoveredPoi =
  | { kind: 'shop'; shop: ShopDef; screenX: number; screenY: number }
  | { kind: 'mission'; mission: MissionDef; unlocked: boolean; screenX: number; screenY: number };

export const MapModal: React.FC<MapModalProps> = ({
  telemetry,
  missionsProgress,
  roadSegments,
  buildingFootprints,
  accentColor,
  lang,
  onSetGps,
  onClearGps,
  onStartMission,
  onClose,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hoverCoords, setHoverCoords] = useState<{ x: number; z: number } | null>(null);
  const [hoveredPoi, setHoveredPoi] = useState<HoveredPoi | null>(null);

  const orderedMissions = [...MISSIONS].sort((a, b) => a.storyOrder - b.storyOrder);

  const worldToCanvas = (wx: number, wz: number, width: number, height: number) => {
    const nx = (wx - WORLD_MIN) / (WORLD_MAX - WORLD_MIN);
    const nz = (wz - WORLD_MIN) / (WORLD_MAX - WORLD_MIN);
    return { x: nx * width, y: nz * height };
  };

  const canvasToWorld = (cx: number, cy: number, width: number, height: number) => {
    const wx = WORLD_MIN + (cx / width) * (WORLD_MAX - WORLD_MIN);
    const wz = WORLD_MIN + (cy / height) * (WORLD_MAX - WORLD_MIN);
    return { x: Math.round(wx), z: Math.round(wz) };
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const scale = w / (WORLD_MAX - WORLD_MIN);

    // 1. Deep Ocean Gradient Surrounding Entire 5x Island
    const seaGrad = ctx.createRadialGradient(w * 0.5, h * 0.5, w * 0.25, w * 0.5, h * 0.5, w * 0.72);
    seaGrad.addColorStop(0, '#0a3a5c');
    seaGrad.addColorStop(1, '#041729');
    ctx.fillStyle = seaGrad;
    ctx.fillRect(0, 0, w, h);

    // Subtle nautical bathymetry ring around coast
    ctx.beginPath();
    ISLAND_COAST.forEach((pt, idx) => {
      const p = worldToCanvas(pt.x * 1.045, pt.z * 1.045, w, h);
      if (idx === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
    ctx.fill();

    // 2. Organic Island Sandy Perimeter
    ctx.beginPath();
    ISLAND_COAST.forEach((pt, idx) => {
      const p = worldToCanvas(pt.x, pt.z, w, h);
      if (idx === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.fillStyle = '#b99b6b';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 245, 224, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 3. Inner Island Urban & Green Landmass
    ctx.beginPath();
    ISLAND_COAST.forEach((pt, idx) => {
      const p = worldToCanvas(pt.x * 0.935, pt.z * 0.935, w, h);
      if (idx === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.fillStyle = '#172233';
    ctx.fill();

    // Northern foothills green parks
    const foothill = worldToCanvas(0, -1040, w, h);
    ctx.fillStyle = '#1d3629';
    ctx.beginPath();
    ctx.ellipse(foothill.x, foothill.y, 760 * scale, 220 * scale, 0, 0, Math.PI * 2);
    ctx.fill();

    // 4. Vice Canal (x: -340..1560, z: 392..468) & North Emerald River (x: -820..860, z: -815..-765)
    const canalTL = worldToCanvas(-340, 392, w, h);
    ctx.fillStyle = '#0369a1';
    ctx.fillRect(canalTL.x, canalTL.y, 1900 * scale, 76 * scale);
    const northRiverTL = worldToCanvas(-820, -815, w, h);
    ctx.fillRect(northRiverTL.x, northRiverTL.y, 1680 * scale, 50 * scale);

    // 5. Marina Harbor Basin (x: 560..1280, z: 620..1120)
    const marinaTL = worldToCanvas(560, 620, w, h);
    ctx.fillStyle = '#0369a1';
    ctx.fillRect(marinaTL.x, marinaTL.y, 720 * scale, 500 * scale);

    // Marina Wooden Piers
    ctx.fillStyle = '#7c5838';
    const pier1 = worldToCanvas(550, 668, w, h);
    ctx.fillRect(pier1.x, pier1.y, 175 * scale, 22 * scale);
    const pier2 = worldToCanvas(550, 745, w, h);
    ctx.fillRect(pier2.x, pier2.y, 175 * scale, 22 * scale);

    // 6. Bayshore International Airport Runways (-1350..-570, z: 774..806 & z: 906..934)
    const runway1TL = worldToCanvas(-1350, 774, w, h);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(runway1TL.x, runway1TL.y, 780 * scale, 32 * scale);
    const runway2TL = worldToCanvas(-1320, 906, w, h);
    ctx.fillRect(runway2TL.x, runway2TL.y, 720 * scale, 28 * scale);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(runway1TL.x + 4, runway1TL.y + 16 * scale);
    ctx.lineTo(runway1TL.x + 780 * scale - 4, runway1TL.y + 16 * scale);
    ctx.stroke();
    ctx.setLineDash([]);

    // Parking Lots
    ctx.fillStyle = '#1e293b';
    for (const lot of PARKING_LOTS) {
      const lp = worldToCanvas(lot.x - lot.width * 0.5, lot.z - lot.depth * 0.5, w, h);
      ctx.fillRect(lp.x, lp.y, lot.width * scale, lot.depth * scale);
    }

    // 7. Curved Road Network, Dirt Trails & Highways
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const seg of roadSegments) {
      if (seg.points.length < 2) continue;
      ctx.beginPath();
      seg.points.forEach((pt, idx) => {
        const c = worldToCanvas(pt.x, pt.z, w, h);
        if (idx === 0) ctx.moveTo(c.x, c.y);
        else ctx.lineTo(c.x, c.y);
      });
      if (seg.closed) ctx.closePath();
      ctx.strokeStyle = seg.isDirtTrail ? '#5c4936' : seg.isHighway ? '#3a4a63' : '#263348';
      ctx.lineWidth = Math.max(1.5, seg.width * scale);
      ctx.stroke();

      if (seg.isHighway) {
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.35)';
        ctx.lineWidth = 1.0;
        ctx.stroke();
      }
    }

    // Bridge Decks & Overpasses
    for (const b of BRIDGE_SPANS) {
      const bp = worldToCanvas(b.x - b.width * 0.5, b.zStart, w, h);
      ctx.fillStyle = '#5a6b82';
      ctx.fillRect(bp.x, bp.y, Math.max(2, b.width * scale), (b.zEnd - b.zStart) * scale);
    }
    for (const ov of OVERPASS_SPANS) {
      const ox = ov.axis === 'x' ? ov.centerX - ov.length * 0.5 : ov.centerX - ov.width * 0.5;
      const oz = ov.axis === 'x' ? ov.centerZ - ov.width * 0.5 : ov.centerZ - ov.length * 0.5;
      const ow = ov.axis === 'x' ? ov.length : ov.width;
      const od = ov.axis === 'x' ? ov.width : ov.length;
      const op = worldToCanvas(ox, oz, w, h);
      ctx.fillStyle = '#64748b';
      ctx.fillRect(op.x, op.y, Math.max(2, ow * scale), Math.max(2, od * scale));
    }

    // 8. Buildings
    for (const b of buildingFootprints) {
      const p = worldToCanvas(b.x - b.w / 2, b.z - b.d / 2, w, h);
      ctx.fillStyle = '#3b4a62';
      ctx.fillRect(p.x, p.y, Math.max(1.2, b.w * scale), Math.max(1.2, b.d * scale));
    }

    // District Labels
    ctx.font = '700 10px Inter, sans-serif';
    ctx.fillStyle = 'rgba(226,232,240,0.5)';
    ctx.textAlign = 'center';
    const labels: [string, number, number][] = [
      ['DOWNTOWN CORE', -40, -140],
      ['CORAL STRIP', 660, -140],
      ['NORTH HEIGHTS', 20, -1040],
      ['BAYSHORE AIRPORT', -960, 860],
      ['MARINA HARBOR', 760, 820],
      ['VICE CANAL', 420, 430],
      ['VICE OCEAN', 1420, -1260],
    ];
    for (const [text, lx, lz] of labels) {
      const pt = worldToCanvas(lx, lz, w, h);
      ctx.fillText(text, pt.x, pt.y);
    }

    // 9. Active GPS Route Line
    if (telemetry.gpsRoute.length > 1) {
      ctx.strokeStyle = telemetry.activeMissionTitle ? '#f59e0b' : '#38bdf8';
      ctx.lineWidth = 3.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      telemetry.gpsRoute.forEach((pt: GpsPoint, idx: number) => {
        const c = worldToCanvas(pt.x, pt.z, w, h);
        if (idx === 0) ctx.moveTo(c.x, c.y);
        else ctx.lineTo(c.x, c.y);
      });
      ctx.stroke();
    }

    // 10. Blips (vehicles, aircraft, parking, friends, side missions)
    for (const blip of telemetry.minimapBlips) {
      const p = worldToCanvas(blip.x, blip.z, w, h);
      if (blip.type === 'plane' || blip.type === 'fighter_jet') {
        ctx.fillStyle = blip.type === 'fighter_jet' ? '#fb7185' : '#f8fafc';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - 5);
        ctx.lineTo(p.x + 5, p.y + 4);
        ctx.lineTo(p.x - 5, p.y + 4);
        ctx.closePath();
        ctx.fill();
      } else if (blip.type === 'helicopter') {
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p.x - 5, p.y);
        ctx.lineTo(p.x + 5, p.y);
        ctx.stroke();
      } else if (blip.type === 'boat') {
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - 4.5);
        ctx.lineTo(p.x + 4, p.y);
        ctx.lineTo(p.x, p.y + 4.5);
        ctx.lineTo(p.x - 4, p.y);
        ctx.closePath();
        ctx.fill();
      } else if (blip.type === 'taxi') {
        ctx.fillStyle = '#facc15';
        ctx.fillRect(p.x - 2.5, p.y - 2.5, 5, 5);
      } else if (blip.type === 'motorcycle') {
        ctx.fillStyle = '#c084fc';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.8, 0, Math.PI * 2);
        ctx.fill();
      } else if (blip.type === 'parking') {
        ctx.fillStyle = '#1e40af';
        ctx.fillRect(p.x - 4.5, p.y - 4.5, 9, 9);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 7px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('P', p.x, p.y + 2.5);
      } else if (blip.type === 'side_mission') {
        ctx.fillStyle = '#a855f7';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      } else if (blip.type === 'friend') {
        ctx.fillStyle = '#22c55e';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else if (blip.type === 'vehicle') {
        ctx.fillStyle = '#94a3b8';
        ctx.fillRect(p.x - 1.8, p.y - 1.8, 3.6, 3.6);
      }
    }

    // 11. Expressive Vector Icons for All Shops & Accessible Buildings
    const hoveredShopId = hoveredPoi?.kind === 'shop' ? hoveredPoi.shop.id : null;
    for (const shop of SHOPS) {
      const p = worldToCanvas(shop.x, shop.z, w, h);
      const active = hoveredShopId === shop.id;
      drawShopMapIcon(ctx, shop.category, p.x, p.y, shop.color, active ? 13 : 10.5, active);
    }

    // 12. Sequential Story Missions on Map
    const hoveredMissionId = hoveredPoi?.kind === 'mission' ? hoveredPoi.mission.id : null;
    for (const m of orderedMissions) {
      const unlocked = isMissionUnlocked(m.id, missionsProgress);
      const done = (missionsProgress[m.id]?.completedCount ?? 0) > 0;
      const p = worldToCanvas(m.startX, m.startZ, w, h);
      const isHovered = hoveredMissionId === m.id;

      ctx.beginPath();
      ctx.arc(p.x, p.y, isHovered ? 12 : 9.5, 0, Math.PI * 2);
      ctx.fillStyle = !unlocked ? '#334155' : done ? '#10b981' : '#f59e0b';
      ctx.fill();
      ctx.strokeStyle = isHovered ? '#ffffff' : '#090d16';
      ctx.lineWidth = isHovered ? 2.5 : 2;
      ctx.stroke();

      ctx.fillStyle = '#090d16';
      ctx.font = 'bold 10px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(m.storyOrder), p.x, p.y + 0.5);
    }
    ctx.textBaseline = 'alphabetic';

    // 13. Custom GPS Waypoint Pin
    const wp: GpsWaypoint | null = telemetry.gpsWaypoint;
    if (wp) {
      const p = worldToCanvas(wp.x, wp.z, w, h);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.strokeStyle = telemetry.activeMissionTitle ? '#fbbf24' : '#38bdf8';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    // 14. Player Directional Chevron
    const pl = worldToCanvas(telemetry.playerX, telemetry.playerZ, w, h);
    ctx.save();
    ctx.translate(pl.x, pl.y);
    ctx.rotate(-telemetry.playerHeading + Math.PI);
    ctx.fillStyle = accentColor;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, -8.5);
    ctx.lineTo(6.5, 6.5);
    ctx.lineTo(0, 3);
    ctx.lineTo(-6.5, 6.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }, [telemetry, missionsProgress, roadSegments, buildingFootprints, accentColor, orderedMissions, hoveredPoi]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const cy = ((e.clientY - rect.top) / rect.height) * canvas.height;
    const world = canvasToWorld(cx, cy, canvas.width, canvas.height);

    // Snap if clicked close to a Shop or Parking Lot
    for (const s of SHOPS) {
      if (Math.hypot(s.x - world.x, s.z - world.z) < 62) {
        onSetGps(s.doorX, s.doorZ, s.name);
        return;
      }
    }
    for (const lot of PARKING_LOTS) {
      if (Math.hypot(lot.x - world.x, lot.z - world.z) < 55) {
        onSetGps(lot.x, lot.z, lot.name);
        return;
      }
    }
    // Snap if clicked close to an unlocked Story Mission
    for (const m of orderedMissions) {
      if (
        isMissionUnlocked(m.id, missionsProgress) &&
        Math.hypot(m.startX - world.x, m.startZ - world.z) < 68
      ) {
        onSetGps(m.startX, m.startZ, m.title);
        return;
      }
    }

    onSetGps(world.x, world.z, t(lang, 'map.customPin', { x: world.x, z: world.z }));
  };

  const handleCanvasMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const cy = ((e.clientY - rect.top) / rect.height) * canvas.height;
    const world = canvasToWorld(cx, cy, canvas.width, canvas.height);
    setHoverCoords(world);

    const relX = e.clientX - rect.left;
    const relY = e.clientY - rect.top;

    for (const s of SHOPS) {
      if (Math.hypot(s.x - world.x, s.z - world.z) < 62) {
        setHoveredPoi({ kind: 'shop', shop: s, screenX: relX, screenY: relY });
        return;
      }
    }
    for (const m of orderedMissions) {
      if (Math.hypot(m.startX - world.x, m.startZ - world.z) < 68) {
        setHoveredPoi({
          kind: 'mission',
          mission: m,
          unlocked: isMissionUnlocked(m.id, missionsProgress),
          screenX: relX,
          screenY: relY,
        });
        return;
      }
    }
    setHoveredPoi(null);
  };

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/90 p-4 md:p-6">
      <div className="w-full max-w-6xl max-h-[92vh] flex flex-col bg-[#0b101b] border border-white/12 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-bold text-white flex items-center gap-2.5">
              <Navigation className="w-6 h-6" style={{ color: accentColor }} />
              {t(lang, 'map.title')}
            </h2>
            <p className="text-xs text-slate-400">
              {t(lang, 'map.subtitle')}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {telemetry.gpsWaypoint && (
              <button
                onClick={onClearGps}
                className="px-3 py-2 rounded-lg text-xs font-medium bg-rose-500/15 text-rose-300 border border-rose-500/30 hover:bg-rose-500/25 flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {t(lang, 'map.clearWaypoint')}
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
              aria-label={t(lang, 'settings.close')}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body: Left Interactive Map Canvas, Right Directory */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
          <div className="lg:col-span-8 p-4 bg-[#070b13] flex flex-col items-center justify-center relative">
            <div className="relative flex items-center justify-center">
              <canvas
                ref={canvasRef}
                width={660}
                height={660}
                onClick={handleCanvasClick}
                onMouseMove={handleCanvasMove}
                onMouseLeave={() => {
                  setHoverCoords(null);
                  setHoveredPoi(null);
                }}
                className={`w-full max-w-[64vh] aspect-square rounded-xl border border-white/10 object-contain ${
                  hoveredPoi ? 'cursor-pointer' : 'cursor-crosshair'
                }`}
              />

              {/* Hover Tooltip */}
              {hoveredPoi && (
                <div
                  className="pointer-events-none absolute z-10 px-3 py-2 rounded-lg bg-[#0b101b] border border-white/20 shadow-xl text-left max-w-[240px]"
                  style={{
                    left: Math.min(360, hoveredPoi.screenX + 14),
                    top: Math.max(8, hoveredPoi.screenY - 14),
                  }}
                >
                  {hoveredPoi.kind === 'shop' ? (
                    <>
                      <div className="text-xs font-bold text-white flex items-center gap-1.5">
                        <span
                          className="w-2.5 h-2.5 rounded-full inline-block shrink-0"
                          style={{ backgroundColor: hoveredPoi.shop.color }}
                        />
                        {hoveredPoi.shop.name}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        {hoveredPoi.shop.subtitle}
                      </div>
                      <div className="text-[10px] font-semibold text-sky-400 mt-1">
                        {t(lang, 'map.clickGps')}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-xs font-bold text-amber-300">
                        {hoveredPoi.mission.requiresGslCourier
                          ? t(lang, 'mission.gsl.title')
                          : hoveredPoi.mission.title}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        {hoveredPoi.unlocked
                          ? t(lang, 'map.rewardStartGps', {
                              cash: hoveredPoi.mission.rewardCash.toLocaleString('en-US'),
                            })
                          : t(lang, 'map.lockedHint')}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Legend & Hover Coordinates */}
            <div className="mt-3 w-full flex flex-wrap items-center justify-between gap-3 text-[11px] text-slate-400 px-1">
              <div className="flex flex-wrap items-center gap-4">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" /> {t(lang, 'map.legendMission')}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-purple-500 border border-white inline-block" /> {t(lang, 'map.legendBarber')}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-teal-500 border border-white inline-block" /> {t(lang, 'map.legendTattoo')}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-sky-400 border border-white inline-block" /> {t(lang, 'map.legendSafehouse')}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Anchor className="w-3 h-3 text-sky-400" /> {t(lang, 'map.legendBoat')}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Plane className="w-3 h-3 text-slate-100" /> {t(lang, 'map.legendPlane')}
                </span>
              </div>
              {hoverCoords && (
                <span className="font-mono-tabular text-slate-300">
                  X {hoverCoords.x} · Z {hoverCoords.z}
                </span>
              )}
            </div>
          </div>

          {/* Right Sidebar: GPS Status, Shops, Story Missions */}
          <div className="lg:col-span-4 border-l border-white/10 p-4 overflow-y-auto space-y-5 bg-[#0b101b]">
            {telemetry.gpsWaypoint && (
              <div className="p-3.5 rounded-xl bg-sky-500/10 border border-sky-400/30 space-y-1">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-sky-400">
                  {t(lang, 'map.activeGps')}
                </div>
                <div className="text-sm font-bold text-white">{telemetry.gpsWaypoint.label}</div>
                <div className="text-xs font-mono-tabular text-slate-300">
                  {t(lang, 'map.distM', { m: telemetry.gpsDistanceM })}
                </div>
              </div>
            )}

            {/* Shops & Enterable Buildings */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" style={{ color: accentColor }} />
                {t(lang, 'map.shopsHeading')}
              </h3>
              <div className="space-y-2">
                {SHOPS.map((shop) => (
                  <button
                    key={shop.id}
                    onClick={() => {
                      onSetGps(shop.doorX, shop.doorZ, shop.name);
                    }}
                    className="w-full p-2.5 rounded-xl bg-slate-900/70 border border-white/8 hover:border-white/25 text-left flex items-center justify-between gap-2 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: shop.color }}
                        />
                        <span className="text-xs font-semibold text-white truncate">{shop.name}</span>
                      </div>
                      <div className="text-[11px] text-slate-400 truncate pl-4">{shop.subtitle}</div>
                    </div>
                    <Navigation className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                  </button>
                ))}
              </div>
            </div>

            {/* Sequential Story Chapters */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" style={{ color: accentColor }} />
                {t(lang, 'map.missionsHeading')}
              </h3>
              <div className="space-y-2">
                {orderedMissions.map((m) => {
                  const unlocked = isMissionUnlocked(m.id, missionsProgress);
                  const done = (missionsProgress[m.id]?.completedCount ?? 0) > 0;
                  const missionLabel = m.requiresGslCourier ? t(lang, 'mission.gsl.title') : m.title;
                  return (
                    <div
                      key={m.id}
                      className="p-2.5 rounded-xl bg-slate-900/70 border border-white/8 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                            {!unlocked && <Lock className="w-3 h-3 text-slate-500" />}
                            <span className={!unlocked ? 'text-slate-500' : ''}>{missionLabel}</span>
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {t(lang, 'missions.reward')}: ${m.rewardCash.toLocaleString('en-US')}
                            {done ? ' · OK' : !unlocked ? ` · ${t(lang, 'missions.locked')}` : ''}
                          </div>
                        </div>
                      </div>
                      {unlocked && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => onSetGps(m.startX, m.startZ, missionLabel)}
                            className="flex-1 py-1.5 px-2.5 rounded-lg text-[11px] font-medium bg-slate-800 text-sky-300 hover:bg-slate-700 flex items-center justify-center gap-1"
                          >
                            <Navigation className="w-3 h-3" />
                            {t(lang, 'map.gpsToStart')}
                          </button>
                          <button
                            onClick={() => {
                              onStartMission(m.id);
                              onClose();
                            }}
                            className="py-1.5 px-2.5 rounded-lg text-[11px] font-semibold text-slate-950"
                            style={{ backgroundColor: accentColor }}
                          >
                            {t(lang, 'map.launch')}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
