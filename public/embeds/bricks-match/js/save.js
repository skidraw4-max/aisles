(() => {
  const KEY = "bricks_match_save_v1";

  const EMPTY_INVENTORY = {
    extraRerolls: 0,
    extraUndos: 0,
    riftHammers: 0,
  };

  function defaultSave() {
    return {
      version: 1,
      unlockedWorld: 0,
      bestEndless: 0,
      mosaicShards: 0,
      worlds: {},
      inventory: Object.assign({}, EMPTY_INVENTORY),
    };
  }

  function normalize(data) {
    const next = Object.assign(defaultSave(), data || {});
    next.inventory = Object.assign({}, EMPTY_INVENTORY, data?.inventory || {});
    next.mosaicShards = Math.max(0, Number(next.mosaicShards) || 0);
    next.bestEndless = Math.max(0, Number(next.bestEndless) || 0);
    return next;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaultSave();
      const data = JSON.parse(raw);
      if (!data || data.version !== 1) return defaultSave();
      return normalize(data);
    } catch {
      return defaultSave();
    }
  }

  function save(data) {
    localStorage.setItem(KEY, JSON.stringify(normalize(data)));
    window.dispatchEvent(new CustomEvent("bricks-save"));
  }

  function notify() {
    window.dispatchEvent(new CustomEvent("bricks-save"));
  }

  function shopItem(id) {
    return (window.SHOP_ITEMS || []).find((item) => item.id === id) || null;
  }

  function inventoryCount(data, key) {
    return Math.max(0, Number((data.inventory || {})[key]) || 0);
  }

  function buyItem(data, itemId) {
    const item = shopItem(itemId);
    if (!item) return { ok: false, reason: "상품을 찾을 수 없어요." };
    const price = item.price;
    if ((data.mosaicShards || 0) < price) {
      return { ok: false, reason: "파편이 부족해요." };
    }
    data.mosaicShards -= price;
    data.inventory = Object.assign({}, EMPTY_INVENTORY, data.inventory);
    data.inventory[item.key] = inventoryCount(data, item.key) + 1;
    save(data);
    return { ok: true, item, shards: data.mosaicShards };
  }

  function useInventory(data, key) {
    const n = inventoryCount(data, key);
    if (n <= 0) return false;
    data.inventory = Object.assign({}, EMPTY_INVENTORY, data.inventory);
    data.inventory[key] = n - 1;
    save(data);
    return true;
  }

  function hasClearedAny(data) {
    return Object.values(data.worlds || {}).some((w) => (w.cleared || []).length > 0);
  }

  function recordEndless(data, score) {
    const prev = data.bestEndless || 0;
    const isNewBest = score > prev;
    data.bestEndless = Math.max(prev, score);
    const shards = score > 0 ? Math.min(10, Math.floor(score / 400)) : 0;
    if (shards > 0) data.mosaicShards = (data.mosaicShards || 0) + shards;
    save(data);
    return { best: data.bestEndless, shards, isNewBest, prev };
  }

  function worldProgress(data, worldIndex) {
    if (!data.worlds[worldIndex]) {
      data.worlds[worldIndex] = { cleared: [], stars: {}, bestScore: {} };
    }
    return data.worlds[worldIndex];
  }

  function isWorldUnlocked(data, worldIndex) {
    return worldIndex <= data.unlockedWorld;
  }

  function isStageUnlocked(data, worldIndex, stageIndex) {
    if (!isWorldUnlocked(data, worldIndex)) return false;
    if (stageIndex === 0) return true;
    const wp = worldProgress(data, worldIndex);
    return wp.cleared.includes(stageIndex - 1);
  }

  function clearStage(data, worldIndex, stageIndex, stars, score, fragments) {
    const wp = worldProgress(data, worldIndex);
    if (!wp.cleared.includes(stageIndex)) wp.cleared.push(stageIndex);
    wp.cleared.sort((a, b) => a - b);
    const prev = wp.stars[stageIndex] || 0;
    wp.stars[stageIndex] = Math.max(prev, stars);
    const prevBest = wp.bestScore[stageIndex] || 0;
    wp.bestScore[stageIndex] = Math.max(prevBest, score);
    if (fragments > 0) data.mosaicShards = (data.mosaicShards || 0) + fragments;

    if (stageIndex === 9 && worldIndex >= data.unlockedWorld && worldIndex < 29) {
      data.unlockedWorld = worldIndex + 1;
    }
    save(data);
    return data;
  }

  function starsFor(stage, score) {
    if (score >= stage.stars.three) return 3;
    if (score >= stage.stars.two) return 2;
    return 1;
  }

  function totalStars(data) {
    let n = 0;
    Object.values(data.worlds).forEach((w) => {
      Object.values(w.stars || {}).forEach((s) => {
        n += s;
      });
    });
    return n;
  }

  window.Save = {
    load,
    save,
    notify,
    worldProgress,
    isWorldUnlocked,
    isStageUnlocked,
    clearStage,
    starsFor,
    totalStars,
    defaultSave,
    buyItem,
    useInventory,
    inventoryCount,
    hasClearedAny,
    recordEndless,
  };
})();
