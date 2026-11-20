import React, { useState } from 'react';
import { User } from 'firebase/auth';
import {
  Bot,
  Car,
  Copy,
  Navigation,
  Phone,
  PhoneCall,
  Plane,
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
  OnlinePlayerInfo,
  RemotePlayerState,
  SavedGarageState,
} from '../types/game';
import { SHOPS } from '../data/defaults';

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
  cheatSessionActive: boolean;
  accentColor: string;
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
  onApplyCheat: (code: string) => { ok: boolean; message: string };
  onRestartCleanSession: () => void;
  onClose: () => void;
}

const CHEAT_PRESETS = [
  { code: '3324', alias: 'GODMODE', label: 'Nesmrteľnosť (God Mode)' },
  { code: '5342', alias: 'HELI', label: 'Spawn vrtuľníka Pelican' },
  { code: '7645', alias: 'TAXI', label: 'Spawn Horizon Cab taxíka' },
  { code: '7726', alias: 'SUPERCAR', label: 'Spawn superšportu Valkyra' },
  { code: '8654', alias: 'PLANE', label: 'Spawn lietadla Skylark' },
  { code: '9975', alias: 'JET', label: 'Spawn ozbrojenej stíhačky F-22' },
  { code: 'CASH50K', alias: '1999-227-468', label: '+$50,000 na účet' },
  { code: 'TURTLE', alias: '1999-887-853', label: '100% Zdravie a Vesta' },
  { code: 'LAWYERUP', alias: '1999-529-937', label: 'Zrušiť policajné pátranie' },
  { code: 'SKYDIVE', alias: '1999-759-348', label: 'Získať taktický padák' },
  { code: 'TOOLUP', alias: '1999-866-587', label: 'Všetky zbrane + munícia' },
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
  cheatSessionActive,
  accentColor,
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
  onApplyCheat,
  onRestartCleanSession,
  onClose,
}) => {
  const [tab, setTab] = useState<'friends' | 'taxi' | 'garage' | 'cheats' | 'ai'>('friends');
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
      text: 'Ahoj, som Vice AI Dispečer. Spýtaj sa ma na misie v Leonide, tajné miesta, autá, počasie alebo taktiku!',
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
          context: { district, weather: weatherLabel, clock: gameClockStr, activeMissionId },
        }),
      });
      const data = await res.json();
      setAiMessages((prev) => [
        ...prev,
        { role: 'ai', text: data?.reply || 'Dispečing je momentálne zaneprázdnený, skús znova.' },
      ]);
    } catch {
      setAiMessages((prev) => [
        ...prev,
        { role: 'ai', text: 'Spojenie s Vice AI zlyhalo. Skús to o chvíľu znova.' },
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
      <div className="grid grid-cols-5 border-b border-white/10 bg-[#0b1120]">
        {[
          { id: 'friends' as const, label: 'Priatelia', icon: Users },
          { id: 'taxi' as const, label: 'Taxík', icon: Car },
          { id: 'garage' as const, label: 'Garáž', icon: Plane },
          { id: 'cheats' as const, label: 'Cheaty', icon: Terminal },
          { id: 'ai' as const, label: 'Vice AI', icon: Bot },
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
              <span>{item.label}</span>
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
                  Prihlás sa cez Google, aby si mohol pridávať priateľov a stretnúť ich naživo v otvorenom svete bez pozvánky!
                </p>
                <button
                  onClick={onSignIn}
                  className="w-full py-2 rounded-lg text-xs font-bold text-slate-950"
                  style={{ backgroundColor: accentColor }}
                >
                  Prihlásiť cez Google
                </button>
              </div>
            ) : (
              <>
                <div className="p-3 rounded-xl bg-slate-900/80 border border-white/10 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-slate-400">
                        Tvoj Nickname & kód
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
                      {copiedCode ? 'Skopírované' : 'Kód'}
                    </button>
                  </div>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      setNickBusy(true);
                      setFriendMsg(null);
                      try {
                        await onUpdateNickname(nickInput);
                        setFriendMsg('Nickname uložený. Kamaráti ťa teraz môžu nájsť podľa prezývky.');
                      } catch (err) {
                        setFriendMsg(err instanceof Error ? err.message : 'Chyba ukladania nickname.');
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
                      placeholder="Nastaviť tvoj nickname..."
                      maxLength={24}
                      className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-white/12 text-xs text-white focus:outline-none focus:border-white/30"
                    />
                    <button
                      type="submit"
                      disabled={nickBusy}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-white disabled:opacity-50"
                    >
                      {nickBusy ? '...' : 'Uložiť'}
                    </button>
                  </form>
                </div>

                <form onSubmit={submitFriend} className="flex gap-1.5">
                  <input
                    type="text"
                    value={friendQuery}
                    onChange={(e) => setFriendQuery(e.target.value)}
                    placeholder="Nickname kamaráta (alebo VH-kód)"
                    className="flex-1 min-w-0 px-2.5 py-2 rounded-lg bg-slate-950 border border-white/12 text-xs text-white focus:outline-none focus:border-white/30"
                  />
                  <button
                    type="submit"
                    disabled={friendBusy}
                    className="px-3 py-2 rounded-lg text-xs font-bold text-slate-950 flex items-center gap-1 shrink-0 disabled:opacity-50"
                    style={{ backgroundColor: accentColor }}
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    Pridať
                  </button>
                </form>

                {friendMsg && (
                  <div className="text-[11px] text-sky-400 leading-snug">{friendMsg}</div>
                )}

                {onlinePlayers.filter((op) => op.uid !== user.uid && !friends.some((f) => f.uid === op.uid)).length > 0 && (
                  <div className="p-2.5 rounded-xl bg-emerald-950/25 border border-emerald-500/25 space-y-1.5">
                    <div className="text-[10px] uppercase tracking-wider font-semibold text-emerald-300">
                      Prihlásení hráči online teraz
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
                                  setFriendMsg(`Kamarát ${op.displayName} pridaný!`);
                                } catch (err) {
                                  setFriendMsg(err instanceof Error ? err.message : 'Chyba pridania.');
                                } finally {
                                  setFriendBusy(false);
                                }
                              }}
                              className="px-2 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/35 text-emerald-200 text-[10px] font-semibold shrink-0"
                            >
                              + Pridať
                            </button>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <div className="text-[11px] font-semibold text-slate-400">
                    Priatelia ({friends.length}) · Online v meste ({remotePlayers.length})
                  </div>
                  {friends.length === 0 ? (
                    <div className="p-4 rounded-xl bg-slate-900/50 border border-white/8 text-center text-xs text-slate-400">
                      Zatiaľ žiadni priatelia. Zadaj nickname prihláseného kamaráta alebo mu pošli svoj nickname "{myNickname}".
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
                                  {f.friendCode} · {isOnline ? 'V hre (Live)' : 'Offline'}
                                </div>
                              </div>
                            </div>
                            <button
                              onClick={() => onRemoveFriend(f.uid)}
                              className="p-1 text-slate-500 hover:text-rose-400"
                              title="Odstrániť"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {live && (
                            <div className="flex gap-1.5">
                              <button
                                onClick={() => onSetGps(live.x, live.z, `Kamarát ${f.displayName}`)}
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
                                Stretnúť sa
                              </button>
                              {activeMissionId && (
                                <button
                                  onClick={() => onInviteFriend(f.uid)}
                                  className="py-1.5 px-2.5 rounded-lg text-[11px] font-bold text-slate-950"
                                  style={{ backgroundColor: accentColor }}
                                >
                                  Pozvať
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
              <div className="text-xs font-bold text-amber-300">Horizon Cab Dispatch</div>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                Zavolaj si taxík priamo pred seba, vyber destináciu na ostrove, alebo vyhoď vodiča klávesom Shift+F / G a zarábaj rozvážaním klientov.
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
                Zavolať Horizon Cab ako pasažier
              </button>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-900/75 border border-white/10 space-y-2">
              <div className="text-xs font-bold text-white">Práca taxikára (Zarábaj peniaze)</div>
              <p className="text-[11px] text-slate-400">
                Sadni do ľubovoľného taxíka Horizon Cab a prijmi objednávku zákazníka z ulice.
              </p>
              <button
                onClick={() => {
                  onStartTaxiShift();
                  onClose();
                }}
                className="w-full py-2 rounded-lg text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30"
              >
                Spustiť zmenu taxikára
              </button>
            </div>
          </div>
        )}

        {/* HANGAR & SAFEHOUSE GARAGE */}
        {tab === 'garage' && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-sky-400">
                Letiskový hangár ({savedGarage.hangarVehicles.length}/4)
              </div>
              {savedGarage.hangarVehicles.length === 0 ? (
                <div className="p-3 rounded-xl bg-slate-900/50 border border-white/8 text-[11px] text-slate-400">
                  Zaparkuj lietadlo, vrtuľník alebo stíhačku do hangáru na letisku Bayshore — automaticky sa uloží.
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
                      <div className="text-[10px] text-slate-400">Hangár Bayshore</div>
                    </div>
                    <button
                      onClick={() => {
                        onRetrieveVehicle('hangar', i);
                        onClose();
                      }}
                      className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-slate-950 shrink-0"
                      style={{ backgroundColor: accentColor }}
                    >
                      Pristaviť
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-400">
                Garáž pri úkryte ({savedGarage.safehouseVehicles.length}/4)
              </div>
              {savedGarage.safehouseVehicles.length === 0 ? (
                <div className="p-3 rounded-xl bg-slate-900/50 border border-white/8 text-[11px] text-slate-400">
                  Zaparkuj auto alebo motorku do garáže pri vile Coral Villa — uloží sa aj pri Cloud Save.
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
                      <div className="text-[10px] text-slate-400">Garáž Coral Villa</div>
                    </div>
                    <button
                      onClick={() => {
                        onRetrieveVehicle('safehouse', i);
                        onClose();
                      }}
                      className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-slate-950 shrink-0"
                      style={{ backgroundColor: accentColor }}
                    >
                      Pristaviť
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* 911 DISPATCH & CHEAT CODES */}
        {tab === 'cheats' && (
          <div className="space-y-3">
            <div className="p-3 rounded-xl bg-slate-900/80 border border-white/10 space-y-2">
              <div className="text-[11px] font-bold text-rose-400 flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5" />
                Tiesňová linka 911 / 112 (GPS navigácia)
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
                  Cheaty sú aktívne: Misie a ukladanie postupu sú zamknuté až do reštartu čistej relácie!
                </div>
                <button
                  onClick={onRestartCleanSession}
                  className="w-full py-1.5 rounded-lg text-[11px] font-bold bg-rose-500 hover:bg-rose-400 text-white flex items-center justify-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reštartovať reláciu bez cheatov
                </button>
              </div>
            )}

            <div className="p-3 rounded-xl bg-slate-900/80 border border-white/10 space-y-2">
              <div className="text-[11px] font-bold text-white">Vytočiť Cheat Kód (napr. 3324, 5342, 7645, 7726, 8654, 9975)</div>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={cheatInput}
                  onChange={(e) => setCheatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') dialCheat(cheatInput);
                  }}
                  placeholder="Zadaj číslo (napr. 3324)"
                  className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-white/12 font-mono-tabular text-xs text-white focus:outline-none"
                />
                <button
                  onClick={() => dialCheat(cheatInput)}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-950 shrink-0"
                  style={{ backgroundColor: accentColor }}
                >
                  Vytočiť
                </button>
              </div>
              {cheatMsg && (
                <div
                  className={`text-[11px] font-medium ${
                    cheatMsg.ok ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {cheatMsg.text}
                </div>
              )}

              <div className="pt-1 space-y-1 max-h-[175px] overflow-y-auto pr-0.5">
                {CHEAT_PRESETS.map((c) => (
                  <button
                    key={c.code}
                    onClick={() => dialCheat(c.code)}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950/90 hover:bg-slate-800 border border-white/8 text-left flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-[11px] font-medium text-white truncate">{c.label}</div>
                      <div className="text-[10px] font-mono-tabular text-slate-400">
                        {c.code} ({c.alias})
                      </div>
                    </div>
                    <span className="text-[10px] font-semibold text-sky-400 shrink-0">Vytočiť</span>
                  </button>
                ))}
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
                  Vice AI premýšľa...
                </div>
              )}
            </div>
            <form onSubmit={submitAiChat} className="flex gap-1.5 pt-1 border-t border-white/10">
              <input
                type="text"
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="Opýtaj sa Vice AI..."
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
