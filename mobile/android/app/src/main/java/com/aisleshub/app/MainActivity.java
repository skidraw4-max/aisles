package com.aisleshub.app;

import android.os.Bundle;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /** 시스템 내비게이션 바(멀티태스크·홈·뒤로) 영역 — 흰색 30% (alpha 77 ≈ 0.3×255) */
    private static final int NAV_BAR_COLOR = 0x4DFFFFFF;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AislesAdPlugin.class);
        super.onCreate(savedInstanceState);
        // Edge-to-edge: WebView 전체 화면 + CSS safe-area. decorFitsSystemWindows(true) 이면
        // AdMob 플러그인(API 35+)이 bottomInset 을 또 더해 하단 배너가 떠 보입니다.
        Window window = getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, false);
        window.setNavigationBarColor(NAV_BAR_COLOR);
        WindowInsetsControllerCompat insetsController = WindowCompat.getInsetsController(window, window.getDecorView());
        if (insetsController != null) {
            insetsController.setAppearanceLightNavigationBars(true);
        }
    }
}
