(() => {
  const STORAGE_KEY = "bricks_match_sound";

  let ctx = null;
  let master = null;
  let sfxGain = null;
  let bgmGain = null;
  let enabled = localStorage.getItem(STORAGE_KEY) !== "0";
  let bgmTimer = null;
  let bgmStep = 0;
  let unlocked = false;
  let paused = false;

  // Lively C major / bright mosaic groove (faster, bouncier)
  const MELODY = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 783.99, 659.25];
  // 32-step loop: melody indices (-1 = rest)
  const MELODY_PAT = [
    0, 2, 4, 2, 5, 4, 3, 1, 0, 4, 5, 7, 5, 4, 2, 0, 2, 4, 5, 4, 6, 5, 4, 2, 0, 2, 4, 5, 4, 3, 1, 0,
  ];
  const BASS = [130.81, 146.83, 164.81, 196.0, 174.61, 196.0, 220.0, 261.63];
  const BASS_PAT = [0, -1, 0, 4, 1, -1, 1, 5, 2, -1, 2, 6, 3, -1, 3, 7];
  const BGM_MS = 210;

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.7;
    master.connect(ctx.destination);

    sfxGain = ctx.createGain();
    sfxGain.gain.value = 0.55;
    sfxGain.connect(master);

    bgmGain = ctx.createGain();
    bgmGain.gain.value = enabled ? 0.16 : 0;
    bgmGain.connect(master);
    return ctx;
  }

  async function unlock() {
    const c = ensure();
    if (!c) return;
    if (c.state === "suspended") {
      try {
        await c.resume();
      } catch {
        /* ignore */
      }
    }
    unlocked = true;
    paused = false;
    if (enabled) startBgm();
  }

  function now() {
    return ctx ? ctx.currentTime : 0;
  }

  function tone({
    freq = 440,
    type = "sine",
    attack = 0.01,
    decay = 0.2,
    sustain = 0.001,
    volume = 0.2,
    delay = 0,
    dest = null,
  }) {
    if (!ctx || !enabled || paused) return;
    const t0 = now() + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), t0 + attack);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain), t0 + attack + decay);
    osc.connect(g);
    g.connect(dest || sfxGain);
    osc.start(t0);
    osc.stop(t0 + attack + decay + 0.05);
  }

  function noiseBurst({ duration = 0.08, volume = 0.12, delay = 0 }) {
    if (!ctx || !enabled || paused) return;
    const len = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1200;
    filter.Q.value = 0.8;
    src.buffer = buffer;
    const t0 = now() + delay;
    g.gain.setValueAtTime(volume, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(filter);
    filter.connect(g);
    g.connect(sfxGain);
    src.start(t0);
  }

  function playPlace() {
    tone({ freq: 520, type: "triangle", attack: 0.005, decay: 0.09, volume: 0.18 });
    tone({ freq: 780, type: "sine", attack: 0.005, decay: 0.07, volume: 0.08, delay: 0.02 });
  }

  function playClear(lines = 1) {
    const base = 392;
    for (let i = 0; i < Math.min(lines, 4); i++) {
      tone({
        freq: base * (1 + i * 0.25),
        type: "sine",
        attack: 0.01,
        decay: 0.22,
        volume: 0.16,
        delay: i * 0.05,
      });
    }
    noiseBurst({ duration: 0.06, volume: 0.06, delay: 0.02 });
  }

  function playCombo() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      tone({ freq: f, type: "triangle", attack: 0.01, decay: 0.2, volume: 0.14, delay: i * 0.06 });
    });
  }

  function playWin() {
    const melody = [392, 493.88, 587.33, 783.99, 987.77];
    melody.forEach((f, i) => {
      tone({ freq: f, type: "sine", attack: 0.02, decay: 0.35, volume: 0.16, delay: i * 0.1 });
      tone({
        freq: f * 2,
        type: "triangle",
        attack: 0.02,
        decay: 0.28,
        volume: 0.06,
        delay: i * 0.1 + 0.02,
      });
    });
  }

  function playFail() {
    tone({ freq: 280, type: "sawtooth", attack: 0.01, decay: 0.35, volume: 0.1 });
    tone({ freq: 210, type: "triangle", attack: 0.02, decay: 0.45, volume: 0.12, delay: 0.08 });
    tone({ freq: 160, type: "sine", attack: 0.02, decay: 0.5, volume: 0.1, delay: 0.16 });
  }

  function playClick() {
    tone({ freq: 880, type: "square", attack: 0.002, decay: 0.04, volume: 0.05 });
  }

  function playUndo() {
    tone({ freq: 392, type: "triangle", attack: 0.005, decay: 0.12, volume: 0.1 });
    tone({ freq: 330, type: "sine", attack: 0.005, decay: 0.16, volume: 0.08, delay: 0.05 });
  }

  function playRotate() {
    tone({ freq: 660, type: "triangle", attack: 0.004, decay: 0.08, volume: 0.08 });
    tone({ freq: 880, type: "sine", attack: 0.004, decay: 0.1, volume: 0.06, delay: 0.03 });
  }

  function playReroll() {
    [440, 554.37, 659.25].forEach((f, i) => {
      tone({ freq: f, type: "triangle", attack: 0.005, decay: 0.1, volume: 0.1, delay: i * 0.04 });
    });
    noiseBurst({ duration: 0.05, volume: 0.05, delay: 0.02 });
  }

  function playMapOpen() {
    [329.63, 392, 523.25].forEach((f, i) => {
      tone({ freq: f, type: "sine", attack: 0.02, decay: 0.25, volume: 0.1, delay: i * 0.07 });
    });
  }

  function kick() {
    if (!ctx || !enabled || paused) return;
    const t0 = now();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, t0);
    osc.frequency.exponentialRampToValueAtTime(45, t0 + 0.12);
    g.gain.setValueAtTime(0.28, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
    osc.connect(g);
    g.connect(bgmGain);
    osc.start(t0);
    osc.stop(t0 + 0.15);
  }

  function hat() {
    noiseBurst({ duration: 0.03, volume: 0.035 });
  }

  function bgmTick() {
    if (!ctx || !enabled || !unlocked || paused) return;
    const step = bgmStep % 32;
    const mIdx = MELODY_PAT[step];
    if (mIdx >= 0) {
      const freq = MELODY[mIdx % MELODY.length];
      const accent = step % 4 === 0;
      tone({
        freq,
        type: accent ? "square" : "triangle",
        attack: 0.008,
        decay: accent ? 0.22 : 0.16,
        volume: accent ? 0.22 : 0.14,
        dest: bgmGain,
      });
      if (step % 2 === 0) {
        tone({
          freq: freq * 2,
          type: "sine",
          attack: 0.01,
          decay: 0.12,
          volume: 0.06,
          dest: bgmGain,
        });
      }
    }

    const bIdx = BASS_PAT[step % BASS_PAT.length];
    if (bIdx >= 0) {
      tone({
        freq: BASS[bIdx % BASS.length],
        type: "triangle",
        attack: 0.02,
        decay: 0.28,
        volume: 0.2,
        dest: bgmGain,
      });
    }

    if (step % 4 === 0) kick();
    if (step % 4 === 2) hat();
    if (step % 8 === 6) {
      tone({
        freq: 880,
        type: "square",
        attack: 0.004,
        decay: 0.08,
        volume: 0.07,
        dest: bgmGain,
      });
    }

    bgmStep += 1;
  }

  function startBgm() {
    if (!enabled || !unlocked || paused) return;
    ensure();
    if (bgmTimer) return;
    if (bgmGain) {
      const t = now();
      bgmGain.gain.cancelScheduledValues(t);
      bgmGain.gain.setValueAtTime(bgmGain.gain.value || 0.0001, t);
      bgmGain.gain.linearRampToValueAtTime(0.16, t + 0.35);
    }
    bgmTick();
    bgmTimer = setInterval(bgmTick, BGM_MS);
  }

  function stopBgm(fade = true) {
    if (bgmTimer) {
      clearInterval(bgmTimer);
      bgmTimer = null;
    }
    if (!bgmGain || !ctx) return;
    const t = now();
    bgmGain.gain.cancelScheduledValues(t);
    if (fade) {
      bgmGain.gain.setValueAtTime(Math.max(0.0001, bgmGain.gain.value), t);
      bgmGain.gain.linearRampToValueAtTime(0.0001, t + 0.25);
    } else {
      bgmGain.gain.setValueAtTime(0, t);
    }
  }

  function pauseAudio() {
    paused = true;
    stopBgm(false);
    if (master && ctx) {
      const t = now();
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(0, t);
    }
    if (ctx && ctx.state === "running") {
      ctx.suspend().catch(() => {});
    }
  }

  async function resumeAudio() {
    if (!unlocked) return;
    paused = false;
    ensure();
    if (ctx && ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        /* ignore */
      }
    }
    if (master && ctx) {
      const t = now();
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(0.7, t);
    }
    if (enabled) startBgm();
  }

  function setEnabled(next) {
    enabled = !!next;
    localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
    if (enabled) {
      unlock().then(() => {
        if (!paused) startBgm();
      });
    } else {
      stopBgm(false);
    }
    updateUi();
  }

  function toggle() {
    setEnabled(!enabled);
    if (enabled) playClick();
  }

  function updateUi() {
    const btn = document.getElementById("btn-sound");
    if (!btn) return;
    btn.textContent = enabled ? "♪" : "🔇";
    btn.setAttribute("aria-label", enabled ? "사운드 끄기" : "사운드 켜기");
    btn.title = enabled ? "사운드 ON" : "사운드 OFF";
    btn.classList.toggle("sound-off", !enabled);
  }

  function bindUi() {
    updateUi();
    document.getElementById("btn-sound")?.addEventListener("click", (e) => {
      e.stopPropagation();
      toggle();
    });

    const unlockOnce = () => {
      unlock();
      document.removeEventListener("pointerdown", unlockOnce);
      document.removeEventListener("keydown", unlockOnce);
    };
    document.addEventListener("pointerdown", unlockOnce);
    document.addEventListener("keydown", unlockOnce);

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) pauseAudio();
      else resumeAudio();
    });
    window.addEventListener("pagehide", () => pauseAudio());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindUi);
  } else {
    bindUi();
  }

  window.GameAudio = {
    unlock,
    toggle,
    setEnabled,
    isEnabled: () => enabled,
    playPlace,
    playClear,
    playCombo,
    playWin,
    playFail,
    playClick,
    playUndo,
    playRotate,
    playReroll,
    playMapOpen,
    startBgm,
    stopBgm,
    pause: pauseAudio,
    resume: resumeAudio,
  };
})();
