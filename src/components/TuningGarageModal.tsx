import React, { useState } from 'react';
import { Gauge, Shield, Sparkles, Wrench, X, Zap } from 'lucide-react';
import { HudTelemetry, LanguageCode } from '../types/game';
import { t } from '../i18n/translations';

interface TuningGarageModalProps {
  cash: number;
  telemetry: HudTelemetry;
  accentColor: string;
  lang: LanguageCode;
  onRepairOrRepaint: (colorHex?: string) => boolean;
  onUpgrade: (type: 'engine' | 'turbo' | 'armor' | 'suspension') => { ok: boolean; message: string };
  onClose: () => void;
}

const GARAGE_COLORS = [
  { name: 'Coral Orange', hex: '#f97316' },
  { name: 'Vice Turquoise', hex: '#06b6d4' },
  { name: 'Crimson Red', hex: '#e11d48' },
  { name: 'Midnight Blue', hex: '#1d4ed8' },
  { name: 'Emerald Green', hex: '#10b981' },
  { name: 'Obsidian Black', hex: '#18181b' },
  { name: 'Metallic Gold', hex: '#eab308' },
  { name: 'Platinum White', hex: '#f8fafc' },
];

export const TuningGarageModal: React.FC<TuningGarageModalProps> = ({
  cash,
  telemetry,
  accentColor,
  lang,
  onRepairOrRepaint,
  onUpgrade,
  onClose,
}) => {
  const [feedback, setFeedback] = useState<string | null>(null);
  const repairCost = Math.max(180, telemetry.nearbyRepairCost || 180);

  const handleUpgrade = (type: 'engine' | 'turbo' | 'armor' | 'suspension') => {
    const res = onUpgrade(type);
    setFeedback(res.message);
  };

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/82 p-4 md:p-6">
      <div className="w-full max-w-xl bg-[#0b101b] border border-white/12 rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Wrench className="w-5 h-5" style={{ color: accentColor }} />
            <div>
              <h2 className="font-display text-xl font-bold text-white">{t(lang, 'tuning.title')}</h2>
              <p className="text-xs text-slate-400">
                {t(lang, 'tuning.subtitle')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10"
            aria-label={t(lang, 'settings.close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5 max-h-[78vh] overflow-y-auto">
          <div className="flex items-center justify-between p-3 rounded-xl bg-slate-900/70 border border-white/10 text-xs">
            <div>
              <span className="text-slate-400">{t(lang, 'tuning.vehicleLabel')} </span>
              <span className="font-semibold text-white">
                {telemetry.vehicleName
                  ? `${telemetry.vehicleBrand} ${telemetry.vehicleName}`
                  : t(lang, 'tuning.parkedGate')}
              </span>
              {telemetry.inVehicle && (
                <span className="ml-2 font-mono-tabular text-amber-300">
                  ({telemetry.vehicleHealthPct}%)
                </span>
              )}
            </div>
            <span className="font-mono-tabular text-base font-bold text-emerald-400">
              ${cash.toLocaleString('en-US')}
            </span>
          </div>

          <button
            disabled={cash < repairCost}
            onClick={() => {
              const ok = onRepairOrRepaint();
              setFeedback(ok ? `OK (-$${repairCost})` : t(lang, 'tuning.parkedGate'));
            }}
            className="w-full py-2.5 px-4 rounded-xl text-xs font-bold text-slate-950 disabled:opacity-40 transition-opacity"
            style={{ backgroundColor: accentColor }}
          >
            {t(lang, 'tuning.repairAll', { cost: repairCost })}
          </button>

          {/* Performance & Armor Upgrades */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-300">{t(lang, 'tuning.upgrades')}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                onClick={() => handleUpgrade('engine')}
                className="p-3 rounded-xl bg-slate-900/70 border border-white/10 hover:border-white/25 text-left flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2">
                  <Gauge className="w-4 h-4 text-amber-400 shrink-0" />
                  <div>
                    <div className="text-xs font-semibold text-white">{t(lang, 'tuning.engine')}</div>
                    <div className="text-[11px] text-slate-400">{t(lang, 'tuning.engineDesc')}</div>
                  </div>
                </div>
                <span className="text-[11px] font-mono-tabular text-emerald-400 font-bold">$2,800</span>
              </button>

              <button
                onClick={() => handleUpgrade('turbo')}
                className="p-3 rounded-xl bg-slate-900/70 border border-white/10 hover:border-white/25 text-left flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-sky-400 shrink-0" />
                  <div>
                    <div className="text-xs font-semibold text-white">{t(lang, 'tuning.turbo')}</div>
                    <div className="text-[11px] text-slate-400">{t(lang, 'tuning.turboDesc')}</div>
                  </div>
                </div>
                <span className="text-[11px] font-mono-tabular text-emerald-400 font-bold">$8,500</span>
              </button>

              <button
                onClick={() => handleUpgrade('armor')}
                className="p-3 rounded-xl bg-slate-900/70 border border-white/10 hover:border-white/25 text-left flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-emerald-400 shrink-0" />
                  <div>
                    <div className="text-xs font-semibold text-white">{t(lang, 'tuning.armor')}</div>
                    <div className="text-[11px] text-slate-400">{t(lang, 'tuning.armorDesc')}</div>
                  </div>
                </div>
                <span className="text-[11px] font-mono-tabular text-emerald-400 font-bold">$4,200</span>
              </button>

              <button
                onClick={() => handleUpgrade('suspension')}
                className="p-3 rounded-xl bg-slate-900/70 border border-white/10 hover:border-white/25 text-left flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-purple-400 shrink-0" />
                  <div>
                    <div className="text-xs font-semibold text-white">{t(lang, 'tuning.suspension')}</div>
                    <div className="text-[11px] text-slate-400">{t(lang, 'tuning.suspensionDesc')}</div>
                  </div>
                </div>
                <span className="text-[11px] font-mono-tabular text-emerald-400 font-bold">$2,400</span>
              </button>
            </div>
          </div>

          {/* Paint Swatches */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-300">{t(lang, 'tuning.paint')}</div>
            <div className="grid grid-cols-4 gap-2.5">
              {GARAGE_COLORS.map((c) => (
                <button
                  key={c.hex}
                  disabled={cash < 1200}
                  onClick={() => {
                    const ok = onRepairOrRepaint(c.hex);
                    setFeedback(ok ? `${c.name} (-$1,200)` : t(lang, 'tuning.parkedGate'));
                  }}
                  title={c.name}
                  className="h-9 rounded-lg border border-white/20 hover:scale-105 transition-transform disabled:opacity-40"
                  style={{ backgroundColor: c.hex }}
                />
              ))}
            </div>
          </div>

          {feedback && (
            <div className="text-xs text-sky-400 font-medium">{feedback}</div>
          )}
        </div>
      </div>
    </div>
  );
};
