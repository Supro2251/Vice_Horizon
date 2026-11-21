import React, { useEffect } from 'react';
import { ChevronRight, FastForward } from 'lucide-react';
import { ActiveCutsceneState, LanguageCode } from '../types/game';
import { t } from '../i18n/translations';

interface CutsceneOverlayProps {
  cutscene: ActiveCutsceneState;
  accentColor: string;
  lang: LanguageCode;
  onNext: () => void;
  onSkip: () => void;
}

export const CutsceneOverlay: React.FC<CutsceneOverlayProps> = ({
  cutscene,
  accentColor,
  lang,
  onNext,
  onSkip,
}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        onNext();
      } else if (e.code === 'Escape') {
        e.preventDefault();
        onSkip();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onNext, onSkip]);

  const isLast = cutscene.lineIndex >= cutscene.totalLines - 1;

  return (
    <div className="fixed inset-0 z-40 pointer-events-auto flex flex-col justify-between">
      {/* Top Letterbox Bar */}
      <div className="h-[11vh] min-h-[72px] bg-black/95 border-b border-white/10 px-6 md:px-10 flex items-center justify-between">
        <div>
          <div
            className="text-[11px] font-bold uppercase tracking-[0.22em]"
            style={{ color: accentColor }}
          >
            {t(lang, 'cutscene.storyScene')}
          </div>
          <h2 className="font-display text-lg md:text-xl font-bold text-white">
            {cutscene.title}
          </h2>
        </div>

        <button
          onClick={onSkip}
          className="px-3.5 py-2 rounded-lg text-xs font-medium bg-white/10 text-slate-200 hover:bg-white/20 flex items-center gap-1.5 transition-colors"
        >
          <FastForward className="w-3.5 h-3.5" />
          {t(lang, 'cutscene.skip')}
        </button>
      </div>

      {/* Bottom Letterbox Dialogue Bar */}
      <div className="min-h-[18vh] bg-black/95 border-t border-white/10 px-6 md:px-12 py-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-5">
        <div className="max-w-4xl space-y-1.5">
          <div className="flex items-center gap-3">
            <span
              className="text-xs font-bold uppercase tracking-wider"
              style={{ color: accentColor }}
            >
              {cutscene.speaker}
            </span>
            <span className="font-mono-tabular text-[11px] text-slate-500">
              {cutscene.lineIndex + 1} / {cutscene.totalLines}
            </span>
          </div>
          <p className="text-sm md:text-base text-slate-100 leading-relaxed">
            „{cutscene.text}“
          </p>
        </div>

        <button
          onClick={onNext}
          className="px-5 py-2.5 rounded-xl text-xs font-bold text-slate-950 flex items-center gap-1.5 shrink-0 transition-transform active:scale-95"
          style={{ backgroundColor: accentColor }}
        >
          <span>{isLast ? t(lang, 'cutscene.action') : t(lang, 'cutscene.next')}</span>
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
