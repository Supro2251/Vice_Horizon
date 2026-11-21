import React from 'react';
import { X } from 'lucide-react';
import { CharacterId, CharacterState, LanguageCode } from '../types/game';
import { t } from '../i18n/translations';

interface CharacterWheelProps {
  characters: Record<CharacterId, CharacterState>;
  activeCharacterId: CharacterId;
  accentColor: string;
  lang: LanguageCode;
  onSelect: (id: CharacterId) => void;
  onClose: () => void;
}

export const CharacterWheel: React.FC<CharacterWheelProps> = ({
  characters,
  activeCharacterId,
  accentColor,
  lang,
  onSelect,
  onClose,
}) => {
  const list: CharacterState[] = [characters.lucia, characters.mateo, characters.kairo];

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/80 p-6">
      <div className="w-full max-w-4xl bg-[#0b101b] border border-white/12 rounded-2xl p-6 space-y-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-2xl font-bold text-white">{t(lang, 'char.title')}</h2>
            <p className="text-sm text-slate-400">
              {t(lang, 'char.subtitle')}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            aria-label={t(lang, 'settings.close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {list.map((ch) => {
            const isActive = ch.id === activeCharacterId;
            return (
              <button
                key={ch.id}
                onClick={() => {
                  onSelect(ch.id);
                  onClose();
                }}
                className="group text-left rounded-xl overflow-hidden border bg-slate-900/70 transition-all hover:bg-slate-900 flex flex-col"
                style={{
                  borderColor: isActive ? accentColor : 'rgba(255,255,255,0.1)',
                }}
              >
                <div className="relative aspect-square w-full overflow-hidden bg-slate-950">
                  <img
                    src={ch.portraitUrl}
                    alt={ch.name}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0b101b] via-transparent to-transparent" />
                  <div className="absolute bottom-3 left-3 right-3">
                    <div className="text-xs text-slate-300">
                      {ch.district} · {ch.role}
                    </div>
                    <div className="font-display text-xl font-bold text-white">{ch.name}</div>
                  </div>
                </div>

                <div className="p-4 space-y-3 flex-1 flex flex-col justify-between">
                  <p className="text-xs text-slate-300 leading-relaxed">{ch.perkLabel}</p>

                  <div className="space-y-2">
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] font-mono-tabular text-slate-400">
                        <span>{t(lang, 'hud.health')}</span>
                        <span>
                          {Math.round(ch.health)} / {ch.maxHealth}
                        </span>
                      </div>
                      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-500"
                          style={{ width: `${(ch.health / ch.maxHealth) * 100}%` }}
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] font-mono-tabular text-slate-400">
                        <span>{t(lang, 'hud.armor')}</span>
                        <span>
                          {Math.round(ch.armor)} / {ch.maxArmor}
                        </span>
                      </div>
                      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-sky-400"
                          style={{ width: `${(ch.armor / ch.maxArmor) * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  <div
                    className="mt-2 py-2 px-3 rounded-lg text-center text-xs font-semibold"
                    style={{
                      backgroundColor: isActive ? accentColor : 'rgba(255,255,255,0.08)',
                      color: isActive ? '#090d16' : '#f1f5f9',
                    }}
                  >
                    {isActive ? t(lang, 'char.active') : t(lang, 'char.switch')}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
