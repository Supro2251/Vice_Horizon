import React, { useState } from 'react';
import { User } from 'firebase/auth';
import {
  Bot,
  Car,
  Copy,
  Delete,
  Navigation,
  Phone,
  PhoneCall,
  Plane,
  Radio,
  RotateCcw,
  Send,
  ShieldAlert,
  Smartphone,
  Terminal,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  FriendRecord,
  LanguageCode,
  OnlinePlayerInfo,
  RadioStationId,
  RemotePlayerState,
  SavedGarageState,
} from '../types/game';
import { RADIO_STATIONS, SHOPS } from '../data/defaults';
import { t } from '../i18n/translations';

interface PhoneOverlayProps {
  user: User | null;
  myNickname: string;
  myFriendCode: string;
  friends: FriendRecord[];
  onlineUids: string[];
  onlinePlayers: OnlinePlayerInfo[];
  remotePlayers: RemotePlayerState[];
  activeMissionId: string | null;
  savedGarage: SavedGarageState;
  gameClockStr: string;
  district: string;
  weatherLabel: string;
  radioStation: RadioStationId;
  radioTrack: string;
  cheatSessionActive: boolean;
  accentColor: string;
  lang: LanguageCode;
  onSignIn: () => void;
  onUpdateNickname: (nickname: string) => Promise<void>;
  onAddFriend: (query: string) => Promise<void>;
  onRemoveFriend: (uid: string) => Promise<void>;
  onInviteFriend: (friendUid: string) => void;
  onSetGps: (x: number, z: number, label: string) => void;
  onTeleportToFriend: (player: RemotePlayerState) => void;
  onCallTaxi: () => void;
  onStartTaxiShift: () => void;
  onRetrieveVehicle: (facility: 'hangar' | 'safehouse', index: number) => void;
  onSetRadioStation: (stationId: RadioStationId) => void;
  onApplyCheat: (code: string) => { ok: boolean; message: string };
  onRestartCleanSession: () => void;
  onClose: () => void;
}

const CHEAT_DIRECTORY = [
  { number: '3324', label: 'Nesmrteľnosť (God Mode)' },
  { number: '5342', label: 'Spawn vrtuľníka Pelican' },
  { number: '7645', label: 'Spawn Horizon Cab taxíka' },
  { number: '7726', label: 'Spawn superšportu Valkyra' },
  { number: '8654', label: 'Spawn lietadla Skylark' },
  { number: '9975', label: 'Spawn ozbrojenej stíhačky F-22' },
  { number: '1999-887-853', label: '100% Zdravie a Vesta' },
  { number: '1999-529-937', label: 'Zrušiť policajné pátranie' },
  { number: '1999-759-348', label: 'Získať taktický padák' },
  { number: '1999-866-587', label: 'Všetky zbrane + munícia' },
];

export const PhoneOverlay: React.FC<PhoneOverlayProps> = ({
  user,
  myNickname,
  myFriendCode,
  friends,
  onlineUids,
  onlinePlayers,
  remotePlayers,
  activeMissionId,
  savedGarage,
  gameClockStr,
  district,
  weatherLabel,
  radioStation,
  radioTrack,
  cheatSessionActive,
  accentColor,
  lang,
  onSignIn,
  onUpdateNickname,
  onAddFriend,
  onRemoveFriend,
  onInviteFriend,
  onSetGps,
  onTeleportToFriend,
  onCallTaxi,
  onStartTaxiShift,
  onRetrieveVehicle,
  onSetRadioStation,
  onApplyCheat,
  onRestartCleanSession,
  onClose,
}) => {
  const [tab, setTab] = useState<'friends' | 'taxi' | 'garage' | 'radio' | 'cheats' | 'ai'>('friends');
  const [nickInput, setNickInput] = useState(myNickname);
  const [nickBusy, setNickBusy] = useState(false);
  const [friendQuery, setFriendQuery] = useState('');
  const [friendMsg, setFriendMsg] = useState<string | null>(null);
  const [friendBusy, setFriendBusy] = useState(false);
  const [cheatInput, setCheatInput] = useState('');
  const [cheatMsg, setCheatMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMessages, setAiMessages] = useState<{ role: 'user' | 'ai'; text: string }[]>([
    {
      role: 'ai',
      text: t(lang, 'phone.aiWelcome'),
    },
  ]);

  const onlineSet = new Set(onlineUids);

  const handleCopyCode = () => {
    if (!myFriendCode) return;
    navigator.clipboard?.writeText(myFriendCode).catch(() => {});
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 1800);
  };

  const submitFriend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!friendQuery.trim()) return;
    setFriendBusy(true);
    setFriendMsg(null);
    try {
      await onAddFriend(friendQuery);
      setFriendQuery('');
      setFriendMsg('Kamarát pridaný! Ak je pripojený, automaticky sa objaví v meste.');
    } catch (err) {
      setFriendMsg(err instanceof Error ? err.message : 'Nepodarilo sa pridať priateľa.');
    } finally {
      setFriendBusy(false);
    }
  };

  const dialCheat = (codeToRun: string) => {
    const res = onApplyCheat(codeToRun);
    setCheatMsg({ ok: res.ok, text: res.message });
    if (res.ok) setCheatInput('');
  };

  const submitAiChat = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = aiPrompt.trim();
    if (!q || aiBusy) return;
    setAiPrompt('');
    setAiMessages((prev) => [...prev, { role: 'user', text: q }]);
    setAiBusy(true);
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: q,
          language: lang,
          context: { district, weather: weatherLabel, clock: gameClockStr, activeMissionId },
        }),
      });
      const data = await res.json();
      setAiMessages((prev) => [
        ...prev,
        { role: 'ai', text: data?.reply || '...' },
      ]);
    } catch {
      setAiMessages((prev) => [
        ...prev,
        { role: 'ai', text: 'Vice AI offline.' },
      ]);
    } finally {
      setAiBusy(false);
    }
  };

  const emergencyServices = SHOPS.filter(
    (s) =>
      s.category === 'hospital' ||
      s.category === 'police_station' ||
      s.category === 'fire_station'
  );

  return (
    <div className="fixed right-5 bottom-20 z-30 w-[356px] max-w-[calc(100vw-2.5rem)] h-[560px] max-h-[82vh] flex flex-col rounded-3xl bg-[#090e1a] border-2 border-white/15 shadow-2xl overflow-hidden">
      {/* Phone Status Bar */}
      <div className="px-4 pt-3 pb-2 bg-[#060912] border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Smartphone className="w-4 h-4" style={{ color: accentColor }} />
          <span className="font-display text-sm font-bold text-white">iVice OS</span>
          <span className="font-mono-tabular text-xs text-slate-400">{gameClockStr}</span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10"
          aria-label="Zavrieť telefón"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* App Switcher Tabs */}
      <div className="grid grid-cols-6 border-b border-white/10 bg-[#0b1120]">
        {[
          { id: 'friends' as const, label: t(lang, 'phone.tab.friends'), icon: Users },
          { id: 'taxi' as const, label: t(lang, 'phone.tab.taxi'), icon: Car },
          { id: 'garage' as const, label: t(lang, 'phone.tab.garage'), icon: Plane },
          { id: 'radio' as const, label: t(lang, 'phone.tab.radio'), icon: Radio },
          { id: 'cheats' as const, label: t(lang, 'phone.tab.cheats'), icon: Terminal },
          { id: 'ai' as const, label: t(lang, 'phone.tab.ai'), icon: Bot },
        ].map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`py-2.5 flex flex-col items-center gap-1 text-[10px] font-semibold transition-colors ${
                active ? 'text-white bg-white/8' : 'text-slate-400 hover:text-slate-200'
              }`}
              style={active ? { borderBottom: `2px solid ${accentColor}` } : undefined}
            >
              <Icon className="w-3.5 h-3.5" style={active ? { color: accentColor } : undefined} />
              <span className="truncate max-w-full px-0.5">{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Screen Content */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
        {/* FRIENDS & CO-OP MULTIPLAYER */}
        {tab === 'friends' && (
          <div className="space-y-3">
            {!user ? (
              <div className="p-4 rounded-xl bg-slate-900/70 border border-white/10 space-y-3 text-center">
                <p className="text-xs text-slate-300 leading-relaxed">
                  {t(lang, 'phone.signInHint')}
                </p>
                <button
                  onClick={onSignIn}
                  className="w-full py-2 rounded-lg text-xs font-bold text-slate-950"
                  style={{ backgroundColor: accentColor }}
                >
                  {t(lang, 'phone.signInBtn')}
                </button>
              </div>
            ) : (
              <>
                <div className="p-3 rounded-xl bg-slate-900/80 border border-white/10 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-slate-400">
                        {t(lang, 'phone.yourNickCode')}
                      </div>
                      <div className="font-mono-tabular text-xs font-bold text-white">
                        {myNickname} · <span className="text-sky-300">{myFriendCode}</span>
                      </div>
                    </div>
                    <button
                      onClick={handleCopyCode}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-200 flex items-center gap-1"
                    >
                      <Copy className="w-3 h-3" />
                      {copiedCode ? t(lang, 'phone.copied') : t(lang, 'phone.code')}
                    </button>
                  </div>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      setNickBusy(true);
                      setFriendMsg(null);
                      try {
                        await onUpdateNickname(nickInput);
                        setFriendMsg(t(lang, 'app.nickSaved', { nick: nickInput }));
                      } catch (err) {
                        setFriendMsg(err instanceof Error ? err.message : 'Error');
                      } finally {
                        setNickBusy(false);
                      }
                    }}
                    className="flex gap-1.5"
                  >
                    <input
                      type="text"
                      value={nickInput}
                      onChange={(e) => setNickInput(e.target.value)}
                      placeholder={t(lang, 'phone.nickPlaceholder')}
                      maxLength={24}
                      className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-white/12 text-xs text-white focus:outline-none focus:border-white/30"
                    />
                    <button
                      type="submit"
                      disabled={nickBusy}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-white disabled:opacity-50"
                    >
                      {nickBusy ? '...' : t(lang, 'wardrobe.save')}
                    </button>
                  </form>
                </div>

                <form onSubmit={submitFriend} className="flex gap-1.5">
                  <input
                    type="text"
                    value={friendQuery}
                    onChange={(e) => setFriendQuery(e.target.value)}
                    placeholder={t(lang, 'phone.friendPlaceholder')}
                    className="flex-1 min-w-0 px-2.5 py-2 rounded-lg bg-slate-950 border border-white/12 text-xs text-white focus:outline-none focus:border-white/30"
                  />
                  <button
                    type="submit"
                    disabled={friendBusy}
                    className="px-3 py-2 rounded-lg text-xs font-bold text-slate-950 flex items-center gap-1 shrink-0 disabled:opacity-50"
                    style={{ backgroundColor: accentColor }}
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    {t(lang, 'phone.add')}
                  </button>
                </form>

                {friendMsg && (
                  <div className="text-[11px] text-sky-400 leading-snug">{friendMsg}</div>
                )}

                {onlinePlayers.filter((op) => op.uid !== user.uid && !friends.some((f) => f.uid === op.uid)).length > 0 && (
                  <div className="p-2.5 rounded-xl bg-emerald-950/25 border border-emerald-500/25 space-y-1.5">
                    <div className="text-[10px] uppercase tracking-wider font-semibold text-emerald-300">
                      {t(lang, 'settings.mp.onlineNow')}
                    </div>
                    <div className="space-y-1">
                      {onlinePlayers
                        .filter((op) => op.uid !== user.uid && !friends.some((f) => f.uid === op.uid))
                        .slice(0, 6)
                        .map((op) => (
                          <div key={op.uid} className="flex items-center justify-between gap-2 text-xs">
                            <span className="text-slate-200 truncate">{op.displayName}</span>
                            <button
                              type="button"
                              disabled={friendBusy}
                              onClick={async () => {
                                setFriendBusy(true);
                                try {
                                  await onAddFriend(op.displayName);
                                  setFriendMsg(`+ ${op.displayName}`);
                                } catch (err) {
                                  setFriendMsg(err instanceof Error ? err.message : 'Error');
                                } finally {
                                  setFriendBusy(false);
                                }
                              }}
                              className="px-2 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/35 text-emerald-200 text-[10px] font-semibold shrink-0"
                            >
                              + {t(lang, 'phone.add')}
                            </button>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <div className="text-[11px] font-semibold text-slate-400">
                    {t(lang, 'settings.mp.yourFriends', { count: friends.length })} · {remotePlayers.length} Live
                  </div>
                  {friends.length === 0 ? (
                    <div className="p-4 rounded-xl bg-slate-900/50 border border-white/8 text-center text-xs text-slate-400">
                      {t(lang, 'settings.mp.noFriends')}
                    </div>
                  ) : (
                    friends.map((f) => {
                      const isOnline = onlineSet.has(f.uid);
                      const live = remotePlayers.find((rp) => rp.uid === f.uid);
                      return (
                        <div
                          key={f.uid}
                          className="p-2.5 rounded-xl bg-slate-900/75 border border-white/10 space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className={`w-2 h-2 rounded-full shrink-0 ${
                                  isOnline ? 'bg-emerald-400' : 'bg-slate-600'
                                }`}
                              />
                              <div className="min-w-0">
                                <div className="text-xs font-semibold text-white truncate">
                                  {f.displayName}
                                </div>
                                <div className="text-[10px] font-mono-tabular text-slate-400">
                                  {f.friendCode} · {isOnline ? t(lang, 'settings.mp.onlineInGame') : t(lang, 'settings.mp.offline')}
                                </div>
                              </div>
                            </div>
                            <button
                              onClick={() => onRemoveFriend(f.uid)}
                              className="p-1 text-slate-500 hover:text-rose-400"
                              title="Remove"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {live && (
                            <div className="flex gap-1.5">
                              <button
                                onClick={() => onSetGps(live.x, live.z, f.displayName)}
                                className="flex-1 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] text-sky-300 flex items-center justify-center gap-1"
                              >
                                <Navigation className="w-3 h-3" />
                                GPS
                              </button>
                              <button
                                onClick={() => {
                                  onTeleportToFriend(live);
                                  onClose();
                                }}
                                className="flex-1 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] text-emerald-300"
                              >
                                TP
                              </button>
                              {activeMissionId && (
                                <button
                                  onClick={() => onInviteFriend(f.uid)}
                                  className="py-1.5 px-2.5 rounded-lg text-[11px] font-bold text-slate-950"
                                  style={{ backgroundColor: accentColor }}
                                >
                                  +
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* TAXI APP */}
        {tab === 'taxi' && (
          <div className="space-y-3">
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-400/25 space-y-2">
              <div className="text-xs font-bold text-amber-300">{t(lang, 'phone.taxiHeader')}</div>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                {t(lang, 'phone.taxiDesc')}
              </p>
              <button
                onClick={() => {
                  onCallTaxi();
                  onClose();
                }}
                className="w-full py-2.5 rounded-lg text-xs font-bold text-slate-950 flex items-center justify-center gap-1.5"
                style={{ backgroundColor: accentColor }}
              >
                <PhoneCall className="w-3.5 h-3.5" />
                {t(lang, 'phone.callCab')}
              </button>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-900/75 border border-white/10 space-y-2">
              <div className="text-xs font-bold text-white">{t(lang, 'phone.driverTitle')}</div>
              <p className="text-[11px] text-slate-400">
                {t(lang, 'phone.driverDesc')}
              </p>
              <button
                onClick={() => {
                  onStartTaxiShift();
                  onClose();
                }}
                className="w-full py-2 rounded-lg text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30"
              >
                {t(lang, 'phone.startShift')}
              </button>
            </div>
          </div>
        )}

        {/* HANGAR & SAFEHOUSE GARAGE */}
        {tab === 'garage' && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-sky-400">
                {t(lang, 'phone.hangarTitle', { count: savedGarage.hangarVehicles.length })}
              </div>
              {savedGarage.hangarVehicles.length === 0 ? (
                <div className="p-3 rounded-xl bg-slate-900/50 border border-white/8 text-[11px] text-slate-400">
                  {t(lang, 'phone.hangarEmpty')}
                </div>
              ) : (
                savedGarage.hangarVehicles.map((v, i) => (
                  <div
                    key={`${v.id}_${i}`}
                    className="p-2.5 rounded-xl bg-slate-900/75 border border-white/10 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-white truncate">
                        {v.brand} {v.name}
                      </div>
                      <div className="text-[10px] text-slate-400">Bayshore</div>
                    </div>
                    <button
                      onClick={() => {
                        onRetrieveVehicle('hangar', i);
                        onClose();
                      }}
                      className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-slate-950 shrink-0"
                      style={{ backgroundColor: accentColor }}
                    >
                      {t(lang, 'phone.summon')}
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-400">
                {t(lang, 'phone.garageTitle', { count: savedGarage.safehouseVehicles.length })}
              </div>
              {savedGarage.safehouseVehicles.length === 0 ? (
                <div className="p-3 rounded-xl bg-slate-900/50 border border-white/8 text-[11px] text-slate-400">
                  {t(lang, 'phone.garageEmpty')}
                </div>
              ) : (
                savedGarage.safehouseVehicles.map((v, i) => (
                  <div
                    key={`${v.id}_${i}`}
                    className="p-2.5 rounded-xl bg-slate-900/75 border border-white/10 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-white truncate">
                        {v.brand} {v.name}
                      </div>
                      <div className="text-[10px] text-slate-400">Coral Villa</div>
                    </div>
                    <button
                      onClick={() => {
                        onRetrieveVehicle('safehouse', i);
                        onClose();
                      }}
                      className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-slate-950 shrink-0"
                      style={{ backgroundColor: accentColor }}
                    >
                      {t(lang, 'phone.summon')}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* FM RADIO STATIONS */}
        {tab === 'radio' && (
          <div className="space-y-2">
            {RADIO_STATIONS.map((st) => {
              const active = radioStation === st.id;
              return (
                <button
                  key={st.id}
                  onClick={() => onSetRadioStation(st.id)}
                  className="w-full p-2.5 rounded-xl border text-left flex items-center justify-between gap-2 transition-colors"
                  style={{
                    backgroundColor: active ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.72)',
                    borderColor: active ? st.color : 'rgba(255,255,255,0.08)',
                  }}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="font-mono-tabular text-[10px] font-bold px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: `${st.color}25`, color: st.color }}
                      >
                        {st.freq}
                      </span>
                      <span className="text-xs font-bold text-white truncate">{st.name}</span>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                      {st.genre}
                      {active && st.id !== 'off' ? ` · ♪ ${radioTrack}` : ''}
                    </div>
                  </div>
                  {active && (
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: st.color }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* 911 DISPATCH & DIALPAD CHEAT CODES */}
        {tab === 'cheats' && (
          <div className="space-y-3">
            <div className="p-3 rounded-xl bg-slate-900/80 border border-white/10 space-y-2">
              <div className="text-[11px] font-bold text-rose-400 flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5" />
                {t(lang, 'phone.emergency')}
              </div>
              <div className="grid grid-cols-1 gap-1.5">
                {emergencyServices.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      onSetGps(s.doorX, s.doorZ, s.name);
                      onClose();
                    }}
                    className="w-full px-2.5 py-2 rounded-lg bg-slate-950 border border-white/10 hover:border-white/25 text-left flex items-center justify-between text-xs text-slate-200"
                  >
                    <span className="truncate">{s.name}</span>
                    <Phone className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  </button>
                ))}
              </div>
            </div>

            {cheatSessionActive && (
              <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-400/35 space-y-2">
                <div className="text-[11px] font-semibold text-rose-200 leading-snug">
                  {t(lang, 'settings.cheatLockWarn')}
                </div>
                <button
                  onClick={onRestartCleanSession}
                  className="w-full py-1.5 rounded-lg text-[11px] font-bold bg-rose-500 hover:bg-rose-400 text-white flex items-center justify-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  {t(lang, 'settings.restartClean')}
                </button>
              </div>
            )}

            {/* Mobile Numeric Keypad Dialer */}
            <div className="p-3 rounded-xl bg-slate-900/80 border border-white/10 space-y-2.5">
              <div className="text-[11px] font-bold text-white">{t(lang, 'phone.dialCheat')}</div>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={cheatInput}
                  onChange={(e) => setCheatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') dialCheat(cheatInput);
                  }}
                  placeholder={t(lang, 'phone.dialPlaceholder')}
                  className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-white/12 font-mono-tabular text-sm tracking-wider text-white focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setCheatInput((v) => v.slice(0, -1))}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"
                  title="Backspace"
                >
                  <Delete className="w-4 h-4" />
                </button>
              </div>

              {/* Numeric Phone Keypad */}
              <div className="grid grid-cols-3 gap-1.5">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', '-', '0', 'C'].map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => {
                      if (k === 'C') setCheatInput('');
                      else setCheatInput((v) => (v.length < 18 ? v + k : v));
                    }}
                    className="py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-white/10 font-mono-tabular text-xs font-bold text-slate-100 active:scale-95 transition-transform"
                  >
                    {k}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => dialCheat(cheatInput)}
                className="w-full py-2 rounded-lg text-xs font-bold text-slate-950 flex items-center justify-center gap-1.5"
                style={{ backgroundColor: accentColor }}
              >
                <PhoneCall className="w-3.5 h-3.5" />
                {t(lang, 'phone.dialBtn')}
              </button>

              {cheatMsg && (
                <div
                  className={`text-[11px] font-medium ${
                    cheatMsg.ok ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {cheatMsg.text}
                </div>
              )}

              {/* Strictly Read-Only Non-Clickable Cheat Directory */}
              <div className="pt-2 border-t border-white/10 space-y-1">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  {t(lang, 'phone.cheatReadOnlyHint')}
                </div>
                <div className="space-y-1 max-h-[155px] overflow-y-auto pr-0.5 pointer-events-none select-none">
                  {CHEAT_DIRECTORY.map((c) => (
                    <div
                      key={c.number}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950/75 border border-white/8 flex items-center justify-between gap-2"
                    >
                      <span className="font-mono-tabular text-[11px] font-bold text-amber-300 shrink-0">
                        {c.number}
                      </span>
                      <span className="text-[10px] text-slate-300 text-right truncate">
                        {c.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* VICE AI DISPATCH CHAT */}
        {tab === 'ai' && (
          <div className="flex flex-col h-full min-h-[380px] space-y-2.5">
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {aiMessages.map((m, idx) => (
                <div
                  key={idx}
                  className={`p-2.5 rounded-xl text-xs leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-sky-500/20 border border-sky-400/30 text-sky-100 ml-6'
                      : 'bg-slate-900/90 border border-white/10 text-slate-200 mr-4'
                  }`}
                >
                  {m.text}
                </div>
              ))}
              {aiBusy && (
                <div className="p-2 rounded-xl bg-slate-900/60 text-[11px] text-slate-400 mr-6">
                  {t(lang, 'phone.aiThinking')}
                </div>
              )}
            </div>
            <form onSubmit={submitAiChat} className="flex gap-1.5 pt-1 border-t border-white/10">
              <input
                type="text"
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder={t(lang, 'phone.aiPlaceholder')}
                className="flex-1 min-w-0 px-2.5 py-2 rounded-lg bg-slate-950 border border-white/12 text-xs text-white focus:outline-none"
              />
              <button
                type="submit"
                disabled={aiBusy || !aiPrompt.trim()}
                className="px-3 py-2 rounded-lg text-xs font-bold text-slate-950 disabled:opacity-50 flex items-center justify-center"
                style={{ backgroundColor: accentColor }}
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};
