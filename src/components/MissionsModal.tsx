import React from 'react';
import { CheckCircle2, Clock, Compass, Lock, MapPin, Navigation, PackageCheck, Play, RotateCcw, Square, X } from 'lucide-react';
import { LanguageCode, MissionProgressRecord } from '../types/game';
import { isMissionUnlocked, MISSIONS, SIDE_DISCOVERY_MISSIONS } from '../data/defaults';
import { t } from '../i18n/translations';

interface MissionsModalProps {
  lang: LanguageCode;
  missionsProgress: Record<string, MissionProgressRecord>;
  discoveredSideIds: string[];
  activeMissionId: string | null;
  cheatSessionActive?: boolean;
  accentColor: string;
  onStartMission: (missionId: string) => void;
  onNavigateGps: (x: number, z: number, label: string) => void;
  onCancelMission: () => void;
  onRestartCleanSession?: () => void;
  onClose: () => void;
}

export const MissionsModal: React.FC<MissionsModalProps> = ({
  lang,
  missionsProgress,
  discoveredSideIds,
  activeMissionId,
  cheatSessionActive = false,
  accentColor,
  onStartMission,
  onNavigateGps,
  onCancelMission,
  onRestartCleanSession,
  onClose,
}) => {
  const orderedMissions = [...MISSIONS].sort((a, b) => a.storyOrder - b.storyOrder);
  const storyMissions = orderedMissions.filter((m) => !m.requiresGslCourier);
  const completedStoryCount = storyMissions.filter((m) => (missionsProgress[m.id]?.completedCount ?? 0) > 0).length;
  const discoveredSides = SIDE_DISCOVERY_MISSIONS.filter((sm) => discoveredSideIds.includes(sm.id));

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/80 p-6">
      <div className="w-full max-w-3xl max-h-[85vh] flex flex-col bg-[#0b101b] border border-white/12 rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <h2 className="font-display text-2xl font-bold text-white">{t(lang, 'missions.title')}</h2>
              <span className="font-mono-tabular text-xs font-bold px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-400/30 text-emerald-300">
                {completedStoryCount}/{storyMissions.length}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              {t(lang, 'missions.subtitle', { count: MISSIONS.length })}
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

        <div className="p-6 overflow-y-auto space-y-4">
          {cheatSessionActive && (
            <div className="p-4 rounded-xl bg-rose-500/15 border border-rose-400/40 flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="text-sm font-bold text-rose-200">
                  {t(lang, 'missions.cheatWarnTitle')}
                </div>
                <div className="text-xs text-rose-100/80">
                  {t(lang, 'missions.cheatWarnDesc')}
                </div>
              </div>
              {onRestartCleanSession && (
                <button
                  onClick={() => onRestartCleanSession()}
                  className="px-4 py-2 rounded-lg text-xs font-bold bg-rose-500 hover:bg-rose-400 text-white flex items-center gap-1.5 shrink-0"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  {t(lang, 'missions.restartClean')}
                </button>
              )}
            </div>
          )}

          {orderedMissions.map((m) => {
            const prog = missionsProgress[m.id];
            const unlocked = isMissionUnlocked(m.id, missionsProgress);
            const isRunning = activeMissionId === m.id;
            const isDone = (prog?.completedCount ?? 0) > 0;
            const titleText = m.requiresGslCourier ? t(lang, 'mission.gsl.title') : m.title;
            const subtitleText = m.requiresGslCourier ? t(lang, 'mission.gsl.subtitle') : m.subtitle;

            return (
              <div
                key={m.id}
                className="p-5 rounded-xl bg-slate-900/65 border flex flex-col md:flex-row md:items-center justify-between gap-4"
                style={{
                  borderColor: isRunning ? accentColor : m.requiresGslCourier ? 'rgba(245,158,11,0.35)' : 'rgba(255,255,255,0.1)',
                  opacity: unlocked ? 1 : 0.65,
                }}
              >
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <span>{t(lang, 'missions.giver')}: {m.giver}</span>
                    <span>·</span>
                    <span className="font-mono-tabular text-emerald-400 font-semibold">
                      {t(lang, 'missions.reward')} ${m.rewardCash.toLocaleString()}
                    </span>
                    {m.difficulty && (
                      <>
                        <span>·</span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                            m.difficulty === 'Extrémna'
                              ? 'bg-rose-500/15 border-rose-400/35 text-rose-300'
                              : m.difficulty === 'Ťažká'
                                ? 'bg-amber-500/15 border-amber-400/35 text-amber-300'
                                : m.difficulty === 'Stredná'
                                  ? 'bg-sky-500/15 border-sky-400/35 text-sky-300'
                                  : 'bg-emerald-500/15 border-emerald-400/35 text-emerald-300'
                          }`}
                        >
                          {m.difficulty}
                        </span>
                      </>
                    )}
                    {m.requiresGslCourier && (
                      <>
                        <span>·</span>
                        <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-400/40 text-[10px] font-bold text-amber-300 inline-flex items-center gap-1">
                          <PackageCheck className="w-3 h-3" />
                          {t(lang, 'missions.specialCourier')}
                        </span>
                      </>
                    )}
                    {m.estimatedMinutes && (
                      <>
                        <span>·</span>
                        <span className="inline-flex items-center gap-1 text-slate-300">
                          <Clock className="w-3 h-3" /> {m.estimatedMinutes}
                        </span>
                      </>
                    )}
                    {isDone && (
                      <>
                        <span>·</span>
                        <span className="inline-flex items-center gap-1 text-emerald-400">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {t(lang, 'missions.completed', { count: prog.completedCount, sec: prog.bestTimeSec })}
                        </span>
                      </>
                    )}
                  </div>

                  <h3 className="font-display text-lg font-bold text-white flex items-center gap-2">
                    {unlocked ? (
                      <MapPin className="w-4 h-4" style={{ color: accentColor }} />
                    ) : (
                      <Lock className="w-4 h-4 text-slate-500" />
                    )}
                    {titleText}
                  </h3>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {unlocked ? subtitleText : t(lang, 'missions.lockedDesc')}
                  </p>
                  {m.requiresGslCourier && (
                    <div className="text-[10px] font-mono-tabular font-semibold text-amber-300/90">
                      {t(lang, 'missions.gslBadge')}
                    </div>
                  )}
                </div>

                <div className="shrink-0 flex items-center gap-2">
                  {!unlocked ? (
                    <span className="px-3.5 py-2 rounded-lg text-xs font-medium bg-slate-800 text-slate-400 flex items-center gap-1.5 whitespace-nowrap">
                      <Lock className="w-3.5 h-3.5" />
                      {t(lang, 'missions.locked')}
                    </span>
                  ) : isRunning ? (
                    <button
                      onClick={() => {
                        onCancelMission();
                        onClose();
                      }}
                      className="px-4 py-2 rounded-lg text-xs font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30 flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <Square className="w-3.5 h-3.5" />
                      {t(lang, 'missions.abort')}
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          onNavigateGps(m.startX, m.startZ, titleText);
                          onClose();
                        }}
                        className="px-3 py-2 rounded-lg text-xs font-medium bg-slate-800 text-sky-300 hover:bg-slate-700 flex items-center gap-1.5 whitespace-nowrap"
                      >
                        <Navigation className="w-3.5 h-3.5" />
                        {t(lang, 'missions.navGps')}
                      </button>
                      <button
                        disabled={cheatSessionActive}
                        onClick={() => {
                          onStartMission(m.id);
                          onClose();
                        }}
                        className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-950 flex items-center gap-1.5 whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ backgroundColor: accentColor }}
                      >
                        {cheatSessionActive ? <Lock className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                        {cheatSessionActive ? t(lang, 'missions.lockedCheats') : isDone ? t(lang, 'missions.repeat') : t(lang, 'missions.start')}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}

          {/* Discovered Side Missions */}
          <div className="pt-3 border-t border-white/10 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-purple-300 flex items-center gap-1.5">
              <Compass className="w-4 h-4" />
              {t(lang, 'missions.sideTitle', { found: discoveredSides.length, total: SIDE_DISCOVERY_MISSIONS.length })}
            </div>
            {discoveredSides.length === 0 ? (
              <div className="p-4 rounded-xl bg-slate-900/50 border border-white/8 text-xs text-slate-400">
                {t(lang, 'missions.sideEmpty')}
              </div>
            ) : (
              discoveredSides.map((sm) => {
                const prog = missionsProgress[sm.id];
                const isRunning = activeMissionId === sm.id;
                const isDone = (prog?.completedCount ?? 0) > 0;
                return (
                  <div
                    key={sm.id}
                    className="p-4 rounded-xl bg-slate-900/65 border border-purple-400/25 flex flex-col md:flex-row md:items-center justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                        <span className="text-purple-300 font-semibold">{t(lang, 'missions.secretDiscovery')}</span>
                        <span>·</span>
                        <span className="font-mono-tabular text-emerald-400 font-semibold">
                          ${sm.rewardCash.toLocaleString()}
                        </span>
                        {sm.estimatedMinutes && (
                          <>
                            <span>·</span>
                            <span>{sm.estimatedMinutes}</span>
                          </>
                        )}
                        {isDone && (
                          <>
                            <span>·</span>
                            <span className="text-emerald-400">
                              {t(lang, 'missions.completed', { count: prog.completedCount, sec: prog.bestTimeSec })}
                            </span>
                          </>
                        )}
                      </div>
                      <h4 className="font-display text-base font-bold text-white">{sm.title}</h4>
                      <p className="text-xs text-slate-300">{sm.subtitle}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => {
                          onNavigateGps(sm.startX, sm.startZ, sm.title);
                          onClose();
                        }}
                        className="px-3 py-2 rounded-lg text-xs font-medium bg-slate-800 text-sky-300 hover:bg-slate-700 flex items-center gap-1"
                      >
                        <Navigation className="w-3.5 h-3.5" /> GPS
                      </button>
                      {!isRunning && (
                        <button
                          disabled={cheatSessionActive}
                          onClick={() => {
                            onStartMission(sm.id);
                            onClose();
                          }}
                          className="px-3.5 py-2 rounded-lg text-xs font-semibold text-slate-950 flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                          style={{ backgroundColor: accentColor }}
                        >
                          {cheatSessionActive ? <Lock className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                          {cheatSessionActive ? t(lang, 'missions.locked') : t(lang, 'missions.start')}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
