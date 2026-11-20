import React from 'react';
import { CheckCircle2, Clock, Compass, Lock, MapPin, Navigation, Play, Square, X } from 'lucide-react';
import { MissionProgressRecord } from '../types/game';
import { isMissionUnlocked, MISSIONS, SIDE_DISCOVERY_MISSIONS } from '../data/defaults';

interface MissionsModalProps {
  missionsProgress: Record<string, MissionProgressRecord>;
  discoveredSideIds: string[];
  activeMissionId: string | null;
  accentColor: string;
  onStartMission: (missionId: string) => void;
  onNavigateGps: (x: number, z: number, label: string) => void;
  onCancelMission: () => void;
  onClose: () => void;
}

export const MissionsModal: React.FC<MissionsModalProps> = ({
  missionsProgress,
  discoveredSideIds,
  activeMissionId,
  accentColor,
  onStartMission,
  onNavigateGps,
  onCancelMission,
  onClose,
}) => {
  const orderedMissions = [...MISSIONS].sort((a, b) => a.storyOrder - b.storyOrder);
  const discoveredSides = SIDE_DISCOVERY_MISSIONS.filter((sm) => discoveredSideIds.includes(sm.id));

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/80 p-6">
      <div className="w-full max-w-3xl max-h-[85vh] flex flex-col bg-[#0b101b] border border-white/12 rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
          <div>
            <h2 className="font-display text-2xl font-bold text-white">Príbeh a misie Leonidy</h2>
            <p className="text-xs text-slate-400">
              {MISSIONS.length} hlavných kapitol s postupnou náročnosťou a tajné objavy na ostrove.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Zavrieť"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-4">
          {orderedMissions.map((m) => {
            const prog = missionsProgress[m.id];
            const unlocked = isMissionUnlocked(m.id, missionsProgress);
            const isRunning = activeMissionId === m.id;
            const isDone = (prog?.completedCount ?? 0) > 0;

            return (
              <div
                key={m.id}
                className="p-5 rounded-xl bg-slate-900/65 border flex flex-col md:flex-row md:items-center justify-between gap-4"
                style={{
                  borderColor: isRunning ? accentColor : 'rgba(255,255,255,0.1)',
                  opacity: unlocked ? 1 : 0.65,
                }}
              >
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <span>Zadávateľ: {m.giver}</span>
                    <span>·</span>
                    <span className="font-mono-tabular text-emerald-400 font-semibold">
                      Odmena ${m.rewardCash.toLocaleString('sk-SK')}
                    </span>
                    {m.difficulty && (
                      <>
                        <span>·</span>
                        <span
                          className={
                            m.difficulty === 'Extrémna'
                              ? 'text-rose-400 font-semibold'
                              : m.difficulty === 'Ťažká'
                                ? 'text-amber-300 font-semibold'
                                : m.difficulty === 'Stredná'
                                  ? 'text-sky-300'
                                  : 'text-slate-300'
                          }
                        >
                          {m.difficulty}
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
                          Splnené {prog.completedCount}× ({prog.bestTimeSec}s)
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
                    {m.title}
                  </h3>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {unlocked
                      ? m.subtitle
                      : 'Zamknuté — dokonči predchádzajúcu príbehovú kapitolu pre odomknutie.'}
                  </p>
                </div>

                <div className="shrink-0 flex items-center gap-2">
                  {!unlocked ? (
                    <span className="px-3.5 py-2 rounded-lg text-xs font-medium bg-slate-800 text-slate-400 flex items-center gap-1.5 whitespace-nowrap">
                      <Lock className="w-3.5 h-3.5" />
                      Zamknuté
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
                      Zrušiť misiu
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          onNavigateGps(m.startX, m.startZ, m.title);
                          onClose();
                        }}
                        className="px-3 py-2 rounded-lg text-xs font-medium bg-slate-800 text-sky-300 hover:bg-slate-700 flex items-center gap-1.5 whitespace-nowrap"
                        title="Nastaviť GPS trasu na miesto začiatku"
                      >
                        <Navigation className="w-3.5 h-3.5" />
                        Navigovať GPS
                      </button>
                      <button
                        onClick={() => {
                          onStartMission(m.id);
                          onClose();
                        }}
                        className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-950 flex items-center gap-1.5 whitespace-nowrap"
                        style={{ backgroundColor: accentColor }}
                      >
                        <Play className="w-3.5 h-3.5" />
                        {isDone ? 'Zopakovať' : 'Spustiť misiu'}
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
              Objavené tajné vedľajšie misie ({discoveredSides.length}/{SIDE_DISCOVERY_MISSIONS.length})
            </div>
            {discoveredSides.length === 0 ? (
              <div className="p-4 rounded-xl bg-slate-900/50 border border-white/8 text-xs text-slate-400">
                Preskúmaj 15× ostrov (lesné chodníky, maják, vraky, letisko, prístav) — objavené tajné misie sa zobrazia tu.
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
                        <span className="text-purple-300 font-semibold">Tajný objav</span>
                        <span>·</span>
                        <span className="font-mono-tabular text-emerald-400 font-semibold">
                          ${sm.rewardCash.toLocaleString('sk-SK')}
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
                            <span className="text-emerald-400">Splnené {prog.completedCount}×</span>
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
                          onClick={() => {
                            onStartMission(sm.id);
                            onClose();
                          }}
                          className="px-3.5 py-2 rounded-lg text-xs font-semibold text-slate-950 flex items-center gap-1"
                          style={{ backgroundColor: accentColor }}
                        >
                          <Play className="w-3.5 h-3.5" /> Spustiť
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
