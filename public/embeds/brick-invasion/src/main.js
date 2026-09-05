import { Game } from "./game.js";
import { loadSprites } from "./sprites.js";
import { loadSave, saveProgress, saveEnergy } from "./storage.js";
import { audio } from "./audio.js";
import { newlyUnlockedAmmo } from "./ammo.js";
import {
  getEnergyState,
  canStartPlay,
  canNextSector,
  consumePlay,
  onSectorCleared,
  endDeployment,
  MAX_PLAYS,
  MAX_SECTORS_PER_RUN,
} from "./energy.js";

const $ = (id) => document.getElementById(id);

const screens = {
  title: $("screen-title"),
  clear: $("screen-clear"),
  fail: $("screen-fail"),
};

let energyTimer = 0;

function show(name) {
  for (const [key, el] of Object.entries(screens)) {
    el.classList.toggle("active", key === name);
  }
  syncEnergyTimer();
}

function hideAll() {
  for (const el of Object.values(screens)) el.classList.remove("active");
  syncEnergyTimer();
}

function renderEnergyDots(container, plays, max = MAX_PLAYS) {
  if (!container) return;
  container.innerHTML = "";
  for (let i = 0; i < max; i++) {
    const dot = document.createElement("span");
    if (i < plays) dot.classList.add("on");
    container.appendChild(dot);
  }
}

function energyInlineHtml(state) {
  const timer = state.full
    ? "에너지 가득"
    : `다음 충전 <strong>${state.nextRechargeLabel}</strong>`;
  return `⚡ 출격 에너지 <strong>${state.plays}/${state.max}</strong> · ${timer}<br />이번 출격 추가 소모 없음`;
}

function refreshEnergyUI() {
  const save = loadSave();
  const state = getEnergyState(save);

  renderEnergyDots($("energy-dots"), state.plays);
  renderEnergyDots($("modal-energy-dots"), state.plays);

  const countEl = $("energy-count");
  if (countEl) countEl.textContent = `${state.plays}/${state.max}`;

  const timerEl = $("energy-timer");
  if (timerEl) {
    timerEl.textContent = state.full
      ? "에너지 가득"
      : `다음 충전 ${state.nextRechargeLabel}`;
  }

  const modalCount = $("modal-energy-count");
  if (modalCount) modalCount.textContent = `${state.plays}/${state.max}`;

  const modalTimer = $("modal-energy-timer");
  if (modalTimer) {
    modalTimer.textContent = state.full
      ? "에너지 가득"
      : `${state.nextRechargeLabel} 후 +1`;
  }

  const canPlay = state.plays >= 1;
  $("btn-play").disabled = !canPlay;
  $("btn-continue").disabled = !canPlay;

  const clearEnergy = $("clear-energy");
  if (clearEnergy) clearEnergy.innerHTML = energyInlineHtml(state);

  const failEnergy = $("fail-energy");
  if (failEnergy) {
    const timer = state.full
      ? "에너지 가득"
      : `다음 충전 <strong>${state.nextRechargeLabel}</strong>`;
    failEnergy.innerHTML = `⚡ 출격 에너지 <strong>${state.plays}/${state.max}</strong> · ${timer}`;
  }

  $("btn-retry").disabled = !canPlay;

  refreshClearRunUI(save);
  return state;
}

function refreshClearRunUI(save = loadSave()) {
  const cleared = save.runSectorsCleared || 0;
  const runEl = $("clear-run");
  if (runEl) {
    runEl.textContent =
      cleared > 0 ? `이번 출격 ${cleared}/${MAX_SECTORS_PER_RUN} 구역 클리어` : "";
  }

  const atLimit = !canNextSector(save);
  const btnNext = $("btn-next");
  if (btnNext) {
    btnNext.hidden = atLimit;
    btnNext.disabled = atLimit;
  }
  const limitEl = $("clear-run-limit");
  if (limitEl) limitEl.hidden = !atLimit;
}

function refreshTitleRecord() {
  const save = loadSave();
  $("title-record").textContent =
    `최고 구역 ${save.bestStage} · 점수 ${save.bestScore} · 공 ${save.ballCount}`;
  const canContinue = save.resumeStage > 1;
  $("btn-continue").hidden = !canContinue;
  $("btn-continue").textContent = canContinue
    ? `이어서 하기 (S${save.resumeStage} · 공${save.ballCount})`
    : "이어서 하기";
  refreshEnergyUI();
}

function syncEnergyTimer() {
  clearInterval(energyTimer);
  const onOverlay =
    screens.title.classList.contains("active") ||
    screens.clear.classList.contains("active") ||
    screens.fail.classList.contains("active");
  if (!onOverlay) return;
  energyTimer = setInterval(() => refreshEnergyUI(), 1000);
}

function showEnergyModal() {
  refreshEnergyUI();
  $("modal-energy").hidden = false;
}

function hideEnergyModal() {
  $("modal-energy").hidden = true;
}

function showToast(text, ms = 1600) {
  const el = $("toast");
  el.hidden = false;
  el.textContent = text;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    el.hidden = true;
  }, ms);
}

function refreshMuteBtn() {
  const btn = $("btn-mute");
  if (!btn) return;
  btn.textContent = audio.enabled ? "🔊 소리" : "🔇 음소거";
  btn.setAttribute("aria-pressed", audio.enabled ? "false" : "true");
}

async function ensureAudio() {
  await audio.unlock();
  if (audio.enabled && !audio._playing && !audio._inBackground) audio.startBgm();
}

/** Try to spend one deployment; returns false if blocked. */
function tryBeginDeployment() {
  const save = loadSave();
  const spent = consumePlay(save);
  if (!spent) {
    showEnergyModal();
    return false;
  }
  saveEnergy(spent);
  return true;
}

function bindAudioLifecycle() {
  let pausedByBackground = false;

  const goBackground = () => {
    audio.enterBackground();
    if (game?.running) {
      pausedByBackground = true;
      game.running = false;
    }
  };

  const goForeground = async () => {
    await audio.leaveBackground();
    if (
      pausedByBackground &&
      game &&
      !screens.clear.classList.contains("active") &&
      !screens.fail.classList.contains("active") &&
      !screens.title.classList.contains("active")
    ) {
      game.running = true;
    }
    pausedByBackground = false;
    refreshEnergyUI();
  };

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) goBackground();
    else goForeground();
  });

  window.addEventListener("pagehide", goBackground);
  window.addEventListener("freeze", goBackground);

  const CapApp = window.Capacitor?.Plugins?.App;
  if (CapApp?.addListener) {
    CapApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive) goForeground();
      else goBackground();
    });
  } else {
    import("@capacitor/app")
      .then(({ App }) => {
        App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) goForeground();
          else goBackground();
        });
      })
      .catch(() => {});
  }
}

let game;

function notifyAisleParent(mode, score) {
  try {
    if (!window.parent || window.parent === window) return;
    const safeScore = Math.max(0, Math.floor(Number(score) || 0));
    const payload = { type: "aisle-game-score", mode, score: safeScore };
    window.parent.postMessage(payload, window.location.origin);
    if (window.top && window.top !== window.parent) {
      window.top.postMessage(payload, window.location.origin);
    }
  } catch {
    try {
      window.parent.postMessage(
        {
          type: "aisle-game-score",
          mode,
          score: Math.max(0, Math.floor(Number(score) || 0)),
        },
        "*"
      );
    } catch {
      /* standalone / blocked */
    }
  }
}

async function boot() {
  const canvas = $("game");
  const sprites = await loadSprites();

  game = new Game(canvas, sprites, {
    onBoss(stage, boss) {
      audio.boss();
      const name = boss?.name ?? "Boss";
      showToast(`⚠ ${name} 출현!  Sector ${stage}`);
    },
    onAmmoLocked(def) {
      showToast(`${def.name} — 구역 ${def.unlockAt} 클리어 시 해금`, 1800);
    },
    onAmmoSelect(def) {
      saveProgress({ selectedAmmo: def.id });
      showToast(`${def.name} 장착`, 900);
    },
    onClear(stage, info) {
      audio.clear();
      const prevBest = game.bestStageCleared;
      const nextBest = Math.max(prevBest, stage);
      game.bestStageCleared = nextBest;
      const unlockedNow = newlyUnlockedAmmo(prevBest, nextBest);

      const afterSector = onSectorCleared(loadSave());
      const save = saveProgress({
        stage: stage + 1,
        score: info.score,
        bestStage: stage,
        bestCleared: stage,
        bestScore: info.score,
        ballCount: info.ballCount,
        selectedAmmo: game.selectedAmmo,
        runSectorsCleared: afterSector.runSectorsCleared,
        inRun: true,
      });

      $("clear-title").textContent = info.isBoss
        ? (info.boss?.clearTitle ?? "보스 제압!")
        : "구역 탈환!";
      $("clear-sub").textContent = info.isBoss
        ? `${info.boss?.name ?? "보스"}를 쓰러뜨렸다! 공 +${info.growth} (현재 ${info.ballCount})`
        : `전열 붕괴! 공 +${info.growth} (현재 ${info.ballCount})`;
      $("stat-kills").textContent = String(info.kills);
      $("stat-ammo").textContent = String(info.ballCount);
      $("stat-ammo-label").textContent = "보유 공";
      $("title-record").textContent =
        `최고 구역 ${save.bestStage} · 점수 ${save.bestScore} · 공 ${save.ballCount}`;

      refreshClearRunUI(save);
      refreshEnergyUI();
      show("clear");
      notifyAisleParent("stage", info.score);

      if (unlockedNow.length) {
        audio.unlockJingle();
        const names = unlockedNow.map((a) => a.name).join(" · ");
        setTimeout(() => showToast(`해금! ${names}`, 2600), 400);
      }
    },
    onFail(stage, score) {
      audio.fail();
      const ended = endDeployment(loadSave());
      saveProgress({
        stage,
        score,
        bestStage: stage,
        bestScore: score,
        ballCount: game.ballCountAtStageStart,
        selectedAmmo: game.selectedAmmo,
        runSectorsCleared: ended.runSectorsCleared,
        inRun: ended.inRun,
      });
      refreshEnergyUI();
      show("fail");
      notifyAisleParent("endless", score);
    },
  });
  window.game = game;

  refreshTitleRecord();
  refreshMuteBtn();
  show("title");
  bindAudioLifecycle();

  $("btn-mute").onclick = async () => {
    await audio.unlock();
    audio.toggleMute();
    if (audio.enabled) audio.startBgm();
    audio.ui();
    refreshMuteBtn();
  };

  $("energy-panel")?.addEventListener("click", () => {
    if (!canStartPlay(loadSave())) showEnergyModal();
    else showToast("5분마다 1회 충전 · 최대 5회", 1400);
  });

  $("btn-modal-energy").onclick = () => {
    audio.ui();
    hideEnergyModal();
  };

  $("btn-play").onclick = async () => {
    audio.ui();
    if (!tryBeginDeployment()) return;
    await ensureAudio();
    const save = loadSave();
    hideAll();
    game.start(1, {
      ballCount: 1,
      selectedAmmo: save.selectedAmmo,
      bestStageCleared: save.bestCleared,
    });
  };

  $("btn-continue").onclick = async () => {
    audio.ui();
    if (!tryBeginDeployment()) return;
    await ensureAudio();
    const save = loadSave();
    hideAll();
    game.start(save.resumeStage || 1, {
      ballCount: save.ballCount || 1,
      selectedAmmo: save.selectedAmmo,
      bestStageCleared: save.bestCleared,
    });
  };

  $("btn-next").onclick = async () => {
    audio.ui();
    if (!canNextSector(loadSave())) {
      showToast("이번 출격 한도(5구역)에 도달했습니다", 2000);
      return;
    }
    await ensureAudio();
    hideAll();
    game.nextStage();
  };

  $("btn-retry").onclick = async () => {
    audio.ui();
    if (!tryBeginDeployment()) return;
    await ensureAudio();
    hideAll();
    const stage = game.stage;
    const score = game.score;
    const ammo = game.selectedAmmo;
    const best = game.bestStageCleared;
    game.resetBallCountForRetry();
    game.start(stage, {
      keepScore: true,
      ballCount: game.ballCount,
      selectedAmmo: ammo,
      bestStageCleared: best,
    });
    game.score = score;
  };

  $("btn-clear-home").onclick = async () => {
    audio.ui();
    await ensureAudio();
    game.stop();
    const ended = endDeployment(loadSave());
    saveEnergy(ended);
    refreshTitleRecord();
    show("title");
  };

  $("btn-fail-home").onclick = async () => {
    audio.ui();
    await ensureAudio();
    game.stop();
    refreshTitleRecord();
    show("title");
  };
}

boot().catch((err) => {
  console.error(err);
  alert("게임 리소스 로딩에 실패했습니다. design/sprites 경로를 확인해주세요.");
});
