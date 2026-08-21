(() => {
  const chars = () => window.COMIC_CHARS || {};
  const bgs = () => window.COMIC_BG || {};
  const comics = () => window.WORLD_COMICS || [];

  let onDone = null;
  let worldIndex = 0;
  let panelIndex = 0;

  function el(id) {
    return document.getElementById(id);
  }

  function comicForWorld(zeroBasedWorld) {
    return comics().find((c) => c.world === zeroBasedWorld + 1) || null;
  }

  function charMeta(speaker, customName) {
    const c = chars()[speaker] || chars().other || { name: "???", img: "", color: "#a09080" };
    return {
      name: customName || c.name,
      img: c.img,
      color: c.color,
    };
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function render() {
    const comic = comicForWorld(worldIndex);
    const root = el("comic-panel");
    const meta = el("comic-pager-meta");
    const title = el("comic-title");
    const summary = el("comic-summary");
    if (!comic || !root) return;

    const panel = comic.panels[panelIndex];
    const bg = bgs()[comic.bg] || bgs().ruins || "";
    const sumSp = charMeta(comic.summarySpeaker);

    if (title) {
      title.textContent =
        "W" + String(comic.world).padStart(2, "0") + " · " + comic.title;
    }
    if (summary) {
      summary.textContent = sumSp.name + ": " + comic.summary;
    }

    const bubbles = (panel.lines || [])
      .map((line, i) => {
        const m = charMeta(line.speaker, line.name);
        const alt = i % 2 === 1 ? " is-alt" : "";
        const avatar = m.img
          ? '<img class="comic-bubble-avatar" src="' +
            m.img +
            '" alt="' +
            escapeHtml(m.name) +
            '" />'
          : '<span class="comic-bubble-avatar comic-bubble-avatar-empty" aria-hidden="true"></span>';
        return (
          '<div class="comic-bubble' +
          alt +
          '">' +
          avatar +
          '<div class="comic-bubble-body"><p class="comic-bubble-name" style="color:' +
          m.color +
          '">' +
          escapeHtml(m.name) +
          '</p><p class="comic-bubble-text">' +
          escapeHtml(line.text) +
          "</p></div></div>"
        );
      })
      .join("");

    root.innerHTML =
      '<div class="comic-panel-bg" style="background-image:url(\'' +
      bg +
      "')\"></div>" +
      '<div class="comic-panel-shade"></div>' +
      '<span class="comic-panel-index">CUT ' +
      (panelIndex + 1) +
      "</span>" +
      '<p class="comic-panel-scene">' +
      escapeHtml(panel.scene || "") +
      "</p>" +
      '<div class="comic-footer">' +
      '<div class="comic-bubbles">' +
      bubbles +
      "</div>" +
      (panel.caption
        ? '<p class="comic-caption">' + escapeHtml(panel.caption) + "</p>"
        : "") +
      "</div>";

    if (meta) {
      meta.textContent = panelIndex + 1 + " / " + comic.panels.length;
    }

    const prev = el("btn-comic-prev");
    const next = el("btn-comic-next");
    if (prev) prev.disabled = panelIndex <= 0;
    if (next) {
      next.textContent =
        panelIndex >= comic.panels.length - 1 ? "계속" : "다음 컷";
    }
  }

  function finish() {
    const overlay = el("overlay-comic");
    if (overlay) overlay.hidden = true;
    const cb = onDone;
    onDone = null;
    if (typeof cb === "function") cb();
  }

  function nextPanel() {
    const comic = comicForWorld(worldIndex);
    if (!comic) {
      finish();
      return;
    }
    if (panelIndex < comic.panels.length - 1) {
      panelIndex += 1;
      window.GameAudio?.playClick();
      render();
      return;
    }
    window.GameAudio?.playClick();
    finish();
  }

  function prevPanel() {
    if (panelIndex <= 0) return;
    panelIndex -= 1;
    window.GameAudio?.playClick();
    render();
  }

  function play(zeroBasedWorld, done) {
    const comic = comicForWorld(zeroBasedWorld);
    onDone = done || null;
    if (!comic) {
      finish();
      return;
    }
    worldIndex = zeroBasedWorld;
    panelIndex = 0;
    const overlay = el("overlay-comic");
    if (overlay) overlay.hidden = false;
    render();
  }

  function isOpen() {
    const overlay = el("overlay-comic");
    return !!(overlay && !overlay.hidden);
  }

  function close() {
    finish();
  }

  function bind() {
    el("btn-comic-prev")?.addEventListener("click", (e) => {
      e.stopPropagation();
      prevPanel();
    });
    el("btn-comic-next")?.addEventListener("click", (e) => {
      e.stopPropagation();
      nextPanel();
    });
    el("btn-comic-skip")?.addEventListener("click", (e) => {
      e.stopPropagation();
      window.GameAudio?.playClick();
      finish();
    });
    el("comic-panel")?.addEventListener("click", () => nextPanel());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }

  window.WorldComic = { play, isOpen, close, comicForWorld };
})();
