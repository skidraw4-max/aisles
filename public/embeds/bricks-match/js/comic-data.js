/* World-clear comic data */
window.COMIC_CHARS = {
  brick: { name: "브릭", img: "assets/characters/char-brick.png", color: "#e8a045" },
  mira: { name: "미라", img: "assets/characters/char-mira.png", color: "#3d8b7a" },
  gild: { name: "길드", img: "assets/characters/char-gild.png", color: "#c4a05a" },
  rift: { name: "리프트", img: "assets/characters/char-rift.png", color: "#9b6bff" },
  echo: { name: "에코", img: "assets/characters/char-echo.png", color: "#7ec8ff" },
  other: { name: "???", img: "", color: "#a09080" },
};

window.COMIC_BG = {
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

/** @type {Array<{world:number,title:string,bg:string,summarySpeaker:string,summary:string,panels:Array}>} */
window.WORLD_COMICS = [
  {
    world: 1,
    title: "폐허의 입구",
    bg: "ruins",
    summarySpeaker: "mira",
    summary: "입구가 열렸어. 이제 진짜 시작이야.",
    panels: [
      {
        scene: "금이 메워진 석문, 빛이 스며듦",
        caption: "무너졌던 입구가, 다시 열렸다.",
        lines: [{ speaker: "mira", text: "…열렸어. 진짜로 열렸어!" }],
      },
      {
        scene: "브릭이 먼지를 털며 문양을 쓰다듬음",
        caption: "",
        lines: [
          { speaker: "brick", text: "첫 문양, 맞춰졌어." },
          { speaker: "mira", text: "잘했어, 복구사. 여기는 시작일 뿐이야." },
        ],
      },
      {
        scene: "문 너머 먼지 골목의 희미한 불빛",
        caption: "",
        lines: [
          { speaker: "mira", text: "저 골목에도… 아직 사람들이 있을지도 몰라." },
          { speaker: "brick", text: "그럼 다음으로 가자." },
        ],
      },
    ],
  },
  {
    world: 2,
    title: "먼지 골목",
    bg: "alley",
    summarySpeaker: "brick",
    summary: "길이 이어지면, 사람도 이어져.",
    panels: [
      {
        scene: "맞춰진 벽돌 길, 쓰러진 간판이 바로 섬",
        caption: "먼지가 걷히자, 길이 숨을 쉬었다.",
        lines: [{ speaker: "mira", text: "간판 글자가 다시 보이네… 「환영」이었어." }],
      },
      {
        scene: "골목 끝 주민 실루엣이 조심스레 고개만 내밈",
        caption: "",
        lines: [
          { speaker: "other", text: "…누구냐.", name: "주민" },
          { speaker: "mira", text: "무섭게 굴지 마. 우린 고치러 온 거야." },
        ],
      },
      {
        scene: "브릭이 길을 가리키며 앞장섬",
        caption: "",
        lines: [
          { speaker: "brick", text: "길이 이어지면, 사람도 이어져." },
          { speaker: "mira", text: "샘터 광장으로 가자. 물이 필요해." },
        ],
      },
    ],
  },
  {
    world: 3,
    title: "샘터 광장",
    bg: "plaza",
    summarySpeaker: "mira",
    summary: "들어 봐… 샘이 다시 숨 쉬고 있어.",
    panels: [
      {
        scene: "마른 샘에 물이 차오르고 타일이 빛남",
        caption: "샘이 다시 노래를 시작했다.",
        lines: [{ speaker: "mira", text: "들어… 물소리야!" }],
      },
      {
        scene: "아이들이 뛰어가려다 멈춰 서서 샘을 바라봄",
        caption: "",
        lines: [
          { speaker: "other", text: "만져도… 돼?", name: "아이" },
          { speaker: "mira", text: "당연하지. 여긴 다시 모두의 광장이야." },
        ],
      },
      {
        scene: "브릭과 미라, 반짝이는 수면에 비친 얼굴",
        caption: "",
        lines: [
          { speaker: "brick", text: "광장이 숨 쉬기 시작했어." },
          { speaker: "mira", text: "그럼 지붕도, 거리도… 하나씩." },
        ],
      },
    ],
  },
  {
    world: 4,
    title: "초가 지붕 거리",
    bg: "alley",
    summarySpeaker: "brick",
    summary: "집이 따뜻해지면, 왕국도 따뜻해져.",
    panels: [
      {
        scene: "이어진 지붕 문양, 굴뚝에서 연기가 피어오름",
        caption: "생활의 연기가, 다시 하늘로 올랐다.",
        lines: [{ speaker: "mira", text: "연기…! 누가 밥을 짓는 거야." }],
      },
      {
        scene: "브릭이 손바닥의 먼지를 털며 작게 웃음",
        caption: "",
        lines: [
          { speaker: "brick", text: "집이 따뜻해지면, 왕국도 따뜻해져." },
          { speaker: "other", text: "고마워… 복구사.", name: "이웃" },
        ],
      },
      {
        scene: "골목 끝에 등불 다리의 실루엣",
        caption: "",
        lines: [
          { speaker: "mira", text: "저 다리만 이어지면, 들판까지 갈 수 있어." },
          { speaker: "brick", text: "등불을 켜자." },
        ],
      },
    ],
  },
  {
    world: 5,
    title: "등불 다리",
    bg: "bridge",
    summarySpeaker: "mira",
    summary: "다리가 이어졌어. 근데… 물에 뭔가 있었어.",
    panels: [
      {
        scene: "이어진 다리 위, 등불이 하나둘 켜짐",
        caption: "밤의 강 위에, 길이 놓였다.",
        lines: [{ speaker: "mira", text: "예뻐… 예전 축제 때 같네." }],
      },
      {
        scene: "브릭이 난간에 손을 얹음. 강물에 잠깐 일그러진 그림자",
        caption: "",
        lines: [
          { speaker: "brick", text: "…방금, 뭐가 지나간 것 같은데." },
          { speaker: "mira", text: "바람? …아니, 느낌이 이상해." },
        ],
      },
      {
        scene: "물결에 리프트의 눈만 잠깐 비침",
        caption: "",
        lines: [
          { speaker: "rift", text: "히히… 예쁘게 고치네~" },
          { speaker: "mira", text: "빨리 건너자. 들판이 기다려." },
        ],
      },
    ],
  },
  {
    world: 6,
    title: "밀밭 테라스",
    bg: "fields",
    summarySpeaker: "gild",
    summary: "손끝을 믿어. 장인답게 쌓는 거다.",
    panels: [
      {
        scene: "금빛 밀밭이 다시 물결침",
        caption: "테라스의 금빛이, 바람에 대답했다.",
        lines: [{ speaker: "gild", text: "허접하게 쌓은 줄은 금방 무너진다." }],
      },
      {
        scene: "길드가 브릭의 손을 툭 치며 지적",
        caption: "",
        lines: [
          { speaker: "gild", text: "손끝을 믿어. 장인답게." },
          { speaker: "brick", text: "…알겠어. 정성껏 맞출게." },
        ],
      },
      {
        scene: "미라가 밀이삭을 만지며 안도",
        caption: "",
        lines: [
          { speaker: "mira", text: "길드 님, 같이 가 줄래요?" },
          { speaker: "gild", text: "당연하지. 왕국이 내 공방이니까." },
        ],
      },
    ],
  },
  {
    world: 7,
    title: "바람 풍차",
    bg: "fields",
    summarySpeaker: "gild",
    summary: "풍차가 돌면, 일상도 돌아온다.",
    panels: [
      {
        scene: "풍차가 돌며 밀가루·색가루가 날림",
        caption: "날개가 돌자, 일상이 돌아왔다.",
        lines: [{ speaker: "gild", text: "들어 봐. 풍차 소리 = 밥 짓는 소리야." }],
      },
      {
        scene: "아이들이 가루를 맞으며 웃음",
        caption: "",
        lines: [
          { speaker: "mira", text: "이게… 복구의 진짜 맛이구나." },
          { speaker: "brick", text: "움직이는 문양은, 살아 있는 문양이야." },
        ],
      },
      {
        scene: "멀리 점토 공방의 굴뚝",
        caption: "",
        lines: [
          { speaker: "gild", text: "다음은 내 구역이다. 점토 공방." },
          { speaker: "gild", text: "가마가 식으면 왕국도 식어." },
        ],
      },
    ],
  },
  {
    world: 8,
    title: "점토 공방",
    bg: "alley",
    summarySpeaker: "brick",
    summary: "불꽃이 돌아오면, 손끝도 깨어나.",
    panels: [
      {
        scene: "깨졌던 가마가 다시 불을 품음",
        caption: "불꽃이 돌아오자, 손끝이 깨어났다.",
        lines: [{ speaker: "gild", text: "좋아… 온도가 맞는다." }],
      },
      {
        scene: "브릭이 장인들과 나란히 벽돌을 맞춤",
        caption: "",
        lines: [
          { speaker: "other", text: "복구사도 우리 편이구나.", name: "장인" },
          { speaker: "brick", text: "편이라기보다… 동료." },
        ],
      },
      {
        scene: "완성된 타일에 왕국 문양 일부가 드러남",
        caption: "",
        lines: [
          { speaker: "mira", text: "이 문양… 성 쪽에도 있었어." },
          { speaker: "gild", text: "숲을 지나면 감시 탑이 보일 거다." },
        ],
      },
    ],
  },
  {
    world: 9,
    title: "숲 가장자리",
    bg: "fields",
    summarySpeaker: "mira",
    summary: "숲이 길을 내줬어. 저 탑으로 가자.",
    panels: [
      {
        scene: "숲길 문양이 이어지며 햇살이 틈으로 들어옴",
        caption: "나무와 돌이, 다시 길을 기억했다.",
        lines: [{ speaker: "mira", text: "어두웠던 숲이… 길을 내주네." }],
      },
      {
        scene: "길드가 발밑의 균열을 발로 가림",
        caption: "",
        lines: [
          { speaker: "gild", text: "방심 마. 숲은 예쁜 척해도 금이 잘 가." },
          { speaker: "brick", text: "조심해서 맞출게." },
        ],
      },
      {
        scene: "나뭇가지 사이로 감시 탑의 붉은 불빛",
        caption: "",
        lines: [
          { speaker: "mira", text: "저거… 탑이야." },
          { speaker: "gild", text: "왕도를 내려다보는 눈. 올라가 보자." },
        ],
      },
    ],
  },
  {
    world: 10,
    title: "감시 탑",
    bg: "ruins",
    summarySpeaker: "mira",
    summary: "저 안에… 갈라진 왕좌가 보여.",
    panels: [
      {
        scene: "탑 계단의 문양이 복구되며 불이 위층으로 전달됨",
        caption: "감시의 눈이, 다시 열렸다.",
        lines: [{ speaker: "mira", text: "한 층씩… 숨 쉬듯이." }],
      },
      {
        scene: "꼭대기. 일행이 왕도 전체를 내려다봄",
        caption: "",
        lines: [
          { speaker: "brick", text: "…크다." },
          { speaker: "gild", text: "저게 우리가 되살릴 전부다." },
        ],
      },
      {
        scene: "성 중앙, 갈라진 왕좌의 실루엣",
        caption: "",
        lines: [
          { speaker: "mira", text: "저 안… 갈라진 왕좌가 있어." },
          { speaker: "echo", text: "기억해…" },
        ],
      },
      {
        scene: "탑 난간에 작은 금 조각이 스침",
        caption: "",
        lines: [
          { speaker: "mira", text: "성문 앞에서 쉬었다가 들어가자." },
          { speaker: "brick", text: "응. 준비할 시간이야." },
        ],
      },
    ],
  },
  {
    world: 11,
    title: "성문 앞 야영지",
    bg: "castle",
    summarySpeaker: "brick",
    summary: "무서우면, 손부터 움직이면 돼.",
    panels: [
      {
        scene: "모닥불 주위. 복구사·장인들이 텐트를 침",
        caption: "성 앞에서, 결의의 밤이 밝혔다.",
        lines: [{ speaker: "mira", text: "내일은… 진짜 왕도야." }],
      },
      {
        scene: "브릭이 모닥불에 손을 녹이며",
        caption: "",
        lines: [
          { speaker: "brick", text: "무서우면, 손부터 움직이면 돼." },
          { speaker: "gild", text: "맞는 말이다. 말보다 줄." },
        ],
      },
      {
        scene: "성문이 살짝 열린 틈으로 빛이 샘",
        caption: "",
        lines: [
          { speaker: "mira", text: "문이… 우릴 기다리는 것 같아." },
          { speaker: "brick", text: "그럼 열자." },
        ],
      },
    ],
  },
  {
    world: 12,
    title: "부서진 성벽",
    bg: "castle",
    summarySpeaker: "gild",
    summary: "문장은 일어섰다. 중앙의 금만 남았어.",
    panels: [
      {
        scene: "성벽 벽돌이 맞춰지며 왕국 문장이 일부 복원됨",
        caption: "성벽이 일어서자, 문장이 숨을 골랐다.",
        lines: [{ speaker: "gild", text: "좌우 대칭… 좋아. 균형이 맞는다." }],
      },
      {
        scene: "문장 중앙에만 남는 금 간 자국",
        caption: "",
        lines: [
          { speaker: "mira", text: "왜 여기만… 안 메워지지?" },
          { speaker: "brick", text: "누군가, 일부러 가른 자국이야." },
        ],
      },
      {
        scene: "성벽 너머 시장 소음이 희미하게",
        caption: "",
        lines: [
          { speaker: "gild", text: "시장부터 살리면, 성도 살아난다." },
          { speaker: "mira", text: "왕도 시장으로!" },
        ],
      },
    ],
  },
  {
    world: 13,
    title: "왕도 시장",
    bg: "plaza",
    summarySpeaker: "mira",
    summary: "저울이 한쪽으로만 기울어… 욕심의 흔적이야.",
    panels: [
      {
        scene: "좌판이 다시 열리고 사람들이 오감",
        caption: "흥정이 돌아오자, 왕도가 떠들썩해졌다.",
        lines: [{ speaker: "other", text: "사과 하나— 아니, 둘이요!", name: "상인" }],
      },
      {
        scene: "브릭이 기이하게 한쪽으로만 기운 저울을 발견",
        caption: "",
        lines: [
          { speaker: "brick", text: "저울이… 이상해. 한쪽으로만 기울어." },
          { speaker: "mira", text: "욕심이… 아직도 남아 있는 건가." },
        ],
      },
      {
        scene: "시장 골목 끝, 기록 보관소 이정표",
        caption: "",
        lines: [
          { speaker: "mira", text: "답을 찾으려면 기록이 필요해." },
          { speaker: "brick", text: "보관소로 가자." },
        ],
      },
    ],
  },
  {
    world: 14,
    title: "기록 보관소",
    bg: "canal",
    summarySpeaker: "echo",
    summary: "욕심의 문양이 왕국을 갈랐어. 기억해.",
    panels: [
      {
        scene: "먼지를 턴 두루마리, 창으로 푸른 빛",
        caption: "잠자던 기록이, 이름을 불렀다.",
        lines: [{ speaker: "echo", text: "……기억해." }],
      },
      {
        scene: "에코가 나타남. 두루마리에 「욕심의 문양」",
        caption: "",
        lines: [
          { speaker: "echo", text: "왕국을 가른 건, 외부의 적만이 아니야." },
          { speaker: "mira", text: "…욕심?" },
        ],
      },
      {
        scene: "에코가 브릭을 바라봄",
        caption: "",
        lines: [
          { speaker: "echo", text: "황금을 독점하려던 문양. 그것이 금을 불렀어." },
          { speaker: "brick", text: "그럼 균형으로 되살리라는 거지." },
          { speaker: "echo", text: "맞아. 정원에서… 그것이 웃고 있을 거야." },
        ],
      },
    ],
  },
  {
    world: 15,
    title: "왕궁 정원",
    bg: "plaza",
    summarySpeaker: "rift",
    summary: "히히~ 예쁘게 고쳐봤자, 난 또 갈라놓을 텐데.",
    panels: [
      {
        scene: "시든 정원이 꽃 문양으로 되살아남",
        caption: "꽃이 피자, 균열도 피었다.",
        lines: [{ speaker: "mira", text: "향기다…! 왕궁 냄새야." }],
      },
      {
        scene: "브릭이 꽃밭 한가운데 금이 가는 소리를 들음",
        caption: "",
        lines: [
          { speaker: "brick", text: "잠깐—" },
          { speaker: "rift", text: "히히~ 예쁘게 고쳐봤자~" },
        ],
      },
      {
        scene: "리프트가 꽃을 금으로 갈라놓음",
        caption: "",
        lines: [
          { speaker: "rift", text: "난 또 갈라놓을 텐데?" },
          { speaker: "gild", text: "이 녀석…!" },
        ],
      },
      {
        scene: "미라가 브릭 앞에 섬",
        caption: "",
        lines: [
          { speaker: "mira", text: "무서워도 멈춰지진 않아." },
          { speaker: "brick", text: "금을 메울게. 몇 번이든." },
        ],
      },
      {
        scene: "리프트가 수로 쪽으로 사라지며",
        caption: "",
        lines: [
          { speaker: "rift", text: "그럼 아래에서 놀자~ 지하 수로에서!" },
          { speaker: "echo", text: "…따라가. 그러나 잊지 마. 균형." },
        ],
      },
    ],
  },
  {
    world: 16,
    title: "지하 수로",
    bg: "canal",
    summarySpeaker: "brick",
    summary: "빛은 여기 있어. 우리 손에.",
    panels: [
      {
        scene: "검은 금빛 균열이 물길을 타고 흐름",
        caption: "물의 길이, 균열의 길이 되었다.",
        lines: [{ speaker: "mira", text: "어두워… 근데 금이 빛나." }],
      },
      {
        scene: "브릭이 모자이크 조각으로 길을 비춤",
        caption: "",
        lines: [
          { speaker: "brick", text: "빛은 여기 있어. 우리 손에." },
          { speaker: "gild", text: "발 밑 조심해. 한 칸만 틀려도 무너진다." },
        ],
      },
      {
        scene: "수로 끝에 거울처럼 반짝이는 문",
        caption: "",
        lines: [
          { speaker: "echo", text: "거울 회랑… 자신을 마주하는 곳." },
          { speaker: "rift", text: "욕심~ 욕심~" },
        ],
      },
    ],
  },
  {
    world: 17,
    title: "거울 회랑",
    bg: "canal",
    summarySpeaker: "brick",
    summary: "나는 고치는 사람이야. 빼앗는 사람이 아니라.",
    panels: [
      {
        scene: "끝없이 이어진 거울 복도",
        caption: "비친 얼굴이, 질문이 되었다.",
        lines: [{ speaker: "mira", text: "브릭… 너, 거울 속이 이상해." }],
      },
      {
        scene: "거울 속 브릭이 황금에 물든 눈빛",
        caption: "",
        lines: [
          { speaker: "other", text: "더 가져. 더 쌓아. 네가 왕이 돼.", name: "거울 브릭" },
          { speaker: "brick", text: "…나는, 그거 아니야." },
        ],
      },
      {
        scene: "에코가 브릭 어깨에 손",
        caption: "",
        lines: [
          { speaker: "echo", text: "균형은 거절에서 시작해." },
          { speaker: "brick", text: "나는 고치는 사람이야. 빼앗는 사람이 아니라." },
        ],
      },
    ],
  },
  {
    world: 18,
    title: "잊힌 예배당",
    bg: "ruins",
    summarySpeaker: "echo",
    summary: "원래 왕국은 원을 믿었어.",
    panels: [
      {
        scene: "먼지에 덮인 원형 바닥 문양",
        caption: "잊힌 기도가, 원의 형태로 남아 있었다.",
        lines: [{ speaker: "echo", text: "원래 왕국은… 원을 믿었어." }],
      },
      {
        scene: "일행이 원을 따라 문양을 맞춤",
        caption: "",
        lines: [
          { speaker: "mira", text: "모서리가 아니라… 이어지는 원." },
          { speaker: "gild", text: "시작과 끝이 같은 자리. 완벽한 균형이지." },
        ],
      },
      {
        scene: "원의 중심에 작은 빛, 멀리 협곡의 울림",
        caption: "",
        lines: [
          { speaker: "echo", text: "저 너머가 균열 협곡. 그의 본거지." },
          { speaker: "brick", text: "…만나러 가자." },
        ],
      },
    ],
  },
  {
    world: 19,
    title: "균열 협곡",
    bg: "rift",
    summarySpeaker: "brick",
    summary: "메워도 네가 싫어해도… 나는 메울게.",
    panels: [
      {
        scene: "땅이 웃는 듯 벌어진 협곡, 보라빛 안개",
        caption: "갈라진 대지가, 이름을 드러냈다.",
        lines: [{ speaker: "rift", text: "어서 와~ 내 정원이야!" }],
      },
      {
        scene: "브릭 일행이 절벽 문양을 맞춤",
        caption: "",
        lines: [
          { speaker: "mira", text: "발 디딜 곳부터 만들자!" },
          { speaker: "gild", text: "한 줄만 틀려도 추락이다. 집중!" },
        ],
      },
      {
        scene: "리프트가 허공에서 금을 키움",
        caption: "",
        lines: [
          { speaker: "rift", text: "메우면 내가 약해져. 그게 싫거든." },
          { speaker: "brick", text: "그래도— 메울게." },
        ],
      },
      {
        scene: "협곡 깊은 곳에 심연 제단의 빛",
        caption: "",
        lines: [
          { speaker: "rift", text: "그럼 제단에서 제대로 놀아보자~" },
          { speaker: "echo", text: "두려워도, 원은 아직 깨지지 않았어." },
        ],
      },
    ],
  },
  {
    world: 20,
    title: "심연 제단",
    bg: "rift",
    summarySpeaker: "rift",
    summary: "메우면 내가 사라져. 그게 싫거든.",
    panels: [
      {
        scene: "제단 위, 리프트가 금의 왕좌에 앉음",
        caption: "심연이 물었다. 메울 것이냐, 함께 갈라질 것이냐.",
        lines: [{ speaker: "rift", text: "메우면 내가 사라져. 그게 싫거든." }],
      },
      {
        scene: "브릭이 제단 문양에 손을 올림",
        caption: "",
        lines: [
          { speaker: "brick", text: "네가 사라져도… 나는 멈출 수 없어." },
          { speaker: "mira", text: "혼자가 아니야, 브릭!" },
        ],
      },
      {
        scene: "제단의 금이 일부 메워지며 리프트가 눈살을 찌푸림",
        caption: "",
        lines: [
          { speaker: "rift", text: "…칫. 동굴에서 네 ‘기억’이나 실컷 들어. 에코~" },
          { speaker: "echo", text: "따라와. 진실을 보여 줄게." },
        ],
      },
    ],
  },
  {
    world: 21,
    title: "메아리 동굴",
    bg: "canal",
    summarySpeaker: "echo",
    summary: "황금을 독점하려던 날, 원이 잘렸어.",
    panels: [
      {
        scene: "동굴 벽에 과거 왕국의 환영이 흐름",
        caption: "메아리는 과거를, 숨기지 않았다.",
        lines: [{ speaker: "echo", text: "봐. 그날의 왕을." }],
      },
      {
        scene: "회상: 왕이 황금 문양을 독점하려 손을 뻗음",
        caption: "",
        lines: [
          { speaker: "other", text: "이 빛은… 나만의 것이야!", name: "왕" },
          { speaker: "echo", text: "욕심이 원을 직선으로 잘랐어." },
        ],
      },
      {
        scene: "브릭이 주먹을 꽉 쥠",
        caption: "",
        lines: [
          { speaker: "brick", text: "…같은 실수를 반복하지 않을게." },
          { speaker: "mira", text: "시계탑이 보이네. 시간이… 이상해." },
        ],
      },
    ],
  },
  {
    world: 22,
    title: "역행하는 시계탑",
    bg: "castle",
    summarySpeaker: "echo",
    summary: "아직 되돌릴 수 있어. ‘지금’이 있으니까.",
    panels: [
      {
        scene: "시계 바늘이 거꾸로 돌며 붕괴 직전 왕국이 보임",
        caption: "시간이 되감겼다. 무너지기 직전의 왕국으로.",
        lines: [{ speaker: "mira", text: "저게… 예전 우리 왕국?" }],
      },
      {
        scene: "에코가 탑 중앙의 균열을 가리킴",
        caption: "",
        lines: [
          { speaker: "echo", text: "아직 되돌릴 수 있어. ‘지금’이 있으니까." },
          { speaker: "gild", text: "말은 거창해도, 줄은 정직하다. 맞춰!" },
        ],
      },
      {
        scene: "바늘이 멈추고, 쌍둥이 성채 방향이 밝아짐",
        caption: "",
        lines: [
          { speaker: "brick", text: "다음은?" },
          { speaker: "echo", text: "균형을 기술로 증명할 곳. 쌍둥이 성채." },
        ],
      },
    ],
  },
  {
    world: 23,
    title: "쌍둥이 성채",
    bg: "castle",
    summarySpeaker: "gild",
    summary: "균형은 기술이다. 좌우를 맞춰.",
    panels: [
      {
        scene: "좌·우 성채가 대칭으로 복구됨",
        caption: "둘이 하나를 이루자, 그림자가 짧아졌다.",
        lines: [{ speaker: "gild", text: "왼쪽 한 칸 = 오른쪽 한 칸. 이게 균형이다." }],
      },
      {
        scene: "브릭이 양손을 펼쳐 성채를 가늠함",
        caption: "",
        lines: [
          { speaker: "brick", text: "기술로도… 마음으로도." },
          { speaker: "mira", text: "둘 다 브릭답다." },
        ],
      },
      {
        scene: "성채 사이 통로에 금빛 금고의 문",
        caption: "",
        lines: [
          { speaker: "gild", text: "욕심이 잠든 창고다. 조심해." },
          { speaker: "echo", text: "황금을 부수지 마. 바꿔." },
        ],
      },
    ],
  },
  {
    world: 24,
    title: "금빛 금고",
    bg: "plaza",
    summarySpeaker: "brick",
    summary: "욕심의 금은 쌓는 게 아니야. 바꾸는 거야.",
    panels: [
      {
        scene: "눈부신 황금 벽돌 더미",
        caption: "빛나는 것일수록, 기울이기 쉽다.",
        lines: [{ speaker: "rift", text: "가져가~ 가져가~" }],
      },
      {
        scene: "브릭이 황금을 만지자 투명한 균형의 벽돌로 변함",
        caption: "",
        lines: [
          { speaker: "brick", text: "욕심의 금은… 쌓는 게 아니야." },
          { speaker: "mira", text: "나누는 빛으로 바꾸는 거지!" },
        ],
      },
      {
        scene: "금고 문이 왕좌의 잔해로 이어짐",
        caption: "",
        lines: [
          { speaker: "echo", text: "왕좌가 비어 있어. 누가 앉을지가 아니라—" },
          { speaker: "echo", text: "무엇을 고칠지야." },
        ],
      },
    ],
  },
  {
    world: 25,
    title: "왕좌의 잔해",
    bg: "ruins",
    summarySpeaker: "brick",
    summary: "왕은 내가 아니야. 왕국이지.",
    panels: [
      {
        scene: "부서진 왕좌, 주변만 문양이 복구됨",
        caption: "왕좌는 비어 있었고, 왕국은 기다리고 있었다.",
        lines: [{ speaker: "mira", text: "…앉을 거야?" }],
      },
      {
        scene: "브릭이 왕좌를 지나쳐 바닥 문양을 고침",
        caption: "",
        lines: [
          { speaker: "brick", text: "왕은 내가 아니야." },
          { speaker: "brick", text: "왕국이지." },
        ],
      },
      {
        scene: "왕좌 뒤에서 새 정문으로 이어지는 빛이 열림",
        caption: "",
        lines: [
          { speaker: "gild", text: "잘 말했다." },
          { speaker: "echo", text: "문이 열린다. 사람들이 돌아올 차례야." },
        ],
      },
    ],
  },
  {
    world: 26,
    title: "새 정문",
    bg: "ruins",
    summarySpeaker: "mira",
    summary: "문이 열렸어… 사람들이 돌아오고 있어!",
    panels: [
      {
        scene: "웅장하게 다시 선 정문, 햇살",
        caption: "문이 열리자, 발소리가 돌아왔다.",
        lines: [{ speaker: "other", text: "돌아왔어…! 정말 돌아왔어!", name: "주민들" }],
      },
      {
        scene: "미라가 울먹이며 웃음, 브릭 손을 잡음",
        caption: "",
        lines: [
          { speaker: "mira", text: "브릭… 우리가 해냈어." },
          { speaker: "brick", text: "아직이야. 그래도… 여기까지는." },
        ],
      },
      {
        scene: "환호 너머, 하늘에 얇은 균열 그림자",
        caption: "",
        lines: [
          { speaker: "echo", text: "기뻐도 돼. 그러나 핵은 아직 남아 있어." },
          { speaker: "gild", text: "축제는 짧게. 일은 정확히." },
        ],
      },
    ],
  },
  {
    world: 27,
    title: "시민 광장",
    bg: "plaza",
    summarySpeaker: "mira",
    summary: "오늘만큼은 웃자. 그래도 하늘은 아직 갈라져 있어.",
    panels: [
      {
        scene: "축제 조명, 춤, 되살아난 분수",
        caption: "광장이 웃자, 왕국도 웃었다.",
        lines: [{ speaker: "mira", text: "오늘만큼은… 웃자!" }],
      },
      {
        scene: "브릭이 아이들을 어깨에 태워 줌",
        caption: "",
        lines: [
          { speaker: "other", text: "복구사 님! 또 고쳐 줘요!", name: "아이" },
          { speaker: "brick", text: "…응. 약속할게." },
        ],
      },
      {
        scene: "하늘 한가운데 리프트 핵의 보랏빛 점",
        caption: "",
        lines: [
          { speaker: "rift", text: "축제는 좋아~ 근데 엔딩은 나랑이야." },
          { speaker: "echo", text: "별빛 전망대로. 길이 보일 거다." },
        ],
      },
    ],
  },
  {
    world: 28,
    title: "별빛 전망대",
    bg: "bridge",
    summarySpeaker: "echo",
    summary: "별이 길을 그린다. 핵을 향해.",
    panels: [
      {
        scene: "밤하늘 별이 모자이크처럼 이어짐",
        caption: "별이 길을 그렸다. 핵을 향하는 선을.",
        lines: [{ speaker: "echo", text: "저 별자리를 따라가." }],
      },
      {
        scene: "미라가 손을 모아 멀리 바라봄",
        caption: "",
        lines: [
          { speaker: "mira", text: "보여… 리프트의 핵." },
          { speaker: "gild", text: "준비는 끝났다. 숨만 고르자." },
        ],
      },
      {
        scene: "브릭이 별을 보며 고개를 끄덕임",
        caption: "",
        lines: [
          { speaker: "brick", text: "같이 가자." },
          { speaker: "mira", text: "응!" },
        ],
      },
    ],
  },
  {
    world: 29,
    title: "리프트의 핵",
    bg: "rift",
    summarySpeaker: "rift",
    summary: "……싫어. 근데… 예쁘네.",
    panels: [
      {
        scene: "보랏빛 핵, 사방으로 금이 뻗음",
        caption: "모든 균열의 중심에서, 마지막 줄이 기다렸다.",
        lines: [{ speaker: "rift", text: "환영해~ 내 심장이야!" }],
      },
      {
        scene: "리프트가 최후의 균열을 키움",
        caption: "",
        lines: [
          { speaker: "rift", text: "메우면 아파. 정말 할 거야?" },
          { speaker: "brick", text: "할 거야." },
        ],
      },
      {
        scene: "브릭·미라·길드·에코가 사방에서 줄을 맞춤",
        caption: "",
        lines: [
          { speaker: "mira", text: "왼쪽!" },
          { speaker: "gild", text: "오른쪽 맞춰!" },
          { speaker: "echo", text: "원의 중심으로!" },
        ],
      },
      {
        scene: "핵의 금이 메워지며 리프트가 작아짐",
        caption: "",
        lines: [
          { speaker: "rift", text: "……싫어." },
          { speaker: "rift", text: "근데… 예쁘네." },
        ],
      },
      {
        scene: "핵이 고요한 구슬처럼 남고, 원형 모자이크로 가는 문",
        caption: "",
        lines: [
          { speaker: "mira", text: "…끝이야?" },
          { speaker: "echo", text: "마지막 문양. 원형 모자이크." },
          { speaker: "brick", text: "가자. 원을 완성하자." },
        ],
      },
    ],
  },
  {
    world: 30,
    title: "원형 모자이크",
    bg: "mosaic",
    summarySpeaker: "echo",
    summary: "욕심은 사라지지 않아. 다만 균형 안에 둘 수 있어.",
    panels: [
      {
        scene: "왕국 전체가 하나의 거대한 원형 문양으로 빛남",
        caption: "흩어졌던 모든 조각이, 하나의 원이 되었다.",
        lines: [{ speaker: "mira", text: "아름다워… 이게 우리 왕국이었어." }],
      },
      {
        scene: "브릭이 마지막 한 칸을 맞춤",
        caption: "",
        lines: [
          { speaker: "brick", text: "완료." },
          { speaker: "gild", text: "…장인이다, 너." },
        ],
      },
      {
        scene: "작은 금 조각(리프트)이 원의 테두리에 얌전히 남음",
        caption: "",
        lines: [
          { speaker: "rift", text: "…나는, 경계로 남을게." },
          { speaker: "rift", text: "욕심이 다시 넘치면… 그때 갈라져 경고할게." },
        ],
      },
      {
        scene: "에코가 일행을 바라봄",
        caption: "",
        lines: [
          { speaker: "echo", text: "욕심은 사라지지 않아." },
          { speaker: "echo", text: "다만— 균형 안에 둘 수 있어." },
        ],
      },
      {
        scene: "브릭과 미라가 나란히 완성된 왕국을 바라봄",
        caption: "— 무너진 모자이크는, 다시 이어졌다. —",
        lines: [
          { speaker: "mira", text: "브릭, 다음에 금이 가도…" },
          { speaker: "brick", text: "그때도 맞춰." },
        ],
      },
    ],
  },
];
