(() => {
  let pluginProxy = null;
  let lastResult = null;

  function plugin() {
    const Cap = window.Capacitor;
    if (!Cap?.isNativePlatform?.()) return null;
    if (pluginProxy) return pluginProxy;
    if (typeof Cap.registerPlugin === "function") {
      pluginProxy = Cap.registerPlugin("TnkAds");
      return pluginProxy;
    }
    pluginProxy = Cap.Plugins?.TnkAds || null;
    return pluginProxy;
  }

  function available() {
    const Cap = window.Capacitor;
    if (!Cap?.isNativePlatform?.()) return false;
    if (typeof Cap.isPluginAvailable === "function" && Cap.isPluginAvailable("TnkAds")) {
      return !!plugin();
    }
    return !!plugin();
  }

  function remember(kind, result) {
    lastResult = { kind, result, at: Date.now() };
    if (result?.error || result?.errorName) {
      console.warn("[TnkAds]", kind, result.errorName || "", result.error || result);
    } else {
      console.log("[TnkAds]", kind, result);
    }
    return result;
  }

  function humanError(result) {
    const name = result?.errorName || "";
    if (name === "FAIL_TEST_DEVICE_NOT_REGISTERED") {
      return "테스트 기기가 TNK에 등록되지 않았습니다. Publisher 콘솔에서 광고 ID를 등록해 주세요.";
    }
    if (name === "FAIL_AD_TYPE_INCORRECT" || name === "FAIL_INCORRECT_PLACEMENT") {
      return "Placement 유형이 맞지 않습니다. 콘솔에서 리워드/전면/배너 설정을 확인해 주세요.";
    }
    if (name === "FAIL_NO_AD") {
      return "받을 수 있는 광고가 없습니다(No Fill). 잠시 후 다시 시도해 주세요.";
    }
    if (name === "FAIL_NO_PLACEMENT_ID") {
      return "Placement 이름을 찾을 수 없습니다. 콘솔 Placement ID를 확인해 주세요.";
    }
    if (result?.unavailable) return "광고는 앱(Android)에서만 이용할 수 있어요.";
    if (result?.error) return "광고 오류: " + (result.errorName || result.error);
    return null;
  }

  async function showRewarded() {
    const p = plugin();
    if (!p) return remember("rewarded", { rewarded: false, unavailable: true });
    try {
      const result = await p.showRewarded({});
      return remember("rewarded", result || { rewarded: false });
    } catch (e) {
      return remember("rewarded", { rewarded: false, error: String(e), errorName: "JS_EXCEPTION" });
    }
  }

  async function showInterstitial() {
    const p = plugin();
    if (!p) return remember("interstitial", { shown: false, unavailable: true });
    try {
      const result = await p.showInterstitial({});
      return remember("interstitial", result || { shown: false });
    } catch (e) {
      return remember("interstitial", { shown: false, error: String(e), errorName: "JS_EXCEPTION" });
    }
  }

  async function showBanner() {
    const p = plugin();
    if (!p) return remember("banner", { ok: false, unavailable: true });
    try {
      const result = await p.showBanner({});
      return remember("banner", result || { ok: false });
    } catch (e) {
      return remember("banner", { ok: false, error: String(e), errorName: "JS_EXCEPTION" });
    }
  }

  async function hideBanner() {
    const p = plugin();
    if (!p) return { ok: false, unavailable: true };
    try {
      return await p.hideBanner({});
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  async function getDiagnostics() {
    const p = plugin();
    if (!p?.getDiagnostics) {
      return { ok: false, unavailable: !available(), lastResult };
    }
    try {
      const d = await p.getDiagnostics({});
      return { ...d, lastResult };
    } catch (e) {
      return { ok: false, error: String(e), lastResult };
    }
  }

  window.TnkAds = {
    available,
    showRewarded,
    showInterstitial,
    showBanner,
    hideBanner,
    getDiagnostics,
    humanError,
    getLastResult: () => lastResult,
  };
})();
