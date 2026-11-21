import React, { useEffect, useState } from 'react';
import { User } from 'firebase/auth';
import {
  CheckCircle2,
  Cloud,
  Download,
  Gamepad2,
  Globe,
  LogIn,
  LogOut,
  Monitor,
  RotateCcw,
  Sliders,
  Sparkles,
  Upload,
  UserPlus,
  Users,
  Trash2,
  Volume2,
  X,
} from 'lucide-react';
import { LANGUAGE_OPTIONS, t } from '../i18n/translations';
import {
  FriendRecord,
  GameSettings,
  GameStats,
  GamepadButtonAction,
  GraphicsPreset,
  HudThemeId,
  KeyAction,
  OnlinePlayerInfo,
  StickControlConfig,
  VehicleControlCategory,
} from '../types/game';
import { DEFAULT_SETTINGS, HUD_THEME_PRESETS } from '../data/defaults';
import { formatKeyCode, PLAYSTATION_GLYPHS, XBOX_GLYPHS } from '../engine/input';

interface SettingsAndModsModalProps {
  settings: GameSettings;
  user: User | null;
  myNickname?: string;
  myFriendCode?: string;
  friends?: FriendRecord[];
  onlineUids?: string[];
  onlinePlayers?: OnlinePlayerInfo[];
  cloudStatus: string | null;
  cloudBusy: boolean;
  stats: GameStats;
  controllerConnected: boolean;
  controllerType: 'playstation' | 'xbox' | 'none';
  controllerName: string;
  gameClockStr: string;
  gameTimeNormalized: number;
  cheatSessionActive?: boolean;
  initialTab?: 'language' | 'graphics' | 'audio' | 'controls' | 'mods' | 'cloud';
  onUpdateSettings: (next: GameSettings) => void;
  onSetTimeOfDay: (normalized: number) => void;
  onRestartCleanSession?: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onSaveCloud: () => void;
  onLoadCloud: () => void;
  onUpdateNickname?: (nickname: string) => Promise<void>;
  onAddFriend?: (query: string) => Promise<void>;
  onRemoveFriend?: (uid: string) => Promise<void>;
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
  { action: 'phone', label: 'Vytiahnuť telefón (Priatelia / Cheaty)' },
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
  { action: 'phone', label: 'Telefón' },
  { action: 'pause', label: 'Menu / Pauza' },
];

const CONTROL_CATEGORIES: { id: 'all' | VehicleControlCategory; label: string }[] = [
  { id: 'all', label: 'Globálne (Všetko)' },
  { id: 'foot', label: 'Pešo' },
  { id: 'car', label: 'Auto' },
  { id: 'motorcycle', label: 'Motorka' },
  { id: 'boat', label: 'Čln / Loď' },
  { id: 'plane', label: 'Lietadlo' },
  { id: 'fighter_jet', label: 'Stíhačka' },
  { id: 'helicopter', label: 'Vrtuľník' },
];

export const SettingsAndModsModal: React.FC<SettingsAndModsModalProps> = ({
  settings,
  user,
  myNickname = '',
  myFriendCode = 'VH-OFFLINE',
  friends = [],
  onlineUids = [],
  onlinePlayers = [],
  cloudStatus,
  cloudBusy,
  stats,
  controllerConnected,
  controllerType,
  controllerName,
  gameClockStr,
  gameTimeNormalized,
  cheatSessionActive = false,
  initialTab = 'graphics',
  onUpdateSettings,
  onSetTimeOfDay,
  onRestartCleanSession,
  onSignIn,
  onSignOut,
  onSaveCloud,
  onLoadCloud,
  onUpdateNickname,
  onAddFriend,
  onRemoveFriend,
  onClose,
}) => {
  const [tab, setTab] = useState<'language' | 'graphics' | 'audio' | 'controls' | 'mods' | 'cloud'>(initialTab);
  const [selectedControlCat, setSelectedControlCat] = useState<'all' | VehicleControlCategory>('all');
  const [rebindingKey, setRebindingKey] = useState<KeyAction | null>(null);
  const [rebindingPad, setRebindingPad] = useState<GamepadButtonAction | null>(null);
  const [modJsonText, setModJsonText] = useState('');
  const [modFeedback, setModFeedback] = useState<string | null>(null);
  const [nickDraft, setNickDraft] = useState(myNickname);
  const [friendSearch, setFriendSearch] = useState('');
  const [mpFeedback, setMpFeedback] = useState<string | null>(null);
  const [mpBusy, setMpBusy] = useState(false);

  const lang = settings.language;

  useEffect(() => {
    setNickDraft(myNickname);
  }, [myNickname]);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const accent = settings.hudMod.accentColor;

  const applyRebindKey = (action: KeyAction, code: string) => {
    if (selectedControlCat === 'all') {
      onUpdateSettings({
        ...settings,
        controls: {
          ...settings.controls,
          keyBindings: {
            ...settings.controls.keyBindings,
            [action]: code,
          },
        },
      });
    } else {
      const prevOverrides = settings.controls.vehicleOverrides || {};
      const catProfile = prevOverrides[selectedControlCat] || { keyBindings: {}, gamepadBindings: {} };
      onUpdateSettings({
        ...settings,
        controls: {
          ...settings.controls,
          vehicleOverrides: {
            ...prevOverrides,
            [selectedControlCat]: {
              ...catProfile,
              keyBindings: {
                ...catProfile.keyBindings,
                [action]: code,
              },
            },
          },
        },
      });
    }
  };

  const applyRebindPad = (action: GamepadButtonAction, btn: number) => {
    if (selectedControlCat === 'all') {
      onUpdateSettings({
        ...settings,
        controls: {
          ...settings.controls,
          gamepadBindings: {
            ...settings.controls.gamepadBindings,
            [action]: btn,
          },
        },
      });
    } else {
      const prevOverrides = settings.controls.vehicleOverrides || {};
      const catProfile = prevOverrides[selectedControlCat] || { keyBindings: {}, gamepadBindings: {} };
      onUpdateSettings({
        ...settings,
        controls: {
          ...settings.controls,
          vehicleOverrides: {
            ...prevOverrides,
            [selectedControlCat]: {
              ...catProfile,
              gamepadBindings: {
                ...catProfile.gamepadBindings,
                [action]: btn,
              },
            },
          },
        },
      });
    }
  };

  const updateVehicleStickConfig = (patch: Partial<StickControlConfig>) => {
    if (selectedControlCat === 'all') return;
    const prevOverrides = settings.controls.vehicleOverrides || {};
    const catProfile = prevOverrides[selectedControlCat] || { keyBindings: {}, gamepadBindings: {} };
    onUpdateSettings({
      ...settings,
      controls: {
        ...settings.controls,
        vehicleOverrides: {
          ...prevOverrides,
          [selectedControlCat]: {
            ...catProfile,
            stickConfig: {
              ...(catProfile.stickConfig || {}),
              ...patch,
            },
          },
        },
      },
    });
  };

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
      applyRebindKey(rebindingKey, e.code);
      setRebindingKey(null);
    };

    const onMouse = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      applyRebindKey(rebindingKey, `Mouse${e.button}`);
      setRebindingKey(null);
    };

    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouse, true);
    };
  }, [rebindingKey, selectedControlCat, settings]);

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
            applyRebindPad(rebindingPad, b);
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
  }, [rebindingPad, selectedControlCat, settings]);

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
              {t(lang, 'settings.title')}
            </h2>
            <p className="text-xs text-slate-400">
              {t(lang, 'settings.subtitle')}
            </p>
          </div>

          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-950 flex items-center gap-1.5"
            style={{ backgroundColor: accent }}
          >
            <X className="w-4 h-4" />
            {t(lang, 'settings.backToGame')}
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="px-6 pt-3 pb-2 border-b border-white/10 flex items-center gap-1.5 overflow-x-auto">
          {[
            { id: 'language' as const, label: t(lang, 'settings.tab.language'), icon: Globe },
            { id: 'graphics' as const, label: t(lang, 'settings.tab.graphics'), icon: Monitor },
            { id: 'audio' as const, label: t(lang, 'settings.tab.audio'), icon: Volume2 },
            { id: 'controls' as const, label: t(lang, 'settings.tab.controls'), icon: Gamepad2 },
            { id: 'mods' as const, label: t(lang, 'settings.tab.mods'), icon: Sparkles },
            { id: 'cloud' as const, label: t(lang, 'settings.tab.cloud'), icon: Cloud },
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
          {/* LANGUAGE TAB */}
          {tab === 'language' && (
            <div className="space-y-5 max-w-3xl">
              <div className="p-4 rounded-xl bg-slate-900/70 border border-white/10 space-y-2">
                <h3 className="font-display text-lg font-bold text-white flex items-center gap-2">
                  <Globe className="w-5 h-5" style={{ color: accent }} />
                  {t(lang, 'settings.lang.heading')}
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">{t(lang, 'settings.lang.desc')}</p>
                <div className="p-3 rounded-lg bg-sky-500/10 border border-sky-400/25 text-xs text-sky-200 flex flex-wrap items-center justify-between gap-3">
                  <span>{t(lang, 'settings.lang.cloudNote')}</span>
                  {user ? (
                    <button
                      type="button"
                      disabled={cloudBusy}
                      onClick={onSaveCloud}
                      className="px-3.5 py-1.5 rounded-lg text-xs font-bold text-slate-950 shrink-0 disabled:opacity-50"
                      style={{ backgroundColor: accent }}
                    >
                      {cloudBusy ? t(lang, 'app.saving') : t(lang, 'settings.saveCloudNow')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={onSignIn}
                      className="px-3.5 py-1.5 rounded-lg text-xs font-bold text-slate-950 shrink-0 flex items-center gap-1.5"
                      style={{ backgroundColor: accent }}
                    >
                      <LogIn className="w-3.5 h-3.5" />
                      {t(lang, 'settings.cloud.signIn')}
                    </button>
                  )}
                </div>
                {cloudStatus && <div className="text-xs text-emerald-400 font-medium">{cloudStatus}</div>}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {LANGUAGE_OPTIONS.map((opt) => {
                  const active = settings.language === opt.code;
                  return (
                    <button
                      key={opt.code}
                      type="button"
                      onClick={() =>
                        onUpdateSettings({
                          ...settings,
                          language: opt.code,
                        })
                      }
                      className="p-3.5 rounded-xl border text-left transition-all flex items-center justify-between gap-2"
                      style={{
                        borderColor: active ? accent : 'rgba(255,255,255,0.1)',
                        backgroundColor: active ? 'rgba(255,255,255,0.08)' : '#0f172a',
                      }}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-xl leading-none">{opt.flag}</span>
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-white truncate">{opt.nativeLabel}</div>
                          <div className="text-[11px] text-slate-400 truncate">{opt.englishName}</div>
                        </div>
                      </div>
                      {active && <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: accent }} />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* GRAPHICS TAB */}
          {tab === 'graphics' && (
            <div className="space-y-6">
              <div className="space-y-2.5">
                <h3 className="text-sm font-semibold text-white">{t(lang, 'settings.preset')}</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { id: 'low' as const, name: t(lang, 'settings.preset.low'), desc: t(lang, 'settings.preset.lowDesc') },
                    { id: 'balanced' as const, name: t(lang, 'settings.preset.balanced'), desc: t(lang, 'settings.preset.balancedDesc') },
                    { id: 'high' as const, name: t(lang, 'settings.preset.high'), desc: t(lang, 'settings.preset.highDesc') },
                    { id: 'ultra' as const, name: t(lang, 'settings.preset.ultra'), desc: t(lang, 'settings.preset.ultraDesc') },
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
                      <span className="text-slate-300">{t(lang, 'settings.renderScale')}</span>
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
                      <span className="text-slate-300">{t(lang, 'settings.fov')}</span>
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
                      <span className="text-slate-300">{t(lang, 'settings.viewDist')}</span>
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
                    <span className="text-xs text-slate-300">{t(lang, 'settings.shadows')}</span>
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
                          {t(lang, `settings.shadow.${sq}`)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-xs text-slate-300">{t(lang, 'settings.traffic')}</span>
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
                          {t(lang, `settings.shadow.${td}`)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <label className="flex items-center justify-between pt-2 cursor-pointer">
                    <span className="text-xs text-slate-200">{t(lang, 'settings.showFps')}</span>
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
                  <div className="text-sm font-semibold text-white">{t(lang, 'settings.muted')}</div>
                  <div className="text-xs text-slate-400">{t(lang, 'settings.mutedDesc')}</div>
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
                { key: 'master' as const, label: t(lang, 'settings.masterVol') },
                { key: 'music' as const, label: t(lang, 'settings.musicVol') },
                { key: 'sfx' as const, label: t(lang, 'settings.sfxVol') },
                { key: 'engine' as const, label: t(lang, 'settings.engineVol') },
                { key: 'siren' as const, label: t(lang, 'settings.sirenVol') },
                { key: 'ui' as const, label: t(lang, 'settings.uiVol') },
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
                          ? t(lang, 'settings.controls.connectedPs')
                          : t(lang, 'settings.controls.connectedPad')
                        : t(lang, 'settings.controls.noPad')}
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
                  {t(lang, 'settings.resetDefaults')}
                </button>
              </div>

              {/* Sensitivity, Deadzone, Glyphs */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-slate-900/60 border border-white/10 space-y-3">
                  <label className="block space-y-1">
                    <div className="flex justify-between text-xs text-slate-300">
                      <span>{t(lang, 'settings.controls.mouseSens')}</span>
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
                      <span>{t(lang, 'settings.controls.padSens')}</span>
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
                      <span>{t(lang, 'settings.controls.deadzone')}</span>
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
                    <span className="text-xs text-slate-300">{t(lang, 'settings.controls.glyphs')}</span>
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
                    <span className="text-xs text-slate-200">{t(lang, 'settings.controls.invertY')}</span>
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
                    <span className="text-xs text-slate-200">{t(lang, 'settings.controls.vibration')}</span>
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

              {/* Per-Vehicle Profile Selector */}
              <div className="p-4 rounded-xl bg-slate-900/60 border border-white/10 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-white">{t(lang, 'settings.controls.perVehicle')}</div>
                    <div className="text-[11px] text-slate-400">
                      {t(lang, 'settings.controls.perVehicleDesc')}
                    </div>
                  </div>
                  {selectedControlCat !== 'all' && settings.controls.vehicleOverrides?.[selectedControlCat] && (
                    <button
                      onClick={() => {
                        const nextOverrides = { ...(settings.controls.vehicleOverrides || {}) };
                        delete nextOverrides[selectedControlCat];
                        onUpdateSettings({
                          ...settings,
                          controls: { ...settings.controls, vehicleOverrides: nextOverrides },
                        });
                      }}
                      className="px-2.5 py-1 rounded bg-rose-500/15 text-rose-300 text-[11px] hover:bg-rose-500/25"
                    >
                      Zrušiť vlastný profil
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {CONTROL_CATEGORIES.map((cat) => {
                    const active = selectedControlCat === cat.id;
                    const hasCustom =
                      cat.id !== 'all' && Boolean(settings.controls.vehicleOverrides?.[cat.id]);
                    return (
                      <button
                        key={cat.id}
                        onClick={() => setSelectedControlCat(cat.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                          active
                            ? 'bg-white text-slate-950 border-white font-semibold'
                            : 'bg-slate-950 text-slate-300 border-white/10 hover:border-white/25'
                        }`}
                      >
                        {cat.label}
                        {hasCustom ? ' *' : ''}
                      </button>
                    );
                  })}
                </div>

                {selectedControlCat !== 'all' && (() => {
                  const defaultCatStick: StickControlConfig = {
                    moveStick: 'left',
                    pitchInvert: selectedControlCat === 'plane' || selectedControlCat === 'fighter_jet',
                    yawSource:
                      selectedControlCat === 'plane' || selectedControlCat === 'fighter_jet'
                        ? 'bumpers'
                        : 'left_x',
                  };
                  const curStick: StickControlConfig = {
                    ...defaultCatStick,
                    ...(settings.controls.vehicleOverrides?.[selectedControlCat]?.stickConfig || {}),
                  };
                  return (
                    <div className="pt-3 mt-2 border-t border-white/10 grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <span className="text-[11px] text-slate-400">Hlavná páčka pohybu / náklonu</span>
                        <div className="grid grid-cols-2 gap-1.5">
                          {(
                            [
                              { id: 'left', label: 'Ľavá páčka' },
                              { id: 'right', label: 'Pravá páčka' },
                            ] as const
                          ).map((opt) => (
                            <button
                              key={opt.id}
                              onClick={() => updateVehicleStickConfig({ moveStick: opt.id })}
                              className={`py-1.5 px-2 rounded-lg text-[11px] font-medium border ${
                                curStick.moveStick === opt.id
                                  ? 'bg-white text-slate-950 border-white font-semibold'
                                  : 'bg-slate-950 text-slate-300 border-white/10'
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-1">
                        <span className="text-[11px] text-slate-400">Zdroj smerovky / zatáčania</span>
                        <div className="grid grid-cols-3 gap-1">
                          {(
                            [
                              { id: 'bumpers', label: 'L1 / R1' },
                              { id: 'left_x', label: 'Ľavá X' },
                              { id: 'right_x', label: 'Pravá X' },
                            ] as const
                          ).map((opt) => (
                            <button
                              key={opt.id}
                              onClick={() => updateVehicleStickConfig({ yawSource: opt.id })}
                              className={`py-1.5 px-1.5 rounded-lg text-[11px] font-medium border ${
                                curStick.yawSource === opt.id
                                  ? 'bg-white text-slate-950 border-white font-semibold'
                                  : 'bg-slate-950 text-slate-300 border-white/10'
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <label className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-950/80 border border-white/10 cursor-pointer self-end">
                        <div>
                          <div className="text-[11px] font-medium text-slate-200">Páčka dole = nos hore</div>
                          <div className="text-[10px] text-slate-400">Invertovaná výškovka letu</div>
                        </div>
                        <input
                          type="checkbox"
                          checked={curStick.pitchInvert}
                          onChange={(e) => updateVehicleStickConfig({ pitchInvert: e.target.checked })}
                          className="w-4 h-4 accent-amber-500"
                        />
                      </label>
                    </div>
                  );
                })()}
              </div>

              {/* Remapping Tables */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-slate-300">
                    {t(lang, 'settings.controls.kbTitle')} ({CONTROL_CATEGORIES.find((c) => c.id === selectedControlCat)?.label})
                  </h3>
                  <div className="rounded-xl border border-white/10 divide-y divide-white/5 bg-slate-900/50">
                    {KEY_ACTION_LABELS.map((item) => {
                      const waiting = rebindingKey === item.action;
                      const overrideCode =
                        selectedControlCat !== 'all'
                          ? settings.controls.vehicleOverrides?.[selectedControlCat]?.keyBindings?.[item.action]
                          : undefined;
                      const effectiveCode = overrideCode ?? settings.controls.keyBindings[item.action];
                      return (
                        <div
                          key={item.action}
                          className="px-3.5 py-2 flex items-center justify-between text-xs"
                        >
                          <span className="text-slate-300">
                            {item.label}
                            {overrideCode ? <span className="ml-1.5 text-[10px] text-sky-400">*</span> : null}
                          </span>
                          <button
                            onClick={() => setRebindingKey(item.action)}
                            className="px-2.5 py-1 rounded bg-slate-800 border border-white/10 font-mono-tabular text-white hover:border-white/30 min-w-[84px] text-center"
                            style={waiting ? { borderColor: accent, color: accent } : undefined}
                          >
                            {waiting ? t(lang, 'settings.controls.pressKey') : formatKeyCode(effectiveCode)}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-slate-300">
                    {t(lang, 'settings.controls.padTitle')} ({CONTROL_CATEGORIES.find((c) => c.id === selectedControlCat)?.label})
                  </h3>
                  <div className="rounded-xl border border-white/10 divide-y divide-white/5 bg-slate-900/50">
                    {PAD_ACTION_LABELS.map((item) => {
                      const waiting = rebindingPad === item.action;
                      const overrideBtn =
                        selectedControlCat !== 'all'
                          ? settings.controls.vehicleOverrides?.[selectedControlCat]?.gamepadBindings?.[item.action]
                          : undefined;
                      const btnIdx = overrideBtn ?? settings.controls.gamepadBindings[item.action];
                      return (
                        <div
                          key={item.action}
                          className="px-3.5 py-2 flex items-center justify-between text-xs"
                        >
                          <span className="text-slate-300">
                            {item.label}
                            {overrideBtn !== undefined ? <span className="ml-1.5 text-[10px] text-sky-400">*</span> : null}
                          </span>
                          <button
                            onClick={() => setRebindingPad(item.action)}
                            className="px-2.5 py-1 rounded bg-slate-800 border border-white/10 font-mono-tabular text-white hover:border-white/30 min-w-[92px] text-center"
                            style={waiting ? { borderColor: accent, color: accent } : undefined}
                          >
                            {waiting ? t(lang, 'settings.controls.pressPad') : glyphMap[btnIdx] || `Btn ${btnIdx}`}
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
                <h3 className="text-sm font-semibold text-white">{t(lang, 'settings.hudTheme')}</h3>
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
                      <Sliders className="w-4 h-4" /> {t(lang, 'settings.hudModules')}
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
                    />
                  </div>

                  {[
                    { key: 'showMinimap' as const, label: 'Minimap' },
                    { key: 'showSpeedometer' as const, label: 'Speedometer' },
                    { key: 'showMissionTracker' as const, label: 'Mission Tracker' },
                    { key: 'showControlsHint' as const, label: 'Controls Bar' },
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
                    <span className="text-xs text-slate-300">{t(lang, 'settings.crosshair')}</span>
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
                          {cs}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Gameplay Mod Mutators */}
                <div className="p-4 rounded-xl bg-slate-900/60 border border-white/10 space-y-3">
                  <div className="text-xs font-semibold text-white">{t(lang, 'settings.gameplayMods')}</div>
                  {[
                    { key: 'infiniteAmmo' as const, label: 'Infinite Ammo' },
                    { key: 'rapidFire' as const, label: 'Rapid Fire (2.4×)' },
                    { key: 'turboVehicles' as const, label: 'Turbo Vehicles (+55%)' },
                    { key: 'lowGravity' as const, label: 'Low Gravity' },
                    { key: 'noPolice' as const, label: 'No Police (Free Roam)' },
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

                  <div className="pt-2 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-300">{t(lang, 'settings.timeOfDay')}</span>
                      <span className="font-mono-tabular text-amber-300 font-semibold">
                        {t(lang, 'settings.gameClock')}: {gameClockStr}
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                      {(
                        [
                          { id: 'auto', label: 'Auto' },
                          { id: 'sunset', label: 'Sunset' },
                          { id: 'noon', label: 'Noon' },
                          { id: 'night', label: 'Night' },
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
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={gameTimeNormalized}
                      onChange={(e) => onSetTimeOfDay(Number(e.target.value))}
                      className="w-full accent-amber-500"
                    />
                  </div>

                  <div className="pt-2 space-y-2 border-t border-white/10">
                    <div className="text-xs text-slate-300">{t(lang, 'settings.weatherOverride')}</div>
                    <div className="grid grid-cols-4 gap-1.5">
                      {(
                        [
                          { id: 'auto', label: 'Auto' },
                          { id: 'clear', label: 'Clear' },
                          { id: 'partly_cloudy', label: 'Cloudy' },
                          { id: 'overcast', label: 'Overcast' },
                          { id: 'rain', label: 'Rain' },
                          { id: 'storm', label: 'Storm' },
                          { id: 'foggy', label: 'Fog' },
                        ] as const
                      ).map((w) => {
                        const active = (settings.gameplayMods.weatherOverride || 'auto') === w.id;
                        return (
                          <button
                            key={w.id}
                            onClick={() =>
                              onUpdateSettings({
                                ...settings,
                                gameplayMods: { ...settings.gameplayMods, weatherOverride: w.id },
                              })
                            }
                            className={`py-1.5 rounded-lg text-[11px] border ${
                              active
                                ? 'bg-white text-slate-950 border-white font-semibold'
                                : 'bg-slate-950 text-slate-300 border-white/10'
                            }`}
                          >
                            {w.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {cheatSessionActive && (
                    <div className="p-3 rounded-lg bg-rose-500/15 border border-rose-400/35 space-y-2">
                      <div className="text-[11px] text-rose-200 font-semibold">
                        {t(lang, 'settings.cheatLockWarn')}
                      </div>
                      {onRestartCleanSession && (
                        <button
                          onClick={onRestartCleanSession}
                          className="w-full py-1.5 rounded-lg text-xs font-bold bg-rose-500 hover:bg-rose-400 text-white"
                        >
                          {t(lang, 'settings.restartClean')}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* JSON Mod Pack Import/Export */}
              <div className="p-4 rounded-xl bg-slate-900/60 border border-white/10 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-white">{t(lang, 'settings.jsonModTitle')}</div>
                    <div className="text-[11px] text-slate-400">
                      {t(lang, 'settings.jsonModDesc')}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleExportMod}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-200 hover:bg-slate-700 flex items-center gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5" />
                      {t(lang, 'settings.exportJson')}
                    </button>
                    <button
                      onClick={handleImportMod}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-950 flex items-center gap-1.5"
                      style={{ backgroundColor: accent }}
                    >
                      <Upload className="w-3.5 h-3.5" />
                      {t(lang, 'settings.importJson')}
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
                        {t(lang, 'settings.cloud.freeBadge')}
                      </span>
                      <span className="text-[11px] text-slate-400">{t(lang, 'settings.cloud.sub')}</span>
                    </div>
                    <h3 className="font-display text-lg font-bold text-white">
                      {user ? user.displayName || user.email : t(lang, 'settings.cloud.title')}
                    </h3>
                    <p className="text-xs text-slate-400">
                      {user
                        ? t(lang, 'settings.cloud.signedDesc', { email: user.email || '' })
                        : t(lang, 'settings.cloud.guestDesc')}
                    </p>
                  </div>
                  {user ? (
                    <button
                      onClick={onSignOut}
                      className="px-3.5 py-2 rounded-lg text-xs font-medium bg-slate-800 text-slate-200 hover:bg-slate-700 flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <LogOut className="w-4 h-4" />
                      {t(lang, 'settings.cloud.signOut')}
                    </button>
                  ) : (
                    <button
                      onClick={onSignIn}
                      className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-950 flex items-center gap-1.5 whitespace-nowrap"
                      style={{ backgroundColor: accent }}
                    >
                      <LogIn className="w-4 h-4" />
                      {t(lang, 'settings.cloud.signIn')}
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
                      {cloudBusy ? t(lang, 'app.saving') : t(lang, 'settings.cloud.saveBtn')}
                    </button>
                    <button
                      onClick={onLoadCloud}
                      disabled={cloudBusy}
                      className="px-4 py-2 rounded-lg text-xs font-medium bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                    >
                      {t(lang, 'settings.cloud.loadBtn')}
                    </button>
                  </div>
                )}

                {cloudStatus && (
                  <div className="text-xs text-sky-400 font-medium">{cloudStatus}</div>
                )}
              </div>

              {/* Multiplayer & Friends by Nickname */}
              <div className="p-5 rounded-xl bg-slate-900/70 border border-white/10 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-sky-400" />
                      <h4 className="font-display text-base font-bold text-white">
                        {t(lang, 'settings.mp.title')}
                      </h4>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {t(lang, 'settings.mp.desc')}
                    </p>
                  </div>
                  {user && (
                    <span className="px-2.5 py-1 rounded-lg bg-slate-800 font-mono-tabular text-xs text-sky-300 shrink-0">
                      {myFriendCode}
                    </span>
                  )}
                </div>

                {!user ? (
                  <div className="p-3.5 rounded-lg bg-slate-950/60 border border-white/10 text-xs text-slate-300">
                    {t(lang, 'settings.mp.signInHint')}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {onUpdateNickname && (
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault();
                          setMpBusy(true);
                          setMpFeedback(null);
                          try {
                            await onUpdateNickname(nickDraft);
                            setMpFeedback(t(lang, 'app.nickSaved', { nick: nickDraft }));
                          } catch (err) {
                            setMpFeedback(err instanceof Error ? err.message : 'Error');
                          } finally {
                            setMpBusy(false);
                          }
                        }}
                        className="flex items-center gap-2"
                      >
                        <input
                          type="text"
                          value={nickDraft}
                          onChange={(e) => setNickDraft(e.target.value)}
                          placeholder={t(lang, 'phone.nickPlaceholder')}
                          maxLength={24}
                          className="flex-1 px-3 py-2 rounded-lg bg-slate-950 border border-white/15 text-xs text-white focus:outline-none focus:border-sky-400"
                        />
                        <button
                          type="submit"
                          disabled={mpBusy}
                          className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          {t(lang, 'settings.mp.saveNick')}
                        </button>
                      </form>
                    )}

                    {onAddFriend && (
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault();
                          if (!friendSearch.trim()) return;
                          setMpBusy(true);
                          setMpFeedback(null);
                          try {
                            await onAddFriend(friendSearch.trim());
                            setFriendSearch('');
                            setMpFeedback('+ OK');
                          } catch (err) {
                            setMpFeedback(err instanceof Error ? err.message : 'Not found');
                          } finally {
                            setMpBusy(false);
                          }
                        }}
                        className="flex items-center gap-2"
                      >
                        <input
                          type="text"
                          value={friendSearch}
                          onChange={(e) => setFriendSearch(e.target.value)}
                          placeholder={t(lang, 'phone.friendPlaceholder')}
                          className="flex-1 px-3 py-2 rounded-lg bg-slate-950 border border-white/15 text-xs text-white focus:outline-none focus:border-sky-400"
                        />
                        <button
                          type="submit"
                          disabled={mpBusy}
                          className="px-3.5 py-2 rounded-lg text-xs font-bold text-slate-950 flex items-center gap-1.5 disabled:opacity-50"
                          style={{ backgroundColor: accent }}
                        >
                          <UserPlus className="w-3.5 h-3.5" />
                          {t(lang, 'settings.mp.addFriend')}
                        </button>
                      </form>
                    )}

                    {mpFeedback && (
                      <div className="text-xs text-sky-400 font-medium">{mpFeedback}</div>
                    )}

                    {onlinePlayers.filter((p) => p.uid !== user.uid && !friends.some((f) => f.uid === p.uid)).length > 0 && (
                      <div className="p-3 rounded-lg bg-emerald-950/25 border border-emerald-500/25 space-y-2">
                        <div className="text-[11px] font-semibold text-emerald-300">
                          {t(lang, 'settings.mp.onlineNow')}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {onlinePlayers
                            .filter((p) => p.uid !== user.uid && !friends.some((f) => f.uid === p.uid))
                            .map((p) => (
                              <button
                                key={p.uid}
                                type="button"
                                disabled={mpBusy}
                                onClick={async () => {
                                  if (!onAddFriend) return;
                                  setMpBusy(true);
                                  try {
                                    await onAddFriend(p.displayName);
                                    setMpFeedback(`+ ${p.displayName}`);
                                  } catch (err) {
                                    setMpFeedback(err instanceof Error ? err.message : 'Error');
                                  } finally {
                                    setMpBusy(false);
                                  }
                                }}
                                className="px-2.5 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/35 text-xs text-emerald-200 flex items-center gap-1.5"
                              >
                                <UserPlus className="w-3 h-3" />
                                {p.displayName}
                              </button>
                            ))}
                        </div>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <div className="text-xs font-semibold text-slate-400">
                        {t(lang, 'settings.mp.yourFriends', { count: friends.length })}
                      </div>
                      {friends.length === 0 ? (
                        <div className="text-xs text-slate-500">
                          {t(lang, 'settings.mp.noFriends')}
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {friends.map((f) => {
                            const isOnline = onlineUids.includes(f.uid);
                            return (
                              <div
                                key={f.uid}
                                className="p-2.5 rounded-lg bg-slate-950/70 border border-white/10 flex items-center justify-between gap-2"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <span
                                    className={`w-2 h-2 rounded-full shrink-0 ${
                                      isOnline ? 'bg-emerald-400' : 'bg-slate-600'
                                    }`}
                                  />
                                  <div className="min-w-0">
                                    <div className="text-xs font-semibold text-white truncate">
                                      {f.nickname || f.displayName}
                                    </div>
                                    <div className="text-[10px] text-slate-400">
                                      {isOnline ? t(lang, 'settings.mp.onlineInGame') : t(lang, 'settings.mp.offline')} · {f.friendCode}
                                    </div>
                                  </div>
                                </div>
                                {onRemoveFriend && (
                                  <button
                                    type="button"
                                    onClick={() => onRemoveFriend(f.uid)}
                                    className="p-1 text-slate-500 hover:text-rose-400"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Career Statistics */}
              <div className="grid grid-cols-3 gap-4">
                <div className="p-4 rounded-xl bg-slate-900/60 border border-white/10">
                  <div className="text-xs text-slate-400">{t(lang, 'settings.stats.elims')}</div>
                  <div className="font-mono-tabular text-2xl font-bold text-white mt-1">
                    {stats.totalEliminations}
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-slate-900/60 border border-white/10">
                  <div className="text-xs text-slate-400">{t(lang, 'settings.stats.escapes')}</div>
                  <div className="font-mono-tabular text-2xl font-bold text-white mt-1">
                    {stats.policeEscapes}
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-slate-900/60 border border-white/10">
                  <div className="text-xs text-slate-400">{t(lang, 'settings.stats.stunts')}</div>
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
