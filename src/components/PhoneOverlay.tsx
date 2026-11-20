import React, { useState } from 'react';
import { User } from 'firebase/auth';
import {
  Car,
  Copy,
  Navigation,
  Phone,
  PhoneCall,
  Plane,
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
  RemotePlayerState,
  SavedGarageState,
} from '../types/game';
import { SHOPS } from '../data/defaults';

interface PhoneOverlayProps {
  user: User | null;
  myFriendCode: string;
  friends: FriendRecord[];
  onlineUids: string[];
  remotePlayers: RemotePlayerState[];
  activeMissionId: string | null;
  savedGarage: SavedGarageState;
  gameClockStr: string;
  accentColor: string;
  onSignIn: () => void;
  onAddFriend: (query: string) => Promise<void>;
  onRemoveFriend: (uid: string) => Promise<void>;
  onInviteFriend: (friendUid: string) => void;
  onSetGps: (x: number, z: number, label: string) => void;
  onTeleportToFriend: (player: RemotePlayerState) => void;
  onCallTaxi: () => void;
  onStartTaxiShift: () => void;
  onRetrieveVehicle: (facility: 'hangar' | 'safehouse', index: number) => void;
  onApplyCheat: (code: string) => { ok: boolean; message: string };
  onClose: () => void;
}

const CHEAT_PRESETS = [
  { code: '1999-463-663', alias: 'GODMODE', label: 'Nesmrteľnosť (God Mode)' },
  { code: '1999-227-468', alias: 'CASH50K', label: '+$50,000 na účet' },
  { code: '1999-887-853', alias: 'TURTLE', label: '100% Zdravie a Vesta' },
  { code: '1999-529-937', alias: 'LAWYERUP', label: 'Zrušiť policajné pátranie' },
  { code: '1999-727-438', alias: 'JET', label: 'Pristaviť stíhačku Zeta F-22' },
  { code: '1999-435-426', alias: 'HELI', label: 'Pristaviť vrtuľník Pelican' },
  { code: '1999-787-372', alias: 'SUPERCAR', label: 'Pristaviť superšport Valkyra' },
  { code: '1999-759-348', alias: 'SKYDIVE', label: 'Získať taktický padák' },
  { code: '1999-866-587', alias: 'TOOLUP', label: 'Všetky zbrane + munícia' },
];

export const PhoneOverlay: React.FC<PhoneOverlayProps> = ({
  user,
  myFriendCode,
  friends,
  onlineUids,
  remotePlayers,
  activeMissionId,
  savedGarage,
  gameClockStr,
  accentColor,
  onSignIn,
  onAddFriend,
  onRemoveFriend,
  onInviteFriend,
  onSetGps,
  onTeleportToFriend,
  onCallTaxi,
  onStartTaxiShift,
  onRetrieveVehicle,
  onApplyCheat,
  onClose,
}) => {
  const [tab, setTab] = useState<'friends' | 'taxi' | 'garage' | 'cheats'>('friends');
  const [friendQuery, setFriendQuery] = useState('');
  const [friendMsg, setFriendMsg] = useState<string | null>(null);
  const [friendBusy, setFriendBusy] = useState(false);
  const [cheatInput, setCheatInput] = useState('');
  const [cheatMsg, setCheatMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

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

  const emergencyServices = SHOPS.filter(
    (s) =>
      s.category === 'hospital' ||
      s.category === 'police_station' ||
      s.category === 'fire_station'
  );

  return (
    <div className="fixed right-5 bottom-20 z-30 w-[340px] max-w-[calc(100vw-2.5rem)] h-[540px] max-h-[80vh] flex flex-col rounded-3xl bg-[#090e1a] border-2 border-white/15 shadow-2xl overflow-hidden">
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
      <div className="grid grid-cols-4 border-b border-white/10 bg-[#0b1120]">
        {[
          { id: 'friends' as const, label: 'Priatelia', icon: Users },
          { id: 'taxi' as const, label: 'Taxík', icon: Car },
          { id: 'garage' as const, label: 'Garáž', icon: Plane },
          { id: 'cheats' as const, label: '911/Cheat', icon: Terminal },
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
                <div className="p-3 rounded-xl bg-slate-900/80 border border-white/10 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-400">
                      Tvoj kód priateľa
                    </div>
                    <div className="font-mono-tabular text-sm font-bold text-white">
                      {myFriendCode}
                    </div>
                  </div>
                  <button
                    onClick={handleCopyCode}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-200 flex items-center gap-1"
                  >
                    <Copy className="w-3 h-3" />
                    {copiedCode ? 'Skopírované' : 'Kopírovať'}
                  </button>
                </div>

                <form onSubmit={submitFriend} className="flex gap-1.5">
                  <input
                    type="text"
                    value={friendQuery}
                    onChange={(e) => setFriendQuery(e.target.value)}
                    placeholder="Kód (VH-...) alebo e-mail"
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

                <div className="space-y-2">
                  <div className="text-[11px] font-semibold text-slate-400">
                    Priatelia ({friends.length}) · Online v meste ({remotePlayers.length})
                  </div>
                  {friends.length === 0 ? (
                    <div className="p-4 rounded-xl bg-slate-900/50 border border-white/8 text-center text-xs text-slate-400">
                      Zatiaľ žiadni priatelia. Pošli im svoj kód {myFriendCode}.
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

            <div className="p-3 rounded-xl bg-slate-900/80 border border-white/10 space-y-2">
              <div className="text-[11px] font-bold text-white">Vytočiť Cheat Kód</div>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={cheatInput}
                  onChange={(e) => setCheatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') dialCheat(cheatInput);
                  }}
                  placeholder="1999-... alebo napr. JET"
                  className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-white/12 font-mono-tabular text-xs text-white focus:outline-none"
                />
                <button
                  onClick={() => dialCheat(cheatInput)}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-950 shrink-0"
                  style={{ backgroundColor: accentColor }}
                >
                  Zadať
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

              <div className="pt-1 space-y-1 max-h-[195px] overflow-y-auto pr-0.5">
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
                    <span className="text-[10px] font-semibold text-sky-400 shrink-0">Aktivovať</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
