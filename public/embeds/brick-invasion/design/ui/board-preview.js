(() => {
  const board = document.getElementById("board");
  if (!board) return;

  // 9x12 preview sector — walls carve a bounce tunnel
  const layout = [
    "#########",
    "#1122111#",
    "#1##11#1#",
    "#1221121#",
    "#1#111#1#",
    "#1133111#",
    "#1####1##",
    "#1112111#",
    "#12#11#1#",
    "#1111111#",
    "#..1.1..#",
    "#........",
  ];

  const src = {
    "#": "./sprites/wall.svg",
    "1": "./sprites/swarm-1.svg",
    "2": "./sprites/swarm-2.svg",
    "3": "./sprites/swarm-3.svg",
    "B": "./sprites/hive-node.svg",
  };

  const frag = document.createDocumentFragment();
  for (const row of layout) {
    for (const ch of row) {
      const cell = document.createElement("div");
      cell.className = "cell";
      if (src[ch]) {
        const img = document.createElement("img");
        img.src = src[ch];
        img.alt = "";
        cell.appendChild(img);
      }
      frag.appendChild(cell);
    }
  }
  board.appendChild(frag);
})();
