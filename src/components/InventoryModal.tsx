import React, { useEffect, useState } from 'react';
import { Crosshair, Package, Shield, ShoppingBag, Umbrella, X } from 'lucide-react';
import { InventoryState, LanguageCode, WeaponId } from '../types/game';
import { PARACHUTE_PRICE, WEAPON_CATALOG } from '../data/defaults';
import { t } from '../i18n/translations';

interface InventoryModalProps {
  inventory: InventoryState;
  cash: number;
  accentColor: string;
  lang: LanguageCode;
  initialTab?: 'weapons' | 'gear' | 'loot';
  onEquipWeapon: (id: WeaponId) => void;
  onBuyWeapon: (id: WeaponId) => void;
  onBuyAmmo: (id: WeaponId) => void;
  onChangeWeaponSkin: (id: WeaponId, color: string) => void;
  onUseConsumable: (id: string) => void;
  onBuyConsumable: (id: string) => void;
  onBuyParachute: () => void;
  onSellContraband: (id: string) => void;
  onClose: () => void;
}

const WEAPON_SKINS = [
  { name: 'Grafit', color: '#27272a' },
  { name: 'Titán', color: '#94a3b8' },
  { name: 'Zlatá edícia', color: '#eab308' },
  { name: 'Karmín', color: '#dc2626' },
  { name: 'Oceán', color: '#0891b2' },
];

export const InventoryModal: React.FC<InventoryModalProps> = ({
  inventory,
  cash,
  accentColor,
  lang,
  initialTab = 'weapons',
  onEquipWeapon,
  onBuyWeapon,
  onBuyAmmo,
  onChangeWeaponSkin,
  onUseConsumable,
  onBuyConsumable,
  onBuyParachute,
  onSellContraband,
  onClose,
}) => {
  const [tab, setTab] = useState<'weapons' | 'gear' | 'loot'>(initialTab);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/80 p-6">
      <div className="w-full max-w-4xl max-h-[86vh] flex flex-col bg-[#0b101b] border border-white/12 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <h2 className="font-display text-2xl font-bold text-white">{t(lang, 'inv.title')}</h2>
            <span className="font-mono-tabular text-base font-bold text-emerald-400">
              ${cash.toLocaleString('en-US')}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 p-1 bg-slate-900 rounded-lg border border-white/10">
              <button
                onClick={() => setTab('weapons')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                  tab === 'weapons' ? 'bg-white text-slate-950' : 'text-slate-300 hover:text-white'
                }`}
              >
                <Crosshair className="w-3.5 h-3.5" />
                {t(lang, 'inv.tab.weapons')}
              </button>
              <button
                onClick={() => setTab('gear')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                  tab === 'gear' ? 'bg-white text-slate-950' : 'text-slate-300 hover:text-white'
                }`}
              >
                <Shield className="w-3.5 h-3.5" />
                {t(lang, 'inv.tab.gear')}
              </button>
              <button
                onClick={() => setTab('loot')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                  tab === 'loot' ? 'bg-white text-slate-950' : 'text-slate-300 hover:text-white'
                }`}
              >
                <Package className="w-3.5 h-3.5" />
                {t(lang, 'inv.tab.loot')}
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
              aria-label={t(lang, 'settings.close')}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-4">
          {tab === 'weapons' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {inventory.weapons.map((owned) => {
                const def = WEAPON_CATALOG[owned.id];
                const isEquipped = inventory.equippedWeapon === owned.id;
                const dmgPct = Math.min(100, (def.damage * def.pellets) / 1.1);
                const rofPct = Math.min(100, (1000 / def.fireRateMs) * 9);

                return (
                  <div
                    key={owned.id}
                    className="p-4 rounded-xl bg-slate-900/60 border flex flex-col justify-between gap-4"
                    style={{
                      borderColor: isEquipped ? accentColor : 'rgba(255,255,255,0.08)',
                    }}
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-xs text-slate-400">
                            {def.category} · {t(lang, 'inv.range', { m: def.range })}
                          </div>
                          <h3 className="font-display text-lg font-bold text-white">{def.name}</h3>
                        </div>
                        {owned.unlocked && (
                          <div className="text-right font-mono-tabular text-xs text-slate-300">
                            {t(lang, 'inv.ammo', { clip: owned.ammoInClip, res: owned.reserveAmmo })}
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 leading-relaxed">{def.description}</p>

                      {/* Stat bars */}
                      <div className="grid grid-cols-2 gap-3 pt-1">
                        <div className="space-y-1">
                          <div className="text-[11px] text-slate-400">{t(lang, 'inv.damage')}</div>
                          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                            <div className="h-full bg-amber-400" style={{ width: `${dmgPct}%` }} />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <div className="text-[11px] text-slate-400">{t(lang, 'inv.rof')}</div>
                          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                            <div className="h-full bg-sky-400" style={{ width: `${rofPct}%` }} />
                          </div>
                        </div>
                      </div>

                      {owned.unlocked && (
                        <div className="pt-2 flex items-center gap-2">
                          <span className="text-[11px] text-slate-400">{t(lang, 'inv.finish')}</span>
                          {WEAPON_SKINS.map((sk) => (
                            <button
                              key={sk.color}
                              onClick={() => onChangeWeaponSkin(owned.id, sk.color)}
                              title={sk.name}
                              className="w-5 h-5 rounded-full border transition-transform hover:scale-110"
                              style={{
                                backgroundColor: sk.color,
                                borderColor:
                                  owned.skinColor === sk.color ? '#ffffff' : 'rgba(255,255,255,0.2)',
                              }}
                            />
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 pt-2 border-t border-white/10">
                      {owned.unlocked ? (
                        <>
                          <button
                            onClick={() => onEquipWeapon(owned.id)}
                            disabled={isEquipped}
                            className="flex-1 py-2 px-3 rounded-lg text-xs font-semibold transition-colors disabled:opacity-60"
                            style={{
                              backgroundColor: isEquipped ? 'rgba(255,255,255,0.1)' : accentColor,
                              color: isEquipped ? '#e2e8f0' : '#090d16',
                            }}
                          >
                            {isEquipped ? t(lang, 'inv.equipped') : t(lang, 'inv.equip')}
                          </button>
                          <button
                            onClick={() => onBuyAmmo(owned.id)}
                            disabled={cash < 420}
                            className="py-2 px-3 rounded-lg text-xs font-medium bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-40 whitespace-nowrap"
                          >
                            {t(lang, 'inv.buyAmmo')}
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => onBuyWeapon(owned.id)}
                          disabled={cash < def.price}
                          className="w-full py-2 px-3 rounded-lg text-xs font-semibold bg-emerald-500 text-slate-950 hover:bg-emerald-400 disabled:opacity-40 transition-colors"
                        >
                          {t(lang, 'inv.buyWeapon', { price: def.price.toLocaleString('en-US') })}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'gear' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {inventory.consumables.map((item) => (
                <div
                  key={item.id}
                  className="p-4 rounded-xl bg-slate-900/60 border border-white/10 flex flex-col justify-between gap-4"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400">{t(lang, 'inv.consumable')}</span>
                      <span className="font-mono-tabular text-sm font-bold text-white">
                        {item.quantity}×
                      </span>
                    </div>
                    <h3 className="font-display text-lg font-bold text-white">{item.name}</h3>
                    <p className="text-xs text-slate-400 leading-relaxed">{item.description}</p>
                  </div>

                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => onUseConsumable(item.id)}
                      disabled={item.quantity <= 0}
                      className="w-full py-2 px-3 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40"
                      style={{ backgroundColor: accentColor, color: '#090d16' }}
                    >
                      {t(lang, 'inv.useNow')}
                    </button>
                    <button
                      onClick={() => onBuyConsumable(item.id)}
                      disabled={cash < item.price}
                      className="w-full py-2 px-3 rounded-lg text-xs font-medium bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-40"
                    >
                      {t(lang, 'inv.buyMore', { price: item.price })}
                    </button>
                  </div>
                </div>
              ))}

              {/* Tactical Parachute Card */}
              <div className="p-4 rounded-xl bg-slate-900/60 border border-sky-400/20 flex flex-col justify-between gap-4">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-sky-400 flex items-center gap-1">
                      <Umbrella className="w-3.5 h-3.5" /> {t(lang, 'inv.airGear')}
                    </span>
                    <span className="font-mono-tabular text-xs font-bold text-white">
                      {inventory.hasParachute ? t(lang, 'inv.owned') : t(lang, 'inv.missing')}
                    </span>
                  </div>
                  <h3 className="font-display text-lg font-bold text-white">{t(lang, 'inv.parachute')}</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    {t(lang, 'inv.parachuteDesc')}
                  </p>
                </div>

                <button
                  onClick={onBuyParachute}
                  disabled={inventory.hasParachute || cash < PARACHUTE_PRICE}
                  className="w-full py-2 px-3 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                  style={{
                    backgroundColor: inventory.hasParachute ? 'rgba(16,185,129,0.2)' : accentColor,
                    color: inventory.hasParachute ? '#34d399' : '#090d16',
                  }}
                >
                  {inventory.hasParachute
                    ? t(lang, 'inv.parachuteEquipped')
                    : t(lang, 'inv.buyParachute', { price: PARACHUTE_PRICE })}
                </button>
              </div>
            </div>
          )}

          {tab === 'loot' && (
            <div className="space-y-3">
              {inventory.contraband.length === 0 ? (
                <div className="py-12 text-center text-sm text-slate-400">
                  {t(lang, 'inv.noLoot')}
                </div>
              ) : (
                inventory.contraband.map((loot) => (
                  <div
                    key={loot.id}
                    className="p-4 rounded-xl bg-slate-900/60 border border-white/10 flex items-center justify-between gap-4"
                  >
                    <div>
                      <div className="text-xs text-slate-400">
                        {t(lang, 'inv.qtyValue', {
                          qty: loot.quantity,
                          val: loot.value.toLocaleString('en-US'),
                        })}
                      </div>
                      <h3 className="font-display text-base font-bold text-white">{loot.name}</h3>
                    </div>
                    <button
                      onClick={() => onSellContraband(loot.id)}
                      className="px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-500 text-slate-950 hover:bg-emerald-400 flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <ShoppingBag className="w-3.5 h-3.5" />
                      {t(lang, 'inv.sellLoot', {
                        total: (loot.value * loot.quantity).toLocaleString('en-US'),
                      })}
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
