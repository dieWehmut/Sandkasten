package dev.sandkasten.mobile;

import android.app.Activity;
import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Color;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Keeps native inset surfaces and the WebView palette in agreement. */
@CapacitorPlugin(name = "Appearance")
public class AppearancePlugin extends Plugin {
    private static final String PREFERENCES = "appearance";

    private static int overlay(String theme) {
        switch (theme) {
            case "coral": return R.style.AppTheme_BackgroundCoral;
            case "rose": return R.style.AppTheme_BackgroundRose;
            case "sea": return R.style.AppTheme_BackgroundSea;
            case "forest": return R.style.AppTheme_BackgroundForest;
            case "indigo": return R.style.AppTheme_BackgroundIndigo;
            case "amber": return R.style.AppTheme_BackgroundAmber;
            default: return 0;
        }
    }

    private static int background(String theme) {
        switch (theme) {
            case "rose": return Color.rgb(26, 17, 23);
            case "sea": return Color.rgb(14, 24, 26);
            case "forest": return Color.rgb(17, 24, 17);
            case "indigo": return Color.rgb(18, 19, 30);
            case "amber": return Color.rgb(27, 22, 12);
            default: return Color.rgb(27, 17, 14);
        }
    }

    static String savedTheme(Context context) {
        String theme = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).getString("theme", "coral");
        return overlay(theme) == 0 ? "coral" : theme;
    }

    @SuppressWarnings("deprecation")
    static void apply(Activity activity, WebView webView, String theme) {
        int color = background(theme);
        // An overlay also makes later Capacitor SystemBars updates use this color.
        prepareTheme(activity, theme);
        activity.getWindow().getDecorView().setBackgroundColor(color);
        activity.getWindow().setStatusBarColor(color);
        activity.getWindow().setNavigationBarColor(color);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(activity.getWindow(), activity.getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(false);
        controller.setAppearanceLightNavigationBars(false);
        if (webView != null) webView.setBackgroundColor(color);
    }

    static void prepareTheme(Activity activity, String theme) {
        activity.getTheme().applyStyle(overlay(theme), true);
    }

    private void restore() {
        getBridge().executeOnMainThread(() -> apply(getActivity(), getBridge().getWebView(), savedTheme(getContext())));
    }

    @Override public void load() { restore(); }
    @Override protected void handleOnConfigurationChanged(Configuration configuration) { restore(); }

    @PluginMethod public void get(PluginCall call) {
        try {
            String theme = getContext().getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).getString("theme", null);
            JSObject result = new JSObject();
            result.put("theme", theme != null && overlay(theme) != 0 ? theme : org.json.JSONObject.NULL);
            call.resolve(result);
        } catch (RuntimeException error) { call.reject("Unable to read appearance preference"); }
    }

    @PluginMethod public void set(PluginCall call) {
        String theme = call.getString("theme", "");
        if (overlay(theme) == 0) { call.reject("Unknown theme"); return; }
        // Capacitor invokes plugin methods on its background handler. Commit
        // there before acknowledging the selection; apply() can lose the latest
        // preference when Android force-stops the process immediately afterward.
        try {
            if (!getContext().getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit().putString("theme", theme).commit()) {
                call.reject("Unable to save appearance preference");
                return;
            }
        } catch (RuntimeException error) { call.reject("Unable to save appearance preference"); return; }
        getBridge().executeOnMainThread(() -> {
            apply(getActivity(), getBridge().getWebView(), theme);
            call.resolve();
        });
    }
}
