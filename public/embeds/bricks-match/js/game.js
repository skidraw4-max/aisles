(() => {
  const SIZE = 8;
  const CELL_POINTS = 10;
  const LINE_BONUS = 50;
  const RIFT = "__rift__";
  const CRACK = "__crack__";

  const boardEl = document.getElementById("board");
  const trayEl = document.getElementById("tray");
  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best-score");
  const targetEl = document.getElementById("target-score");
  const linesEl = document.getElementById("lines-value");
  const objectiveEl = document.getElementById("objective-label");
  const rerollBtn = document.getElementById("btn-reroll");
  const undoBtn = document.getElementById("btn-undo");
  const chiselBtn = document.getElementById("btn-chisel");
  const restartBtn = document.getElementById("btn-restart");
  const storyBanner = document.getElementById("story-banner");
  const overlayClear = document.getElementById("overlay-clear");
  const overlayFail = document.getElementById("overlay-fail");
  const hintEl = document.getElementById("game-hint");

  let grid = [];
  let score = 0;
  let linesCleared = 0;
  let combos = 0;
  let rerolls = 2;
  let undos = 1;
  let rerollUsed = false;
  let undoSnap = null;
  let chiselMode = false;
  let tray = [null, null, null];
  let ghost = null;
  let playing = false;
  let stage = null;
  let onClear = null;
  let onFail = null;
  let colorCleared = {};
  let doubleClears = 0;
  let movesSinceClear = 0;
  let clearStreak = 0;
  let holdPiece = null;
  let relicSet = new Set();
  let relicsCollected = 0;
  let livingMoves = 0;
  let flowMoves = 0;
  let movesUsed = 0;
  const holdSlotEl = document.getElementById("hold-slot");

  function isRift(cell) {
    return cell === RIFT;
  }

  function isCrack(cell) {
    return cell === CRACK;
  }

  function isBlock(cell) {
    // 금 간·일반 블록은 줄 채움에 포함, 균열 돌은 제외(완전불가)
    return !!cell && !isRift(cell);
  }

  function emptyGrid() {
    return Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  }

  function applyBoardHazards() {
    (stage?.obstacles || []).forEach(({ r, c }) => {
      if (r >= 0 && c >= 0 && r < SIZE && c < SIZE) grid[r][c] = RIFT;
    });
    (stage?.cracks || []).forEach(({ r, c }) => {
      if (r >= 0 && c >= 0 && r < SIZE && c < SIZE && !isRift(grid[r][c])) grid[r][c] = CRACK;
    });
  }

  function cloneShape(shape) {
    return shape.map((row) => row.slice());
  }

  function rotateShape(shape) {
    const rows = shape.length;
    const cols = shape[0].length;
    const next = Array.from({ length: cols }, () => Array(rows).fill(0));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        next[c][rows - 1 - r] = shape[r][c];
      }
    }
    return next;
  }

  function rotationsOf(shape) {
    const out = [cloneShape(shape)];
    let s = shape;
    for (let i = 0; i < 3; i++) {
      s = rotateShape(s);
      out.push(s);
    }
    return out;
  }

  function clonePiece(piece) {
    if (!piece) return null;
    return { id: piece.id, color: piece.color, shape: cloneShape(piece.shape) };
  }

  function invCount(key) {
    const data = window.Save.load();
    return window.Save.inventoryCount(data, key);
  }

  function consumeInv(key) {
    const data = window.Save.load();
    return window.Save.useInventory(data, key);
  }

  function snapshot() {
    undoSnap = {
      grid: grid.map((row) => row.slice()),
      tray: tray.map(clonePiece),
      holdPiece: clonePiece(holdPiece),
      score,
      linesCleared,
      combos,
      colorCleared: Object.assign({}, colorCleared),
      doubleClears,
      movesSinceClear,
      clearStreak,
      rerolls,
      rerollUsed,
      relics: [...relicSet],
      relicsCollected,
      livingMoves,
      flowMoves,
      movesUsed,
    };
  }

  function restoreSnap() {
    if (!undoSnap) return false;
    grid = undoSnap.grid.map((row) => row.slice());
    tray = undoSnap.tray.map(clonePiece);
    holdPiece = clonePiece(undoSnap.holdPiece);
    score = undoSnap.score;
    linesCleared = undoSnap.linesCleared;
    combos = undoSnap.combos;
    colorCleared = Object.assign({}, undoSnap.colorCleared);
    doubleClears = undoSnap.doubleClears;
    movesSinceClear = undoSnap.movesSinceClear;
    clearStreak = undoSnap.clearStreak;
    rerolls = undoSnap.rerolls;
    rerollUsed = undoSnap.rerollUsed;
    relicSet = new Set(undoSnap.relics || []);
    relicsCollected = undoSnap.relicsCollected || 0;
    livingMoves = undoSnap.livingMoves || 0;
    flowMoves = undoSnap.flowMoves || 0;
    movesUsed = undoSnap.movesUsed || 0;
    undoSnap = null;
    return true;
  }

  function pickPiece() {
    let poolKey = stage?.pool || "easy";
    if (stage?.endless) {
      if (linesCleared >= 40) poolKey = "expert";
      else if (linesCleared >= 20) poolKey = "hard";
      else if (linesCleared >= 8) poolKey = "normal";
      else poolKey = "easy";
    }
    const poolIds = window.PIECE_POOLS[poolKey];
    const id = poolIds[Math.floor(Math.random() * poolIds.length)];
    const base = window.PIECE_DEFS[id];
    return {
      id: base.id + "_" + Math.random().toString(36).slice(2, 7),
      color: base.color,
      shape: cloneShape(base.shape),
    };
  }

  function fillTray(forceAll = false) {
    for (let i = 0; i < 3; i++) {
      if (forceAll || !tray[i]) tray[i] = pickPiece();
    }
    if (tray.every((p) => !p)) {
      for (let i = 0; i < 3; i++) tray[i] = pickPiece();
    }
    renderTray();
  }

  function renderBoard(preview = null) {
    boardEl.innerHTML = "";
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const cell = document.createElement("div");
        cell.className = "cell";
        cell.dataset.r = String(r);
        cell.dataset.c = String(c);
        const value = grid[r][c];
        if (isRift(value)) {
          cell.classList.add("obstacle");
          cell.title = "균열 돌 — 이 줄은 클리어 불가";
        } else if (isCrack(value)) {
          cell.classList.add("crack");
          cell.title = "금 간 벽돌 — 줄을 맞추면 지워짐";
          if (stage?.worldIndex === 0 && stage?.stageIndex < 3) cell.classList.add("hint-glow");
        } else if (value) {
          cell.classList.add("filled");
          cell.style.background = value;
        }
        if (relicSet.has(r + "," + c)) {
          cell.classList.add("relic");
          cell.title = (cell.title ? cell.title + " · " : "") + "유물 — 줄 클리어로 되찾으세요";
        }
        if (preview) {
          const hit = preview.cells.find((p) => p.r === r && p.c === c);
          if (hit) {
            cell.classList.add(preview.ok ? "preview-ok" : "preview-bad");
            if (!value) cell.style.background = preview.color;
          }
        }
        boardEl.appendChild(cell);
      }
    }
  }

  function renderTray() {
    trayEl.innerHTML = "";
    tray.forEach((piece, index) => {
      const slot = document.createElement("div");
      slot.className = "piece-slot" + (piece ? "" : " empty");
      if (piece) {
        const el = buildPieceEl(piece);
        bindPieceDrag(el, piece, index);
        slot.appendChild(el);
      }
      trayEl.appendChild(slot);
    });
    renderHold();
  }

  function renderHold() {
    if (!holdSlotEl) return;
    holdSlotEl.innerHTML = "";
    holdSlotEl.classList.toggle("empty", !holdPiece);
    if (holdPiece) {
      const el = buildPieceEl(holdPiece);
      bindPieceDrag(el, holdPiece, "hold");
      holdSlotEl.appendChild(el);
    }
  }

  function buildPieceEl(piece, cellSize = 16) {
    const el = document.createElement("div");
    el.className = "piece";
    const rows = piece.shape.length;
    const cols = piece.shape[0].length;
    el.style.gridTemplateColumns = `repeat(${cols}, ${cellSize}px)`;
    el.style.gridTemplateRows = `repeat(${rows}, ${cellSize}px)`;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = document.createElement("div");
        cell.className = "piece-cell";
        cell.style.width = cellSize + "px";
        cell.style.height = cellSize + "px";
        if (piece.shape[r][c]) cell.style.background = piece.color;
        else cell.style.visibility = "hidden";
        el.appendChild(cell);
      }
    }
    return el;
  }

  function shapeCells(shape, originR, originC) {
    const cells = [];
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        cells.push({ r: originR + r, c: originC + c });
      }
    }
    return cells;
  }

  function canPlace(shape, originR, originC) {
    for (const { r, c } of shapeCells(shape, originR, originC)) {
      if (r < 0 || c < 0 || r >= SIZE || c >= SIZE) return false;
      if (grid[r][c]) return false;
    }
    return true;
  }

  function canPlaceAnywhere(piece) {
    for (const shape of rotationsOf(piece.shape)) {
      const rows = shape.length;
      const cols = shape[0].length;
      for (let r = 0; r <= SIZE - rows; r++) {
        for (let c = 0; c <= SIZE - cols; c++) {
          if (canPlace(shape, r, c)) return true;
        }
      }
    }
    return false;
  }

  function anyMoveLeft() {
    return tray.some((p) => p && canPlaceAnywhere(p)) || !!(holdPiece && canPlaceAnywhere(holdPiece));
  }

  function placePiece(piece, originR, originC) {
    const cells = shapeCells(piece.shape, originR, originC);
    for (const { r, c } of cells) grid[r][c] = piece.color;
    score += cells.length * CELL_POINTS;
    movesUsed += 1;
    window.GameAudio?.playPlace();
    const cleared = clearLines();
    if (cleared > 0) {
      linesCleared += cleared;
      movesSinceClear = 0;
      clearStreak += 1;
      score += cleared * LINE_BONUS + (cleared > 1 ? cleared * 25 : 0);
      if (clearStreak >= 2) score += clearStreak * 8;
      if (cleared >= 2) {
        combos += 1;
        doubleClears += 1;
        window.GameAudio?.playCombo();
      } else {
        window.GameAudio?.playClear(cleared);
      }
      maybeSpawnEndlessRelic();
    } else {
      movesSinceClear += 1;
      clearStreak = 0;
      if (movesSinceClear >= 3 && hintEl) {
        hintEl.textContent = "줄을 만들어 보자! 금 간 벽돌을 지워도 좋아요.";
      }
    }
    applyLivingRift();
    applyFlow();
    if (!cleared) renderBoard();
    updateHud();
    return cleared;
  }

  function lineColors(cells) {
    const counts = {};
    let max = 0;
    cells.forEach((val) => {
      if (!val || isRift(val) || isCrack(val)) return;
      counts[val] = (counts[val] || 0) + 1;
      if (counts[val] > max) max = counts[val];
    });
    return max;
  }

  function isPalindromeLine(cells) {
    for (let i = 0; i < cells.length; i++) {
      const a = cells[i];
      const b = cells[cells.length - 1 - i];
      if (a !== b) return false;
    }
    return true;
  }

  function clearLines() {
    const fullRows = [];
    const fullCols = [];
    for (let r = 0; r < SIZE; r++) {
      if (grid[r].every(isBlock)) fullRows.push(r);
    }
    for (let c = 0; c < SIZE; c++) {
      let ok = true;
      for (let r = 0; r < SIZE; r++) {
        if (!isBlock(grid[r][c])) {
          ok = false;
          break;
        }
      }
      if (ok) fullCols.push(c);
    }
    const mark = new Set();
    let resonanceBonus = 0;
    let mirrorBonus = 0;
    fullRows.forEach((r) => {
      for (let c = 0; c < SIZE; c++) mark.add(r + "," + c);
      const row = grid[r].slice();
      const same = lineColors(row);
      if (stage?.boardMods?.resonance && same >= 6) resonanceBonus += same >= 8 ? 80 : 40;
      if (stage?.boardMods?.mirror && isPalindromeLine(row)) mirrorBonus += 80;
    });
    fullCols.forEach((c) => {
      const col = [];
      for (let r = 0; r < SIZE; r++) {
        mark.add(r + "," + c);
        col.push(grid[r][c]);
      }
      const same = lineColors(col);
      if (stage?.boardMods?.resonance && same >= 6) resonanceBonus += same >= 8 ? 80 : 40;
      if (stage?.boardMods?.mirror && isPalindromeLine(col)) mirrorBonus += 80;
    });
    if (!mark.size) return 0;

    [...boardEl.children].forEach((cell) => {
      if (mark.has(cell.dataset.r + "," + cell.dataset.c)) cell.classList.add("clearing");
    });
    let crackBonus = 0;
    let relicBonus = 0;
    mark.forEach((key) => {
      const [r, c] = key.split(",").map(Number);
      const val = grid[r][c];
      if (isRift(val)) return;
      if (relicSet.has(key)) {
        relicSet.delete(key);
        relicsCollected += 1;
        relicBonus += 50;
      }
      if (isCrack(val)) {
        crackBonus += 15;
      } else if (val) {
        colorCleared[val] = (colorCleared[val] || 0) + 1;
      }
      grid[r][c] = null;
    });
    score += crackBonus + relicBonus + resonanceBonus + mirrorBonus;
    if ((relicBonus || resonanceBonus || mirrorBonus) && window.GameAudio?.playCombo && (resonanceBonus || mirrorBonus || relicBonus >= 50)) {
      if (resonanceBonus || mirrorBonus) window.GameAudio.playCombo();
    }
    if (relicBonus && hintEl) hintEl.textContent = "유물을 되찾았어요! +" + relicBonus;
    else if (mirrorBonus && hintEl) hintEl.textContent = "거울 문양 보너스! +" + mirrorBonus;
    else if (resonanceBonus && hintEl) hintEl.textContent = "색 공명! +" + resonanceBonus;
    return fullRows.length + fullCols.length;
  }

  function applyLivingRift() {
    const spec = stage?.boardMods?.livingRift;
    if (!spec) return;
    livingMoves += 1;
    if (livingMoves % spec.every !== 0) return;
    const seeds = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (isRift(grid[r][c]) || isCrack(grid[r][c])) seeds.push({ r, c });
      }
    }
    const dirs = [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
    ];
    const candidates = [];
    const source = seeds.length ? seeds : [{ r: 0, c: 3 }, { r: 7, c: 4 }];
    source.forEach(({ r, c }) => {
      dirs.forEach(([dr, dc]) => {
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= SIZE || nc >= SIZE) return;
        if (grid[nr][nc]) return;
        if (relicSet.has(nr + "," + nc)) return;
        candidates.push({ r: nr, c: nc });
      });
    });
    if (!candidates.length) return;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    grid[pick.r][pick.c] = CRACK;
    if (hintEl) hintEl.textContent = "균열이 퍼졌어요…";
  }

  function applyFlow() {
    const spec = stage?.boardMods?.flow;
    if (!spec) return;
    flowMoves += 1;
    if (flowMoves % spec.every !== 0) return;
    let bestRow = 0;
    let bestCount = -1;
    for (let r = 0; r < SIZE; r++) {
      const n = grid[r].filter((v) => v && !isRift(v)).length;
      if (n > bestCount) {
        bestCount = n;
        bestRow = r;
      }
    }
    if (bestCount <= 0) return;
    const src = grid[bestRow].slice();
    const dest = Array(SIZE).fill(null);
    for (let c = 0; c < SIZE; c++) {
      if (isRift(src[c])) dest[c] = RIFT;
    }
    for (let c = SIZE - 1; c >= 0; c--) {
      const v = src[c];
      if (!v || isRift(v)) continue;
      let nc = c + 1;
      while (nc < SIZE && dest[nc]) nc += 1;
      if (nc < SIZE) dest[nc] = v;
    }
    grid[bestRow] = dest;
    if (hintEl) hintEl.textContent = "물길이 " + (bestRow + 1) + "행을 흘려보냈어요.";
  }

  function maybeSpawnEndlessRelic() {
    if (!stage?.endless) return;
    if (linesCleared < 12 || linesCleared % 12 !== 0) return;
    const empty = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const key = r + "," + c;
        if (!grid[r][c] && !relicSet.has(key)) empty.push(key);
      }
    }
    if (!empty.length) return;
    relicSet.add(empty[Math.floor(Math.random() * empty.length)]);
  }

  function movesRemaining() {
    const cap = stage?.boardMods?.moveLimit;
    if (!cap) return null;
    return Math.max(0, cap - movesUsed);
  }

  function sideMissionMet() {
    const m = stage?.sideMission;
    if (!m) return true;
    if (m.type === "colorClear") return (colorCleared[m.color] || 0) >= m.need;
    if (m.type === "doubleClear") return doubleClears >= (m.need || 1);
    if (m.type === "noReroll") return !rerollUsed;
    if (m.type === "traySpare") {
      const left = tray.filter(Boolean).length + (holdPiece ? 1 : 0);
      return left <= (m.maxLeft ?? 1);
    }
    return true;
  }

  function sideMissionProgressText() {
    const m = stage?.sideMission;
    if (!m) return "";
    if (m.type === "colorClear") {
      const n = colorCleared[m.color] || 0;
      return m.label + " (" + Math.min(n, m.need) + "/" + m.need + ")";
    }
    if (m.type === "doubleClear") {
      return m.label + (doubleClears > 0 ? " ✓" : "");
    }
    if (m.type === "noReroll") {
      return m.label + (rerollUsed ? " · 리롤 사용됨" : "");
    }
    if (m.type === "traySpare") {
      return m.label + " (현재 " + (tray.filter(Boolean).length + (holdPiece ? 1 : 0)) + ")";
    }
    return m.label;
  }

  function objectiveMet() {
    if (!stage) return false;
    const o = stage.objective;
    if (o.type === "endless") return false;
    let main = false;
    if (o.type === "score") main = score >= o.score;
    else if (o.type === "lines") main = linesCleared >= o.lines;
    else if (o.type === "combo") main = combos >= o.combo;
    else if (o.type === "hybrid") main = score >= o.score && linesCleared >= o.lines;
    return main && sideMissionMet();
  }

  function objectiveLabel() {
    if (!stage) return "";
    const o = stage.objective;
    let base = "";
    if (o.type === "score") base = "목표 점수 " + o.score;
    else if (o.type === "lines") base = "라인 " + o.lines + "회";
    else if (o.type === "combo") base = "콤보(2줄+) " + o.combo + "회";
    else if (o.type === "hybrid") base = "점수 " + o.score + " & 라인 " + o.lines;
    else if (o.type === "endless") base = "끝없는 복구 · 최고 " + (window.Save.load().bestEndless || 0);
    const rift = stage.obstacles?.length || 0;
    const crack = stage.cracks?.length || 0;
    if (rift > 0) base += " · 균열 " + rift;
    if (crack > 0) base += " · 금 간 " + crack;
    const relicsLeft = relicSet.size;
    if (relicsLeft > 0) base += " · 유물 " + relicsLeft;
    const left = movesRemaining();
    if (left != null) base += " · 수 " + left;
    if (stage.boardMods?.livingRift) base += " · 확산";
    if (stage.boardMods?.flow) base += " · 흐름";
    if (stage.boardMods?.mirror) base += " · 거울";
    const side = sideMissionProgressText();
    if (side) base += " · " + side;
    return base;
  }

  function updateHud() {
    scoreEl.textContent = String(score);
    if (linesEl) linesEl.textContent = String(linesCleared);
    if (objectiveEl) objectiveEl.textContent = objectiveLabel();
    if (targetEl) {
      const o = stage?.objective;
      if (o?.type === "score" || o?.type === "hybrid") targetEl.textContent = String(o.score);
      else if (o?.type === "lines") targetEl.textContent = String(o.lines);
      else if (o?.type === "combo") targetEl.textContent = String(o.combo);
    }
    const best = stage?.endless
      ? window.Save.load().bestEndless || 0
      : stage
        ? window.Save.worldProgress(window.Save.load(), stage.worldIndex).bestScore[stage.stageIndex] || 0
        : 0;
    bestEl.textContent = String(Math.max(best, score));
    updateUndoBtn();
    updateChiselBtn();
  }

  function checkEndState() {
    if (!playing) return;
    if (objectiveMet()) {
      playing = false;
      setTimeout(() => {
        if (onClear)
          onClear({
            score,
            linesCleared,
            combos,
            stage,
            sideDone: sideMissionMet(),
            clearStreak,
            relicShards: relicsCollected,
          });
        else overlayClear.hidden = false;
      }, 300);
      return;
    }
    if (movesRemaining() === 0) {
      playing = false;
      setTimeout(() => {
        if (onFail) onFail({ score, stage, reason: "moves" });
        else if (overlayFail) overlayFail.hidden = false;
      }, 300);
      return;
    }
    if (!anyMoveLeft()) {
      if (rerolls > 0 || invCount("extraRerolls") > 0) {
        hintEl.textContent = "놓을 곳이 없어요. REROLL을 사용해 보세요!";
        updateRerollBtn();
        return;
      }
      if (window.TnkAds?.available?.()) {
        hintEl.textContent = "놓을 곳이 없어요. 「광고 리롤」로 조각을 받을 수 있어요!";
        updateRerollBtn();
        return;
      }
      playing = false;
      setTimeout(() => {
        if (onFail) onFail({ score, stage });
        else if (overlayFail) overlayFail.hidden = false;
      }, 300);
    }
  }

  function boardCellFromPoint(x, y) {
    const rect = boardEl.getBoundingClientRect();
    if (x < rect.left || y < rect.top || x > rect.right || y > rect.bottom) return null;
    const c = Math.floor((x - rect.left) / (rect.width / SIZE));
    const r = Math.floor((y - rect.top) / (rect.height / SIZE));
    if (r < 0 || c < 0 || r >= SIZE || c >= SIZE) return null;
    return { r, c };
  }

  function previewAt(piece, x, y) {
    const anchor = boardCellFromPoint(x, y);
    if (!anchor) {
      renderBoard();
      return null;
    }
    const rows = piece.shape.length;
    const cols = piece.shape[0].length;
    const originR = anchor.r - Math.floor((rows - 1) / 2);
    const originC = anchor.c - Math.floor((cols - 1) / 2);
    const cells = shapeCells(piece.shape, originR, originC);
    const ok = canPlace(piece.shape, originR, originC);
    renderBoard({ cells, ok, color: piece.color });
    return { originR, originC, ok };
  }

  function removeGhost() {
    if (ghost) {
      ghost.remove();
      ghost = null;
    }
  }

  function moveGhost(x, y) {
    if (!ghost) return;
    ghost.style.left = x - ghost.offsetWidth / 2 + "px";
    ghost.style.top = y - ghost.offsetHeight / 2 + "px";
  }

  function bindPieceDrag(el, piece, source) {
    const onDown = (e) => {
      if (!playing) return;
      e.preventDefault();
      setChiselMode(false);
      const start = e.touches ? e.touches[0] : e;
      const startX = start.clientX;
      const startY = start.clientY;
      let dragged = false;

      const onMove = (ev) => {
        const p = ev.touches ? ev.touches[0] : ev;
        if (!p) return;
        const dist = Math.hypot(p.clientX - startX, p.clientY - startY);
        if (!dragged && dist < 12) return;
        if (!dragged) {
          dragged = true;
          el.classList.add("dragging");
          removeGhost();
          ghost = buildPieceEl(piece, 22);
          ghost.classList.add("drag-ghost");
          document.body.appendChild(ghost);
        }
        ev.preventDefault();
        moveGhost(p.clientX, p.clientY);
        previewAt(piece, p.clientX, p.clientY);
      };

      const onUp = (ev) => {
        const p = ev.changedTouches ? ev.changedTouches[0] : ev;
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        el.classList.remove("dragging");
        removeGhost();

        if (!dragged) {
          piece.shape = rotateShape(piece.shape);
          if (window.GameAudio?.playRotate) window.GameAudio.playRotate();
          else window.GameAudio?.playClick?.();
          renderTray();
          if (hintEl) hintEl.textContent = "조각을 회전했어요. 드래그해서 놓으세요.";
          return;
        }

        const result = previewAt(piece, p.clientX, p.clientY);
        if (result && result.ok) {
          snapshot();
          placePiece(piece, result.originR, result.originC);
          if (source === "hold") {
            holdPiece = null;
            if (tray.every((x) => !x)) fillTray(true);
            else renderTray();
          } else {
            tray[source] = null;
            if (tray.every((x) => !x)) fillTray(true);
            else renderTray();
          }
          renderHold();
          updateHud();
          setTimeout(() => {
            renderBoard();
            checkEndState();
          }, 280);
          if (hintEl && !hintEl.textContent) hintEl.textContent = objectiveLabel();
        } else if (isOverHold(p.clientX, p.clientY) && source !== "hold") {
          snapshot();
          const prev = holdPiece;
          holdPiece = clonePiece(piece);
          tray[source] = prev;
          window.GameAudio?.playClick?.();
          renderTray();
          renderBoard();
          if (hintEl) hintEl.textContent = "조각을 보관했어요.";
        } else {
          renderBoard();
        }
      };

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    };

    el.addEventListener("pointerdown", onDown);
  }

  function isOverHold(x, y) {
    if (!holdSlotEl) return false;
    const rect = holdSlotEl.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function updateRerollBtn() {
    if (!rerollBtn) return;
    const extra = invCount("extraRerolls");
    if (rerolls > 0) {
      rerollBtn.textContent = "REROLL · " + rerolls;
      rerollBtn.disabled = !playing;
    } else if (extra > 0) {
      rerollBtn.textContent = "파편 리롤 · " + extra;
      rerollBtn.disabled = !playing;
    } else {
      rerollBtn.textContent = "광고 리롤";
      rerollBtn.disabled = !playing;
    }
  }

  function undoAvailable() {
    return undos + invCount("extraUndos");
  }

  function updateUndoBtn() {
    if (!undoBtn) return;
    const n = undoAvailable();
    const badge = document.getElementById("undo-count");
    if (badge) badge.textContent = String(n);
    if (!playing) {
      undoBtn.disabled = true;
      undoBtn.title = "되돌리기";
      return;
    }
    if (n > 0) {
      undoBtn.disabled = !undoSnap;
      undoBtn.title = undoSnap ? "되돌리기 · " + n : "되돌릴 수가 없어요";
    } else {
      undoBtn.disabled = false;
      undoBtn.title = "파편 상점에서 되돌리기 구매";
    }
  }

  function updateChiselBtn() {
    if (!chiselBtn) return;
    const n = invCount("riftHammers");
    const hasRift = !!(stage?.obstacles?.length) || grid.some((row) => row.some(isRift));
    chiselBtn.hidden = !hasRift && n <= 0;
    if (n <= 0) {
      chiselBtn.textContent = "끌 구매";
      chiselBtn.classList.remove("is-active");
    } else {
      chiselBtn.textContent = chiselMode ? "끌 취소" : "끌 · " + n;
    }
    chiselBtn.disabled = !playing;
    chiselBtn.classList.toggle("is-active", chiselMode && n > 0);
  }

  function setChiselMode(on) {
    chiselMode = !!on && playing && invCount("riftHammers") > 0;
    document.body.classList.toggle("chisel-mode", chiselMode);
    updateChiselBtn();
    if (chiselMode && hintEl) hintEl.textContent = "제거할 균열 돌을 탭하세요.";
  }

  function doUndo() {
    if (!playing || !undoSnap) return;
    if (undos > 0) undos -= 1;
    else if (!consumeInv("extraUndos")) return;
    restoreSnap();
    setChiselMode(false);
    if (window.GameAudio?.playUndo) window.GameAudio.playUndo();
    else window.GameAudio?.playClick?.();
    renderTray();
    renderBoard();
    updateHud();
    updateRerollBtn();
    if (hintEl) hintEl.textContent = "한 수를 되돌렸어요.";
  }

  function hideOverlays() {
    if (overlayClear) overlayClear.hidden = true;
    if (overlayFail) overlayFail.hidden = true;
  }

  function start(stageData, handlers = {}) {
    stage = stageData;
    onClear = handlers.onClear || null;
    onFail = handlers.onFail || null;
    grid = emptyGrid();
    applyBoardHazards();
    score = 0;
    linesCleared = 0;
    combos = 0;
    colorCleared = {};
    doubleClears = 0;
    movesSinceClear = 0;
    clearStreak = 0;
    rerolls = stage.rerolls;
    undos = stage.undos ?? 1;
    rerollUsed = false;
    undoSnap = null;
    holdPiece = null;
    relicsCollected = 0;
    livingMoves = 0;
    flowMoves = 0;
    movesUsed = 0;
    relicSet = new Set((stage.boardMods?.relics || []).map((p) => p.r + "," + p.c));
    setChiselMode(false);
    tray = [null, null, null];
    hideOverlays();
    if (storyBanner) storyBanner.classList.remove("is-hidden");
    playing = true;
    updateHud();
    fillTray(true);
    renderBoard();
    updateRerollBtn();
    const tips = [];
    if ((stage.cracks?.length || 0) > 0) tips.push("금 간 벽돌은 줄 클리어로 지워져요");
    if ((stage.obstacles?.length || 0) > 0) tips.push("균열 돌이 있는 줄은 클리어 불가 · 끌로 제거 가능");
    if (stage.boardMods?.relics?.length) tips.push("금빛 유물은 줄 클리어로 되찾으세요");
    if (stage.boardMods?.livingRift) tips.push("균열이 수마다 퍼집니다");
    if (stage.boardMods?.flow) tips.push("물길이 한 줄을 오른쪽으로 흘립니다");
    if (stage.boardMods?.mirror) tips.push("좌우 대칭 줄은 거울 보너스");
    if (stage.boardMods?.moveLimit) tips.push("남은 수 " + stage.boardMods.moveLimit);
    if (stage.sideMission) tips.push("미션: " + stage.sideMission.label);
    if (hintEl) {
      hintEl.textContent =
        "탭=회전 · 드래그=배치 · HOLD에 보관 · " + objectiveLabel() + (tips.length ? " · " + tips[0] : "");
    }
  }

  function enablePlay() {
    if (!stage) return;
    playing = true;
    updateRerollBtn();
    if (hintEl) hintEl.textContent = "탭하면 회전, 드래그하면 배치 · " + objectiveLabel();
  }

  rerollBtn?.addEventListener("click", async () => {
    if (!playing) return;
    setChiselMode(false);

    if (rerolls > 0) {
      snapshot();
      rerolls -= 1;
      rerollUsed = true;
      window.GameAudio?.playReroll();
      fillTray(true);
      updateRerollBtn();
      updateHud();
      if (!anyMoveLeft() && rerolls <= 0 && invCount("extraRerolls") <= 0) checkEndState();
      return;
    }

    if (invCount("extraRerolls") > 0) {
      snapshot();
      if (!consumeInv("extraRerolls")) return;
      rerollUsed = true;
      window.GameAudio?.playReroll();
      fillTray(true);
      updateRerollBtn();
      updateHud();
      if (hintEl) hintEl.textContent = "파편 리롤로 조각을 새로 받았어요!";
      if (!anyMoveLeft() && rerolls <= 0 && invCount("extraRerolls") <= 0) checkEndState();
      return;
    }

    rerollBtn.disabled = true;
    rerollBtn.textContent = "광고 로딩…";
    const result = await window.TnkAds?.showRewarded?.();
    if (result?.rewarded) {
      window.GameAudio?.playReroll();
      rerollUsed = true;
      fillTray(true);
      updateHud();
      if (hintEl) hintEl.textContent = "광고 보상으로 조각을 새로 받았어요!";
    } else if (result?.unavailable) {
      if (hintEl) hintEl.textContent = "광고는 앱에서만 이용할 수 있어요.";
    } else if (result?.error || result?.errorName) {
      const msg = window.TnkAds?.humanError?.(result);
      if (hintEl) hintEl.textContent = msg || "광고를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.";
    } else {
      if (hintEl) hintEl.textContent = "광고를 끝까지 보지 않아 보상이 지급되지 않았어요.";
    }
    updateRerollBtn();
    if (!anyMoveLeft() && rerolls <= 0 && invCount("extraRerolls") <= 0) checkEndState();
  });

  undoBtn?.addEventListener("click", () => {
    window.GameAudio?.playClick();
    if (!playing) return;
    if (undoAvailable() <= 0) {
      window.dispatchEvent(new CustomEvent("bricks-open-shop"));
      return;
    }
    doUndo();
  });

  chiselBtn?.addEventListener("click", () => {
    window.GameAudio?.playClick();
    if (!playing) return;
    if (invCount("riftHammers") <= 0) {
      if (hintEl) hintEl.textContent = "균열 끌이 없어요. 파편 상점에서 준비하세요.";
      window.dispatchEvent(new CustomEvent("bricks-open-shop"));
      return;
    }
    setChiselMode(!chiselMode);
  });

  boardEl?.addEventListener("click", (e) => {
    if (!chiselMode || !playing) return;
    const cell = e.target.closest(".cell");
    if (!cell) {
      setChiselMode(false);
      return;
    }
    const r = Number(cell.dataset.r);
    const c = Number(cell.dataset.c);
    if (!isRift(grid[r][c])) {
      if (hintEl) hintEl.textContent = "균열 돌만 제거할 수 있어요.";
      return;
    }
    snapshot();
    if (!consumeInv("riftHammers")) {
      undoSnap = null;
      return;
    }
    grid[r][c] = null;
    setChiselMode(false);
    window.GameAudio?.playClear?.(1);
    renderBoard();
    updateHud();
    if (hintEl) hintEl.textContent = "균열 돌을 제거했어요.";
    checkEndState();
  });

  restartBtn?.addEventListener("click", () => {
    if (!stage) return;
    window.GameAudio?.playClick();
    start(stage, { onClear, onFail });
  });

  window.addEventListener("bricks-save", () => {
    if (!playing) return;
    updateRerollBtn();
    updateUndoBtn();
    updateChiselBtn();
  });

  window.BricksGame = {
    start,
    enablePlay,
    getState: () => ({ score, linesCleared, combos, stage, endless: !!stage?.endless }),
    isEndless: () => !!stage?.endless,
  };
})();
