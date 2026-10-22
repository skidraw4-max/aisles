package com.aisleshub.app;

import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.FrameLayout;
import androidx.coordinatorlayout.widget.CoordinatorLayout;
import com.getcapacitor.Bridge;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.ads.AdError;
import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.AdSize;
import com.google.android.gms.ads.AdView;
import com.google.android.gms.ads.FullScreenContentCallback;
import com.google.android.gms.ads.LoadAdError;
import com.google.android.gms.ads.appopen.AppOpenAd;

/**
 * In-feed MREC at exact WebView coordinates (dp). The community AdMob plugin only supports
 * TOP_CENTER / BOTTOM_CENTER + margin and does not reliably position MEDIUM_RECTANGLE in feed slots.
 */
@CapacitorPlugin(name = "AislesAd")
public class AislesAdPlugin extends Plugin {

    private static final String TAG = "AislesAd";
    private static final String TEST_BANNER_ID = "ca-app-pub-3940256099942544/6300978111";
    private static final String TEST_APP_OPEN_ID = "ca-app-pub-3940256099942544/3419835294";

    private AdView adView;
    private FrameLayout mrecContainer;
    private AppOpenAd appOpenAd;
    private boolean isLoadingAppOpen;
    private ViewGroup rootViewGroup;
    private String loadedUnitId;

    private ViewGroup getRootViewGroup() {
        if (rootViewGroup == null) {
            WebView webView = getWebView();
            if (webView != null && webView.getParent() instanceof ViewGroup) {
                rootViewGroup = (ViewGroup) webView.getParent();
            }
        }
        if (rootViewGroup == null && getActivity() != null) {
            View content = getActivity().findViewById(android.R.id.content);
            if (content instanceof ViewGroup contentGroup && contentGroup.getChildCount() > 0) {
                rootViewGroup = (ViewGroup) contentGroup.getChildAt(0);
            }
        }
        return rootViewGroup;
    }

    private WebView getWebView() {
        Bridge bridge = getBridge();
        return bridge != null ? bridge.getWebView() : null;
    }

    @PluginMethod
    public void showMrecAtRect(PluginCall call) {
        if (getActivity() == null) {
            call.reject("Activity not available");
            return;
        }

        final int topDp = call.getInt("top", 0);
        final int leftDp = call.getInt("left", 0);
        final int widthDp = call.getInt("width", 300);
        final int heightDp = call.getInt("height", 250);
        final String adId = call.getString("adId", TEST_BANNER_ID);
        final boolean isTesting = call.getBoolean("isTesting", false);
        final String unitId = isTesting ? TEST_BANNER_ID : adId;

        getActivity().runOnUiThread(() -> {
            try {
                ViewGroup root = getRootViewGroup();
                if (root == null) {
                    call.reject("Root view not available");
                    return;
                }

                float density = getContext().getResources().getDisplayMetrics().density;
                WebView webView = getWebView();
                int webViewTop = webView != null ? webView.getTop() : 0;
                int webViewLeft = webView != null ? webView.getLeft() : 0;
                int topPx = webViewTop + Math.round(topDp * density);
                int leftPx = webViewLeft + Math.round(leftDp * density);
                int containerWidthPx = Math.round(widthDp * density);
                int containerHeightPx = Math.round(heightDp * density);

                AdSize mrecSize = AdSize.MEDIUM_RECTANGLE;
                int mrecWidthPx = Math.round(mrecSize.getWidthInPixels(getContext()));
                int mrecHeightPx = Math.round(mrecSize.getHeightInPixels(getContext()));

                if (root instanceof ViewGroup) {
                    ((ViewGroup) root).setClipChildren(false);
                    ((ViewGroup) root).setClipToPadding(false);
                }

                if (mrecContainer == null) {
                    mrecContainer = new FrameLayout(getContext());
                    mrecContainer.setElevation(24f);
                    adView = new AdView(getContext());
                    adView.setAdSize(mrecSize);
                    adView.setAdUnitId(unitId);
                    loadedUnitId = unitId;

                    FrameLayout.LayoutParams adParams = new FrameLayout.LayoutParams(
                        mrecWidthPx,
                        mrecHeightPx,
                        Gravity.CENTER
                    );
                    mrecContainer.addView(adView, adParams);

                    CoordinatorLayout.LayoutParams params = new CoordinatorLayout.LayoutParams(
                        containerWidthPx,
                        containerHeightPx
                    );
                    params.gravity = Gravity.TOP | Gravity.START;
                    params.setMargins(leftPx, topPx, 0, 0);
                    root.addView(mrecContainer, params);
                    root.bringChildToFront(mrecContainer);
                    adView.loadAd(new AdRequest.Builder().build());
                } else {
                    CoordinatorLayout.LayoutParams params = (CoordinatorLayout.LayoutParams) mrecContainer.getLayoutParams();
                    params.width = containerWidthPx;
                    params.height = containerHeightPx;
                    params.gravity = Gravity.TOP | Gravity.START;
                    params.setMargins(leftPx, topPx, 0, 0);
                    mrecContainer.setLayoutParams(params);
                    mrecContainer.requestLayout();
                    mrecContainer.setVisibility(View.VISIBLE);
                    root.bringChildToFront(mrecContainer);

                    if (!unitId.equals(loadedUnitId)) {
                        adView.setAdUnitId(unitId);
                        loadedUnitId = unitId;
                        adView.loadAd(new AdRequest.Builder().build());
                    }
                }

                adView.setScaleX(1f);
                adView.setScaleY(1f);
                adView.setVisibility(View.VISIBLE);
                adView.resume();
                call.resolve();
            } catch (Exception ex) {
                Log.e(TAG, "showMrecAtRect failed", ex);
                call.reject(ex.getLocalizedMessage(), ex);
            }
        });
    }

    @PluginMethod
    public void prepareAppOpen(PluginCall call) {
        if (getActivity() == null) {
            call.reject("Activity not available");
            return;
        }

        if (appOpenAd != null || isLoadingAppOpen) {
            call.resolve();
            return;
        }

        final String adId = call.getString("adId", TEST_APP_OPEN_ID);
        final boolean isTesting = call.getBoolean("isTesting", false);
        final String unitId = isTesting ? TEST_APP_OPEN_ID : adId;

        isLoadingAppOpen = true;
        getActivity().runOnUiThread(() -> {
            AppOpenAd.load(
                getContext(),
                unitId,
                new AdRequest.Builder().build(),
                new AppOpenAd.AppOpenAdLoadCallback() {
                    @Override
                    public void onAdLoaded(AppOpenAd ad) {
                        isLoadingAppOpen = false;
                        appOpenAd = ad;
                        call.resolve();
                    }

                    @Override
                    public void onAdFailedToLoad(LoadAdError loadAdError) {
                        isLoadingAppOpen = false;
                        Log.w(TAG, "prepareAppOpen failed: " + loadAdError.getMessage());
                        call.reject(loadAdError.getMessage());
                    }
                }
            );
        });
    }

    @PluginMethod
    public void showAppOpen(PluginCall call) {
        if (getActivity() == null) {
            call.reject("Activity not available");
            return;
        }

        if (appOpenAd == null) {
            call.reject("App open ad not ready");
            return;
        }

        getActivity().runOnUiThread(() -> {
            final AppOpenAd ad = appOpenAd;
            appOpenAd = null;
            ad.setFullScreenContentCallback(
                new FullScreenContentCallback() {
                    @Override
                    public void onAdDismissedFullScreenContent() {
                        ad.setFullScreenContentCallback(null);
                    }

                    @Override
                    public void onAdFailedToShowFullScreenContent(AdError adError) {
                        Log.w(TAG, "showAppOpen failed: " + adError.getMessage());
                        ad.setFullScreenContentCallback(null);
                    }
                }
            );
            ad.show(getActivity());
            call.resolve();
        });
    }

    @PluginMethod
    public void hideMrec(PluginCall call) {
        if (getActivity() == null) {
            call.resolve();
            return;
        }

        getActivity().runOnUiThread(() -> {
            if (adView != null) {
                adView.pause();
                adView.setVisibility(View.GONE);
            }
            if (mrecContainer != null) {
                mrecContainer.setVisibility(View.GONE);
            }
            call.resolve();
        });
    }

    private void destroyAdView() {
        if (adView == null) {
            return;
        }

        ViewGroup root = getRootViewGroup();
        adView.pause();
        adView.setVisibility(View.GONE);
        if (mrecContainer != null && root != null) {
            root.removeView(mrecContainer);
            mrecContainer = null;
        }
        adView.destroy();
        adView = null;
        loadedUnitId = null;
    }
}
