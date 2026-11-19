import React from 'react';
import { CheckCircle2, Lock, MapPin, Navigation, Play, Square, X } from 'lucide-react';
import { MissionProgressRecord } from '../types/game';
import { isMissionUnlocked, MISSIONS } from '../data/defaults';

interface MissionsModalProps {
  missionsProgress: Record<string, MissionProgressRecord>;
  activeMissionId: string | null;
  accentColor: string;
  onStartMission: (missionId: string) => void;
  onNavigateGps: (x: number, z: number, label: string) => void;
  onCancelMission: () => void;
  onClose: () => void;
}

export const MissionsModal: React.FC<MissionsModalProps> = ({
  missionsProgress,
  activeMissionId,
  accentColor,
  onStartMission,
  onNavigateGps,
  onCancelMission,
  onClose,
}) => {
  const orderedMissions = [...MISSIONS].sort((a, b) => a.storyOrder - b.storyOrder);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/80 p-6">
      <div className="w-full max-w-3xl max-h-[85vh] flex flex-col bg-[#0b101b] border border-white/12 rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
          <div>
            <h2 className="font-display text-2xl font-bold text-white">Príbeh a misie Leonidy</h2>
            <p className="text-xs text-slate-400">
              Dokonči aktuálnu kapitolu pre odomknutie ďalšej časti príbehu alebo si zapni GPS trasu k začiatku.
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
                    {m.timeLimitSec && (
                      <>
                        <span>·</span>
                        <span>Limit {m.timeLimitSec}s</span>
                      </>
                    )}
                    {isDone && (
                      <>
                        <span>·</span>
                        <span className="inline-flex items-center gap-1 text-emerald-400">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Splnené {prog.completedCount}× (najlepší čas {prog.bestTimeSec}s)
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
        </div>
      </div>
    </div>
  );
};
