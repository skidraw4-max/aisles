/**
 * BrickInvasion — 16-bit style BGM + SFX (Web Audio, no asset files)
 */

const NOTE = {
  C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.0, A3: 220.0, B3: 246.94,
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.0, B5: 987.77,
  C6: 1046.5,
};

// Cheerful C-major chip melody (16th-note grid). null = rest.
const MELODY_A = [
  "E5", "E5", null, "E5", null, "C5", "E5", null,
  "G5", null, null, null, "G4", null, null, null,
  "C5", null, null, "G4", null, null, "E4", null,
  "A4", null, "B4", null, "A#4", "A4", null, null,
  "G4", "E5", "G5", "A5", null, "F5", "G5", null,
  "E5", null, "C5", "D5", "B4", null, null, null,
];

const MELODY_B = [
  "C5", null, null, "G4", null, null, "E4", null,
  "A4", null, "B4", null, "A4", "G#4", "A4", null,
  "C5", null, "D5", null, "E5", null, "C5", null,
  "A4", null, "G4", null, "E5", "E5", "E5", null,
  "G5", null, "A5", null, "F5", "G5", null, "E5",
  "C5", "D5", "B4", null, "C5", null, null, null,
];

const BASS = [
  "C3", "C3", "G3", "G3", "A3", "A3", "E3", "E3",
  "F3", "F3", "C3", "C3", "G3", "G3", "G3", "G3",
  "C3", "C3", "G3", "G3", "A3", "A3", "E3", "E3",
  "F3", "F3", "G3", "G3", "C3", "C3", "C3", "C3",
];

const HARM = [
  "E4", null, "G4", null, "C5", null, "G4", null,
  "A4", null, "C5", null, "E4", null, "B4", null,
  "F4", null, "A4", null, "C5", null, "A4", null,
  "G4", null, "B4", null, "D5", null, "G4", null,
];

class AudioBus {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.bgmGain = null;
    this.sfxGain = null;
    this.enabled = true;
    this.bgmOn = true;
    this.sfxOn = true;
    this._bgmTimer = 0;
    this._step = 0;
    this._playing = false;
    this._unlocked = false;
    this._inBackground = false;
    this._resumeBgmAfterForeground = false;
    this.bpm = 148;
  }

  async unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.7;
      this.master.connect(this.ctx.destination);

      this.bgmGain = this.ctx.createGain();
      this.bgmGain.gain.value = 0.22;
      this.bgmGain.connect(this.master);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.45;
      this.sfxGain.connect(this.master);
    }
    if (!this._inBackground && this.ctx.state === "suspended") await this.ctx.resume();
    this._unlocked = true;
  }

  /** 홈/다른 앱으로 나갈 때 — BGM·SFX 즉시 정지 */
  enterBackground() {
    if (this._inBackground) return;
    this._inBackground = true;
    this._resumeBgmAfterForeground = this._playing && this.enabled;
    this.stopBgm();
    if (this.master && this.ctx) {
      try {
        this.master.gain.setValueAtTime(0, this.ctx.currentTime);
      } catch {
        /* ignore */
      }
    }
    if (this.ctx && this.ctx.state === "running") {
      this.ctx.suspend().catch(() => {});
    }
  }

  /** 앱으로 다시 돌아왔을 때 */
  async leaveBackground() {
    if (!this._inBackground) return;
    this._inBackground = false;
    if (!this.ctx || !this.enabled) return;
    try {
      await this.ctx.resume();
      this.master.gain.setTargetAtTime(0.7, this.ctx.currentTime, 0.02);
    } catch {
      /* ignore */
    }
    if (this._resumeBgmAfterForeground) {
      this.startBgm();
    }
    this._resumeBgmAfterForeground = false;
  }

  setMuted(muted) {
    this.enabled = !muted;
    if (!this.master || !this.ctx) return;
    if (this._inBackground) return;
    this.master.gain.setTargetAtTime(muted ? 0 : 0.7, this.ctx.currentTime, 0.02);
    if (muted) this.stopBgm();
    else this.startBgm();
  }

  toggleMute() {
    this.setMuted(this.enabled);
    return !this.enabled;
  }

  _tone(freq, t0, dur, type = "square", gainNode = null, vol = 0.12, slideTo = null) {
    if (!this.ctx || !this.enabled || this._inBackground) return;
    const dest = gainNode || this.sfxGain;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo != null) osc.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(dest);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  _noise(t0, dur, vol = 0.08, dest = null) {
    if (!this.ctx || !this.enabled || this._inBackground) return;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    const g = this.ctx.createGain();
    const f = this.ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 1800;
    src.buffer = buf;
    g.gain.value = vol;
    src.connect(f);
    f.connect(g);
    g.connect(dest || this.sfxGain);
    src.start(t0);
    src.stop(t0 + dur);
  }

  _noteFreq(name) {
    return NOTE[name] || 0;
  }

  _scheduleBgmStep(step, when) {
    const melody = step < 48 ? MELODY_A : MELODY_B;
    const mi = step % melody.length;
    const bi = step % BASS.length;
    const hi = step % HARM.length;

    const mel = melody[mi];
    if (mel) {
      this._tone(this._noteFreq(mel), when, 0.11, "square", this.bgmGain, 0.09);
      // soft octave sparkle every other hit
      if (step % 2 === 0) {
        this._tone(this._noteFreq(mel) * 2, when, 0.06, "square", this.bgmGain, 0.03);
      }
    }

    const bass = BASS[bi];
    if (bass && step % 2 === 0) {
      this._tone(this._noteFreq(bass), when, 0.18, "triangle", this.bgmGain, 0.11);
    }

    const harm = HARM[hi];
    if (harm && step % 4 === 0) {
      this._tone(this._noteFreq(harm), when, 0.2, "square", this.bgmGain, 0.035);
    }

    // chip hats
    if (step % 2 === 0) this._noise(when, 0.03, step % 4 === 0 ? 0.04 : 0.02, this.bgmGain);
  }

  startBgm() {
    if (!this._unlocked || !this.enabled || !this.bgmOn || this._inBackground) return;
    this._playing = true;
    this._step = 0;
    const stepDur = 60 / this.bpm / 4; // 16th notes

    const tick = () => {
      if (!this._playing || !this.enabled || this._inBackground) return;
      const now = this.ctx.currentTime;
      while (this._bgmTimer < now + 0.25) {
        this._scheduleBgmStep(this._step % 96, this._bgmTimer);
        this._bgmTimer += stepDur;
        this._step += 1;
      }
      this._bgmHandle = setTimeout(tick, 40);
    };

    this._bgmTimer = this.ctx.currentTime + 0.05;
    clearTimeout(this._bgmHandle);
    tick();
  }

  stopBgm() {
    this._playing = false;
    clearTimeout(this._bgmHandle);
  }

  // —— SFX ——
  shoot(type = "plasma") {
    if (!this._ready()) return;
    const t = this.ctx.currentTime;
    if (type === "split") {
      this._tone(640, t, 0.05, "square", this.sfxGain, 0.09, 920);
      this._tone(920, t + 0.04, 0.06, "square", this.sfxGain, 0.08, 1180);
      return;
    }
    if (type === "heavy") {
      this._tone(180, t, 0.1, "triangle", this.sfxGain, 0.14, 120);
      this._noise(t, 0.08, 0.07);
      this._tone(90, t, 0.12, "square", this.sfxGain, 0.06);
      return;
    }
    if (type === "drill") {
      this._tone(700, t, 0.04, "sawtooth", this.sfxGain, 0.08, 1100);
      this._tone(1100, t + 0.03, 0.05, "sawtooth", this.sfxGain, 0.07, 1400);
      this._noise(t, 0.03, 0.04);
      return;
    }
    // plasma default
    this._tone(520, t, 0.07, "square", this.sfxGain, 0.1, 880);
    this._tone(260, t, 0.05, "triangle", this.sfxGain, 0.06, 400);
  }

  hit(type = "plasma") {
    if (!this._ready()) return;
    const t = this.ctx.currentTime;
    if (type === "split") {
      this._tone(480, t, 0.04, "square", this.sfxGain, 0.07, 320);
      this._tone(720, t + 0.03, 0.04, "square", this.sfxGain, 0.05);
      return;
    }
    if (type === "heavy") {
      this._tone(140, t, 0.08, "triangle", this.sfxGain, 0.1, 80);
      this._noise(t, 0.06, 0.06);
      return;
    }
    if (type === "drill") {
      this._tone(880, t, 0.03, "sawtooth", this.sfxGain, 0.07, 600);
      this._noise(t, 0.025, 0.05);
      return;
    }
    this._tone(220, t, 0.05, "square", this.sfxGain, 0.07, 140);
    this._noise(t, 0.04, 0.04);
  }

  destroy(type = "plasma") {
    if (!this._ready()) return;
    const t = this.ctx.currentTime;
    if (type === "split") {
      this._tone(700, t, 0.06, "square", this.sfxGain, 0.09, 1000);
      this._tone(1000, t + 0.05, 0.08, "square", this.sfxGain, 0.08, 1300);
      this._tone(1300, t + 0.1, 0.06, "square", this.sfxGain, 0.05);
      return;
    }
    if (type === "heavy") {
      this._tone(200, t, 0.1, "triangle", this.sfxGain, 0.12, 100);
      this._tone(400, t + 0.06, 0.12, "square", this.sfxGain, 0.09, 160);
      this._noise(t, 0.1, 0.08);
      return;
    }
    if (type === "drill") {
      this._tone(900, t, 0.05, "sawtooth", this.sfxGain, 0.1, 1400);
      this._tone(1400, t + 0.04, 0.08, "sawtooth", this.sfxGain, 0.08, 1800);
      return;
    }
    this._tone(660, t, 0.08, "square", this.sfxGain, 0.1, 990);
    this._tone(990, t + 0.05, 0.1, "square", this.sfxGain, 0.07, 1320);
  }

  unlockJingle() {
    if (!this._ready()) return;
    const t = this.ctx.currentTime;
    [523, 659, 784, 1046].forEach((f, i) =>
      this._tone(f, t + i * 0.07, 0.12, "square", this.sfxGain, 0.1)
    );
  }

  pickup() {
    if (!this._ready()) return;
    const t = this.ctx.currentTime;
    this._tone(523, t, 0.06, "square", this.sfxGain, 0.1);
    this._tone(659, t + 0.06, 0.06, "square", this.sfxGain, 0.1);
    this._tone(784, t + 0.12, 0.1, "square", this.sfxGain, 0.11);
  }

  bounce() {
    if (!this._ready()) return;
    const t = this.ctx.currentTime;
    this._tone(180, t, 0.03, "triangle", this.sfxGain, 0.035);
  }

  clear() {
    if (!this._ready()) return;
    const t = this.ctx.currentTime;
    const fan = [523, 659, 784, 1046];
    fan.forEach((f, i) => this._tone(f, t + i * 0.09, 0.16, "square", this.sfxGain, 0.11));
    this._tone(1318, t + 0.38, 0.25, "square", this.sfxGain, 0.09);
  }

  fail() {
    if (!this._ready()) return;
    const t = this.ctx.currentTime;
    this._tone(392, t, 0.15, "square", this.sfxGain, 0.1, 220);
    this._tone(294, t + 0.14, 0.2, "square", this.sfxGain, 0.09, 160);
  }

  boss() {
    if (!this._ready()) return;
    const t = this.ctx.currentTime;
    this._tone(196, t, 0.12, "square", this.sfxGain, 0.12);
    this._tone(247, t + 0.12, 0.12, "square", this.sfxGain, 0.12);
    this._tone(311, t + 0.24, 0.18, "square", this.sfxGain, 0.13);
    this._noise(t + 0.2, 0.1, 0.06);
  }

  ui() {
    if (!this._ready()) return;
    const t = this.ctx.currentTime;
    this._tone(700, t, 0.04, "square", this.sfxGain, 0.06, 900);
  }

  _ready() {
    return this._unlocked && this.enabled && this.sfxOn && this.ctx && !this._inBackground;
  }
}

export const audio = new AudioBus();
