import React, { useEffect, useRef } from 'react';
import {
  Camera,
  ChevronDown,
  Clock,
  Cloud,
  CloudRain,
  Crosshair,
  Gamepad2,
  Map as MapIcon,
  MapPin,
  Navigation,
  Package,
  RotateCcw,
  Settings,
  Shield,
  Shirt,
  Smartphone,
  Star,
  Sun,
  Users,
} from 'lucide-react';
import {
  CameraMode,
  CharacterId,
  CharacterState,
  ControlSettings,
  GameplayModSettings,
  GraphicsSettings,
  HudModSettings,
  HudTelemetry,
} from '../types/game';
import { WEAPON_CATALOG } from '../data/defaults';
import { formatKeyCode, PLAYSTATION_GLYPHS, XBOX_GLYPHS } from '../engine/input';
import {
  BRIDGE_SPANS,
  getIslandOutlinePoints,
  OVERPASS_SPANS,
  PARKING_LOTS,
  RoadSegmentDef,
} from '../engine/navigation';
import { drawShopMapIcon } from '../engine/mapIcons';

interface GameHUDProps {
  telemetry: HudTelemetry;
  activeCharacter: CharacterState;
  characters: Record<CharacterId, CharacterState>;
  hudMod: HudModSettings;
  graphics: GraphicsSettings;
  controls: ControlSettings;
  gameplayMods: GameplayModSettings;
  dockOpen: boolean;
  roadSegments: RoadSegmentDef[];
  buildingFootprints: { x: number; z: number; w: number; d: number; color: string }[];
  onToggleDock: () => void;
  onCycleCamera: () => void;
  onOpenModal: (modal: 'character' | 'inventory' | 'wardrobe' | 'missions' | 'map' | 'settings') => void;
  onTogglePhone: () => void;
  onOpenCloud: () => void;
  onRequestLock: () => void;
  onRestartCleanSession?: () => void;
}

const CAMERA_LABELS: Record<CameraMode, string> = {
  first_person: '1. osoba',
  third_person: '3. osoba',
  third_person_far: '3. osoba (ďaleká)',
};

const ISLAND_MINIMAP_COAST = getIslandOutlinePoints(96);

export const GameHUD: React.FC<GameHUDProps> = ({
  telemetry,
  activeCharacter,
  hudMod,
  graphics,
  controls,
  gameplayMods,
  dockOpen,
  roadSegments,
  buildingFootprints,
  onToggleDock,
  onCycleCamera,
  onOpenModal,
  onTogglePhone,
  onOpenCloud,
  onRequestLock,
  onRestartCleanSession,
}) => {
  const radarCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Determine active glyph helper (PS4/PS5 vs Xbox vs Keyboard)
  const usePlaystation =
    controls.glyphMode === 'playstation' ||
    (controls.glyphMode === 'auto' && telemetry.controllerType === 'playstation');
  const useXbox =
    controls.glyphMode === 'xbox' ||
    (controls.glyphMode === 'auto' && telemetry.controllerType === 'xbox');

  const getGlyph = (keyCode: string, padBtnIndex: number) => {
    if (usePlaystation) return PLAYSTATION_GLYPHS[padBtnIndex] || formatKeyCode(keyCode);
    if (useXbox) return XBOX_GLYPHS[padBtnIndex] || formatKeyCode(keyCode);
    return formatKeyCode(keyCode);
  };

  // Draw live Canvas 2D Minimap for 5x Island
  useEffect(() => {
    if (!hudMod.showMinimap) return;
    const canvas = radarCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = 168;
    const half = size / 2;
    const scale = 0.58; // ~145m radar radius around player

    ctx.clearRect(0, 0, size, size);
    // Open ocean base color
    ctx.fillStyle = '#07243d';
    ctx.fillRect(0, 0, size, size);

    ctx.save();
    ctx.translate(half, half);
    // Rotate radar opposite player heading so "up" is forward
    ctx.rotate(telemetry.playerHeading - Math.PI);

    // Sandy Island Coastline
    ctx.beginPath();
    ISLAND_MINIMAP_COAST.forEach((pt, idx) => {
      const rx = (pt.x - telemetry.playerX) * scale;
      const rz = (pt.z - telemetry.playerZ) * scale;
      if (idx === 0) ctx.moveTo(rx, rz);
      else ctx.lineTo(rx, rz);
    });
    ctx.closePath();
    ctx.fillStyle = '#a3895d';
    ctx.fill();

    // Inner Urban Landmass
    ctx.beginPath();
    ISLAND_MINIMAP_COAST.forEach((pt, idx) => {
      const rx = (pt.x * 0.935 - telemetry.playerX) * scale;
      const rz = (pt.z * 0.935 - telemetry.playerZ) * scale;
      if (idx === 0) ctx.moveTo(rx, rz);
      else ctx.lineTo(rx, rz);
    });
    ctx.closePath();
    ctx.fillStyle = '#131d2e';
    ctx.fill();

    // Vice Canal (x: -340..1560, z: 392..468)
    ctx.fillStyle = '#0369a1';
    ctx.fillRect(
      (-340 - telemetry.playerX) * scale,
      (392 - telemetry.playerZ) * scale,
      1900 * scale,
      76 * scale
    );

    // North Emerald River (x: -820..860, z: -815..-765)
    ctx.fillRect(
      (-820 - telemetry.playerX) * scale,
      (-815 - telemetry.playerZ) * scale,
      1680 * scale,
      50 * scale
    );

    // Marina Harbor Basin (x: 560..1280, z: 620..1120)
    ctx.fillRect(
      (560 - telemetry.playerX) * scale,
      (620 - telemetry.playerZ) * scale,
      720 * scale,
      500 * scale
    );

    // Airport Runways
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(
      (-1350 - telemetry.playerX) * scale,
      (774 - telemetry.playerZ) * scale,
      780 * scale,
      32 * scale
    );
    ctx.fillRect(
      (-1320 - telemetry.playerX) * scale,
      (906 - telemetry.playerZ) * scale,
      720 * scale,
      28 * scale
    );

    // Parking Lots
    ctx.fillStyle = '#1e293b';
    for (const lot of PARKING_LOTS) {
      ctx.fillRect(
        (lot.x - lot.width * 0.5 - telemetry.playerX) * scale,
        (lot.z - lot.depth * 0.5 - telemetry.playerZ) * scale,
        lot.width * scale,
        lot.depth * scale
      );
    }

    // Curved Roads, Dirt Trails & Highways
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const seg of roadSegments) {
      if (seg.points.length < 2) continue;
      ctx.beginPath();
      seg.points.forEach((pt, idx) => {
        const rx = (pt.x - telemetry.playerX) * scale;
        const rz = (pt.z - telemetry.playerZ) * scale;
        if (idx === 0) ctx.moveTo(rx, rz);
        else ctx.lineTo(rx, rz);
      });
      if (seg.closed) ctx.closePath();
      ctx.strokeStyle = seg.isDirtTrail ? '#5c4936' : seg.isHighway ? '#334155' : '#243044';
      ctx.lineWidth = Math.max(2, seg.width * scale);
      ctx.stroke();
    }

    // Bridges & Overpasses
    ctx.fillStyle = '#475569';
    for (const b of BRIDGE_SPANS) {
      ctx.fillRect(
        (b.x - b.width * 0.5 - telemetry.playerX) * scale,
        (b.zStart - telemetry.playerZ) * scale,
        b.width * scale,
        (b.zEnd - b.zStart) * scale
      );
    }
    ctx.fillStyle = '#64748b';
    for (const ov of OVERPASS_SPANS) {
      const ox = ov.axis === 'x' ? ov.centerX - ov.length * 0.5 : ov.centerX - ov.width * 0.5;
      const oz = ov.axis === 'x' ? ov.centerZ - ov.width * 0.5 : ov.centerZ - ov.length * 0.5;
      const ow = ov.axis === 'x' ? ov.length : ov.width;
      const od = ov.axis === 'x' ? ov.width : ov.length;
      ctx.fillRect((ox - telemetry.playerX) * scale, (oz - telemetry.playerZ) * scale, ow * scale, od * scale);
    }

    // Buildings within radar range
    ctx.fillStyle = '#334155';
    for (const b of buildingFootprints) {
      const dx = b.x - telemetry.playerX;
      const dz = b.z - telemetry.playerZ;
      if (Math.abs(dx) > 190 || Math.abs(dz) > 190) continue;
      const bx = (dx - b.w / 2) * scale;
      const bz = (dz - b.d / 2) * scale;
      ctx.fillRect(bx, bz, b.w * scale, b.d * scale);
    }

    // GPS Route Polyline
    if (telemetry.gpsRoute.length > 1) {
      ctx.strokeStyle = telemetry.activeMissionTitle ? '#f59e0b' : '#38bdf8';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      telemetry.gpsRoute.forEach((pt, idx) => {
        const px = (pt.x - telemetry.playerX) * scale;
        const pz = (pt.z - telemetry.playerZ) * scale;
        if (idx === 0) ctx.moveTo(px, pz);
        else ctx.lineTo(px, pz);
      });
      ctx.stroke();
    }

    // Blips (vehicles, boats, planes, motorcycles, shops, enemies, police, mission waypoint)
    for (const blip of telemetry.minimapBlips) {
      const bx = (blip.x - telemetry.playerX) * scale;
      const bz = (blip.z - telemetry.playerZ) * scale;
      const clampedDist = Math.hypot(bx, bz);
      let drawX = bx;
      let drawZ = bz;
      if (clampedDist > half - 8 && (blip.type === 'mission' || blip.type === 'shop')) {
        const ratio = (half - 8) / clampedDist;
        drawX *= ratio;
        drawZ *= ratio;
      } else if (clampedDist > half - 4) {
        continue;
      }

      if (blip.type === 'mission') {
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.arc(drawX, drawZ, 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fef3c7';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else if (blip.type === 'side_mission') {
        ctx.fillStyle = '#a855f7';
        ctx.beginPath();
        ctx.arc(drawX, drawZ, 4.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      } else if (blip.type === 'friend') {
        ctx.fillStyle = '#22c55e';
        ctx.beginPath();
        ctx.arc(drawX, drawZ, 4.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.4;
        ctx.stroke();
      } else if (blip.type === 'shop' || blip.type === 'shooting_range') {
        ctx.save();
        ctx.translate(drawX, drawZ);
        ctx.rotate(-(telemetry.playerHeading - Math.PI));
        drawShopMapIcon(
          ctx,
          blip.shopCategory || 'wardrobe',
          0,
          0,
          blip.color || '#10b981',
          6.8,
          false
        );
        ctx.restore();
      } else if (blip.type === 'police') {
        ctx.fillStyle = Math.floor(Date.now() / 220) % 2 === 0 ? '#ef4444' : '#3b82f6';
        ctx.beginPath();
        ctx.arc(drawX, drawZ, 3.8, 0, Math.PI * 2);
        ctx.fill();
      } else if (blip.type === 'enemy') {
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(drawX, drawZ, 3.4, 0, Math.PI * 2);
        ctx.fill();
      } else if (blip.type === 'boat') {
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.moveTo(drawX, drawZ - 3.8);
        ctx.lineTo(drawX + 3.2, drawZ);
        ctx.lineTo(drawX, drawZ + 3.8);
        ctx.lineTo(drawX - 3.2, drawZ);
        ctx.closePath();
        ctx.fill();
      } else if (blip.type === 'plane' || blip.type === 'fighter_jet') {
        ctx.fillStyle = blip.type === 'fighter_jet' ? '#fb7185' : '#f8fafc';
        ctx.beginPath();
        ctx.moveTo(drawX, drawZ - 4);
        ctx.lineTo(drawX + 3.6, drawZ + 3.2);
        ctx.lineTo(drawX - 3.6, drawZ + 3.2);
        ctx.closePath();
        ctx.fill();
      } else if (blip.type === 'helicopter') {
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.arc(drawX, drawZ, 3.4, 0, Math.PI * 2);
        ctx.fill();
      } else if (blip.type === 'taxi') {
        ctx.fillStyle = '#facc15';
        ctx.fillRect(drawX - 2.2, drawZ - 2.2, 4.4, 4.4);
      } else if (blip.type === 'motorcycle') {
        ctx.fillStyle = '#c084fc';
        ctx.beginPath();
        ctx.arc(drawX, drawZ, 2.8, 0, Math.PI * 2);
        ctx.fill();
      } else if (blip.type === 'vehicle') {
        ctx.fillStyle = '#94a3b8';
        ctx.fillRect(drawX - 2, drawZ - 2, 4, 4);
      }
    }

    ctx.restore();

    // Player Center Chevron
    ctx.fillStyle = hudMod.accentColor;
    ctx.beginPath();
    ctx.moveTo(half, half - 7);
    ctx.lineTo(half + 5, half + 5);
    ctx.lineTo(half, half + 2);
    ctx.lineTo(half - 5, half + 5);
    ctx.closePath();
    ctx.fill();
  }, [telemetry, hudMod.showMinimap, hudMod.accentColor, roadSegments, buildingFootprints]);

  const weaponDef = WEAPON_CATALOG[telemetry.equippedWeapon];
  const accent = hudMod.accentColor;

  return (
    <div
      className="fixed inset-0 z-10 pointer-events-none select-none overflow-hidden"
      style={{
        opacity: hudMod.hudOpacity,
        transform: `scale(${hudMod.hudScale})`,
        transformOrigin: 'center center',
      }}
    >
      {/* Damage Vignette */}
      {telemetry.damageFlashActive && (
        <div
          className="fixed inset-0 pointer-events-none"
          style={{
            boxShadow: 'inset 0 0 110px rgba(239, 68, 68, 0.65)',
          }}
        />
      )}

      {/* Wasted Banner */}
      {telemetry.isWasted && (
        <div className="fixed inset-0 flex items-center justify-center bg-slate-950/75">
          <div className="text-center space-y-2 px-4">
            <div className="font-display text-6xl font-bold tracking-wider text-rose-500">
              VYRADENÝ
            </div>
            <div className="text-sm text-slate-300">
              {telemetry.wastedReason || 'Ošetrenie v nemocnici (-$350) · Prevoz pred nemocnicu...'}
            </div>
          </div>
        </div>
      )}

      {/* Busted Banner */}
      {telemetry.isBusted && (
        <div className="fixed inset-0 flex items-center justify-center bg-slate-950/75">
          <div className="text-center space-y-2">
            <div className="font-display text-6xl font-bold tracking-wider text-sky-400">
              ZATKNUTÝ
            </div>
            <div className="text-sm text-slate-300">
              Zásah polície (-$250) · Prevoz pred policajnú stanicu...
            </div>
          </div>
        </div>
      )}

      {/* TOP-LEFT: Active Mission + Clock + FPS + Controller + Delayed Police Warning */}
      <div className="absolute top-4 left-4 flex flex-col gap-2 max-w-xs pointer-events-auto">
        <div className="inline-flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-lg bg-[#0b101b]/90 border border-white/10 text-xs text-slate-300 w-fit">
          {graphics.showFps && (
            <>
              <span className="font-mono-tabular font-semibold text-emerald-400">
                {telemetry.fps} FPS
              </span>
              <span className="text-slate-600">·</span>
            </>
          )}
          <span className="inline-flex items-center gap-1 font-mono-tabular text-amber-300 font-semibold">
            <Clock className="w-3 h-3" />
            {telemetry.gameClockStr}
          </span>
          <span className="text-slate-600">·</span>
          <span className="inline-flex items-center gap-1 text-sky-200 font-medium">
            {telemetry.rainIntensity > 0.25 ? (
              <CloudRain className="w-3 h-3 text-sky-400" />
            ) : (
              <Sun className="w-3 h-3 text-amber-300" />
            )}
            {telemetry.weatherLabel} {telemetry.ambientTempC}°C
          </span>
          <span className="text-slate-600">·</span>
          <span className="text-slate-300">{telemetry.district}</span>
          {telemetry.remotePlayersCount > 0 && (
            <>
              <span className="text-slate-600">·</span>
              <span className="text-emerald-400 font-semibold">
                {telemetry.remotePlayersCount} {telemetry.remotePlayersCount === 1 ? 'kamarát' : 'kamaráti'}
              </span>
            </>
          )}
          {telemetry.godModeActive && (
            <>
              <span className="text-slate-600">·</span>
              <span className="text-rose-400 font-bold">GOD</span>
            </>
          )}
          {telemetry.inWater && !telemetry.inVehicle && (
            <>
              <span className="text-slate-600">·</span>
              <span className="text-sky-400 font-medium">Plávanie</span>
            </>
          )}
          {telemetry.controllerConnected && (
            <>
              <span className="text-slate-600">·</span>
              <span className="inline-flex items-center gap-1 text-sky-400 font-medium">
                <Gamepad2 className="w-3.5 h-3.5" />
                {telemetry.controllerType === 'playstation' ? 'DualShock/Sense' : 'Pad'}
              </span>
            </>
          )}
        </div>

        {telemetry.cheatSessionActive && (
          <div className="px-3 py-1.5 rounded-lg bg-rose-500/20 border border-rose-400/40 text-xs text-rose-100 flex items-center justify-between gap-2">
            <span className="font-semibold">Cheaty aktívne · Misie zamknuté</span>
            {onRestartCleanSession && (
              <button
                onClick={onRestartCleanSession}
                className="px-2 py-0.5 rounded bg-rose-500 hover:bg-rose-400 text-[11px] font-bold text-white inline-flex items-center gap-1 shrink-0"
              >
                <RotateCcw className="w-3 h-3" />
                Reštart bez cheatov
              </button>
            )}
          </div>
        )}

        {telemetry.policeDispatchTimer > 0 && telemetry.wantedStars === 0 && (
          <div className="px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-400/40 text-xs text-amber-200 font-medium">
            Hlásenie VCPD ({telemetry.policeDispatchReason || 'Incident'}) · Hliadka o{' '}
            <span className="font-mono-tabular font-bold">{telemetry.policeDispatchTimer}s</span> — uteč!
          </div>
        )}

        {telemetry.parkedFacilityNotice && (
          <div className="px-3 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-400/40 text-xs text-emerald-200 font-medium">
            {telemetry.parkedFacilityNotice}
          </div>
        )}

        {telemetry.taxiMode !== 'none' && (
          <div className="px-3 py-1.5 rounded-lg bg-amber-400/15 border border-amber-400/35 text-xs text-amber-200">
            {telemetry.taxiMode === 'passenger'
              ? `Horizon Cab -> ${telemetry.taxiDestinationLabel || 'Cieľ'} ($${telemetry.taxiFareCash}) · [G] Vyhodiť vodiča`
              : telemetry.taxiMode === 'driver_waiting'
                ? 'Taxikár: Vyzdvihni zákazníka na žltom bode GPS'
                : `Taxikár: Odvez zákazníka (${telemetry.taxiDestinationLabel}) · Zárobok $${telemetry.taxiFareCash}`}
          </div>
        )}

        {telemetry.gpsWaypoint && (
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#0b101b]/90 border border-sky-400/25 text-xs text-sky-300 w-fit">
            <Navigation className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate max-w-[180px]">{telemetry.gpsWaypoint.label}</span>
            <span className="font-mono-tabular font-bold text-white">{telemetry.gpsDistanceM} m</span>
          </div>
        )}

        {hudMod.showMissionTracker && telemetry.activeMissionTitle && (
          <div className="px-3.5 py-2.5 rounded-lg bg-[#0b101b]/90 border border-white/10 space-y-1">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold tracking-wide" style={{ color: accent }}>
                {telemetry.activeMissionTitle}
              </span>
              {telemetry.missionTimerRemaining !== null && (
                <span className="font-mono-tabular text-xs font-bold text-amber-300">
                  {Math.floor(telemetry.missionTimerRemaining / 60)}:
                  {String(telemetry.missionTimerRemaining % 60).padStart(2, '0')}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-200 leading-snug">{telemetry.activeObjectiveLabel}</p>
          </div>
        )}
      </div>

      {/* TOP-CENTER: Mission / Stunt Notification */}
      {(telemetry.missionNotification || telemetry.stuntMessage) && (
        <div className="absolute top-5 left-1/2 -translate-x-1/2 pointer-events-none">
          <div className="px-5 py-2.5 rounded-xl bg-[#0b101b]/95 border border-white/15 text-center shadow-xl">
            {telemetry.stuntMessage ? (
              <div className="font-display text-lg font-bold text-amber-400">
                {telemetry.stuntMessage}
              </div>
            ) : telemetry.missionNotification ? (
              <>
                <div className="font-display text-base font-bold text-white">
                  {telemetry.missionNotification.title}
                </div>
                <div className="text-xs text-slate-300">
                  {telemetry.missionNotification.subtitle}
                  {telemetry.missionNotification.reward
                    ? ` · +$${telemetry.missionNotification.reward.toLocaleString('sk-SK')}`
                    : ''}
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}

      {/* TOP-RIGHT: Character Badge, Wanted Stars, Cash, Weapon & Ammo */}
      <div className="absolute top-4 right-4 flex flex-col items-end gap-2">
        <div className="flex items-center gap-3 px-3.5 py-2 rounded-xl bg-[#0b101b]/90 border border-white/10">
          <div className="text-right">
            <div className="text-xs text-slate-400">
              {activeCharacter.name} · {CAMERA_LABELS[telemetry.cameraMode]}
            </div>
            <div className="font-mono-tabular text-lg font-bold text-emerald-400">
              ${telemetry.cash.toLocaleString('sk-SK')}
            </div>
          </div>
          <img
            src={activeCharacter.portraitUrl}
            alt={activeCharacter.name}
            referrerPolicy="no-referrer"
            className="w-10 h-10 rounded-lg object-cover border border-white/15"
          />
        </div>

        {/* Wanted Stars */}
        {telemetry.wantedStars > 0 && (
          <div className="flex flex-col items-end gap-1 px-3 py-1.5 rounded-lg bg-[#0b101b]/90 border border-white/10">
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((starIdx) => {
                const active = starIdx <= telemetry.wantedStars;
                const flashBlue =
                  active && !telemetry.wantedEvading && Math.floor(Date.now() / 260) % 2 === 0;
                return (
                  <Star
                    key={starIdx}
                    className={`w-4 h-4 ${
                      !active
                        ? 'text-slate-700'
                        : telemetry.wantedEvading
                          ? 'text-slate-300 fill-slate-300 opacity-60'
                          : flashBlue
                            ? 'text-sky-400 fill-sky-400'
                            : 'text-rose-500 fill-rose-500'
                    }`}
                  />
                );
              })}
            </div>
            {telemetry.wantedEvading && (
              <div className="w-28 h-1 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-sky-400 transition-all"
                  style={{ width: `${telemetry.evasionProgress}%` }}
                />
              </div>
            )}
          </div>
        )}

        {/* Weapon & Ammo */}
        <div className="flex items-center gap-3 px-3.5 py-2 rounded-lg bg-[#0b101b]/90 border border-white/10">
          <div className="text-right">
            <div className="text-xs font-medium text-slate-300">{weaponDef.name}</div>
            <div className="font-mono-tabular text-sm font-bold text-white">
              {gameplayMods.infiniteAmmo ? (
                '∞ / ∞'
              ) : telemetry.isReloading ? (
                <span className="text-amber-400">Prebíjam...</span>
              ) : (
                <>
                  <span>{telemetry.ammoInClip}</span>
                  <span className="text-slate-500"> / {telemetry.reserveAmmo}</span>
                </>
              )}
            </div>
          </div>
          <Crosshair className="w-5 h-5" style={{ color: accent }} />
        </div>
      </div>

      {/* CENTER CROSSHAIR & INTERACTION PROMPT */}
      {!telemetry.inVehicle && !telemetry.isWasted && !telemetry.isBusted && (
        <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none flex items-center justify-center">
          {hudMod.crosshairStyle === 'dot' && (
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: telemetry.isAiming ? accent : '#ffffff' }}
            />
          )}
          {hudMod.crosshairStyle === 'circle' && (
            <div
              className="w-5 h-5 rounded-full border-2 flex items-center justify-center"
              style={{ borderColor: telemetry.isAiming ? accent : 'rgba(255,255,255,0.75)' }}
            >
              <div className="w-1 h-1 rounded-full bg-white" />
            </div>
          )}
          {hudMod.crosshairStyle === 'tactical' && (
            <div className="relative w-6 h-6 flex items-center justify-center">
              <div className="w-1 h-1 rounded-full bg-white" />
              <div
                className="absolute top-0 w-0.5 h-1.5"
                style={{ backgroundColor: telemetry.isAiming ? accent : 'rgba(255,255,255,0.8)' }}
              />
              <div
                className="absolute bottom-0 w-0.5 h-1.5"
                style={{ backgroundColor: telemetry.isAiming ? accent : 'rgba(255,255,255,0.8)' }}
              />
              <div
                className="absolute left-0 h-0.5 w-1.5"
                style={{ backgroundColor: telemetry.isAiming ? accent : 'rgba(255,255,255,0.8)' }}
              />
              <div
                className="absolute right-0 h-0.5 w-1.5"
                style={{ backgroundColor: telemetry.isAiming ? accent : 'rgba(255,255,255,0.8)' }}
              />
            </div>
          )}

          {/* Hitmarker X */}
          {telemetry.hitMarkerActive && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-4 h-0.5 bg-rose-500 rotate-45 absolute" />
              <div className="w-4 h-0.5 bg-rose-500 -rotate-45 absolute" />
            </div>
          )}

          {telemetry.autoAimLocked && (
            <div className="absolute top-6 px-1.5 py-0.5 rounded bg-rose-500/85 text-[9px] font-mono-tabular font-bold tracking-wider text-white">
              LOCK
            </div>
          )}
        </div>
      )}

      {/* Subtle Aim / Lock hint when pointer isn't locked yet */}
      {!telemetry.pointerLocked && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 pointer-events-auto">
          <button
            onClick={onRequestLock}
            className="px-3.5 py-1.5 rounded-lg bg-[#0b101b]/90 border border-white/15 text-xs text-slate-200 hover:border-white/30 transition-colors"
          >
            Klikni do 3D scény pre voľné mierenie myšou · Esc pre kurzor
          </button>
        </div>
      )}

      {/* Mid-air Parachute hint */}
      {!telemetry.inVehicle && telemetry.altitudeM >= 7 && telemetry.hasParachute && !telemetry.parachuteDeployed && (
        <div className="fixed bottom-40 left-1/2 -translate-x-1/2">
          <div className="px-3.5 py-1.5 rounded-lg bg-sky-500/20 border border-sky-400/40 text-xs font-semibold text-sky-200">
            [Medzerník] Otvoriť padák ({telemetry.altitudeM} m)
          </div>
        </div>
      )}

      {/* AI NPC Dynamic Reaction Subtitle */}
      {telemetry.nearestNpcDialogue && (
        <div className="fixed bottom-44 left-1/2 -translate-x-1/2 max-w-md px-4 py-2 rounded-xl bg-[#090e1a]/92 border border-sky-400/35 shadow-xl text-center">
          <div className="text-[10px] font-bold uppercase tracking-wider text-sky-400">
            {telemetry.nearestNpcDialogue.speaker}
          </div>
          <div className="text-xs text-slate-100 leading-snug mt-0.5">
            „{telemetry.nearestNpcDialogue.text}“
          </div>
        </div>
      )}

      {/* Nearby Vehicle / Interaction / Side Discovery Prompt */}
      {(telemetry.nearbyPrompt || telemetry.activeSidePrompt) && (
        <div className="fixed bottom-28 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5">
          {telemetry.activeSidePrompt && (
            <div className="px-3.5 py-1.5 rounded-lg bg-purple-500/20 border border-purple-400/40 text-xs font-medium text-purple-200">
              [{getGlyph(controls.keyBindings.enterVehicle, controls.gamepadBindings.enterVehicle)}] {telemetry.activeSidePrompt}
            </div>
          )}
          {telemetry.nearbyPrompt && (
            <div className="px-4 py-2 rounded-lg bg-[#0b101b]/92 border border-white/15 text-xs font-medium text-white flex items-center gap-2">
              <span
                className="px-1.5 py-0.5 rounded font-mono-tabular font-bold text-slate-950"
                style={{ backgroundColor: accent }}
              >
                {getGlyph(controls.keyBindings.enterVehicle, controls.gamepadBindings.enterVehicle)}
              </span>
              <span>{telemetry.nearbyPrompt}</span>
            </div>
          )}
        </div>
      )}

      {/* BOTTOM-LEFT: Clickable Minimap + Health / Armor / Stamina */}
      <div className="absolute bottom-4 left-4 flex flex-col gap-2">
        {hudMod.showMinimap && (
          <button
            type="button"
            onClick={() => onOpenModal('map')}
            className="pointer-events-auto relative rounded-xl overflow-hidden border border-white/15 hover:border-white/40 bg-[#09111e] p-1 text-left transition-colors group"
            title="Klikni pre otvorenie veľkej interaktívnej mapy"
          >
            <canvas
              ref={radarCanvasRef}
              width={168}
              height={168}
              className="rounded-lg block"
            />
            <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-[#0b101b]/90 border border-white/15 text-[10px] font-mono-tabular text-slate-200 group-hover:text-white">
              [{getGlyph(controls.keyBindings.openMap, controls.gamepadBindings.openMap)}] Mapa
            </span>
          </button>
        )}

        <div className="w-[178px] px-2.5 py-2 rounded-lg bg-[#0b101b]/90 border border-white/10 space-y-1.5">
          {/* Health */}
          <div className="space-y-0.5">
            <div className="flex justify-between text-[11px] font-mono-tabular text-slate-300">
              <span>Zdravie</span>
              <span>{telemetry.health}</span>
            </div>
            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{ width: `${(telemetry.health / telemetry.maxHealth) * 100}%` }}
              />
            </div>
          </div>

          {/* Armor */}
          <div className="space-y-0.5">
            <div className="flex justify-between text-[11px] font-mono-tabular text-slate-300">
              <span>Vesta</span>
              <span>{telemetry.armor}</span>
            </div>
            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-sky-400 transition-all"
                style={{ width: `${(telemetry.armor / telemetry.maxArmor) * 100}%` }}
              />
            </div>
          </div>

          {/* Stamina */}
          <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-400 transition-all"
              style={{ width: `${telemetry.stamina}%` }}
            />
          </div>

          {/* Character RPG Skills mini row */}
          <div className="grid grid-cols-4 gap-1 pt-0.5 text-[9px] font-mono-tabular text-slate-400 text-center">
            <span title="Šoférovanie">Šof {Math.round(telemetry.skills.driving)}</span>
            <span title="Streľba">Str {Math.round(telemetry.skills.shooting)}</span>
            <span title="Lietanie">Let {Math.round(telemetry.skills.flying)}</span>
            <span title="Kondícia">Kon {Math.round(telemetry.skills.stamina)}</span>
          </div>
        </div>
      </div>

      {/* BOTTOM-RIGHT: Speedometer when driving / flying / sailing */}
      {hudMod.showSpeedometer && telemetry.inVehicle && (
        <div className="absolute bottom-4 right-4 px-4 py-3 rounded-xl bg-[#0b101b]/90 border border-white/12 text-right min-w-[196px]">
          {telemetry.vehicleBrand && (
            <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: accent }}>
              {telemetry.vehicleBrand}
            </div>
          )}
          <div className="text-xs font-medium text-slate-300">{telemetry.vehicleName}</div>
          <div className="flex items-baseline justify-end gap-1.5">
            <span className="font-display text-4xl font-bold font-mono-tabular text-white">
              {telemetry.speedKmh}
            </span>
            <span className="text-xs font-medium text-slate-400">km/h</span>
          </div>
          <div className="mt-1 flex items-center justify-end gap-2 text-[10px] font-mono-tabular">
            <span className={telemetry.vehicleBurning ? 'text-rose-400 font-bold' : 'text-slate-400'}>
              {telemetry.vehicleBurning ? 'POŽIAR MOTORA!' : `Stav ${telemetry.vehicleHealthPct}%`}
            </span>
          </div>
          {(telemetry.vehicleKind === 'plane' ||
            telemetry.vehicleKind === 'fighter_jet' ||
            telemetry.vehicleKind === 'helicopter') && (
            <div className="text-[11px] font-mono-tabular text-sky-400 mt-0.5">
              Výška {telemetry.altitudeM} m · [Shift/Medz] Stúpať · [S/Ctrl] Klesať
              {telemetry.vehicleKind === 'fighter_jet' ? ' · [LMB] Rakety' : ''}
            </div>
          )}
          {telemetry.vehicleKind !== 'plane' &&
            telemetry.vehicleKind !== 'fighter_jet' &&
            telemetry.vehicleKind !== 'helicopter' &&
            (telemetry.isDrifting || telemetry.handbrake) && (
              <div className="text-[11px] font-bold tracking-wide text-amber-400 mt-0.5">
                ŠMYK / DRIFT
              </div>
            )}
        </div>
      )}

      {/* BOTTOM-CENTER: Mappable Action Dock (opens/closes via mapped key/button) */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 flex flex-col items-center pointer-events-auto">
        {!dockOpen ? (
          <button
            onClick={onToggleDock}
            className="px-3.5 py-1.5 rounded-xl bg-[#0b101b]/90 border border-white/12 text-xs text-slate-200 hover:text-white hover:border-white/25 flex items-center gap-2 transition-colors shadow-lg"
            title="Otvoriť spodnú lištu"
          >
            <span
              className="px-1.5 py-0.5 rounded font-mono-tabular text-[11px] font-bold text-slate-950"
              style={{ backgroundColor: accent }}
            >
              {getGlyph(controls.keyBindings.toggleDock, controls.gamepadBindings.toggleDock)}
            </span>
            <span>Menu lišta</span>
          </button>
        ) : (
          <div className="flex flex-col items-center">
            <button
              onClick={onToggleDock}
              className="px-3 py-1 rounded-t-lg bg-[#0b101b]/90 border border-b-0 border-white/10 text-[11px] text-slate-300 hover:text-white flex items-center gap-1.5 transition-colors"
            >
              <ChevronDown className="w-3.5 h-3.5" />
              <span>Zavrieť lištu</span>
              <span className="font-mono-tabular text-[10px] text-slate-400">
                [{getGlyph(controls.keyBindings.toggleDock, controls.gamepadBindings.toggleDock)}]
              </span>
            </button>

            <div className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl bg-[#0b101b]/92 border border-white/12 shadow-2xl">
              <button
                onClick={() => onOpenModal('character')}
                className="px-3 py-2 rounded-lg text-xs font-medium text-slate-200 hover:bg-white/10 flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                title="Zmeniť postavu"
              >
                <Users className="w-4 h-4" style={{ color: accent }} />
                <span>Postavy</span>
                {hudMod.showControlsHint && (
                  <span className="text-[10px] font-mono-tabular text-slate-400">
                    [{getGlyph(controls.keyBindings.characterWheel, controls.gamepadBindings.characterWheel)}]
                  </span>
                )}
              </button>

              <button
                onClick={() => onOpenModal('inventory')}
                className="px-3 py-2 rounded-lg text-xs font-medium text-slate-200 hover:bg-white/10 flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                title="Inventár a obchod"
              >
                <Package className="w-4 h-4" style={{ color: accent }} />
                <span>Inventár</span>
                {hudMod.showControlsHint && (
                  <span className="text-[10px] font-mono-tabular text-slate-400">
                    [{getGlyph(controls.keyBindings.inventory, controls.gamepadBindings.inventory)}]
                  </span>
                )}
              </button>

              <button
                onClick={() => onOpenModal('wardrobe')}
                className="px-3 py-2 rounded-lg text-xs font-medium text-slate-200 hover:bg-white/10 flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                title="Úprava vzhľadu a kostýmov"
              >
                <Shirt className="w-4 h-4" style={{ color: accent }} />
                <span>Kostýmy</span>
                {hudMod.showControlsHint && (
                  <span className="text-[10px] font-mono-tabular text-slate-400">
                    [{formatKeyCode(controls.keyBindings.wardrobe)}]
                  </span>
                )}
              </button>

              <button
                onClick={() => onOpenModal('missions')}
                className="px-3 py-2 rounded-lg text-xs font-medium text-slate-200 hover:bg-white/10 flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                title="Príbehové misie"
              >
                <MapPin className="w-4 h-4" style={{ color: accent }} />
                <span>Misie</span>
                {hudMod.showControlsHint && (
                  <span className="text-[10px] font-mono-tabular text-slate-400">
                    [{formatKeyCode(controls.keyBindings.missions)}]
                  </span>
                )}
              </button>

              <button
                onClick={() => onOpenModal('map')}
                className="px-3 py-2 rounded-lg text-xs font-medium text-slate-200 hover:bg-white/10 flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                title="Mapa mesta, obchody a GPS navigácia"
              >
                <MapIcon className="w-4 h-4" style={{ color: accent }} />
                <span>Mapa</span>
                {hudMod.showControlsHint && (
                  <span className="text-[10px] font-mono-tabular text-slate-400">
                    [{getGlyph(controls.keyBindings.openMap, controls.gamepadBindings.openMap)}]
                  </span>
                )}
              </button>

              <button
                onClick={onCycleCamera}
                className="px-3 py-2 rounded-lg text-xs font-medium text-slate-200 hover:bg-white/10 flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                title="Prepnúť pohľad kamery"
              >
                <Camera className="w-4 h-4" style={{ color: accent }} />
                <span>Pohľad</span>
                {hudMod.showControlsHint && (
                  <span className="text-[10px] font-mono-tabular text-slate-400">
                    [{getGlyph(controls.keyBindings.switchCamera, controls.gamepadBindings.switchCamera)}]
                  </span>
                )}
              </button>

              <button
                onClick={onTogglePhone}
                className="px-3 py-2 rounded-lg text-xs font-medium text-slate-200 hover:bg-white/10 flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                title="Otvoriť telefón iVice (Priatelia, Taxík, Garáž, Cheaty)"
              >
                <Smartphone className="w-4 h-4" style={{ color: accent }} />
                <span>Telefón</span>
                {hudMod.showControlsHint && (
                  <span className="text-[10px] font-mono-tabular text-slate-400">
                    [{getGlyph(controls.keyBindings.phone, controls.gamepadBindings.phone)}]
                  </span>
                )}
              </button>

              <button
                onClick={onOpenCloud}
                className="px-3 py-2 rounded-lg text-xs font-medium text-sky-300 hover:bg-sky-500/15 border border-sky-400/25 flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                title="Uložiť alebo načítať hru na Cloud zadarmo"
              >
                <Cloud className="w-4 h-4 text-sky-400" />
                <span>Cloud</span>
              </button>

              <button
                onClick={() => onOpenModal('settings')}
                className="px-3 py-2 rounded-lg text-xs font-semibold text-slate-950 flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                style={{ backgroundColor: accent }}
                title="Nastavenia, Modifikácie a Cloud"
              >
                <Settings className="w-4 h-4" />
                <span>Nastavenia · Mody</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Quick Consumables & AI NPC talk hint bottom-left */}
      <div className="fixed bottom-4 left-[204px] hidden xl:flex items-center gap-2 text-[11px] text-slate-400 pointer-events-none">
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#0b101b]/80 border border-white/10">
          <Shield className="w-3 h-3 text-emerald-400" /> [1] Lekárnička · [2] Vesta · [T] Rozhovor s NPC · [Q] Zbraň · [{getGlyph(controls.keyBindings.phone, controls.gamepadBindings.phone)}] Telefón
        </span>
      </div>
    </div>
  );
};
