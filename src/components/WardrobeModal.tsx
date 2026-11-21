import React, { useEffect, useState } from 'react';
import { Eye, Plus, Scissors, Shirt, Sparkles, Trash2, X } from 'lucide-react';
import {
  AccessoryType,
  CharacterAppearance,
  CharacterState,
  FacialHairType,
  GlassesType,
  HairStyle,
  JacketStyle,
  LanguageCode,
  TattooType,
} from '../types/game';
import { DEFAULT_CHARACTERS, OUTFIT_PRESETS } from '../data/defaults';
import { t } from '../i18n/translations';

interface WardrobeModalProps {
  character: CharacterState;
  accentColor: string;
  lang: LanguageCode;
  mode?: 'wardrobe' | 'barber' | 'tattoo' | 'safehouse';
  onUpdateAppearance: (appearance: CharacterAppearance) => void;
  onSaveOutfit: (name: string, appearance: CharacterAppearance) => void;
  onDeleteOutfit: (outfitId: string) => void;
  onClose: () => void;
}

const SKIN_TONES = ['#f1c29b', '#d49a73', '#c68b67', '#b97e5b', '#8d5524', '#5c3824'];

const HAIR_STYLES: { id: HairStyle; label: string }[] = [
  { id: 'bun', label: 'Drdol' },
  { id: 'waves', label: 'Vlny' },
  { id: 'fade', label: 'Fade' },
  { id: 'buzz', label: 'Krátky strih' },
  { id: 'ponytail', label: 'Cop' },
  { id: 'pompadour', label: 'Pompadour' },
];

const FACIAL_HAIR_OPTIONS: { id: FacialHairType; label: string }[] = [
  { id: 'none', label: 'Hladké oholenie' },
  { id: 'stubble', label: 'Strnisko' },
  { id: 'beard', label: 'Plná brada' },
  { id: 'goatee', label: 'Briatka a fúzy' },
];

const GLASSES_OPTIONS: { id: GlassesType; label: string }[] = [
  { id: 'none', label: 'Bez okuliarov' },
  { id: 'aviators', label: 'Aviator' },
  { id: 'wayfarer', label: 'Wayfarer' },
  { id: 'round', label: 'Okrúhle retro' },
  { id: 'visor', label: 'Kyber priezor' },
];

const JACKET_STYLES: { id: JacketStyle; label: string }[] = [
  { id: 'bomber', label: 'Bomber bunda' },
  { id: 'cuban', label: 'Kubánska košeľa' },
  { id: 'tech', label: 'Taktická bunda' },
  { id: 'suit', label: 'Sako / Oblek' },
  { id: 'tank', label: 'Letné tielko' },
];

const ACCESSORIES: { id: AccessoryType; label: string }[] = [
  { id: 'none', label: 'Bez doplnku' },
  { id: 'cap', label: 'Šiltovka' },
  { id: 'gold_chain', label: 'Zlatá retiazka' },
  { id: 'tactical_vest', label: 'Taktická vesta' },
  { id: 'watch', label: 'Luxusné hodinky' },
];

const TATTOO_OPTIONS: { id: TattooType; label: string; desc: string }[] = [
  { id: 'none', label: 'Bez tetovania', desc: 'Čistá pokožka bez atramentu.' },
  { id: 'sleeve', label: 'Rukáv (Sleeve)', desc: 'Detailné tetovanie pokrývajúce obe predlaktia a ramená.' },
  { id: 'tribal', label: 'Tribal rameno', desc: 'Výrazné tmavé ornamenty na ramenách a bicepsoch.' },
  { id: 'neon_dragon', label: 'Neónový drak', desc: 'Tyrkysovo-koralový motív draka pozdĺž paží a trupu.' },
  { id: 'skull_chest', label: 'Hruď & Krk', desc: 'Motív lebky a línií na krku, hrudníku a rukách.' },
];

export const WardrobeModal: React.FC<WardrobeModalProps> = ({
  character,
  accentColor,
  lang,
  mode = 'wardrobe',
  onUpdateAppearance,
  onSaveOutfit,
  onDeleteOutfit,
  onClose,
}) => {
  const [outfitName, setOutfitName] = useState('');
  const [activeTab, setActiveTab] = useState<'outfits' | 'barber' | 'tattoo'>(() =>
    mode === 'barber' ? 'barber' : mode === 'tattoo' ? 'tattoo' : 'outfits'
  );

  useEffect(() => {
    setActiveTab(mode === 'barber' ? 'barber' : mode === 'tattoo' ? 'tattoo' : 'outfits');
  }, [mode]);

  const app: CharacterAppearance = {
    ...DEFAULT_CHARACTERS[character.id].appearance,
    ...character.appearance,
  };

  const setField = <K extends keyof CharacterAppearance>(key: K, val: CharacterAppearance[K]) => {
    onUpdateAppearance({ ...app, [key]: val });
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = outfitName.trim() || `Outfit ${character.customOutfits.length + 1}`;
    onSaveOutfit(trimmed, app);
    setOutfitName('');
  };

  const titleByMode =
    mode === 'barber'
      ? t(lang, 'wardrobe.barberTitle', { name: character.name })
      : mode === 'tattoo'
        ? t(lang, 'wardrobe.tattooTitle', { name: character.name })
        : mode === 'safehouse'
          ? t(lang, 'wardrobe.safehouseTitle', { name: character.name })
          : t(lang, 'wardrobe.title', { name: character.name });

  const subtitleByMode =
    mode === 'safehouse'
      ? t(lang, 'wardrobe.subSafe')
      : t(lang, 'wardrobe.subDefault');

  return (
    <div className="fixed inset-y-0 right-0 z-30 w-full max-w-[445px] bg-[#0b101b] border-l border-white/12 flex flex-col shadow-2xl">
      <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
        <div>
          <div className="text-xs text-slate-400">{subtitleByMode}</div>
          <h2 className="font-display text-xl font-bold text-white">{titleByMode}</h2>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          aria-label={t(lang, 'settings.close')}
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Studio Navigation Tabs */}
      <div className="px-5 pt-3 pb-2 border-b border-white/10 flex gap-2">
        <button
          onClick={() => setActiveTab('outfits')}
          className={`flex-1 py-2 px-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
            activeTab === 'outfits'
              ? 'text-slate-950'
              : 'bg-slate-900 text-slate-300 border border-white/10 hover:text-white'
          }`}
          style={activeTab === 'outfits' ? { backgroundColor: accentColor } : undefined}
        >
          <Shirt className="w-3.5 h-3.5" />
          {t(lang, 'wardrobe.tab.outfits')}
        </button>
        <button
          onClick={() => setActiveTab('barber')}
          className={`flex-1 py-2 px-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
            activeTab === 'barber'
              ? 'text-slate-950'
              : 'bg-slate-900 text-slate-300 border border-white/10 hover:text-white'
          }`}
          style={activeTab === 'barber' ? { backgroundColor: accentColor } : undefined}
        >
          <Scissors className="w-3.5 h-3.5" />
          {t(lang, 'wardrobe.tab.barber')}
        </button>
        <button
          onClick={() => setActiveTab('tattoo')}
          className={`flex-1 py-2 px-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
            activeTab === 'tattoo'
              ? 'text-slate-950'
              : 'bg-slate-900 text-slate-300 border border-white/10 hover:text-white'
          }`}
          style={activeTab === 'tattoo' ? { backgroundColor: accentColor } : undefined}
        >
          <Sparkles className="w-3.5 h-3.5" />
          {t(lang, 'wardrobe.tab.tattoo')}
        </button>
      </div>

      <div className="p-5 overflow-y-auto space-y-6 flex-1">
        {activeTab === 'outfits' && (
          <>
            {/* Saved Custom Outfits */}
            <section className="space-y-2.5">
              <h3 className="text-xs font-semibold text-slate-300">{t(lang, 'wardrobe.savedOutfits')}</h3>
              <div className="flex flex-wrap gap-2">
                {character.customOutfits.map((outfit) => (
                  <div
                    key={outfit.id}
                    className="inline-flex items-center gap-1 rounded-lg bg-slate-900 border border-white/10 overflow-hidden"
                  >
                    <button
                      onClick={() =>
                        onUpdateAppearance({
                          ...DEFAULT_CHARACTERS[character.id].appearance,
                          ...outfit.appearance,
                        })
                      }
                      className="px-3 py-1.5 text-xs font-medium text-slate-200 hover:text-white hover:bg-white/5"
                    >
                      {outfit.name}
                    </button>
                    {character.customOutfits.length > 1 && (
                      <button
                        onClick={() => onDeleteOutfit(outfit.id)}
                        className="pr-2 py-1.5 text-slate-500 hover:text-rose-400"
                        title="Odstrániť kostým"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <form onSubmit={handleSave} className="flex gap-2 pt-1">
                <input
                  type="text"
                  value={outfitName}
                  onChange={(e) => setOutfitName(e.target.value)}
                  maxLength={28}
                  placeholder={t(lang, 'wardrobe.newOutfitPlaceholder')}
                  className="flex-1 px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-white/30"
                />
                <button
                  type="submit"
                  className="px-3 py-2 rounded-lg text-xs font-semibold text-slate-950 flex items-center gap-1 whitespace-nowrap"
                  style={{ backgroundColor: accentColor }}
                >
                  <Plus className="w-3.5 h-3.5" />
                  {t(lang, 'wardrobe.save')}
                </button>
              </form>
            </section>

            {/* Preset Outfits */}
            <section className="space-y-2.5">
              <h3 className="text-xs font-semibold text-slate-300">{t(lang, 'wardrobe.presets')}</h3>
              <div className="grid grid-cols-2 gap-2">
                {OUTFIT_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() =>
                      onUpdateAppearance({
                        ...preset.appearance,
                        skinTone: app.skinTone,
                        facialHair: app.facialHair,
                        tattoo: app.tattoo,
                      })
                    }
                    className="px-3 py-2 rounded-lg bg-slate-900 border border-white/10 hover:border-white/25 text-left text-xs font-medium text-slate-200 transition-colors"
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            </section>

            {/* Glasses */}
            <section className="space-y-2.5">
              <h3 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5" style={{ color: accentColor }} />
                {t(lang, 'wardrobe.glasses')}
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {GLASSES_OPTIONS.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => setField('glasses', g.id)}
                    className={`py-2 px-3 rounded-lg text-xs font-medium border text-left transition-colors ${
                      app.glasses === g.id
                        ? 'bg-white text-slate-950 border-white'
                        : 'bg-slate-900 text-slate-300 border-white/10 hover:border-white/25'
                    }`}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </section>

            {/* Jacket Style */}
            <section className="space-y-2.5">
              <h3 className="text-xs font-semibold text-slate-300">{t(lang, 'wardrobe.jacketStyle')}</h3>
              <div className="grid grid-cols-2 gap-2">
                {JACKET_STYLES.map((js) => (
                  <button
                    key={js.id}
                    onClick={() => setField('jacketStyle', js.id)}
                    className={`py-2 px-3 rounded-lg text-xs font-medium border text-left transition-colors ${
                      app.jacketStyle === js.id
                        ? 'bg-white text-slate-950 border-white'
                        : 'bg-slate-900 text-slate-300 border-white/10 hover:border-white/25'
                    }`}
                  >
                    {js.label}
                  </button>
                ))}
              </div>
            </section>

            {/* Clothing Colors */}
            <section className="space-y-3">
              <h3 className="text-xs font-semibold text-slate-300">{t(lang, 'wardrobe.colors')}</h3>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: 'jacketColor' as const, label: 'Jacket / Top' },
                  { key: 'shirtColor' as const, label: 'Shirt' },
                  { key: 'pantsColor' as const, label: 'Pants' },
                  { key: 'shoesColor' as const, label: 'Shoes' },
                ].map((item) => (
                  <label
                    key={item.key}
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-900 border border-white/10 text-xs text-slate-200 cursor-pointer"
                  >
                    <span>{item.label}</span>
                    <input
                      type="color"
                      value={app[item.key]}
                      onChange={(e) => setField(item.key, e.target.value)}
                      className="w-6 h-6 rounded cursor-pointer bg-transparent border-0"
                    />
                  </label>
                ))}
              </div>
            </section>

            {/* Accessories */}
            <section className="space-y-2.5">
              <h3 className="text-xs font-semibold text-slate-300">{t(lang, 'wardrobe.accessories')}</h3>
              <div className="grid grid-cols-2 gap-2">
                {ACCESSORIES.map((acc) => (
                  <button
                    key={acc.id}
                    onClick={() => setField('accessory', acc.id)}
                    className={`py-2 px-3 rounded-lg text-xs font-medium border text-left transition-colors ${
                      app.accessory === acc.id
                        ? 'bg-white text-slate-950 border-white'
                        : 'bg-slate-900 text-slate-300 border-white/10 hover:border-white/25'
                    }`}
                  >
                    {acc.label}
                  </button>
                ))}
              </div>
            </section>

            {/* Skin Tone */}
            <section className="space-y-2">
              <h3 className="text-xs font-semibold text-slate-300">{t(lang, 'wardrobe.skinTone')}</h3>
              <div className="flex gap-2">
                {SKIN_TONES.map((tone) => (
                  <button
                    key={tone}
                    onClick={() => setField('skinTone', tone)}
                    className="w-8 h-8 rounded-full border-2 transition-transform hover:scale-105"
                    style={{
                      backgroundColor: tone,
                      borderColor: app.skinTone === tone ? '#ffffff' : 'transparent',
                    }}
                  />
                ))}
              </div>
            </section>
          </>
        )}

        {activeTab === 'barber' && (
          <>
            <div className="p-3.5 rounded-xl bg-purple-500/10 border border-purple-400/25 text-xs text-purple-200">
              {t(lang, 'wardrobe.barberTitle', { name: character.name })}
            </div>

            {/* Hairstyle */}
            <section className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-300">{t(lang, 'wardrobe.hair')}</h3>
                <label className="inline-flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                  <span>{t(lang, 'wardrobe.colorLabel')}</span>
                  <input
                    type="color"
                    value={app.hairColor}
                    onChange={(e) => setField('hairColor', e.target.value)}
                    className="w-7 h-7 rounded cursor-pointer bg-transparent border-0"
                    aria-label={t(lang, 'wardrobe.colorLabel')}
                  />
                </label>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {HAIR_STYLES.map((hs) => (
                  <button
                    key={hs.id}
                    onClick={() => setField('hairStyle', hs.id)}
                    className={`py-2.5 px-2 rounded-lg text-xs font-medium border transition-colors ${
                      app.hairStyle === hs.id
                        ? 'bg-white text-slate-950 border-white'
                        : 'bg-slate-900 text-slate-300 border-white/10 hover:border-white/25'
                    }`}
                  >
                    {hs.label}
                  </button>
                ))}
              </div>
            </section>

            {/* Facial Hair */}
            <section className="space-y-2.5">
              <h3 className="text-xs font-semibold text-slate-300">{t(lang, 'wardrobe.facialHair')}</h3>
              <div className="grid grid-cols-2 gap-2">
                {FACIAL_HAIR_OPTIONS.map((fh) => (
                  <button
                    key={fh.id}
                    onClick={() => setField('facialHair', fh.id)}
                    className={`py-2.5 px-3 rounded-lg text-xs font-medium border text-left transition-colors ${
                      app.facialHair === fh.id
                        ? 'bg-white text-slate-950 border-white'
                        : 'bg-slate-900 text-slate-300 border-white/10 hover:border-white/25'
                    }`}
                  >
                    {fh.label}
                  </button>
                ))}
              </div>
            </section>
          </>
        )}

        {activeTab === 'tattoo' && (
          <>
            <div className="p-3.5 rounded-xl bg-teal-500/10 border border-teal-400/25 text-xs text-teal-200">
              {t(lang, 'wardrobe.tattooDesc')}
            </div>

            <section className="space-y-2.5">
              <h3 className="text-xs font-semibold text-slate-300">{t(lang, 'wardrobe.tattooDesigns')}</h3>
              <div className="space-y-2">
                {TATTOO_OPTIONS.map((tat) => {
                  const selected = app.tattoo === tat.id;
                  return (
                    <button
                      key={tat.id}
                      onClick={() => setField('tattoo', tat.id)}
                      className={`w-full p-3 rounded-xl border text-left transition-colors ${
                        selected
                          ? 'bg-white text-slate-950 border-white'
                          : 'bg-slate-900 text-slate-200 border-white/10 hover:border-white/25'
                      }`}
                    >
                      <div className="text-xs font-bold">{tat.label}</div>
                      <div className={`text-[11px] mt-0.5 ${selected ? 'text-slate-700' : 'text-slate-400'}`}>
                        {tat.desc}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
};
