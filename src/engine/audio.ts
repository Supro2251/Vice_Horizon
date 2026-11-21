import { AudioSettings, RadioStationId, WeaponId } from '../types/game';
import { DEFAULT_SETTINGS, RADIO_STATIONS } from '../data/defaults';

export class ProceduralAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private sirenGain: GainNode | null = null;
  private uiGain: GainNode | null = null;

  private engineOsc: OscillatorNode | null = null;
  private engineSubOsc: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineVolNode: GainNode | null = null;

  private sirenOsc: OscillatorNode | null = null;
  private sirenVolNode: GainNode | null = null;

  private screechNoise: AudioBufferSourceNode | null = null;
  private screechFilter: BiquadFilterNode | null = null;
  private screechGain: GainNode | null = null;

  private currentGear = 1;
  private lastShiftTime = -10;
  private lastShiftedFrom = 1;

  private currentStation: RadioStationId = 'off';
  private radioTimerId: number | null = null;
  private radioNextStepTime = 0;
  private radioStep = 0;
  private radioBar = 0;

  private settings: AudioSettings = { ...DEFAULT_SETTINGS.audio };
  private noiseBuffer: AudioBuffer | null = null;

  public unlock() {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();

      this.masterGain = this.ctx.createGain();
      this.musicGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.engineGain = this.ctx.createGain();
      this.sirenGain = this.ctx.createGain();
      this.uiGain = this.ctx.createGain();

      this.musicGain.connect(this.masterGain);
      this.sfxGain.connect(this.masterGain);
      this.engineGain.connect(this.masterGain);
      this.sirenGain.connect(this.masterGain);
      this.uiGain.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);

      // Reusable softly smoothed noise buffer (prevents harsh Nyquist whistle)
      const sampleRate = this.ctx.sampleRate;
      const length = sampleRate * 1.2;
      const buffer = this.ctx.createBuffer(1, length, sampleRate);
      const data = buffer.getChannelData(0);
      let prev = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        prev = prev * 0.35 + white * 0.65;
        data[i] = prev;
      }
      this.noiseBuffer = buffer;

      // Vehicle 5-speed engine synth with warm low-Q lowpass (zero whistling resonance)
      this.engineFilter = this.ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 160;
      this.engineFilter.Q.value = 0.7;

      this.engineVolNode = this.ctx.createGain();
      this.engineVolNode.gain.value = 0.0;
      this.engineFilter.connect(this.engineVolNode);
      this.engineVolNode.connect(this.engineGain);

      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 50;
      this.engineOsc.connect(this.engineFilter);
      this.engineOsc.start();

      this.engineSubOsc = this.ctx.createOscillator();
      this.engineSubOsc.type = 'triangle';
      this.engineSubOsc.frequency.value = 25;
      this.engineSubOsc.connect(this.engineFilter);
      this.engineSubOsc.start();

      // Police siren synth (silent unless wantedStars > 0)
      this.sirenVolNode = this.ctx.createGain();
      this.sirenVolNode.gain.value = 0.0;
      this.sirenVolNode.connect(this.sirenGain);

      this.sirenOsc = this.ctx.createOscillator();
      this.sirenOsc.type = 'triangle';
      this.sirenOsc.frequency.value = 660;
      this.sirenOsc.connect(this.sirenVolNode);
      this.sirenOsc.start();

      // Tire scrub synth: low-Q bandpassed noise buffer, hard-gated at exact 0 when not drifting
      // Eliminates the previous high-Q 980Hz/1315Hz oscillator ringing whistle!
      this.screechFilter = this.ctx.createBiquadFilter();
      this.screechFilter.type = 'bandpass';
      this.screechFilter.frequency.value = 780;
      this.screechFilter.Q.value = 1.1;

      this.screechGain = this.ctx.createGain();
      this.screechGain.gain.value = 0.0;

      this.screechNoise = this.ctx.createBufferSource();
      this.screechNoise.buffer = this.noiseBuffer;
      this.screechNoise.loop = true;
      this.screechNoise.connect(this.screechFilter);
      this.screechFilter.connect(this.screechGain);
      this.screechGain.connect(this.sfxGain);
      this.screechNoise.start();

      this.applySettings(this.settings);
    }

    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }

    if (this.ctx && this.currentStation !== 'off' && this.radioTimerId === null) {
      this.radioNextStepTime = this.ctx.currentTime + 0.06;
      this.radioTimerId = window.setInterval(() => this.schedulerTick(), 38);
    }
  }

  public applySettings(settings: AudioSettings) {
    this.settings = { ...settings };
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const master = settings.muted ? 0 : settings.master;
    this.masterGain.gain.setTargetAtTime(master, now, 0.03);
    this.musicGain?.gain.setTargetAtTime(settings.music ?? 0.55, now, 0.03);
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
    _rainIntensity = 0,
    maxSpeedKmh = 145,
    throttle = 0,
    brake = 0
  ) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;

    if (this.engineFilter && this.engineOsc && this.engineSubOsc && this.engineVolNode) {
      if (inVehicle && !this.settings.muted) {
        const topKmh = Math.max(45, maxSpeedKmh);
        const absKmh = Math.abs(speedKmh);
        const speedNorm = Math.min(1.0, absKmh / topKmh);

        // 5-speed automatic transmission gear brackets
        const gearStarts = [0.0, 0.17, 0.35, 0.55, 0.77];
        const gearEnds = [0.21, 0.40, 0.60, 0.82, 1.02];

        let targetGear = this.currentGear;
        if (speedNorm > gearEnds[this.currentGear - 1] && this.currentGear < 5) {
          targetGear = this.currentGear + 1;
        } else if (speedNorm < gearStarts[this.currentGear - 1] - 0.03 && this.currentGear > 1) {
          targetGear = this.currentGear - 1;
        }

        if (targetGear !== this.currentGear) {
          this.lastShiftedFrom = this.currentGear;
          this.currentGear = targetGear;
          this.lastShiftTime = timeSec;
        }

        const gMin = gearStarts[this.currentGear - 1];
        const gMax = gearEnds[this.currentGear - 1];
        const gearSpan = Math.max(0.12, gMax - gMin);
        const gearFrac = Math.max(0, Math.min(1, (speedNorm - gMin) / gearSpan));

        // Detect steady cruising at max speed vs active acceleration/deceleration
        const atTopSpeed = speedNorm >= 0.96 && this.currentGear === 5;
        const shiftElapsed = timeSec - this.lastShiftTime;
        let shiftDip = 0;
        if (shiftElapsed >= 0 && shiftElapsed < 0.22) {
          const isUpshift = this.currentGear > this.lastShiftedFrom;
          const env = Math.sin((shiftElapsed / 0.22) * Math.PI);
          shiftDip = isUpshift ? -0.18 * env : 0.14 * env;
        }

        const loadPush = throttle > 0.1 && !atTopSpeed ? throttle * 0.12 : 0;
        const decelDrag = brake > 0.1 && absKmh > 6 ? -brake * 0.10 : 0;
        const rpm = atTopSpeed
          ? 0.94
          : Math.max(0.14, Math.min(1.0, 0.22 + gearFrac * 0.72 + loadPush + decelDrag + shiftDip));

        const freq = 42 + rpm * 128;
        const filterCutoff = 125 + rpm * 390 + (throttle > 0.1 ? 55 : 0);
        const vol = 0.055 + rpm * 0.075 + (shiftElapsed < 0.14 ? -0.025 : 0);

        this.engineOsc.frequency.setTargetAtTime(freq, now, 0.04);
        this.engineSubOsc.frequency.setTargetAtTime(freq * 0.5, now, 0.04);
        this.engineFilter.frequency.setTargetAtTime(filterCutoff, now, 0.05);
        this.engineVolNode.gain.setTargetAtTime(Math.max(0.03, vol), now, 0.05);
      } else {
        this.currentGear = 1;
        this.engineVolNode.gain.cancelScheduledValues(now);
        this.engineVolNode.gain.setValueAtTime(0.0, now);
      }
    }

    if (this.screechGain && this.screechFilter) {
      const clampedDrift =
        inVehicle && !this.settings.muted && driftIntensity > 0.14
          ? Math.min(1, (driftIntensity - 0.14) / 0.86)
          : 0;
      if (clampedDrift > 0.01) {
        const targetVol = clampedDrift * 0.065;
        const targetFreq = 680 + clampedDrift * 260;
        this.screechFilter.frequency.setTargetAtTime(targetFreq, now, 0.04);
        this.screechGain.gain.setTargetAtTime(targetVol, now, 0.03);
      } else {
        this.screechGain.gain.cancelScheduledValues(now);
        this.screechGain.gain.setValueAtTime(0.0, now);
      }
    }

    if (this.sirenOsc && this.sirenVolNode) {
      if (wantedStars > 0 && !this.settings.muted) {
        const sweep = Math.sin(timeSec * 4.5);
        const freq = 690 + sweep * 240;
        this.sirenOsc.frequency.setTargetAtTime(freq, now, 0.04);
        this.sirenVolNode.gain.setTargetAtTime(0.04, now, 0.12);
      } else {
        this.sirenVolNode.gain.cancelScheduledValues(now);
        this.sirenVolNode.gain.setValueAtTime(0.0, now);
      }
    }
  }

  public playFootstep(isSprint: boolean, inWater: boolean) {
    if (!this.ctx || !this.sfxGain || !this.noiseBuffer || this.settings.muted) return;
    if (this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;

    // Subtle soft step thud + faint texture noise
    const thudOsc = this.ctx.createOscillator();
    const thudGain = this.ctx.createGain();
    thudOsc.type = 'sine';
    const baseFreq = inWater ? 140 : isSprint ? 115 : 92;
    thudOsc.frequency.setValueAtTime(baseFreq + Math.random() * 14, now);
    thudOsc.frequency.exponentialRampToValueAtTime(38, now + 0.055);
    const thudLevel = isSprint ? 0.042 : 0.026;
    thudGain.gain.setValueAtTime(thudLevel, now);
    thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.065);
    thudOsc.connect(thudGain);
    thudGain.connect(this.sfxGain);
    thudOsc.start(now);
    thudOsc.stop(now + 0.07);

    const grit = this.ctx.createBufferSource();
    grit.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = inWater ? 'bandpass' : 'lowpass';
    filter.frequency.setValueAtTime(inWater ? 920 : 480, now);
    filter.Q.value = 0.7;
    const gritGain = this.ctx.createGain();
    gritGain.gain.setValueAtTime(inWater ? 0.036 : isSprint ? 0.024 : 0.015, now);
    gritGain.gain.exponentialRampToValueAtTime(0.001, now + (inWater ? 0.11 : 0.055));
    grit.connect(filter);
    filter.connect(gritGain);
    gritGain.connect(this.sfxGain);
    grit.start(now);
    grit.stop(now + (inWater ? 0.12 : 0.06));
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

  public setRadioStation(stationId: RadioStationId) {
    if (stationId === this.currentStation) return;
    this.unlock();
    this.currentStation = stationId;
    this.radioStep = 0;
    this.radioBar = 0;

    if (stationId === 'off') {
      if (this.radioTimerId !== null) {
        window.clearInterval(this.radioTimerId);
        this.radioTimerId = null;
      }
      return;
    }

    this.playTuningStatic();
    if (this.ctx) {
      this.radioNextStepTime = this.ctx.currentTime + 0.08;
      if (this.radioTimerId === null) {
        this.radioTimerId = window.setInterval(() => this.schedulerTick(), 38);
      }
    }
  }

  public getRadioStation(): RadioStationId {
    return this.currentStation;
  }

  public getCurrentRadioTrack(): string {
    if (this.currentStation === 'off') return '---';
    const def = RADIO_STATIONS.find((s) => s.id === this.currentStation);
    if (!def || def.tracks.length === 0) return '---';
    const idx = Math.floor(this.radioBar / 8) % def.tracks.length;
    return def.tracks[idx];
  }

  private playTuningStatic() {
    if (!this.ctx || !this.musicGain || !this.noiseBuffer || this.settings.muted) return;
    if (this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1600, now);
    bp.Q.value = 1.4;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.055, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.musicGain);
    src.start(now);
    src.stop(now + 0.12);
  }

  private schedulerTick() {
    if (!this.ctx || !this.musicGain || this.currentStation === 'off' || this.settings.muted) return;
    if (this.ctx.state !== 'running') return;
    const def = RADIO_STATIONS.find((s) => s.id === this.currentStation);
    const bpm = def?.bpm || 105;
    const stepDur = 60 / bpm / 4;

    if (this.radioNextStepTime < this.ctx.currentTime - 0.1) {
      this.radioNextStepTime = this.ctx.currentTime + 0.02;
    }

    while (this.radioNextStepTime < this.ctx.currentTime + 0.14) {
      this.scheduleRadioStep(this.currentStation, this.radioStep, this.radioBar, this.radioNextStepTime, stepDur);
      this.radioNextStepTime += stepDur;
      this.radioStep = (this.radioStep + 1) % 16;
      if (this.radioStep === 0) {
        this.radioBar += 1;
      }
    }
  }

  private radioKick(t: number, startHz = 125, endHz = 42, vol = 0.24, decay = 0.18) {
    if (!this.ctx || !this.musicGain) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(startHz, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(24, endHz), t + decay * 0.65);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + decay);
    osc.connect(g);
    g.connect(this.musicGain);
    osc.start(t);
    osc.stop(t + decay + 0.01);
  }

  private radioSnare(t: number, toneHz = 185, vol = 0.13, decay = 0.14) {
    if (!this.ctx || !this.musicGain) return;
    const osc = this.ctx.createOscillator();
    const og = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(toneHz, t);
    osc.frequency.exponentialRampToValueAtTime(85, t + 0.06);
    og.gain.setValueAtTime(vol * 0.65, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.connect(og);
    og.connect(this.musicGain);
    osc.start(t);
    osc.stop(t + 0.09);

    if (this.noiseBuffer) {
      const n = this.ctx.createBufferSource();
      n.buffer = this.noiseBuffer;
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.setValueAtTime(1100, t);
      const ng = this.ctx.createGain();
      ng.gain.setValueAtTime(vol, t);
      ng.gain.exponentialRampToValueAtTime(0.001, t + decay);
      n.connect(hp);
      hp.connect(ng);
      ng.connect(this.musicGain);
      n.start(t);
      n.stop(t + decay + 0.01);
    }
  }

  private radioHat(t: number, open = false, vol = 0.045) {
    if (!this.ctx || !this.musicGain || !this.noiseBuffer) return;
    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuffer;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(open ? 4200 : 6200, t);
    const g = this.ctx.createGain();
    const dur = open ? 0.14 : 0.042;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(hp);
    hp.connect(g);
    g.connect(this.musicGain);
    n.start(t);
    n.stop(t + dur + 0.01);
  }

  private radioTone(
    t: number,
    freq: number,
    dur: number,
    wave: OscillatorType,
    cutoff: number,
    vol: number,
    q = 1.2,
    slideToFreq?: number
  ) {
    if (!this.ctx || !this.musicGain) return;
    const osc = this.ctx.createOscillator();
    const flt = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, t);
    if (slideToFreq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(24, slideToFreq), t + dur * 0.85);
    }
    flt.type = 'lowpass';
    flt.frequency.setValueAtTime(cutoff, t);
    flt.frequency.exponentialRampToValueAtTime(Math.max(120, cutoff * 0.45), t + dur);
    flt.Q.value = q;
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(vol, t + Math.min(0.015, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(flt);
    flt.connect(g);
    g.connect(this.musicGain);
    osc.start(t);
    osc.stop(t + dur + 0.015);
  }

  private radioChord(t: number, freqs: number[], dur: number, wave: OscillatorType, cutoff: number, vol: number) {
    const each = vol / Math.max(1, freqs.length);
    for (const f of freqs) {
      this.radioTone(t, f, dur, wave, cutoff, each, 0.7);
    }
  }

  private scheduleRadioStep(station: RadioStationId, step: number, bar: number, t: number, stepDur: number) {
    const barMod = bar % 4;

    if (station === 'vice_synth') {
      // 80s Synthwave (Am - F - C - G @ 108 BPM)
      const roots = [110, 87.31, 130.81, 98.0];
      const chords = [
        [220, 261.63, 329.63],
        [174.61, 220, 261.63],
        [261.63, 329.63, 392.0],
        [196.0, 246.94, 293.66],
      ];
      const leadSeq = [659.25, 0, 523.25, 0, 587.33, 0, 659.25, 783.99, 659.25, 0, 523.25, 0, 440, 493.88, 523.25, 0];
      if (step % 4 === 0) this.radioKick(t, 130, 46, 0.24, 0.16);
      if (step === 4 || step === 12) this.radioSnare(t, 195, 0.14, 0.18);
      if (step % 4 === 2) this.radioHat(t, false, 0.045);
      // Driving 8th-note synthwave bassline
      if (step % 2 === 0) {
        const oct = step % 4 === 2 ? 2 : 1;
        this.radioTone(t, roots[barMod] * oct, stepDur * 1.65, 'sawtooth', 540, 0.11, 2.0);
      }
      if (step === 0) {
        this.radioChord(t, chords[barMod], stepDur * 14, 'sawtooth', 880, 0.095);
      }
      const leadF = leadSeq[(step + barMod * 4) % leadSeq.length];
      if (leadF > 0) {
        this.radioTone(t, leadF, stepDur * 1.8, 'square', 1650, 0.055, 1.0);
      }
    } else if (station === 'leonida_hiphop') {
      // Hip-Hop / Trap (808 sub + trap hi-hat rolls @ 92 BPM)
      const roots = [65.41, 65.41, 58.27, 51.91]; // C2 - Bb1 - Ab1
      if (step === 0 || step === 7 || step === 10) this.radioKick(t, 115, 36, 0.28, 0.24);
      if (step === 4 || step === 12) this.radioSnare(t, 170, 0.15, 0.13);
      if (step % 2 === 0 || step === 11 || step === 13 || step === 15) {
        this.radioHat(t, step === 14, step % 2 === 1 ? 0.032 : 0.048);
      }
      if (step === 0 || step === 10) {
        const slideTarget = step === 10 ? roots[barMod] * 0.88 : undefined;
        this.radioTone(t, roots[barMod], stepDur * 5.2, 'sine', 240, 0.22, 0.8, slideTarget);
      }
      const bells = [523.25, 0, 622.25, 0, 587.33, 0, 466.16, 0, 523.25, 0, 783.99, 0, 622.25, 0, 587.33, 466.16];
      const bf = bells[step];
      if (bf > 0 && (bar % 2 === 0 || step < 12)) {
        this.radioTone(t, bf, stepDur * 2.1, 'triangle', 1900, 0.07, 1.0);
      }
    } else if (station === 'coral_rock') {
      // Rock / Grunge (Power chords @ 128 BPM)
      const roots = [82.41, 98.0, 110.0, 73.42]; // E2 - G2 - A2 - D2
      if (step === 0 || step === 3 || step === 8 || step === 10) this.radioKick(t, 118, 48, 0.23, 0.15);
      if (step === 4 || step === 12) this.radioSnare(t, 210, 0.15, 0.15);
      if (step % 2 === 0) this.radioHat(t, step === 6 || step === 14, 0.045);
      const r = roots[barMod];
      this.radioTone(t, r, stepDur * 1.4, 'sawtooth', 480, 0.11, 1.4);
      if (step === 0 || step === 3 || step === 6 || step === 8 || step === 12) {
        this.radioChord(t, [r * 2, r * 3, r * 4], stepDur * 2.5, 'sawtooth', 1550, 0.11);
      }
      const solo = [329.63, 0, 392.0, 440.0, 0, 493.88, 440.0, 392.0];
      if (bar % 2 === 1 && step % 2 === 0) {
        const nf = solo[(step / 2) % solo.length];
        if (nf > 0) this.radioTone(t, nf, stepDur * 1.8, 'sawtooth', 2100, 0.06, 1.5);
      }
    } else if (station === 'havana_latin') {
      // Latin Salsa (Montuno + Tumbao + Clave @ 102 BPM)
      const roots = [146.83, 116.54, 110.0, 146.83]; // Dm - Bb - A - Dm
      const chords = [
        [293.66, 349.23, 440.0],
        [233.08, 293.66, 349.23],
        [220.0, 277.18, 329.63],
        [293.66, 349.23, 440.0],
      ];
      // Clave 3-2 click
      if (step === 0 || step === 3 || step === 6 || step === 10 || step === 12) {
        this.radioTone(t, 1680, 0.035, 'triangle', 2600, 0.075, 2.5);
      }
      this.radioHat(t, false, step % 2 === 0 ? 0.036 : 0.02);
      // Tumbao bass on beat 2& and 4
      if (step === 0 || step === 6 || step === 12) {
        this.radioTone(t, roots[barMod] * 0.5, stepDur * 2.4, 'triangle', 380, 0.18, 0.9);
      }
      // Piano montuno syncopation
      if (step === 2 || step === 5 || step === 8 || step === 11 || step === 14) {
        this.radioChord(t, chords[barMod], stepDur * 1.4, 'triangle', 1750, 0.095);
      }
      if (bar % 2 === 1 && (step === 0 || step === 4 || step === 7 || step === 10)) {
        const brass = [587.33, 659.25, 698.46, 587.33];
        this.radioTone(t, brass[Math.floor(step / 3) % brass.length], stepDur * 2.2, 'sawtooth', 1600, 0.058, 1.2);
      }
    } else if (station === 'horizon_techno') {
      // Techno / Rave (303 acid + 132 BPM 4x4)
      const acidNotes = [55, 55, 110, 55, 65.41, 55, 82.41, 73.42, 55, 110, 55, 65.41, 110, 55, 98, 82.41];
      if (step % 4 === 0) this.radioKick(t, 145, 42, 0.27, 0.17);
      if (step % 4 === 2) this.radioHat(t, true, 0.052);
      if (step === 4 || step === 12) this.radioSnare(t, 180, 0.11, 0.09);
      const sweep = 420 + Math.sin((bar * 16 + step) * 0.18) * 320 + (step % 4 === 0 ? 450 : 0);
      this.radioTone(t, acidNotes[step], stepDur * 0.88, 'sawtooth', sweep, 0.115, 4.2);
      if (step === 0 && bar % 2 === 0) {
        this.radioChord(t, [220, 261.63, 329.63, 392.0], stepDur * 4.5, 'sawtooth', 1400, 0.09);
      }
    } else if (station === 'midnight_jazz') {
      // Chill Jazz / Lo-Fi (Rhodes 9th chords + mellow sax @ 84 BPM)
      const roots = [146.83, 98.0, 130.81, 110.0]; // Dm9 - G13 - Cmaj9 - A7
      const chords = [
        [293.66, 349.23, 440.0, 523.25],
        [246.94, 329.63, 392.0, 440.0],
        [261.63, 329.63, 392.0, 493.88],
        [220.0, 277.18, 329.63, 392.0],
      ];
      if (step === 0 || step === 7 || step === 10) this.radioKick(t, 92, 40, 0.16, 0.18);
      if (step === 4 || step === 12) this.radioSnare(t, 150, 0.06, 0.09);
      if (step % 3 === 0 || step === 14) this.radioHat(t, false, 0.026);
      if (step === 0 || step === 9) {
        this.radioTone(t, roots[barMod] * 0.5, stepDur * 5.0, 'sine', 300, 0.14, 0.7);
      }
      if (step === 0 || step === 10) {
        this.radioChord(t, chords[barMod], stepDur * 6.5, 'sine', 1200, 0.095);
      }
      const sax = [523.25, 0, 0, 587.33, 659.25, 0, 587.33, 0, 440.0, 0, 0, 392.0, 440.0, 0, 523.25, 0];
      const sf = sax[(step + barMod * 2) % sax.length];
      if (sf > 0) {
        this.radioTone(t, sf, stepDur * 2.5, 'triangle', 1050, 0.055, 0.8);
      }
    }
  }

  public playWaterSpray(intensity = 1) {
    if (!this.ctx || !this.sfxGain || !this.noiseBuffer || this.settings.muted) return;
    if (this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(680 + Math.random() * 240, now);
    bp.Q.value = 0.8;
    const g = this.ctx.createGain();
    const vol = Math.min(0.14, 0.08 * Math.max(0.3, intensity));
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(vol, now + 0.025);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.sfxGain);
    src.start(now);
    src.stop(now + 0.17);
  }

  public dispose() {
    if (this.radioTimerId !== null) {
      window.clearInterval(this.radioTimerId);
      this.radioTimerId = null;
    }
    try {
      this.engineOsc?.stop();
      this.engineSubOsc?.stop();
      this.sirenOsc?.stop();
      this.screechNoise?.stop();
      this.ctx?.close();
    } catch {
      // Ignore cleanup errors
    }
    this.ctx = null;
  }
}
