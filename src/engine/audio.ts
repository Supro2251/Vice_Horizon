import { AudioSettings, WeaponId } from '../types/game';
import { DEFAULT_SETTINGS } from '../data/defaults';

export class ProceduralAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private sirenGain: GainNode | null = null;
  private uiGain: GainNode | null = null;

  private engineOsc: OscillatorNode | null = null;
  private engineSubOsc: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private sirenOsc: OscillatorNode | null = null;
  private screechOsc1: OscillatorNode | null = null;
  private screechOsc2: OscillatorNode | null = null;
  private screechFilter: BiquadFilterNode | null = null;
  private screechGain: GainNode | null = null;

  private settings: AudioSettings = { ...DEFAULT_SETTINGS.audio };
  private noiseBuffer: AudioBuffer | null = null;

  public unlock() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();

      this.masterGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.engineGain = this.ctx.createGain();
      this.sirenGain = this.ctx.createGain();
      this.uiGain = this.ctx.createGain();

      this.sfxGain.connect(this.masterGain);
      this.engineGain.connect(this.masterGain);
      this.sirenGain.connect(this.masterGain);
      this.uiGain.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);

      // Generate reusable white noise buffer for gunfire & explosions
      const sampleRate = this.ctx.sampleRate;
      const length = sampleRate * 1.0;
      const buffer = this.ctx.createBuffer(1, length, sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      this.noiseBuffer = buffer;

      // Setup continuous vehicle engine synth
      this.engineFilter = this.ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 180;

      const engineVol = this.ctx.createGain();
      engineVol.gain.value = 0.0;
      this.engineFilter.connect(engineVol);
      engineVol.connect(this.engineGain);

      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 55;
      this.engineOsc.connect(this.engineFilter);
      this.engineOsc.start();

      this.engineSubOsc = this.ctx.createOscillator();
      this.engineSubOsc.type = 'triangle';
      this.engineSubOsc.frequency.value = 28;
      this.engineSubOsc.connect(this.engineFilter);
      this.engineSubOsc.start();

      // Store local gain ref on node for smooth modulation
      (this.engineFilter as unknown as { _volNode: GainNode })._volNode = engineVol;

      // Setup police siren synth
      const sirenVol = this.ctx.createGain();
      sirenVol.gain.value = 0.0;
      sirenVol.connect(this.sirenGain);

      this.sirenOsc = this.ctx.createOscillator();
      this.sirenOsc.type = 'triangle';
      this.sirenOsc.frequency.value = 660;
      this.sirenOsc.connect(sirenVol);
      this.sirenOsc.start();
      (this.sirenOsc as unknown as { _volNode: GainNode })._volNode = sirenVol;

      // Setup clean harmonic tire screech synth (no white-noise background hiss)
      this.screechFilter = this.ctx.createBiquadFilter();
      this.screechFilter.type = 'bandpass';
      this.screechFilter.frequency.value = 1280;
      this.screechFilter.Q.value = 5.0;

      this.screechGain = this.ctx.createGain();
      this.screechGain.gain.value = 0.0;

      this.screechOsc1 = this.ctx.createOscillator();
      this.screechOsc1.type = 'triangle';
      this.screechOsc1.frequency.value = 980;
      this.screechOsc1.connect(this.screechFilter);

      this.screechOsc2 = this.ctx.createOscillator();
      this.screechOsc2.type = 'sine';
      this.screechOsc2.frequency.value = 1315;
      this.screechOsc2.connect(this.screechFilter);

      this.screechFilter.connect(this.screechGain);
      this.screechGain.connect(this.sfxGain);
      this.screechOsc1.start();
      this.screechOsc2.start();

      this.applySettings(this.settings);
    }

    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  public applySettings(settings: AudioSettings) {
    this.settings = { ...settings };
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const master = settings.muted ? 0 : settings.master;
    this.masterGain.gain.setTargetAtTime(master, now, 0.03);
    this.sfxGain?.gain.setTargetAtTime(settings.sfx, now, 0.03);
    this.engineGain?.gain.setTargetAtTime(settings.engine, now, 0.03);
    this.sirenGain?.gain.setTargetAtTime(settings.siren, now, 0.03);
    this.uiGain?.gain.setTargetAtTime(settings.ui, now, 0.03);
  }

  public updateContinuous(
    inVehicle: boolean,
    speedKmh: number,
    wantedStars: number,
    timeSec: number,
    driftIntensity = 0,
    rainIntensity = 0
  ) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;

    if (this.engineFilter && this.engineOsc && this.engineSubOsc) {
      const volNode = (this.engineFilter as unknown as { _volNode: GainNode })._volNode;
      if (inVehicle) {
        const rpmRatio = Math.min(1, Math.abs(speedKmh) / 160);
        const freq = 48 + rpmRatio * 135;
        this.engineOsc.frequency.setTargetAtTime(freq, now, 0.05);
        this.engineSubOsc.frequency.setTargetAtTime(freq * 0.5, now, 0.05);
        this.engineFilter.frequency.setTargetAtTime(140 + rpmRatio * 420, now, 0.05);
        volNode.gain.setTargetAtTime(0.08 + rpmRatio * 0.09, now, 0.08);
      } else {
        volNode.gain.setTargetAtTime(0.0, now, 0.08);
      }
    }

    if (this.screechGain && this.screechFilter && this.screechOsc1 && this.screechOsc2) {
      const clampedDrift = inVehicle && !this.settings.muted && driftIntensity > 0.08 ? Math.min(1, driftIntensity) : 0;
      if (clampedDrift > 0) {
        const targetVol = clampedDrift * 0.085;
        const targetFreq = 1040 + clampedDrift * 380 + Math.sin(timeSec * 19) * 38;
        this.screechOsc1.frequency.setTargetAtTime(targetFreq * 0.78, now, 0.04);
        this.screechOsc2.frequency.setTargetAtTime(targetFreq * 1.04, now, 0.04);
        this.screechFilter.frequency.setTargetAtTime(targetFreq, now, 0.05);
        this.screechGain.gain.setTargetAtTime(targetVol, now, 0.04);
      } else {
        this.screechGain.gain.setTargetAtTime(0.0, now, 0.02);
      }
    }

    if (this.sirenOsc) {
      const sirenVol = (this.sirenOsc as unknown as { _volNode: GainNode })._volNode;
      if (wantedStars > 0) {
        const sweep = Math.sin(timeSec * 4.5);
        const freq = 690 + sweep * 240;
        this.sirenOsc.frequency.setTargetAtTime(freq, now, 0.04);
        sirenVol.gain.setTargetAtTime(0.045, now, 0.15);
      } else {
        sirenVol.gain.setTargetAtTime(0.0, now, 0.15);
      }
    }
  }

  public playThunder() {
    if (!this.ctx || !this.sfxGain || !this.noiseBuffer || this.settings.muted) return;
    if (this.ctx.state === 'suspended') return;
    const now = this.ctx.currentTime;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(220, now);
    filter.frequency.exponentialRampToValueAtTime(48, now + 1.4);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.01, now);
    g.gain.linearRampToValueAtTime(0.42, now + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, now + 1.5);
    noise.connect(filter);
    filter.connect(g);
    g.connect(this.sfxGain);
    noise.start(now);
    noise.stop(now + 1.55);
  }

  public playGunshot(weaponId: WeaponId) {
    if (!this.ctx || !this.sfxGain || !this.noiseBuffer || this.settings.muted) return;
    if (this.ctx.state === 'suspended') return;
    const now = this.ctx.currentTime;

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    const gain = this.ctx.createGain();

    const punchOsc = this.ctx.createOscillator();
    const punchGain = this.ctx.createGain();

    if (weaponId === 'pistol') {
      filter.frequency.setValueAtTime(1400, now);
      filter.Q.value = 0.8;
      gain.gain.setValueAtTime(0.32, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
      punchOsc.frequency.setValueAtTime(180, now);
      punchOsc.frequency.exponentialRampToValueAtTime(55, now + 0.08);
      punchGain.gain.setValueAtTime(0.28, now);
      punchGain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    } else if (weaponId === 'smg') {
      filter.frequency.setValueAtTime(1850, now);
      filter.Q.value = 1.0;
      gain.gain.setValueAtTime(0.22, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
      punchOsc.frequency.setValueAtTime(220, now);
      punchOsc.frequency.exponentialRampToValueAtTime(75, now + 0.05);
      punchGain.gain.setValueAtTime(0.18, now);
      punchGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    } else if (weaponId === 'shotgun') {
      filter.frequency.setValueAtTime(750, now);
      filter.Q.value = 0.5;
      gain.gain.setValueAtTime(0.55, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      punchOsc.frequency.setValueAtTime(135, now);
      punchOsc.frequency.exponentialRampToValueAtTime(32, now + 0.16);
      punchGain.gain.setValueAtTime(0.45, now);
      punchGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    } else if (weaponId === 'sniper') {
      filter.frequency.setValueAtTime(980, now);
      filter.Q.value = 0.6;
      gain.gain.setValueAtTime(0.58, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      punchOsc.frequency.setValueAtTime(195, now);
      punchOsc.frequency.exponentialRampToValueAtTime(38, now + 0.14);
      punchGain.gain.setValueAtTime(0.45, now);
      punchGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    } else if (weaponId === 'minigun') {
      filter.frequency.setValueAtTime(1550, now);
      filter.Q.value = 1.1;
      gain.gain.setValueAtTime(0.24, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      punchOsc.frequency.setValueAtTime(210, now);
      punchOsc.frequency.exponentialRampToValueAtTime(65, now + 0.045);
      punchGain.gain.setValueAtTime(0.2, now);
      punchGain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);
    } else if (weaponId === 'rpg') {
      filter.frequency.setValueAtTime(520, now);
      filter.Q.value = 0.45;
      gain.gain.setValueAtTime(0.52, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
      punchOsc.frequency.setValueAtTime(120, now);
      punchOsc.frequency.exponentialRampToValueAtTime(42, now + 0.22);
      punchGain.gain.setValueAtTime(0.38, now);
      punchGain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    } else {
      // carbine
      filter.frequency.setValueAtTime(1250, now);
      filter.Q.value = 0.7;
      gain.gain.setValueAtTime(0.36, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      punchOsc.frequency.setValueAtTime(160, now);
      punchOsc.frequency.exponentialRampToValueAtTime(48, now + 0.09);
      punchGain.gain.setValueAtTime(0.32, now);
      punchGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    }

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    noise.start(now);
    noise.stop(now + 0.3);

    punchOsc.type = 'sine';
    punchOsc.connect(punchGain);
    punchGain.connect(this.sfxGain);
    punchOsc.start(now);
    punchOsc.stop(now + 0.2);
  }

  public playReload() {
    if (!this.ctx || !this.sfxGain || this.settings.muted) return;
    const now = this.ctx.currentTime;
    [0, 0.18].forEach((offset, idx) => {
      if (!this.ctx || !this.sfxGain) return;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(idx === 0 ? 520 : 780, now + offset);
      g.gain.setValueAtTime(0.08, now + offset);
      g.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.045);
      osc.connect(g);
      g.connect(this.sfxGain);
      osc.start(now + offset);
      osc.stop(now + offset + 0.05);
    });
  }

  public playHitMarker() {
    if (!this.ctx || !this.sfxGain || this.settings.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1320, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.04);
    g.gain.setValueAtTime(0.14, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
    osc.connect(g);
    g.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.05);
  }

  public playExplosion() {
    if (!this.ctx || !this.sfxGain || !this.noiseBuffer || this.settings.muted) return;
    const now = this.ctx.currentTime;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(480, now);
    filter.frequency.exponentialRampToValueAtTime(60, now + 0.7);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.65, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.75);
    noise.connect(filter);
    filter.connect(g);
    g.connect(this.sfxGain);
    noise.start(now);
    noise.stop(now + 0.8);
  }

  public playImpact(strength = 0.5) {
    if (!this.ctx || !this.sfxGain || this.settings.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(36, now + 0.14);
    g.gain.setValueAtTime(Math.min(0.4, 0.15 + strength * 0.25), now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc.connect(g);
    g.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.18);
  }

  public playHorn() {
    if (!this.ctx || !this.sfxGain || this.settings.muted) return;
    const now = this.ctx.currentTime;
    [340, 425].forEach((freq) => {
      if (!this.ctx || !this.sfxGain) return;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, now);
      g.gain.setValueAtTime(0.09, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.connect(g);
      g.connect(this.sfxGain);
      osc.start(now);
      osc.stop(now + 0.26);
    });
  }

  public playUiChime(kind: 'click' | 'mission' | 'switch' = 'click') {
    if (!this.ctx || !this.uiGain || this.settings.muted) return;
    const now = this.ctx.currentTime;
    const notes = kind === 'mission' ? [523.25, 659.25, 783.99] : kind === 'switch' ? [392, 587.33] : [620];
    notes.forEach((freq, i) => {
      if (!this.ctx || !this.uiGain) return;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.07);
      g.gain.setValueAtTime(0.09, now + i * 0.07);
      g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.07 + 0.16);
      osc.connect(g);
      g.connect(this.uiGain);
      osc.start(now + i * 0.07);
      osc.stop(now + i * 0.07 + 0.18);
    });
  }

  public dispose() {
    try {
      this.engineOsc?.stop();
      this.engineSubOsc?.stop();
      this.sirenOsc?.stop();
      this.screechOsc1?.stop();
      this.screechOsc2?.stop();
      this.ctx?.close();
    } catch {
      // Ignore cleanup errors
    }
    this.ctx = null;
  }
}
