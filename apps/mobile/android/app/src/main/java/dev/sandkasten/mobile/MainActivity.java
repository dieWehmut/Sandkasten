package dev.sandkasten.mobile;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    private boolean webReady;
    // SPA pushState entries can precede the native WebView history update.
    private static final String SPA_BACK = """
        (() => {
            const state = window.history.state;
            if (state?.sandkastenPicker || ['devices', 'appearance', 'about', 'editor', 'output'].includes(state?.sandkasten)) {
                window.history.back();
                return true;
            }
            return false;
        })();
        """;

    @Override public void onCreate(Bundle savedInstanceState) {
        AppearancePlugin.prepareTheme(this, AppearancePlugin.savedTheme(this));
        SplashScreen splash = SplashScreen.installSplashScreen(this);
        splash.setKeepOnScreenCondition(() -> !webReady);
        bridgeBuilder.addWebViewListener(new WebViewListener() {
            @Override public void onPageLoaded(WebView webView) {
                webView.post(() -> webReady = true);
            }
        });
        registerPlugin(CredentialsPlugin.class);
        registerPlugin(AppearancePlugin.class);
        super.onCreate(savedInstanceState);
        AppearancePlugin.apply(this, getBridge() == null ? null : getBridge().getWebView(), AppearancePlugin.savedTheme(this));
        // A missing or failed WebView must still reveal the native error UI.
        getWindow().getDecorView().postDelayed(() -> webReady = true, 3500);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                WebView webView = getBridge() == null ? null : getBridge().getWebView();
                if (webView == null) {
                    nativeBack(null);
                    return;
                }
                // Ask the page before consulting native history, including for
                // an immediate Back press after opening a secondary screen.
                webView.evaluateJavascript(SPA_BACK, handled -> {
                    if (!"true".equals(handled)) nativeBack(webView);
                });
            }

            private void nativeBack(WebView webView) {
                if (isFinishing() || isDestroyed()) return;
                if (webView != null && webView.canGoBack()) {
                    webView.goBack();
                } else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                    setEnabled(true);
                }
            }
        });
        splash.setOnExitAnimationListener(provider -> provider.getView().animate()
            .alpha(0f)
            .setDuration(160)
            .withEndAction(provider::remove)
            .start());
    }
}
