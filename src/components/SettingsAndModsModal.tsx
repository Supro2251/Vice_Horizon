import React, { useEffect, useState } from 'react';
import { User } from 'firebase/auth';
import {
  Cloud,
  Download,
  Gamepad2,
  LogIn,
  LogOut,
  Monitor,
  RotateCcw,
  Sliders,
  Sparkles,
  Upload,
  Volume2,
  X,
} from 'lucide-react';
import {
  GameSettings,
  GameStats,
  GamepadButtonAction,
  GraphicsPreset,
  HudThemeId,
  KeyAction,
} from '../types/game';
import { DEFAULT_SETTINGS, HUD_THEME_PRESETS } from '../data/defaults';
import { formatKeyCode, PLAYSTATION_GLYPHS, XBOX_GLYPHS } from '../engine/input';

interface SettingsAndModsModalProps {
  settings: GameSettings;
  user: User | null;
  cloudStatus: string | null;
  cloudBusy: boolean;
  stats: GameStats;
  controllerConnected: boolean;
  controllerType: 'playstation' | 'xbox' | 'none';
  controllerName: string;
  initialTab?: 'graphics' | 'audio' | 'controls' | 'mods' | 'cloud';
  onUpdateSettings: (next: GameSettings) => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onSaveCloud: () => void;
  onLoadCloud: () => void;
  onClose: () => void;
}

const KEY_ACTION_LABELS: { action: KeyAction; label: string }[] = [
  { action: 'moveForward', label: 'Pohyb dopredu / Plyn' },
  { action: 'moveBackward', label: 'Pohyb dozadu / Brzda' },
  { action: 'moveLeft', label: 'Vľavo' },
  { action: 'moveRight', label: 'Vpravo' },
  { action: 'sprint', label: 'Šprint' },
  { action: 'jump', label: 'Skok / Ručná brzda' },
  { action: 'shoot', label: 'Streľba' },
  { action: 'aim', label: 'Mierenie' },
  { action: 'reload', label: 'Prebiť zbraň' },
  { action: 'enterVehicle', label: 'Nastúpiť / Vystúpiť z auta' },
  { action: 'switchCamera', label: 'Prepnúť pohľad (1P / 3P)' },
  { action: 'characterWheel', label: 'Prepnutie postáv' },
  { action: 'inventory', label: 'Inventár' },
  { action: 'wardrobe', label: 'Šatník a kostýmy' },
  { action: 'missions', label: 'Misie' },
  { action: 'openMap', label: 'Otvoriť mapu mesta a GPS' },
  { action: 'toggleDock', label: 'Otvoriť / Zavrieť spodnú lištu' },
  { action: 'horn', label: 'Klaksón' },
];

const PAD_ACTION_LABELS: { action: GamepadButtonAction; label: string }[] = [
  { action: 'shoot', label: 'Streľba / Plyn' },
  { action: 'aim', label: 'Mierenie / Brzda' },
  { action: 'jump', label: 'Skok / Ručná brzda' },
  { action: 'reload', label: 'Prebiť zbraň' },
  { action: 'enterVehicle', label: 'Nastúpiť / Vystúpiť z auta' },
  { action: 'sprint', label: 'Šprint' },
  { action: 'switchCamera', label: 'Prepnúť pohľad kamery' },
  { action: 'inventory', label: 'Inventár' },
  { action: 'characterWheel', label: 'Prepnutie postáv' },
  { action: 'openMap', label: 'Otvoriť mapu mesta a GPS' },
  { action: 'toggleDock', label: 'Otvoriť / Zavrieť spodnú lištu' },
  { action: 'pause', label: 'Menu / Pauza' },
];

export const SettingsAndModsModal: React.FC<SettingsAndModsModalProps> = ({
  settings,
  user,
  cloudStatus,
  cloudBusy,
  stats,
  controllerConnected,
  controllerType,
  controllerName,
  initialTab = 'graphics',
  onUpdateSettings,
  onSignIn,
  onSignOut,
  onSaveCloud,
  onLoadCloud,
  onClose,
}) => {
  const [tab, setTab] = useState<'graphics' | 'audio' | 'controls' | 'mods' | 'cloud'>(initialTab);
  const [rebindingKey, setRebindingKey] = useState<KeyAction | null>(null);
  const [rebindingPad, setRebindingPad] = useState<GamepadButtonAction | null>(null);
  const [modJsonText, setModJsonText] = useState('');
  const [modFeedback, setModFeedback] = useState<string | null>(null);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const accent = settings.hudMod.accentColor;

  // Listen for keyboard/mouse rebinding
  useEffect(() => {
    if (!rebindingKey) return;

    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') {
        setRebindingKey(null);
        return;
      }
      onUpdateSettings({
        ...settings,
        controls: {
          ...settings.controls,
          keyBindings: {
            ...settings.controls.keyBindings,
            [rebindingKey]: e.code,
          },
        },
      });
      setRebindingKey(null);
    };

    const onMouse = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const code = `Mouse${e.button}`;
      onUpdateSettings({
        ...settings,
        controls: {
          ...settings.controls,
          keyBindings: {
            ...settings.controls.keyBindings,
            [rebindingKey]: code,
          },
        },
      });
      setRebindingKey(null);
    };

    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouse, true);
    };
  }, [rebindingKey, settings, onUpdateSettings]);

  // Poll Gamepad button for controller rebinding
  useEffect(() => {
    if (!rebindingPad) return;
    let active = true;
    const interval = window.setInterval(() => {
      if (!active) return;
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (let i = 0; i < pads.length; i++) {
        const p = pads[i];
        if (!p || !p.connected) continue;
        for (let b = 0; b < p.buttons.length; b++) {
          if (p.buttons[b].pressed || p.buttons[b].value > 0.6) {
            onUpdateSettings({
              ...settings,
              controls: {
                ...settings.controls,
                gamepadBindings: {
                  ...settings.controls.gamepadBindings,
                  [rebindingPad]: b,
                },
              },
            });
            setRebindingPad(null);
            return;
          }
        }
      }
    }, 60);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [rebindingPad, settings, onUpdateSettings]);

  const applyGraphicsPreset = (preset: GraphicsPreset) => {
    const presets: Record<GraphicsPreset, Partial<GameSettings['graphics']>> = {
      low: { renderScale: 0.75, shadowQuality: 'off', trafficDensity: 'low', viewDistance: 160, envReflections: false },
      balanced: { renderScale: 1.0, shadowQuality: 'medium', trafficDensity: 'medium', viewDistance: 240, envReflections: true },
      high: { renderScale: 1.25, shadowQuality: 'high', trafficDensity: 'high', viewDistance: 300, envReflections: true },
      ultra: { renderScale: 1.5, shadowQuality: 'high', trafficDensity: 'high', viewDistance: 360, envReflections: true },
    };
    onUpdateSettings({
      ...settings,
      graphics: {
        ...settings.graphics,
        preset,
        ...presets[preset],
      },
    });
  };

  const applyHudTheme = (themeId: HudThemeId) => {
    const preset = HUD_THEME_PRESETS[themeId];
    onUpdateSettings({
      ...settings,
      hudMod: {
        ...settings.hudMod,
        theme: themeId,
        accentColor: preset.accent,
      },
    });
  };

  const handleExportMod = () => {
    const pack = {
      name: 'Vice Horizon Custom Mod Pack',
      hudMod: settings.hudMod,
      gameplayMods: settings.gameplayMods,
    };
    setModJsonText(JSON.stringify(pack, null, 2));
    setModFeedback('Mod balík exportovaný do textového poľa nižšie.');
  };

  const handleImportMod = () => {
    try {
      const parsed = JSON.parse(modJsonText);
      onUpdateSettings({
        ...settings,
        hudMod: { ...settings.hudMod, ...(parsed.hudMod || {}) },
        gameplayMods: { ...settings.gameplayMods, ...(parsed.gameplayMods || {}) },
      });
      setModFeedback('Mod balík bol úspešne aplikovaný!');
    } catch {
      setModFeedback('Neplatný JSON formát modifikácie.');
    }
  };

  const glyphMap = controllerType === 'xbox' ? XBOX_GLYPHS : PLAYSTATION_GLYPHS;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/85 p-4 md:p-6">
      <div className="w-full max-w-5xl max-h-[88vh] flex flex-col bg-[#0b101b] border border-white/12 rounded-2xl shadow-2xl overflow-hidden">
        {/* Top Bar */}
        <div className="px-6 py-4 border-b border-white/10 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-bold text-white">
              Nastavenia, ovládanie a modifikácie
            </h2>
            <p className="text-xs text-slate-400">
              Všetky zmeny sa prejavia okamžite počas hrania.
            </p>
          </div>

          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-950 flex items-center gap-1.5"
            style={{ backgroundColor: accent }}
          >
            <X className="w-4 h-4" />
            Späť do hry
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="px-6 pt-3 pb-2 border-b border-white/10 flex items-center gap-1.5 overflow-x-auto">
          {[
            { id: 'graphics' as const, label: 'Grafika a HW', icon: Monitor },
            { id: 'audio' as const, label: 'Zvuk', icon: Volume2 },
            { id: 'controls' as const, label: 'Klávesnica a PS4/PS5 Controller', icon: Gamepad2 },
            { id: 'mods' as const, label: 'UI a Modifikácie', icon: Sparkles },
            { id: 'cloud' as const, label: 'Cloud uloženie', icon: Cloud },
          ].map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={`px-3.5 py-2 rounded-lg text-xs font-medium flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors ${
                  active ? 'bg-white text-slate-950 font-semibold' : 'text-slate-300 hover:bg-white/10'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* GRAPHICS TAB */}
          {tab === 'graphics' && (
            <div className="space-y-6">
              <div className="space-y-2.5">
                <h3 className="text-sm font-semibold text-white">Predvoľba výkonu</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { id: 'low' as const, name: 'Úsporná (Nízke HW)', desc: 'Max FPS na slabšom PC' },
                    { id: 'balanced' as const, name: 'Vyvážená', desc: 'Optimálny pomer kvality' },
                    { id: 'high' as const, name: 'Vysoká', desc: 'Ostré tiene a hustá premávka' },
                    { id: 'ultra' as const, name: 'Ultra', desc: 'Maximálne rozlíšenie' },
                  ].map((p) => (
                    <button
                      key={p.id}
                      onClick={() => applyGraphicsPreset(p.id)}
                      className="p-3 rounded-xl border text-left transition-colors"
                      style={{
                        borderColor:
                          settings.graphics.preset === p.id ? accent : 'rgba(255,255,255,0.1)',
                        backgroundColor:
                          settings.graphics.preset === p.id ? 'rgba(255,255,255,0.06)' : '#0f172a',
                      }}
                    >
                      <div className="text-xs font-semibold text-white">{p.name}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">{p.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="p-4 rounded-xl bg-slate-900/60 border border-white/10 space-y-4">
                  <label className="block space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-300">Rozlíšenie vykresľovania</span>
                      <span className="font-mono-tabular text-white">
                        {Math.round(settings.graphics.renderScale * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.5}
                      max={1.75}
                      step={0.05}
                      value={settings.graphics.renderScale}
                      onChange={(e) =>
                        onUpdateSettings({
                          ...settings,
                          graphics: { ...settings.graphics, renderScale: Number(e.target.value) },
                        })
                      }
                      className="w-full accent-amber-500"
                    />
                  </label>

                  <label className="block space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-300">Zorné pole (FOV)</span>
                      <span className="font-mono-tabular text-white">{settings.graphics.fov}°</span>
                    </div>
                    <input
                      type="range"
                      min={60}
                      max={105}
                      step={1}
                      value={settings.graphics.fov}
                      onChange={(e) =>
                        onUpdateSettings({
                          ...settings,
                          graphics: { ...settings.graphics, fov: Number(e.target.value) },
                        })
                      }
                      className="w-full accent-amber-500"
                    />
                  </label>

                  <label className="block space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-300">Dohľadnosť / Hmla</span>
                      <span className="font-mono-tabular text-white">
                        {settings.graphics.viewDistance}m
                      </span>
                    </div>
                    <input
                      type="range"
                      min={120}
                      max={380}
                      step={10}
                      value={settings.graphics.viewDistance}
                      onChange={(e) =>
                        onUpdateSettings({
                          ...settings,
                          graphics: { ...settings.graphics, viewDistance: Number(e.target.value) },
                        })
                      }
                      className="w-full accent-amber-500"
                    />
                  </label>
                </div>

                <div className="p-4 rounded-xl bg-slate-900/60 border border-white/10 space-y-4">
                  <div className="space-y-1.5">
                    <span className="text-xs text-slate-300">Kvalita tieňov</span>
                    <div className="grid grid-cols-4 gap-1.5">
                      {(['off', 'low', 'medium', 'high'] as const).map((sq) => (
                        <button
                          key={sq}
                          onClick={() =>
                            onUpdateSettings({
                              ...settings,
                              graphics: { ...settings.graphics, shadowQuality: sq },
                            })
                          }
                          className={`py-1.5 rounded-lg text-xs font-medium border ${
                            settings.graphics.shadowQuality === sq
                              ? 'bg-white text-slate-950 border-white'
                              : 'bg-slate-950 text-slate-300 border-white/10'
                          }`}
                        >
                          {sq === 'off' ? 'Vyp' : sq === 'low' ? 'Nízka' : sq === 'medium' ? 'Stred' : 'Vysoká'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-xs text-slate-300">Hustota premávky v meste</span>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(['low', 'medium', 'high'] as const).map((td) => (
                        <button
                          key={td}
                          onClick={() =>
                            onUpdateSettings({
                              ...settings,
                              graphics: { ...settings.graphics, trafficDensity: td },
                            })
                          }
                          className={`py-1.5 rounded-lg text-xs font-medium border ${
                            settings.graphics.trafficDensity === td
                              ? 'bg-white text-slate-950 border-white'
                              : 'bg-slate-950 text-slate-300 border-white/10'
                          }`}
                        >
                          {td === 'low' ? 'Nízka' : td === 'medium' ? 'Stredná' : 'Vysoká'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <label className="flex items-center justify-between pt-2 cursor-pointer">
                    <span className="text-xs text-slate-200">Zobraziť počítadlo FPS</span>
                    <input
                      type="checkbox"
                      checked={settings.graphics.showFps}
                      onChange={(e) =>
                        onUpdateSettings({
                          ...settings,
                          graphics: { ...settings.graphics, showFps: e.target.checked },
                        })
                      }
                      className="w-4 h-4 accent-amber-500"
                    />
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* AUDIO TAB */}
          {tab === 'audio' && (
            <div className="p-5 rounded-xl bg-slate-900/60 border border-white/10 space-y-5 max-w-2xl">
              <label className="flex items-center justify-between cursor-pointer pb-3 border-b border-white/10">
                <div>
                  <div className="text-sm font-semibold text-white">Stlmiť všetok zvuk</div>
                  <div className="text-xs text-slate-400">Okamžité vypnutie procedurálneho audia</div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.audio.muted}
                  onChange={(e) =>
                    onUpdateSettings({
                      ...settings,
                      audio: { ...settings.audio, muted: e.target.checked },
                    })
                  }
                  className="w-5 h-5 accent-amber-500"
                />
              </label>

              {[
                { key: 'master' as const, label: 'Hlavná hlasitosť' },
                { key: 'sfx' as const, label: 'Streľba, explózie a nárazy' },
                { key: 'engine' as const, label: 'Motory vozidiel' },
                { key: 'siren' as const, label: 'Policajné sirény' },
                { key: 'ui' as const, label: 'Zvuky rozhrania a misií' },
              ].map((row) => (
                <label key={row.key} className="block space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-200">{row.label}</span>
                    <span className="font-mono-tabular text-white">
                      {Math.round(settings.audio[row.key] * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={settings.audio[row.key]}
                    onChange={(e) =>
                      onUpdateSettings({
                        ...settings,
                        audio: { ...settings.audio, [row.key]: Number(e.target.value) },
                      })
                    }
                    className="w-full accent-amber-500"
                  />
                </label>
              ))}
            </div>
          )}

          {/* CONTROLS & PS4/PS5 CONTROLLER TAB */}
          {tab === 'controls' && (
            <div className="space-y-6">
              {/* Controller Live Status Banner */}
              <div className="p-4 rounded-xl bg-slate-900/70 border border-white/10 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Gamepad2 className="w-6 h-6" style={{ color: accent }} />
                  <div>
                    <div className="text-sm font-semibold text-white">
                      {controllerConnected
                        ? controllerType === 'playstation'
                          ? 'Pripojený PlayStation Controller (PS4 DualShock / PS5 DualSense)'
                          : 'Pripojený herný ovládač'
                        : 'Žiadny ovládač nie je aktívny (stlač ľubovoľné tlačidlo na ovládači)'}
                    </div>
                    {controllerConnected && (
                      <div className="text-xs text-slate-400 truncate max-w-md">{controllerName}</div>
                    )}
                  </div>
                </div>

                <button
                  onClick={() =>
                    onUpdateSettings({
                      ...settings,
                      controls: structuredClone(DEFAULT_SETTINGS.controls),
                    })
                  }
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-200 hover:bg-slate-700 flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Predvolené mapovanie
                </button>
              </div>

              {/* Sensitivity, Deadzone, Glyphs */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-slate-900/60 border border-white/10 space-y-3">
                  <label className="block space-y-1">
                    <div className="flex justify-between text-xs text-slate-300">
                      <span>Citlivosť myši</span>
                      <span className="font-mono-tabular">{settings.controls.mouseSensitivity.toFixed(2)}×</span>
                    </div>
                    <input
                      type="range"
                      min={0.3}
                      max={2.5}
                      step={0.05}
                      value={settings.controls.mouseSensitivity}
                      onChange={(e) =>
                        onUpdateSettings({
                          ...settings,
                          controls: { ...settings.controls, mouseSensitivity: Number(e.target.value) },
                        })
                      }
                      className="w-full accent-amber-500"
                    />
                  </label>

                  <label className="block space-y-1">
                    <div className="flex justify-between text-xs text-slate-300">
                      <span>Citlivosť páčky ovládača</span>
                      <span className="font-mono-tabular">{settings.controls.gamepadSensitivity.toFixed(2)}×</span>
                    </div>
                    <input
                      type="range"
                      min={0.4}
                      max={3.0}
                      step={0.05}
                      value={settings.controls.gamepadSensitivity}
                      onChange={(e) =>
                        onUpdateSettings({
                          ...settings,
                          controls: { ...settings.controls, gamepadSensitivity: Number(e.target.value) },
                        })
                      }
                      className="w-full accent-amber-500"
                    />
                  </label>

                  <label className="block space-y-1">
                    <div className="flex justify-between text-xs text-slate-300">
                      <span>Mŕtva zóna páčok (Deadzone)</span>
                      <span className="font-mono-tabular">{Math.round(settings.controls.deadzone * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0.04}
                      max={0.35}
                      step={0.02}
                      value={settings.controls.deadzone}
                      onChange={(e) =>
                        onUpdateSettings({
                          ...settings,
                          controls: { ...settings.controls, deadzone: Number(e.target.value) },
                        })
                      }
                      className="w-full accent-amber-500"
                    />
                  </label>
                </div>

                <div className="p-4 rounded-xl bg-slate-900/60 border border-white/10 space-y-3">
                  <div className="space-y-1.5">
                    <span className="text-xs text-slate-300">Ikony tlačidiel v HUD</span>
                    <div className="grid grid-cols-4 gap-1.5">
                      {(
                        [
                          { id: 'auto', label: 'Auto' },
                          { id: 'playstation', label: 'PS4/PS5' },
                          { id: 'xbox', label: 'Xbox' },
                          { id: 'keyboard', label: 'PC' },
                        ] as const
                      ).map((g) => (
                        <button
                          key={g.id}
                          onClick={() =>
                            onUpdateSettings({
                              ...settings,
                              controls: { ...settings.controls, glyphMode: g.id },
                            })
                          }
                          className={`py-1.5 rounded-lg text-xs font-medium border ${
                            settings.controls.glyphMode === g.id
                              ? 'bg-white text-slate-950 border-white'
                              : 'bg-slate-950 text-slate-300 border-white/10'
                          }`}
                        >
                          {g.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <label className="flex items-center justify-between pt-2 cursor-pointer">
                    <span className="text-xs text-slate-200">Invertovať os Y kamery</span>
                    <input
                      type="checkbox"
                      checked={settings.controls.invertY}
                      onChange={(e) =>
                        onUpdateSettings({
                          ...settings,
                          controls: { ...settings.controls, invertY: e.target.checked },
                        })
                      }
                      className="w-4 h-4 accent-amber-500"
                    />
                  </label>

                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-xs text-slate-200">Haptické vibrácie (DualShock / DualSense)</span>
                    <input
                      type="checkbox"
                      checked={settings.controls.vibration}
                      onChange={(e) =>
                        onUpdateSettings({
                          ...settings,
                          controls: { ...settings.controls, vibration: e.target.checked },
                        })
                      }
                      className="w-4 h-4 accent-amber-500"
                    />
                  </label>
                </div>
              </div>

              {/* Remapping Tables */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-slate-300">Mapovanie klávesnice a myši</h3>
                  <div className="rounded-xl border border-white/10 divide-y divide-white/5 bg-slate-900/50">
                    {KEY_ACTION_LABELS.map((item) => {
                      const waiting = rebindingKey === item.action;
                      return (
                        <div
                          key={item.action}
                          className="px-3.5 py-2 flex items-center justify-between text-xs"
                        >
                          <span className="text-slate-300">{item.label}</span>
                          <button
                            onClick={() => setRebindingKey(item.action)}
                            className="px-2.5 py-1 rounded bg-slate-800 border border-white/10 font-mono-tabular text-white hover:border-white/30 min-w-[84px] text-center"
                            style={waiting ? { borderColor: accent, color: accent } : undefined}
                          >
                            {waiting
                              ? 'Stlač kláves...'
                              : formatKeyCode(settings.controls.keyBindings[item.action])}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-slate-300">
                    Mapovanie PS4 / PS5 ovládača (DualShock / DualSense)
                  </h3>
                  <div className="rounded-xl border border-white/10 divide-y divide-white/5 bg-slate-900/50">
                    {PAD_ACTION_LABELS.map((item) => {
                      const waiting = rebindingPad === item.action;
                      const btnIdx = settings.controls.gamepadBindings[item.action];
                      return (
                        <div
                          key={item.action}
                          className="px-3.5 py-2 flex items-center justify-between text-xs"
                        >
                          <span className="text-slate-300">{item.label}</span>
                          <button
                            onClick={() => setRebindingPad(item.action)}
                            className="px-2.5 py-1 rounded bg-slate-800 border border-white/10 font-mono-tabular text-white hover:border-white/30 min-w-[92px] text-center"
                            style={waiting ? { borderColor: accent, color: accent } : undefined}
                          >
                            {waiting ? 'Stlač na pade...' : glyphMap[btnIdx] || `Btn ${btnIdx}`}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* MODS & HUD TAB */}
          {tab === 'mods' && (
            <div className="space-y-6">
              {/* HUD Theme Modder */}
              <div className="space-y-2.5">
                <h3 className="text-sm font-semibold text-white">Vizuálna téma používateľského rozhrania</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {(Object.keys(HUD_THEME_PRESETS) as HudThemeId[]).map((tid) => {
                    const p = HUD_THEME_PRESETS[tid];
                    const active = settings.hudMod.theme === tid;
                    return (
                      <button
                        key={tid}
                        onClick={() => applyHudTheme(tid)}
                        className="p-3 rounded-xl border text-left transition-colors"
                        style={{
                          borderColor: active ? p.accent : 'rgba(255,255,255,0.1)',
                          backgroundColor: active ? 'rgba(255,255,255,0.06)' : '#0f172a',
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-white">{p.name}</span>
                          <span
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: p.accent }}
                          />
                        </div>
                        <div className="text-[11px] text-slate-400 mt-1">{p.description}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* HUD Layout & Visibility */}
                <div className="p-4 rounded-xl bg-slate-900/60 border border-white/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                      <Sliders className="w-4 h-4" /> Moduly rozhrania
                    </span>
                    <input
                      type="color"
                      value={settings.hudMod.accentColor}
                      onChange={(e) =>
                        onUpdateSettings({
                          ...settings,
                          hudMod: { ...settings.hudMod, accentColor: e.target.value },
                        })
                      }
                      className="w-6 h-6 rounded bg-transparent border-0 cursor-pointer"
                      title="Vlastná farba akcentu"
                    />
                  </div>

                  {[
                    { key: 'showMinimap' as const, label: 'Taktická minimapa' },
                    { key: 'showSpeedometer' as const, label: 'Digitálny tachometer' },
                    { key: 'showMissionTracker' as const, label: 'Sledovač aktívnej misie' },
                    { key: 'showControlsHint' as const, label: 'Skratky tlačidiel v lište' },
                  ].map((m) => (
                    <label key={m.key} className="flex items-center justify-between text-xs text-slate-200 cursor-pointer">
                      <span>{m.label}</span>
                      <input
                        type="checkbox"
                        checked={settings.hudMod[m.key]}
                        onChange={(e) =>
                          onUpdateSettings({
                            ...settings,
                            hudMod: { ...settings.hudMod, [m.key]: e.target.checked },
                          })
                        }
                        className="w-4 h-4 accent-amber-500"
                      />
                    </label>
                  ))}

                  <div className="pt-2 space-y-1.5">
                    <span className="text-xs text-slate-300">Štýl zameriavača</span>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(['tactical', 'dot', 'circle'] as const).map((cs) => (
                        <button
                          key={cs}
                          onClick={() =>
                            onUpdateSettings({
                              ...settings,
                              hudMod: { ...settings.hudMod, crosshairStyle: cs },
                            })
                          }
                          className={`py-1.5 rounded-lg text-xs border ${
                            settings.hudMod.crosshairStyle === cs
                              ? 'bg-white text-slate-950 border-white font-semibold'
                              : 'bg-slate-950 text-slate-300 border-white/10'
                          }`}
                        >
                          {cs === 'tactical' ? 'Taktický' : cs === 'dot' ? 'Bodka' : 'Kruh'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Gameplay Mod Mutators */}
                <div className="p-4 rounded-xl bg-slate-900/60 border border-white/10 space-y-3">
                  <div className="text-xs font-semibold text-white">Herné modifikácie (Sandbox)</div>
                  {[
                    { key: 'infiniteAmmo' as const, label: 'Nekonečná munícia' },
                    { key: 'rapidFire' as const, label: 'Rýchlopalba (2.4× kadencia)' },
                    { key: 'turboVehicles' as const, label: 'Turbo motory (+55% výkon)' },
                    { key: 'lowGravity' as const, label: 'Nízka gravitácia (Mesiac)' },
                    { key: 'noPolice' as const, label: 'Bez zásahu polície (Free Roam)' },
                  ].map((mod) => (
                    <label key={mod.key} className="flex items-center justify-between text-xs text-slate-200 cursor-pointer">
                      <span>{mod.label}</span>
                      <input
                        type="checkbox"
                        checked={settings.gameplayMods[mod.key]}
                        onChange={(e) =>
                          onUpdateSettings({
                            ...settings,
                            gameplayMods: { ...settings.gameplayMods, [mod.key]: e.target.checked },
                          })
                        }
                        className="w-4 h-4 accent-amber-500"
                      />
                    </label>
                  ))}

                  <div className="pt-2 space-y-1.5">
                    <span className="text-xs text-slate-300">Denná doba a atmosféra</span>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(
                        [
                          { id: 'sunset', label: 'Západ slnka' },
                          { id: 'noon', label: 'Poludnie' },
                          { id: 'night', label: 'Noc' },
                        ] as const
                      ).map((tod) => (
                        <button
                          key={tod.id}
                          onClick={() =>
                            onUpdateSettings({
                              ...settings,
                              gameplayMods: { ...settings.gameplayMods, timeOfDay: tod.id },
                            })
                          }
                          className={`py-1.5 rounded-lg text-xs border ${
                            settings.gameplayMods.timeOfDay === tod.id
                              ? 'bg-white text-slate-950 border-white font-semibold'
                              : 'bg-slate-950 text-slate-300 border-white/10'
                          }`}
                        >
                          {tod.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* JSON Mod Pack Import/Export */}
              <div className="p-4 rounded-xl bg-slate-900/60 border border-white/10 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-white">Import / Export JSON Mod balíka</div>
                    <div className="text-[11px] text-slate-400">
                      Zdieľaj alebo načítaj vlastné nastavenia rozhrania a herných modifikácií.
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleExportMod}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-200 hover:bg-slate-700 flex items-center gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Exportovať JSON
                    </button>
                    <button
                      onClick={handleImportMod}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-950 flex items-center gap-1.5"
                      style={{ backgroundColor: accent }}
                    >
                      <Upload className="w-3.5 h-3.5" />
                      Načítať JSON Mod
                    </button>
                  </div>
                </div>
                <textarea
                  value={modJsonText}
                  onChange={(e) => setModJsonText(e.target.value)}
                  rows={4}
                  placeholder='{"hudMod": {...}, "gameplayMods": {...}}'
                  className="w-full p-3 rounded-lg bg-slate-950 border border-white/10 font-mono text-xs text-slate-200 focus:outline-none focus:border-white/30"
                />
                {modFeedback && <div className="text-xs text-emerald-400">{modFeedback}</div>}
              </div>
            </div>
          )}

          {/* CLOUD SAVE TAB */}
          {tab === 'cloud' && (
            <div className="space-y-5 max-w-2xl">
              <div className="p-5 rounded-xl bg-slate-900/70 border border-white/10 space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="inline-flex items-center gap-2 mb-1">
                      <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-semibold uppercase tracking-wider">
                        100% Zadarmo
                      </span>
                      <span className="text-[11px] text-slate-400">Automatická lokálna záloha + Cloud Sync</span>
                    </div>
                    <h3 className="font-display text-lg font-bold text-white">
                      {user ? user.displayName || user.email : 'Cloudové uloženie zadarmo'}
                    </h3>
                    <p className="text-xs text-slate-400">
                      {user
                        ? `Prepojený účet: ${user.email} · Postup sa automaticky synchronizuje zadarmo.`
                        : 'Prihlás sa cez Google pre bezplatné ukladanie postupu, peňazí, misií, kostýmov a nastavení do cloudu na akomkoľvek zariadení.'}
                    </p>
                  </div>
                  {user ? (
                    <button
                      onClick={onSignOut}
                      className="px-3.5 py-2 rounded-lg text-xs font-medium bg-slate-800 text-slate-200 hover:bg-slate-700 flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <LogOut className="w-4 h-4" />
                      Odhlásiť sa
                    </button>
                  ) : (
                    <button
                      onClick={onSignIn}
                      className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-950 flex items-center gap-1.5 whitespace-nowrap"
                      style={{ backgroundColor: accent }}
                    >
                      <LogIn className="w-4 h-4" />
                      Prihlásiť cez Google (Zadarmo)
                    </button>
                  )}
                </div>

                {user && (
                  <div className="flex flex-wrap gap-3 pt-2 border-t border-white/10">
                    <button
                      onClick={onSaveCloud}
                      disabled={cloudBusy}
                      className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-950 disabled:opacity-50"
                      style={{ backgroundColor: accent }}
                    >
                      {cloudBusy ? 'Ukladám...' : 'Uložiť postup do cloudu zadarmo'}
                    </button>
                    <button
                      onClick={onLoadCloud}
                      disabled={cloudBusy}
                      className="px-4 py-2 rounded-lg text-xs font-medium bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                    >
                      Načítať z cloudu
                    </button>
                  </div>
                )}

                {cloudStatus && (
                  <div className="text-xs text-sky-400 font-medium">{cloudStatus}</div>
                )}
              </div>

              {/* Career Statistics */}
              <div className="grid grid-cols-3 gap-4">
                <div className="p-4 rounded-xl bg-slate-900/60 border border-white/10">
                  <div className="text-xs text-slate-400">Eliminácie</div>
                  <div className="font-mono-tabular text-2xl font-bold text-white mt-1">
                    {stats.totalEliminations}
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-slate-900/60 border border-white/10">
                  <div className="text-xs text-slate-400">Úniky polícii</div>
                  <div className="font-mono-tabular text-2xl font-bold text-white mt-1">
                    {stats.policeEscapes}
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-slate-900/60 border border-white/10">
                  <div className="text-xs text-slate-400">Kaskadérske skoky</div>
                  <div className="font-mono-tabular text-2xl font-bold text-white mt-1">
                    {stats.stuntJumps}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
