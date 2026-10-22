(() => {
  const screens = {
    intro: document.getElementById("screen-intro"),
    map: document.getElementById("screen-map"),
    stages: document.getElementById("screen-stages"),
    game: document.getElementById("screen-game"),
  };

  let save = window.Save.load();
  let currentWorld = 0;
  let currentStage = 0;
  let activeScreen = "intro";
  let pendingWorldComic = null;
  let playMode = "stage";
  let bannerReq = 0;

  function setAdBanner(on) {
    const ads = window.TnkAds;
    const native = !!(ads && ads.available && ads.available());
    const req = ++bannerReq;
    document.body.classList.toggle("has-ad-banner", !!(on && native));
    if (!ads) return;
    if (on) {
      Promise.resolve(ads.showBanner?.())
        .then((r) => {
          if (req !== bannerReq) return;
          if (r && (r.error || r.errorName || r.unavailable)) {
            console.warn("[TnkAds] banner", r);
            if (r.unavailable || r.ok === false) {
              document.body.classList.remove("has-ad-banner");
            }
          }
        })
        .catch((e) => {
          if (req !== bannerReq) return;
          console.warn("[TnkAds] banner", e);
          document.body.classList.remove("has-ad-banner");
        });
    } else {
      ads.hideBanner?.();
    }
  }

  function show(name) {
    activeScreen = name;
    Object.entries(screens).forEach(([key, el]) => {
      if (!el) return;
      const on = key === name;
      el.classList.toggle("is-active", on);
      el.hidden = !on;
    });
    setAdBanner(name === "intro" || name === "map" || name === "game" || name === "stages");
  }

  function charOf(id) {
    return window.CHARACTERS[id] || window.CHARACTERS.mira;
  }

  function worldOf(i) {
    return window.WORLD_META[i];
  }

  function refreshIntroMeta() {
    const meta = document.getElementById("intro-meta");
    const wp = window.Save.worldProgress(save, save.unlockedWorld);
    const nextStage = wp.cleared.length < 10 ? wp.cleared.length : 9;
    const stage = window.getStage(save.unlockedWorld, nextStage);
    if (meta) {
      meta.textContent =
        "진행 W" +
        String(save.unlockedWorld + 1).padStart(2, "0") +
        " · 스테이지 " +
        String(nextStage + 1).padStart(2, "0") +
        " / 10 · 별 " +
        window.Save.totalStars(save) +
        " · 파편 " +
        (save.mosaicShards || 0) +
        (save.bestEndless ? " · 복구 " + save.bestEndless : "");
    }
    const endlessBtn = document.getElementById("btn-endless");
    if (endlessBtn) {
      const open = window.Save.hasClearedAny(save);
      endlessBtn.classList.toggle("is-locked", !open);
      endlessBtn.title = open ? "최고 " + (save.bestEndless || 0) : "첫 스테이지 클리어 후 해금";
    }
    const eyebrow = document.querySelector(".intro-eyebrow");
    if (eyebrow) {
      eyebrow.textContent =
        "World " +
        String(save.unlockedWorld + 1).padStart(2, "0") +
        " · " +
        worldOf(save.unlockedWorld).title;
    }
    return stage;
  }

  function buildIntroCast() {
    const cast = document.getElementById("intro-cast");
    if (!cast) return;
    cast.innerHTML = "";
    let activeId = "mira";

    function setSpeaker(id) {
      const c = charOf(id);
      activeId = c.id;
      const full = document.getElementById("intro-fullbody");
      const nameEl = document.getElementById("intro-speaker-name");
      const textEl = document.getElementById("intro-speech-text");
      const nameTag = document.querySelector(".speech-name");
      const src = c.fullImg || c.img;

      if (full) {
        const applySrc = () => {
          full.alt = c.role + " " + c.name;
          full.classList.remove("is-switching");
        };
        if (full.getAttribute("src") === src) {
          applySrc();
        } else {
          full.classList.add("is-switching");
          full.onload = applySrc;
          full.onerror = applySrc;
          full.src = src;
        }
      }
      if (nameEl) nameEl.textContent = c.name;
      if (textEl) textEl.textContent = c.introLine || "";
      if (nameTag) {
        nameTag.style.background = c.color + "33";
        nameTag.style.color = c.color;
      }

      cast.querySelectorAll(".cast-chip-img").forEach((btn) => {
        const on = btn.dataset.id === c.id;
        btn.classList.toggle("is-active", on);
        btn.setAttribute("aria-selected", on ? "true" : "false");
      });
    }

    Object.values(window.CHARACTERS).forEach((c) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "cast-chip-img" + (c.id === activeId ? " is-active" : "");
      chip.dataset.id = c.id;
      chip.setAttribute("role", "tab");
      chip.setAttribute("aria-selected", c.id === activeId ? "true" : "false");
      chip.innerHTML = '<img src="' + c.img + '" alt="" /><span>' + c.name + "</span>";
      chip.title = c.role + " — " + c.name;
      chip.addEventListener("click", () => {
        if (activeId === c.id) return;
        window.GameAudio?.playClick();
        setSpeaker(c.id);
      });
      cast.appendChild(chip);
    });

    setSpeaker(activeId);
  }

  function buildMap() {
    const mapGrid = document.getElementById("map-grid");
    mapGrid.innerHTML = "";
    window.WORLD_META.forEach((w, i) => {
      const unlocked = window.Save.isWorldUnlocked(save, i);
      const wp = window.Save.worldProgress(save, i);
      const img = window.WORLD_IMAGES[w.imageKey];
      const speaker = charOf(w.speaker);
      const clearedCount = wp.cleared.length;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "map-node" +
        (i === currentWorld ? " current" : "") +
        (clearedCount === 10 ? " cleared" : "");
      btn.disabled = !unlocked;
      btn.innerHTML =
        '<div class="map-thumb"><img src="' +
        img +
        '" alt="" loading="lazy" /><img class="map-speaker" src="' +
        speaker.img +
        '" alt="" /></div><span class="wn">W' +
        String(i + 1).padStart(2, "0") +
        (unlocked ? " · " + clearedCount + "/10" : " · LOCK") +
        '</span><span class="wt">' +
        w.title +
        "</span>";
      btn.addEventListener("click", () => {
        if (!unlocked) return;
        window.GameAudio?.playClick();
        openStageSelect(i);
      });
      mapGrid.appendChild(btn);
    });

    const starsEl = document.getElementById("map-stars");
    if (starsEl) starsEl.textContent = "총 별 " + window.Save.totalStars(save);
  }

  function openStageSelect(worldIndex) {
    currentWorld = worldIndex;
    const world = worldOf(worldIndex);
    const speaker = charOf(world.speaker);
    document.getElementById("stages-world-title").textContent =
      "W" + String(worldIndex + 1).padStart(2, "0") + " · " + world.title;
    document.getElementById("stages-world-img").src = window.WORLD_IMAGES[world.imageKey];
    document.getElementById("stages-speaker-img").src = speaker.img;
    document.getElementById("stages-speaker-name").textContent = speaker.name;
    document.getElementById("stages-speaker-line").textContent =
      speaker.name + ": 「" + world.title + "」을 되살릴 차례야.";

    const wp = window.Save.worldProgress(save, worldIndex);
    const worldCleared = wp.cleared.length >= 10;
    const storyBtn = document.getElementById("btn-stages-story");
    if (storyBtn) {
      storyBtn.hidden = !worldCleared;
    }

    const list = document.getElementById("stage-list");
    list.innerHTML = "";
    for (let s = 0; s < 10; s++) {
      const stage = window.getStage(worldIndex, s);
      const unlocked = window.Save.isStageUnlocked(save, worldIndex, s);
      const stars = wp.stars[s] || 0;
      const cleared = wp.cleared.includes(s);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "stage-card" + (cleared ? " cleared" : "");
      btn.disabled = !unlocked;
      btn.innerHTML =
        '<span class="stage-num">' +
        String(s + 1).padStart(2, "0") +
        '</span><span class="stage-info"><strong>' +
        stage.title +
        "</strong><small>" +
        objectiveShort(stage) +
        '</small></span><span class="stage-stars">' +
        "★".repeat(stars) +
        "☆".repeat(3 - stars) +
        "</span>";
      btn.addEventListener("click", () => {
        if (!unlocked) return;
        window.GameAudio?.playClick();
        startStage(worldIndex, s);
      });
      list.appendChild(btn);
    }
    show("stages");
  }

  function objectiveShort(stage) {
    const o = stage.objective;
    let text = "";
    if (o.type === "score") text = "점수 " + o.score;
    else if (o.type === "lines") text = "라인 " + o.lines;
    else if (o.type === "combo") text = "콤보 " + o.combo;
    else if (o.type === "hybrid") text = "점수 " + o.score + " · 라인 " + o.lines;
    const rift = stage.obstacles?.length || 0;
    const crack = stage.cracks?.length || 0;
    if (rift > 0) text += (text ? " · " : "") + "균열 " + rift;
    if (crack > 0) text += (text ? " · " : "") + "금 간 " + crack;
    if (stage.sideMission) text += (text ? " · " : "") + "미션";
    const mods = stage.boardMods;
    if (mods?.relics?.length) text += (text ? " · " : "") + "유물";
    if (mods?.livingRift) text += (text ? " · " : "") + "확산";
    if (mods?.flow) text += (text ? " · " : "") + "흐름";
    if (mods?.mirror) text += (text ? " · " : "") + "거울";
    if (mods?.moveLimit) text += (text ? " · " : "") + "제한 수";
    return text;
  }

  function applyStoryUI(stage) {
    const speaker = charOf(stage.speakerId);
    document.getElementById("story-avatar").src = speaker.img;
    document.getElementById("story-avatar").alt = speaker.name;
    document.getElementById("story-speaker").textContent = speaker.name;
    document.getElementById("story-text").textContent = stage.pre.replace(speaker.name + ": ", "");
    if (stage.endless) {
      document.querySelector(".game-world").textContent = "끝없는 복구";
      document.querySelector(".game-stage-title").textContent =
        "최고 " + (save.bestEndless || 0);
    } else {
      document.querySelector(".game-world").textContent =
        "W" + (stage.worldIndex + 1) + " · " + stage.worldTitle;
      document.querySelector(".game-stage-title").textContent =
        stage.title + " (" + (stage.stageIndex + 1) + "/10)";
    }
    document.getElementById("overlay-avatar").src = speaker.img;
    document.getElementById("fail-avatar").src = speaker.img;
  }

  function startStage(worldIndex, stageIndex) {
    playMode = "stage";
    currentWorld = worldIndex;
    currentStage = stageIndex;
    const stage = window.getStage(worldIndex, stageIndex);
    applyStoryUI(stage);
    show("game");
    window.GameAudio?.unlock();
    window.GameAudio?.startBgm();
    window.BricksGame.start(stage, {
      onClear: handleClear,
      onFail: handleFail,
    });
  }

  function startEndless() {
    playMode = "endless";
    const stage = window.getEndlessStage();
    applyStoryUI(stage);
    show("game");
    window.GameAudio?.unlock();
    window.GameAudio?.startBgm();
    window.BricksGame.start(stage, {
      onClear: handleClear,
      onFail: handleFail,
    });
  }

  function leaveGame() {
    if (playMode === "endless") {
      refreshIntroMeta();
      show("intro");
      return;
    }
    openStageSelect(currentWorld);
  }

  function renderShop() {
    save = window.Save.load();
    const balance = document.getElementById("shop-balance");
    if (balance) balance.textContent = "보유 파편 " + (save.mosaicShards || 0);
    const list = document.getElementById("shop-list");
    if (!list) return;
    list.innerHTML = "";
    (window.SHOP_ITEMS || []).forEach((item) => {
      const owned = window.Save.inventoryCount(save, item.key);
      const canBuy = (save.mosaicShards || 0) >= item.price;
      const row = document.createElement("div");
      row.className = "shop-item";
      row.innerHTML =
        "<div><strong>" +
        item.name +
        "</strong><small>" +
        item.desc +
        " · 보유 " +
        owned +
        "</small></div>";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-primary";
      btn.textContent = item.price + " 파편";
      btn.disabled = !canBuy;
      btn.addEventListener("click", () => {
        window.GameAudio?.playClick();
        save = window.Save.load();
        const result = window.Save.buyItem(save, item.id);
        if (!result.ok) {
          if (balance) balance.textContent = result.reason || "구매할 수 없어요.";
          return;
        }
        save = window.Save.load();
        renderShop();
        refreshIntroMeta();
      });
      row.appendChild(btn);
      list.appendChild(row);
    });
  }

  function openShop() {
    renderShop();
    const el = document.getElementById("overlay-shop");
    if (el) el.hidden = false;
  }

  function closeShop() {
    const el = document.getElementById("overlay-shop");
    if (el) el.hidden = true;
    refreshIntroMeta();
  }

  function isShopOpen() {
    const el = document.getElementById("overlay-shop");
    return !!(el && !el.hidden);
  }

  function notifyAisleParent(mode, score) {
    try {
      if (!window.parent || window.parent === window) return;
      const safeScore = Math.max(0, Math.floor(Number(score) || 0));
      const payload = { type: "aisle-game-score", mode: mode, score: safeScore };
      window.parent.postMessage(payload, window.location.origin);
      if (window.top && window.top !== window.parent) {
        window.top.postMessage(payload, window.location.origin);
      }
    } catch (err) {
      try {
        window.parent.postMessage(
          {
            type: "aisle-game-score",
            mode: mode,
            score: Math.max(0, Math.floor(Number(score) || 0)),
          },
          "*"
        );
      } catch (e) {
        /* standalone / blocked */
      }
    }
  }

  function handleClear({ score, stage, relicShards }) {
    if (stage?.endless) return;
    const stars = window.Save.starsFor(stage, score);
    const fragments = (stage.fragmentReward || 1) + (relicShards || 0);
    save = window.Save.clearStage(save, stage.worldIndex, stage.stageIndex, stars, score, fragments);
    notifyAisleParent("stage", score);
    window.GameAudio?.playWin();

    const speaker = charOf(stage.speakerId);
    const avatar = document.getElementById("overlay-avatar");
    if (avatar) {
      avatar.src = speaker.img;
      avatar.alt = speaker.name;
    }

    document.getElementById("overlay-eyebrow").textContent =
      stars >= 3 ? "Perfect Clear" : "Stage Clear";
    document.getElementById("overlay-title").textContent = stage.clear;
    const reaction = stage.clearReaction || "다음 스테이지로 나아가자.";
    document.getElementById("overlay-story").textContent =
      speaker.name +
      ": " +
      reaction +
      "\n점수 " +
      score +
      " · 별 " +
      "★".repeat(stars) +
      "☆".repeat(3 - stars) +
      " · 파편 +" +
      fragments +
      " (총 " +
      (save.mosaicShards || 0) +
      ")";
    document.getElementById("overlay-stars").textContent = "★".repeat(stars) + "☆".repeat(3 - stars);

    const nextBtn = document.getElementById("btn-next");
    if (stage.stageIndex < 9) {
      pendingWorldComic = null;
      nextBtn.textContent = "다음 스테이지";
      nextBtn.hidden = false;
    } else {
      pendingWorldComic = stage.worldIndex;
      if (stage.worldIndex < 29) {
        nextBtn.textContent = "스토리 보기";
      } else {
        nextBtn.textContent = "피날레 스토리";
      }
      nextBtn.hidden = false;
    }
    document.getElementById("overlay-clear").hidden = false;
  }

  function runAfterClear(action) {
    const finish = () => {
      pendingWorldComic = null;
      action();
    };

    const afterComic = () => {
      const p = window.TnkAds?.showInterstitial?.();
      if (p && typeof p.then === "function") {
        p.then(finish).catch(finish);
      } else {
        finish();
      }
    };

    if (pendingWorldComic == null || !window.WorldComic) {
      finish();
      return;
    }
    const world = pendingWorldComic;
    document.getElementById("overlay-clear").hidden = true;
    window.WorldComic.play(world, afterComic);
  }

  function handleFail({ score, stage, reason }) {
    window.GameAudio?.playFail();
    const speaker = charOf(stage.speakerId);
    const avatar = document.getElementById("fail-avatar");
    if (avatar) {
      avatar.src = speaker.img;
      avatar.alt = speaker.name;
    }
    const stagesBtn = document.getElementById("btn-fail-stages");
    if (stage.endless) {
      const result = window.Save.recordEndless(save, score || 0);
      save = window.Save.load();
      refreshIntroMeta();
      notifyAisleParent("endless", score || 0);
      document.getElementById("fail-title").textContent = result.isNewBest ? "신기록!" : "복구 종료";
      document.getElementById("fail-story").textContent =
        "점수 " +
        (score || 0) +
        " · 최고 " +
        result.best +
        (result.shards ? " · 파편 +" + result.shards : "") +
        "\n" +
        stage.fail;
      if (stagesBtn) stagesBtn.textContent = "나가기";
    } else {
      document.getElementById("fail-title").textContent =
        reason === "moves" ? "시계가 멈췄어…" : "길이 막혔어…";
      document.getElementById("fail-story").textContent = stage.fail;
      if (stagesBtn) stagesBtn.textContent = "스테이지 목록";
    }
    document.getElementById("overlay-fail").hidden = false;
  }

  function uiClick() {
    window.GameAudio?.playClick();
  }

  document.getElementById("btn-start")?.addEventListener("click", () => {
    uiClick();
    window.GameAudio?.unlock();
    const wp = window.Save.worldProgress(save, save.unlockedWorld);
    const stageIndex = Math.min(wp.cleared.length, 9);
    startStage(save.unlockedWorld, stageIndex);
  });

  document.getElementById("btn-worlds")?.addEventListener("click", () => {
    uiClick();
    window.GameAudio?.playMapOpen();
    buildMap();
    show("map");
  });

  document.getElementById("btn-endless")?.addEventListener("click", () => {
    uiClick();
    save = window.Save.load();
    if (!window.Save.hasClearedAny(save)) {
      const btn = document.getElementById("btn-endless");
      if (btn) btn.title = "첫 스테이지를 클리어하면 열립니다";
      const meta = document.getElementById("intro-meta");
      if (meta) meta.textContent = "첫 스테이지를 클리어하면 끝없는 복구가 열려요.";
      return;
    }
    window.GameAudio?.unlock();
    startEndless();
  });

  document.getElementById("btn-shop")?.addEventListener("click", () => {
    uiClick();
    openShop();
  });
  document.getElementById("btn-map-shop")?.addEventListener("click", () => {
    uiClick();
    openShop();
  });
  document.getElementById("btn-shop-close")?.addEventListener("click", () => {
    uiClick();
    closeShop();
  });
  document.getElementById("overlay-shop")?.addEventListener("click", (e) => {
    if (e.target.id === "overlay-shop") closeShop();
  });
  window.addEventListener("bricks-open-shop", () => openShop());
  window.addEventListener("bricks-save", () => {
    save = window.Save.load();
    if (isShopOpen()) renderShop();
    if (activeScreen === "intro") refreshIntroMeta();
  });

  document.getElementById("btn-map-back")?.addEventListener("click", () => {
    uiClick();
    show("intro");
  });
  document.getElementById("btn-stages-back")?.addEventListener("click", () => {
    uiClick();
    buildMap();
    show("map");
  });

  document.getElementById("btn-stages-story")?.addEventListener("click", () => {
    uiClick();
    const wp = window.Save.worldProgress(save, currentWorld);
    if (wp.cleared.length < 10) return;
    window.WorldComic?.play(currentWorld, () => {});
  });
  document.getElementById("btn-game-back")?.addEventListener("click", () => {
    uiClick();
    leaveGame();
  });

  document.getElementById("btn-to-map")?.addEventListener("click", () => {
    uiClick();
    runAfterClear(() => {
      document.getElementById("overlay-clear").hidden = true;
      buildMap();
      show("map");
    });
  });

  document.getElementById("btn-to-stages")?.addEventListener("click", () => {
    uiClick();
    runAfterClear(() => {
      document.getElementById("overlay-clear").hidden = true;
      openStageSelect(currentWorld);
    });
  });

  document.getElementById("btn-next")?.addEventListener("click", () => {
    uiClick();
    runAfterClear(() => {
      document.getElementById("overlay-clear").hidden = true;
      if (currentStage < 9) {
        startStage(currentWorld, currentStage + 1);
      } else if (currentWorld < 29) {
        openStageSelect(currentWorld + 1);
      } else {
        buildMap();
        show("map");
      }
    });
  });

  document.getElementById("btn-retry")?.addEventListener("click", () => {
    uiClick();
    document.getElementById("overlay-fail").hidden = true;
    if (playMode === "endless") startEndless();
    else startStage(currentWorld, currentStage);
  });

  document.getElementById("btn-fail-stages")?.addEventListener("click", () => {
    uiClick();
    document.getElementById("overlay-fail").hidden = true;
    leaveGame();
  });

  buildIntroCast();
  refreshIntroMeta();
  show("intro");
  setupAndroidBackButton();

  const comicParam = new URLSearchParams(location.search).get("comic");
  if (comicParam != null) {
    const wi = Math.max(0, Math.min(29, (Number(comicParam) || 1) - 1));
    show("game");
    window.WorldComic?.play(wi, () => {
      show("intro");
      refreshIntroMeta();
    });
  }

  function setupAndroidBackButton() {
    const CapApp = window.Capacitor?.Plugins?.App;
    if (!CapApp?.addListener) return;

    CapApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive) window.GameAudio?.resume();
      else window.GameAudio?.pause();
    });

    CapApp.addListener("backButton", () => {
      if (isShopOpen()) {
        closeShop();
        return;
      }
      if (window.WorldComic?.isOpen()) {
        window.WorldComic.close();
        return;
      }
      const clear = document.getElementById("overlay-clear");
      const fail = document.getElementById("overlay-fail");
      if (clear && !clear.hidden) {
        clear.hidden = true;
        leaveGame();
        return;
      }
      if (fail && !fail.hidden) {
        fail.hidden = true;
        leaveGame();
        return;
      }

      if (activeScreen === "game") {
        leaveGame();
      } else if (activeScreen === "stages") {
        buildMap();
        show("map");
      } else if (activeScreen === "map") {
        show("intro");
      } else {
        window.GameAudio?.pause();
        CapApp.exitApp();
      }
    });
  }
})();
