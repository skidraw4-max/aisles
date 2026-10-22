window.CHARACTERS = {
  brick: {
    id: "brick",
    name: "브릭",
    role: "복구사",
    img: "assets/characters/char-brick.png",
    fullImg: "assets/characters/char-brick-full.png?v=3",
    color: "#e8a045",
    introLine:
      "무너진 문양을 다시 맞출게. 첫 구역, 폐허의 입구부터 시작하자!",
  },
  mira: {
    id: "mira",
    name: "미라",
    role: "안내자",
    img: "assets/characters/char-mira.png",
    fullImg: "assets/characters/char-mira-full.png?v=3",
    color: "#3d8b7a",
    introLine:
      "색깔 벽돌로 이루어진 왕국이 무너졌어. 복구사 브릭, 흩어진 문양을 맞춰 폐허의 입구를 되살려 줘!",
  },
  gild: {
    id: "gild",
    name: "길드",
    role: "장인 조합장",
    img: "assets/characters/char-gild.png",
    fullImg: "assets/characters/char-gild-full.png?v=3",
    color: "#c4a05a",
    introLine: "장인답게 한 줄 한 줄, 정성껏 쌓는 거다. 손끝을 믿어!",
  },
  rift: {
    id: "rift",
    name: "리프트",
    role: "균열의 화신",
    img: "assets/characters/char-rift.png",
    fullImg: "assets/characters/char-rift-full.png?v=3",
    color: "#9b6bff",
    introLine: "히히… 금을 메울 수 있겠어? 난 또 갈라놓을 텐데~",
  },
  echo: {
    id: "echo",
    name: "에코",
    role: "왕국의 메아리",
    img: "assets/characters/char-echo.png",
    fullImg: "assets/characters/char-echo-full.png?v=3",
    color: "#7ec8ff",
    introLine: "기억해… 욕심의 문양이 왕국을 갈랐어. 균형으로 되살려 줘.",
  },
};

window.WORLD_IMAGES = {
  ruins: "assets/worlds/world-01-ruins-gate.png",
  alley: "assets/worlds/world-02-alley.png",
  plaza: "assets/worlds/world-03-plaza.png",
  bridge: "assets/worlds/world-05-bridge.png",
  fields: "assets/worlds/world-06-fields.png",
  castle: "assets/worlds/world-12-castle.png",
  canal: "assets/worlds/world-16-canal.png",
  rift: "assets/worlds/world-19-rift.png",
  mosaic: "assets/worlds/world-30-mosaic.png",
};

window.WORLD_META = [
  { title: "폐허의 입구", imageKey: "ruins", speaker: "mira" },
  { title: "먼지 골목", imageKey: "alley", speaker: "mira" },
  { title: "샘터 광장", imageKey: "plaza", speaker: "mira" },
  { title: "초가 지붕 거리", imageKey: "alley", speaker: "mira" },
  { title: "등불 다리", imageKey: "bridge", speaker: "mira" },
  { title: "밀밭 테라스", imageKey: "fields", speaker: "gild" },
  { title: "바람 풍차", imageKey: "fields", speaker: "gild" },
  { title: "점토 공방", imageKey: "alley", speaker: "gild" },
  { title: "숲 가장자리", imageKey: "fields", speaker: "gild" },
  { title: "감시 탑", imageKey: "ruins", speaker: "mira" },
  { title: "성문 앞 야영지", imageKey: "castle", speaker: "mira" },
  { title: "부서진 성벽", imageKey: "castle", speaker: "gild" },
  { title: "왕도 시장", imageKey: "plaza", speaker: "mira" },
  { title: "기록 보관소", imageKey: "canal", speaker: "echo" },
  { title: "왕궁 정원", imageKey: "plaza", speaker: "rift" },
  { title: "지하 수로", imageKey: "canal", speaker: "mira" },
  { title: "거울 회랑", imageKey: "canal", speaker: "echo" },
  { title: "잊힌 예배당", imageKey: "ruins", speaker: "echo" },
  { title: "균열 협곡", imageKey: "rift", speaker: "rift" },
  { title: "심연 제단", imageKey: "rift", speaker: "rift" },
  { title: "메아리 동굴", imageKey: "canal", speaker: "echo" },
  { title: "역행하는 시계탑", imageKey: "castle", speaker: "echo" },
  { title: "쌍둥이 성채", imageKey: "castle", speaker: "gild" },
  { title: "금빛 금고", imageKey: "plaza", speaker: "gild" },
  { title: "왕좌의 잔해", imageKey: "ruins", speaker: "brick" },
  { title: "새 정문", imageKey: "ruins", speaker: "mira" },
  { title: "시민 광장", imageKey: "plaza", speaker: "mira" },
  { title: "별빛 전망대", imageKey: "bridge", speaker: "echo" },
  { title: "리프트의 핵", imageKey: "rift", speaker: "rift" },
  { title: "원형 모자이크", imageKey: "mosaic", speaker: "brick" },
];

window.PIECE_DEFS = {
  mono: { id: "mono", color: "#e05a6d", shape: [[1]] },
  domino: { id: "domino", color: "#4aa3de", shape: [[1, 1]] },
  vDuo: {
    id: "vDuo",
    color: "#5b9bd5",
    shape: [[1], [1]],
  },
  tri: { id: "tri", color: "#5ecf8a", shape: [[1, 1, 1]] },
  tall3: {
    id: "tall3",
    color: "#4caf7a",
    shape: [[1], [1], [1]],
  },
  square: {
    id: "square",
    color: "#f0c14a",
    shape: [
      [1, 1],
      [1, 1],
    ],
  },
  corner: {
    id: "corner",
    color: "#d4a017",
    shape: [
      [1, 1],
      [1, 0],
    ],
  },
  l3: {
    id: "l3",
    color: "#ff7a59",
    shape: [
      [1, 0],
      [1, 0],
      [1, 1],
    ],
  },
  j3: {
    id: "j3",
    color: "#ff8f6b",
    shape: [
      [0, 1],
      [0, 1],
      [1, 1],
    ],
  },
  t4: {
    id: "t4",
    color: "#b07cff",
    shape: [
      [1, 1, 1],
      [0, 1, 0],
    ],
  },
  line4: { id: "line4", color: "#3dcdb8", shape: [[1, 1, 1, 1]] },
  line5: { id: "line5", color: "#2bbbad", shape: [[1, 1, 1, 1, 1]] },
  s3: {
    id: "s3",
    color: "#7ec8ff",
    shape: [
      [0, 1, 1],
      [1, 1, 0],
    ],
  },
  u4: {
    id: "u4",
    color: "#9b8cff",
    shape: [
      [1, 0, 1],
      [1, 1, 1],
    ],
  },
  plus: {
    id: "plus",
    color: "#ff9f43",
    shape: [
      [0, 1, 0],
      [1, 1, 1],
      [0, 1, 0],
    ],
  },
  bigL: {
    id: "bigL",
    color: "#e17055",
    shape: [
      [1, 0, 0],
      [1, 0, 0],
      [1, 1, 1],
    ],
  },
  bigT: {
    id: "bigT",
    color: "#c77dff",
    shape: [
      [1, 1, 1],
      [0, 1, 0],
      [0, 1, 0],
    ],
  },
  // easy extras (월드 1~3)
  rCorner: {
    id: "rCorner",
    color: "#e8b84a",
    shape: [
      [1, 1],
      [0, 1],
    ],
  },
  flatL: {
    id: "flatL",
    color: "#6ec6ff",
    shape: [
      [1, 1, 1],
      [1, 0, 0],
    ],
  },
  flatJ: {
    id: "flatJ",
    color: "#7ad4b0",
    shape: [
      [1, 1, 1],
      [0, 0, 1],
    ],
  },
  teeSmall: {
    id: "teeSmall",
    color: "#f4a261",
    shape: [
      [0, 1],
      [1, 1],
      [0, 1],
    ],
  },
  // hard extras (월드 4~)
  n5: {
    id: "n5",
    color: "#e76f51",
    shape: [
      [0, 1],
      [1, 1],
      [1, 0],
      [1, 0],
    ],
  },
  p5: {
    id: "p5",
    color: "#9b5de5",
    shape: [
      [1, 1],
      [1, 1],
      [1, 0],
    ],
  },
  f5: {
    id: "f5",
    color: "#00bbf9",
    shape: [
      [0, 1, 1],
      [1, 1, 0],
      [0, 1, 0],
    ],
  },
  w5: {
    id: "w5",
    color: "#f15bb5",
    shape: [
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 1],
    ],
  },
};

window.PIECE_POOLS = {
  easy: [
    "mono",
    "domino",
    "vDuo",
    "tri",
    "square",
    "l3",
    "corner",
    "rCorner",
    "flatL",
    "flatJ",
    "teeSmall",
  ],
  normal: [
    "domino",
    "tri",
    "tall3",
    "square",
    "l3",
    "j3",
    "t4",
    "line4",
    "s3",
    "corner",
    "n5",
    "p5",
    "f5",
    "w5",
  ],
  hard: [
    "l3",
    "j3",
    "t4",
    "line4",
    "line5",
    "s3",
    "square",
    "plus",
    "bigL",
    "u4",
    "n5",
    "p5",
    "f5",
    "w5",
  ],
  expert: [
    "t4",
    "line4",
    "line5",
    "s3",
    "plus",
    "bigL",
    "bigT",
    "u4",
    "l3",
    "j3",
    "n5",
    "p5",
    "f5",
    "w5",
  ],
};

window.STAGE_BEATS = [
  {
    title: "첫 발걸음",
    pre: "이곳부터 차근차근 되살려 보자.",
    clear: "좋은 시작이야!",
    obj: "hybrid",
    mult: 1.0,
  },
  {
    title: "금 메우기",
    pre: "갈라진 금을 벽돌로 메워 줘.",
    clear: "바닥이 단단해졌어.",
    obj: "lines",
    mult: 1.05,
  },
  {
    title: "문양 조각",
    pre: "흩어진 문양 조각을 맞춰 봐.",
    clear: "문양이 되살아난다.",
    obj: "hybrid",
    mult: 1.1,
  },
  {
    title: "기울어진 기둥",
    pre: "균형을 잡아야 기둥이 선다.",
    clear: "기둥이 숨을 고른다.",
    obj: "lines",
    mult: 1.15,
  },
  {
    title: "그림자 틈",
    pre: "그림자가 스쳤어… 서두르자.",
    clear: "그림자가 물러났다.",
    obj: "hybrid",
    mult: 1.2,
  },
  {
    title: "심화 복구",
    pre: "이제 본격적으로 손을 대자.",
    clear: "구역이 밝아졌어.",
    obj: "hybrid",
    mult: 1.25,
  },
  {
    title: "장인 손길",
    pre: "한 줄 한 줄, 정성껏.",
    clear: "장인답다!",
    obj: "lines",
    mult: 1.3,
  },
  {
    title: "고난의 문",
    pre: "문이 닫히려 해. 한 번에 맞춰!",
    clear: "문이 열렸다.",
    obj: "combo",
    mult: 1.35,
  },
  {
    title: "결의",
    pre: "거의 다 왔어. 집중해!",
    clear: "핵심이 보인다.",
    obj: "hybrid",
    mult: 1.4,
  },
  {
    title: "키 모자이크",
    pre: "이 구역의 핵심 문양이다!",
    clear: "키 모자이크가 빛난다. 다음 구역으로!",
    obj: "hybrid",
    mult: 1.5,
  },
];

/** @returns {object} */
window.getStage = function getStage(worldIndex, stageIndex) {
  const world = window.WORLD_META[worldIndex];
  const beat = window.STAGE_BEATS[stageIndex];
  const tier =
    worldIndex < 3 ? "easy" : worldIndex < 10 ? "normal" : worldIndex < 20 ? "hard" : "expert";
  const baseScore = 120 + worldIndex * 55 + stageIndex * 28;
  const baseLines = 2 + Math.floor(worldIndex / 5) + Math.floor(stageIndex / 3);
  const scoreTarget = Math.round(baseScore * beat.mult);
  const linesTarget = Math.max(2, Math.round(baseLines * (beat.obj === "lines" ? 1.1 : 0.9)));
  const rerolls = worldIndex < 5 ? 3 : worldIndex < 15 ? 2 : 1;
  const undos = worldIndex < 5 ? 2 : 1;

  let objective = { type: beat.obj, score: scoreTarget, lines: linesTarget, combo: 1 };
  // score-only → score + lines (hybrid)
  if (beat.obj === "score" || beat.obj === "hybrid") {
    objective = {
      type: "hybrid",
      score: Math.round(scoreTarget * (beat.obj === "score" ? 1 : 0.85)),
      lines: Math.max(2, beat.obj === "score" ? linesTarget : linesTarget - 1),
    };
  }
  if (beat.obj === "lines") objective = { type: "lines", lines: linesTarget };
  if (beat.obj === "combo") objective = { type: "combo", combo: Math.max(1, 1 + Math.floor(worldIndex / 10)) };

  const cracks = window.buildCracks(worldIndex, stageIndex, []);
  const riftObstacles = window.buildObstacles(
    worldIndex,
    stageIndex,
    cracks.map((p) => p.r + "," + p.c)
  );
  const sideMission = window.buildSideMission(worldIndex, stageIndex);
  const boardMods = window.buildBoardMods(
    worldIndex,
    stageIndex,
    cracks.map((p) => p.r + "," + p.c).concat(riftObstacles.map((p) => p.r + "," + p.c))
  );
  const speaker = window.CHARACTERS[world.speaker] || window.CHARACTERS.mira;
  const preBits = [];
  if (cracks.length > 0) preBits.push("금 간 벽돌 " + cracks.length + "칸이 있어. 줄로 지울 수 있어!");
  if (riftObstacles.length > 0) preBits.push("리프트의 균열(" + riftObstacles.length + ")이 줄을 막고 있어.");
  if (boardMods.relics?.length) preBits.push("유물 " + boardMods.relics.length + "칸을 줄로 되찾으면 보너스!");
  if (boardMods.livingRift) preBits.push("균열이 " + boardMods.livingRift.every + "수마다 퍼져.");
  if (boardMods.flow) preBits.push("물길이 " + boardMods.flow.every + "수마다 한 줄을 흘려보내.");
  if (boardMods.mirror) preBits.push("좌우가 같은 줄을 지우면 거울 보너스!");
  if (boardMods.moveLimit) preBits.push("남은 수 " + boardMods.moveLimit + " 안에 끝내야 해.");
  if (sideMission) preBits.push("미션: " + sideMission.label);
  const preExtra = preBits.length ? " " + preBits.join(" ") : "";
  const clearReaction =
    (window.CLEAR_REACTIONS[world.speaker] || window.CLEAR_REACTIONS.mira)[stageIndex % 3];
  return {
    worldIndex,
    stageIndex,
    id: "w" + worldIndex + "_s" + stageIndex,
    worldTitle: world.title,
    title: beat.title,
    speakerId: world.speaker,
    pre: speaker.name + ": " + beat.pre + preExtra,
    clear: beat.clear,
    clearReaction,
    fail: boardMods.moveLimit ? "시계가 되돌았어… 수 안에 맞추자." : "벽돌이 미끄러졌어… 다시 도전하자.",
    objective,
    obstacles: riftObstacles,
    cracks,
    sideMission,
    boardMods,
    fragmentReward: 1 + Math.floor(worldIndex / 5) + (stageIndex === 9 ? 2 : 0),
    pool: tier,
    rerolls,
    undos,
    stars: {
      two: Math.round(scoreTarget * 1.35),
      three: Math.round(scoreTarget * 1.7),
    },
  };
};

window.CLEAR_REACTIONS = {
  mira: [
    "잘했어! 문양이 한 조각 되살아났어.",
    "좋아, 이 페이스면 왕국도 곧이야!",
    "금이 메워지는 소리가 들려. 멋져!",
  ],
  brick: [
    "이 손맛… 복구사 각이다!",
    "한 칸 한 칸, 내가 되살린다.",
    "다음 구역도 맡겨 둬!",
  ],
  gild: [
    "허허, 장인답군. 정성이 보여.",
    "줄이 반듯해. 합격이다!",
    "도구를 믿게. 손은 정직하니까.",
  ],
  rift: [
    "칫… 이번엔 넘어가 주지.",
    "금을 메웠다고? 흥, 다시 갈라질걸.",
    "재미있네… 조금만요.",
  ],
  echo: [
    "기억의 조각이 돌아왔다…",
    "균형이 잠시 숨을 고른다.",
    "욕심의 문양이 물러가는군.",
  ],
};

window.buildSideMission = function buildSideMission(worldIndex, stageIndex) {
  // 초반 집중, 이후에도 가벼운 미션 유지
  const cycle = stageIndex % 4;
  const colors = [
    { color: "#e05a6d", name: "빨간" },
    { color: "#4aa3de", name: "파란" },
    { color: "#5ecf8a", name: "초록" },
    { color: "#f0c14a", name: "노란" },
  ];
  const pick = colors[(worldIndex + stageIndex) % colors.length];

  if (cycle === 0) {
    const need = worldIndex < 4 ? 3 : 5;
    return {
      type: "colorClear",
      color: pick.color,
      need,
      label: pick.name + " 벽돌 " + need + "칸 지우기",
    };
  }
  if (cycle === 1) {
    return { type: "doubleClear", need: 1, label: "한 번에 2줄 이상 클리어" };
  }
  if (cycle === 2) {
    return { type: "noReroll", label: "리롤 없이 클리어" };
  }
  return { type: "traySpare", maxLeft: 1, label: "트레이 조각 ≤1개로 클리어" };
};

window.buildCracks = function buildCracks(worldIndex, stageIndex, blocked) {
  let count = 0;
  if (worldIndex < 4) count = 1 + Math.floor(stageIndex / 4) + (worldIndex >= 2 ? 1 : 0); // W1~4: 1~3
  else if (worldIndex < 9) count = 1 + Math.floor(stageIndex / 5);
  else count = stageIndex % 3 === 0 ? 1 : 0; // later: occasional

  if (count <= 0) return [];
  const blockSet = new Set((blocked || []).map((p) => (typeof p === "string" ? p : p.r + "," + p.c)));
  return window.pickBoardCells(worldIndex, stageIndex, count, blockSet, 9973);
};

/** Fixed rift stones: count scales with world/stage. Cleared lines blocked (완전불가). */
window.buildObstacles = function buildObstacles(worldIndex, stageIndex, blockedKeys) {
  let count = 0;
  if (worldIndex < 4) count = 0;
  else if (worldIndex < 9) count = 2 + Math.floor(stageIndex / 5);
  else if (worldIndex < 19) count = Math.min(5, 2 + Math.floor(stageIndex / 3) + Math.floor((worldIndex - 9) / 4));
  else count = Math.min(6, 3 + Math.floor(stageIndex / 2));

  if (count <= 0) return [];
  const blockSet = new Set(blockedKeys || []);
  return window.pickBoardCells(worldIndex, stageIndex, count, blockSet, 104729);
};

window.pickBoardCells = function pickBoardCells(worldIndex, stageIndex, count, blockSet, salt) {
  const cells = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (blockSet.has(r + "," + c)) continue;
      if (worldIndex < 12 && ((r === 3 && c === 3) || (r === 4 && c === 4))) continue;
      cells.push({ r, c });
    }
  }
  let seed = (worldIndex + 1) * 7919 + (stageIndex + 1) * salt;
  function next() {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed;
  }
  for (let i = cells.length - 1; i > 0; i--) {
    const j = next() % (i + 1);
    const tmp = cells[i];
    cells[i] = cells[j];
    cells[j] = tmp;
  }
  const picked = [];
  const usedRows = {};
  const usedCols = {};
  for (const cell of cells) {
    if (picked.length >= count) break;
    if ((usedRows[cell.r] || 0) >= 2) continue;
    if ((usedCols[cell.c] || 0) >= 2) continue;
    picked.push(cell);
    usedRows[cell.r] = (usedRows[cell.r] || 0) + 1;
    usedCols[cell.c] = (usedCols[cell.c] || 0) + 1;
  }
  return picked;
};

window.buildBoardMods = function buildBoardMods(worldIndex, stageIndex, blockedKeys) {
  const blocked = new Set(blockedKeys || []);
  const mods = {
    resonance: true,
    hold: true,
    relics: [],
    livingRift: null,
    flow: null,
    mirror: false,
    moveLimit: null,
  };

  let relicCount = 0;
  if (worldIndex === 23) relicCount = 3;
  else if (worldIndex >= 15) relicCount = 2;
  else if (worldIndex >= 8) relicCount = 1;
  else if (worldIndex >= 1 && stageIndex % 2 === 1) relicCount = 1;
  if (relicCount > 0) {
    mods.relics = window.pickBoardCells(worldIndex, stageIndex, relicCount, blocked, 424243);
  }

  const skipLiving = worldIndex === 15 || worldIndex === 16 || worldIndex === 20 || worldIndex === 21;
  if (!skipLiving) {
    if (worldIndex === 18 || worldIndex === 19 || worldIndex === 28) {
      mods.livingRift = { every: 2 };
    } else if (worldIndex >= 9) {
      mods.livingRift = { every: 4 };
    } else if (worldIndex >= 4) {
      mods.livingRift = { every: 5 };
    }
  }

  if (worldIndex === 15 || worldIndex === 20) mods.flow = { every: 2 };
  if (worldIndex === 16 || worldIndex === 22) mods.mirror = true;
  if (worldIndex === 21) {
    const lines = 2 + Math.floor(worldIndex / 5) + Math.floor(stageIndex / 3);
    mods.moveLimit = 12 + lines * 2 + stageIndex;
  }
  return mods;
};

window.SHOP_ITEMS = [
  {
    id: "reroll",
    key: "extraRerolls",
    name: "리롤 +1",
    desc: "조각을 한 번 다시 뽑습니다.",
    price: 5,
  },
  {
    id: "undo",
    key: "extraUndos",
    name: "되돌리기 +1",
    desc: "바로 전 수를 취소합니다.",
    price: 4,
  },
  {
    id: "chisel",
    key: "riftHammers",
    name: "균열 끌 +1",
    desc: "균열 돌 하나를 제거합니다.",
    price: 8,
  },
];

window.getEndlessStage = function getEndlessStage() {
  const speaker = window.CHARACTERS.brick;
  const best = window.Save?.load?.()?.bestEndless || 0;
  return {
    worldIndex: -1,
    stageIndex: 0,
    id: "endless",
    endless: true,
    worldTitle: "끝없는 복구",
    title: "끝없는 복구",
    speakerId: "brick",
    pre: speaker.name + ": 문양이 이어지는 한, 손을 멈추지 마! 조각은 탭해서 회전할 수 있어.",
    clear: "",
    clearReaction: "여기까지가 이번 복구야.",
    fail: "길이 막혔어. 최고 기록에 다시 도전해 봐!",
    objective: { type: "endless" },
    obstacles: [],
    cracks: [],
    sideMission: null,
    boardMods: {
      resonance: true,
      hold: true,
      relics: [
        { r: 2, c: 2 },
        { r: 5, c: 5 },
      ],
      livingRift: { every: 4 },
      flow: null,
      mirror: false,
      moveLimit: null,
    },
    fragmentReward: 0,
    pool: "easy",
    rerolls: 3,
    undos: 2,
    stars: { two: 999999, three: 9999999 },
    bestEndless: best,
  };
};

