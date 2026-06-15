package com.aisleshub.app;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AislesAdPlugin.class);
        super.onCreate(savedInstanceState);
        // Edge-to-edge: WebView 전체 화면 + CSS safe-area. decorFitsSystemWindows(true) 이면
        // AdMob 플러그인(API 35+)이 bottomInset 을 또 더해 하단 배너가 떠 보입니다.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
    }
}
