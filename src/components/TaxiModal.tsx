import React from 'react';
import { Car, MapPin, Navigation, Shuffle, X } from 'lucide-react';
import { LanguageCode } from '../types/game';
import { t } from '../i18n/translations';

interface TaxiModalProps {
  lang: LanguageCode;
  playerX: number;
  playerZ: number;
  cash: number;
  accentColor: string;
  onSelectDestination: (x: number, z: number, label: string) => void;
  onTakeWheel: () => void;
  onClose: () => void;
}

const TAXI_DESTINATIONS = [
  { label: 'Bayshore International Airport', district: 'Hangars & Runways', x: -960, z: 750 },
  { label: 'Coral Villa Safehouse & Garage', district: 'Private Villa', x: 420, z: -484 },
  { label: 'Vice General Hospital', district: 'North Midtown', x: -90, z: -592 },
  { label: 'Downtown Plaza', district: 'City Center', x: 0, z: -90 },
  { label: 'Marina Harbor & Yachts', district: 'South Docks', x: 520, z: 685 },
  { label: 'Bayshore Customs Tuning', district: 'Garage & Paint', x: -540, z: 156 },
  { label: 'Ammu-Nation & Shooting Range', district: 'Armory', x: 185, z: -224 },
  { label: 'Coral Beach & Boardwalk', district: 'East Coast', x: 820, z: -90 },
  { label: 'North Heights & Mountain Lodge', district: 'North Heights', x: 0, z: -1060 },
];

export const TaxiModal: React.FC<TaxiModalProps> = ({
  lang,
  playerX,
  playerZ,
  cash,
  accentColor,
  onSelectDestination,
  onTakeWheel,
  onClose,
}) => {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/80 p-6">
      <div className="w-full max-w-xl max-h-[85vh] flex flex-col bg-[#0b101b] border border-white/12 rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Car className="w-5 h-5" style={{ color: accentColor }} />
            <div>
              <h2 className="font-display text-xl font-bold text-white">{t(lang, 'taxiModal.title')}</h2>
              <p className="text-xs text-slate-400">
                {t(lang, 'taxiModal.subtitle')}
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

        <div className="p-5 overflow-y-auto space-y-2.5">
          {TAXI_DESTINATIONS.map((dest) => {
            const dist = Math.round(Math.hypot(dest.x - playerX, dest.z - playerZ));
            const fare = Math.max(85, Math.round(dist * 0.25));
            const affordable = cash >= fare;
            return (
              <button
                key={dest.label}
                disabled={!affordable}
                onClick={() => {
                  onSelectDestination(dest.x, dest.z, dest.label);
                  onClose();
                }}
                className="w-full p-3.5 rounded-xl bg-slate-900/75 border border-white/10 hover:border-white/30 text-left flex items-center justify-between gap-3 transition-colors disabled:opacity-45"
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white flex items-center gap-2">
                    <MapPin className="w-3.5 h-3.5 shrink-0" style={{ color: accentColor }} />
                    <span className="truncate">{dest.label}</span>
                  </div>
                  <div className="text-xs text-slate-400 pl-5">
                    {dest.district} · {dist} m
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-mono-tabular text-xs font-bold text-emerald-400">
                    ${fare}
                  </span>
                  <Navigation className="w-4 h-4 text-sky-400" />
                </div>
              </button>
            );
          })}
        </div>

        <div className="px-5 py-3.5 border-t border-white/10 bg-[#090d16] flex items-center justify-between gap-3">
          <span className="text-xs text-slate-400">
            {t(lang, 'taxiModal.cashLabel')}{' '}
            <strong className="font-mono-tabular text-emerald-400">${cash.toLocaleString()}</strong>
          </span>
          <button
            onClick={() => {
              onTakeWheel();
              onClose();
            }}
            className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 flex items-center gap-1.5"
          >
            <Shuffle className="w-3.5 h-3.5" />
            {t(lang, 'taxiModal.takeWheel')}
          </button>
        </div>
      </div>
    </div>
  );
};
