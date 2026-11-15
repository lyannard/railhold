/**
 * Procedural sound and music. Nothing is downloaded: every sound is synthesised with Web Audio.
 * Nothing here may throw: audio can be blocked, missing or suspended.
 */

export type MusicTrack = 'menu' | 'battle' | 'off';
export type Sfx =
  | 'click' | 'back' | 'toggle' | 'slider' | 'confirm' | 'buy' | 'error' | 'ready' | 'tick'
  | 'hit' | 'kill' | 'baseHit' | 'waveStart' | 'waveClear' | 'victory' | 'defeat' | 'chargeReady' | 'step';

const midi = (n: number): number => 440 * 2 ** ((n - 69) / 12);

interface TrackDef {
  bpm: number;
  /** One chord per bar: root MIDI note and the triad above it. */
  chords: Array<{ root: number; tones: number[] }>;
  drums: boolean;
  /** 16 steps of the arpeggio, as indices into the chord tones (-1 = rest, 3 = octave above root). */
  arp: number[];
  bass: number[];
  lead?: Array<number[]>;
  arpWave: OscillatorType;
  arpGain: number;
}

const AM = { root: 45, tones: [57, 60, 64] };
const F = { root: 41, tones: [53, 57, 60] };
const C = { root: 48, tones: [60, 64, 67] };
const G = { root: 43, tones: [55, 59, 62] };

const TRACKS: Record<Exclude<MusicTrack, 'off'>, TrackDef> = {
  menu: {
    bpm: 96,
    chords: [AM, F, C, G],
    drums: true,
    arp: [0, -1, 1, -1, 2, -1, 1, -1, 0, -1, 1, -1, 2, -1, 3, -1],
    bass: [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    arpWave: 'triangle',
    arpGain: 0.16,
  },
  battle: {
    bpm: 132,
    chords: [AM, F, C, G],
    drums: true,
    arp: [0, 1, 2, 1, 0, 1, 2, 3, 0, 1, 2, 1, 2, 1, 3, 2],
    bass: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1],
    lead: [
      [9, -1, -1, -1, 12, -1, 9, -1, 7, -1, -1, -1, -1, -1, -1, -1],
      [-1, -1, -1, -1, 9, -1, 12, -1, 14, -1, 12, -1, 9, -1, -1, -1],
    ],
    arpWave: 'square',
    arpGain: 0.07,
  },
};

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private whine: { osc: OscillatorNode; gain: GainNode } | null = null;
  private wind: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  volume = 0.7;
  musicVolume = 0.5;
  sfxVolume = 0.85;

  private track: MusicTrack = 'off';
  private wanted: MusicTrack = 'off';
  private timer: number | null = null;
  private nextTime = 0;
  private step = 0;
  private bar = 0;

  /** Create or resume the context. Call from a user gesture. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.ratio.value = 4;
        this.master = this.ctx.createGain();
        this.musicBus = this.ctx.createGain();
        this.sfxBus = this.ctx.createGain();
        this.musicBus.connect(this.master);
        this.sfxBus.connect(this.master);
        this.master.connect(comp).connect(this.ctx.destination);
        this.applyVolumes();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
      if (this.wanted !== 'off' && this.track !== this.wanted) this.music(this.wanted);
    } catch {
      this.ctx = null;
    }
  }

  private applyVolumes(): void {
    try {
      if (this.master) this.master.gain.value = this.volume;
      if (this.musicBus) this.musicBus.gain.value = this.musicVolume * 0.9;
      if (this.sfxBus) this.sfxBus.gain.value = this.sfxVolume;
    } catch {
      /* ignore */
    }
  }

  setVolume(v: number): void {
    this.volume = v;
    this.applyVolumes();
  }

  setMusicVolume(v: number): void {
    this.musicVolume = v;
    this.applyVolumes();
  }

  setSfxVolume(v: number): void {
    this.sfxVolume = v;
    this.applyVolumes();
  }

  // ------------------------------------------------------------------ music

  /** Start a looping track (or stop it with 'off'). Safe to call before the first gesture. */
  music(track: MusicTrack): void {
    this.wanted = track;
    try {
      if (!this.ctx || !this.musicBus) return;
      if (track === this.track && (this.timer !== null || track === 'off')) return;
      if (this.timer !== null) {
        window.clearInterval(this.timer);
        this.timer = null;
      }
      this.track = track;
      if (track === 'off') return;
      this.step = 0;
      this.bar = 0;
      this.nextTime = this.ctx.currentTime + 0.08;
      this.timer = window.setInterval(() => this.schedule(), 40);
    } catch {
      /* ignore */
    }
  }

  private schedule(): void {
    try {
      if (!this.ctx || this.track === 'off') return;
      const def = TRACKS[this.track];
      const stepLen = 60 / def.bpm / 4;
      while (this.nextTime < this.ctx.currentTime + 0.18) {
        this.playStep(def, this.step, this.bar, this.nextTime, stepLen);
        this.nextTime += stepLen;
        this.step += 1;
        if (this.step >= 16) {
          this.step = 0;
          this.bar += 1;
        }
      }
    } catch {
      /* ignore */
    }
  }

  private playStep(def: TrackDef, step: number, bar: number, t: number, len: number): void {
    const chord = def.chords[bar % def.chords.length];
    if (def.bass[step]) this.tone(midi(chord.root), t, len * 1.8, 'sawtooth', 0.2, this.musicBus, 520);
    const a = def.arp[step];
    if (a >= 0) {
      const n = a === 3 ? chord.tones[0] + 12 : chord.tones[a];
      this.tone(midi(n), t, len * 1.5, def.arpWave, def.arpGain, this.musicBus, 3200);
    }
    if (def.lead) {
      const phrase = def.lead[Math.floor(bar / 2) % def.lead.length];
      const semis = phrase[step];
      if (semis >= 0 && bar % 4 >= 2) this.tone(midi(chord.root + 24 + semis), t, len * 2.2, 'square', 0.06, this.musicBus, 2600);
    }
    if (def.drums) {
      if (step % 4 === 0) this.kick(t, def.bpm > 110 ? 0.5 : 0.35);
      if (def.bpm > 110 && (step === 4 || step === 12)) this.snare(t, 0.22);
      if (def.bpm <= 110 && step === 8) this.snare(t, 0.12);
      if (step % 2 === 0) this.hat(t, step % 4 === 2 ? 0.1 : 0.05);
    }
  }

  private tone(freq: number, t: number, dur: number, type: OscillatorType, gain: number, bus: GainNode | null, cutoff: number): void {
    if (!this.ctx || !bus) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const f = this.ctx.createBiquadFilter();
    o.type = type;
    o.frequency.value = freq;
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.05, dur));
    o.connect(f).connect(g).connect(bus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private kick(t: number, gain: number): void {
    if (!this.ctx || !this.musicBus) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g).connect(this.musicBus);
    o.start(t);
    o.stop(t + 0.22);
  }

  private snare(t: number, gain: number): void {
    this.noiseHit(t, 0.12, 1800, 'bandpass', gain, this.musicBus);
  }

  private hat(t: number, gain: number): void {
    this.noiseHit(t, 0.035, 7000, 'highpass', gain, this.musicBus);
  }

  private noise(): AudioBuffer | null {
    if (!this.ctx) return null;
    if (!this.noiseBuf) {
      const n = Math.floor(this.ctx.sampleRate * 2);
      this.noiseBuf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    return this.noiseBuf;
  }

  private noiseHit(t: number, dur: number, freq: number, type: BiquadFilterType, gain: number, bus: GainNode | null): void {
    if (!this.ctx || !bus) return;
    const buf = this.noise();
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(bus);
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
  }

  // ------------------------------------------------------------------ continuous

  /** Charge whine: pitch follows the bank voltage fraction (0 to 1). Pass 0 to silence it. */
  setCharge(frac: number): void {
    try {
      if (!this.ctx || !this.sfxBus) return;
      if (!this.whine) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        gain.gain.value = 0;
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 1800;
        osc.connect(lp).connect(gain).connect(this.sfxBus);
        osc.start();
        this.whine = { osc, gain };
      }
      const t = this.ctx.currentTime;
      this.whine.osc.frequency.setTargetAtTime(180 + 900 * frac, t, 0.05);
      this.whine.gain.gain.setTargetAtTime(frac > 0.01 && frac < 0.985 ? 0.012 : 0, t, 0.08);
    } catch {
      /* ignore */
    }
  }

  startWind(): void {
    /* the wind bed was removed: it fought with the music */
  }

  stopAll(): void {
    try {
      this.whine?.osc.stop();
      this.wind?.src.stop();
    } catch {
      /* ignore */
    }
    this.whine = null;
    this.wind = null;
  }

  // ------------------------------------------------------------------ one-shots

  private now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  click(): void {
    this.sfx('click');
  }

  /** Short UI and game sounds. */
  sfx(name: Sfx): void {
    try {
      if (!this.ctx || !this.sfxBus) return;
      const t = this.now();
      const b = this.sfxBus;
      const note = (n: number, at: number, dur: number, type: OscillatorType = 'triangle', gain = 0.2): void => this.tone(midi(n), t + at, dur, type, gain, b, 5000);
      switch (name) {
        case 'click': note(84, 0, 0.06, 'square', 0.07); note(91, 0.02, 0.05, 'square', 0.05); break;
        case 'back': note(79, 0, 0.07, 'square', 0.07); note(72, 0.04, 0.08, 'square', 0.06); break;
        case 'toggle': note(88, 0, 0.05, 'triangle', 0.12); break;
        case 'slider': note(76, 0, 0.03, 'triangle', 0.05); break;
        case 'confirm': note(72, 0, 0.1); note(79, 0.07, 0.1); note(84, 0.14, 0.18); break;
        case 'ready': note(76, 0, 0.1); note(83, 0.08, 0.16); break;
        case 'buy': note(88, 0, 0.07, 'square', 0.08); note(95, 0.06, 0.07, 'square', 0.08); note(100, 0.12, 0.2, 'triangle', 0.14); break;
        case 'error': note(52, 0, 0.12, 'square', 0.1); note(49, 0.1, 0.18, 'square', 0.1); break;
        case 'tick': note(90, 0, 0.04, 'square', 0.06); break;
        case 'step': note(86, 0, 0.08, 'triangle', 0.12); break;
        case 'chargeReady': note(88, 0, 0.06, 'square', 0.06); note(100, 0.06, 0.1, 'triangle', 0.1); break;
        case 'hit': this.noiseHit(t, 0.1, 900, 'lowpass', 0.3, b); note(55, 0, 0.1, 'sine', 0.25); break;
        case 'kill': this.noiseHit(t, 0.12, 1200, 'lowpass', 0.3, b); note(76, 0, 0.09, 'square', 0.1); note(83, 0.07, 0.09, 'square', 0.1); note(88, 0.14, 0.16, 'square', 0.1); break;
        case 'baseHit': this.noiseHit(t, 0.35, 300, 'lowpass', 0.5, b); note(40, 0, 0.3, 'sawtooth', 0.2); break;
        case 'waveStart': note(57, 0, 0.18, 'sawtooth', 0.18); note(64, 0.15, 0.18, 'sawtooth', 0.18); note(69, 0.3, 0.4, 'sawtooth', 0.2); break;
        case 'waveClear': note(72, 0, 0.12); note(76, 0.1, 0.12); note(79, 0.2, 0.12); note(84, 0.3, 0.35); break;
        case 'victory': [72, 76, 79, 84, 79, 84, 88, 91].forEach((n, i) => note(n, i * 0.12, 0.22, 'square', 0.1)); break;
        case 'defeat': [64, 62, 60, 55].forEach((n, i) => note(n, i * 0.22, 0.3, 'sawtooth', 0.12)); break;
      }
    } catch {
      /* ignore */
    }
  }

  impact(): void {
    this.sfx('hit');
  }

  fault(): void {
    this.sfx('error');
  }

  /** Relay click, crack and thump; the rumble length grows with muzzle energy. */
  fire(muzzleEnergy_J: number): void {
    try {
      if (!this.ctx || !this.sfxBus) return;
      const t = this.now() + 0.01;
      const b = this.sfxBus;
      this.noiseHit(t, 0.02, 3200, 'highpass', 0.25, b);
      this.noiseHit(t + 0.02, 0.09, 2400, 'bandpass', 0.5, b);
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(95, t);
      o.frequency.exponentialRampToValueAtTime(38, t + 0.25);
      g.gain.setValueAtTime(0.55, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.connect(g).connect(b);
      o.start(t);
      o.stop(t + 0.35);
      const rumble = Math.min(1.4, 0.3 + Math.log10(Math.max(10, muzzleEnergy_J)) * 0.18);
      this.noiseHit(t + 0.05, rumble, 220, 'lowpass', 0.35, b);
    } catch {
      /* ignore */
    }
  }
}
