package com.aisleshub.app;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // WebView 콘텐츠가 상태표시줄 아래에서 시작하도록 (Android 15+ edge-to-edge 대응)
        WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
    }
}
