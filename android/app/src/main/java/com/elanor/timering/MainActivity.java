package com.elanor.timering;

import android.app.Activity;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.IOException;

public final class MainActivity extends Activity {
    private static final String ORIGIN = "https://timering.local";
    private WebView webView;
    private DayStore store;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            store = new DayStore(getFilesDir().toPath().resolve("days"));
        } catch (IOException ex) {
            Toast.makeText(this, "无法打开本地数据", Toast.LENGTH_LONG).show();
            finish();
            return;
        }
        FrameLayout root = new FrameLayout(this);
        boolean dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        root.setBackgroundColor(Color.parseColor(dark ? "#17171c" : "#f5f5f2"));
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
        } else {
            root.setSystemUiVisibility(dark ? 0 : View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        }
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets safe = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
                view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportZoom(false);
        webView.setBackgroundColor(Color.TRANSPARENT);
        webView.addJavascriptInterface(new StorageBridge(), "TimeringAndroid");
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !isLocal(request.getUrl());
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String path = uri.getPath();
                if (!isLocal(uri) || path == null || path.contains("..") || !"GET".equals(request.getMethod())) return notFound();
                try {
                    String type = path.endsWith(".css") ? "text/css" : path.endsWith(".js") ? "application/javascript" : "text/html";
                    return new WebResourceResponse(type, "UTF-8", getAssets().open("web" + path));
                } catch (IOException ex) {
                    return notFound();
                }
            }
        });
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        if (Build.VERSION.SDK_INT >= 30 && getWindow().getInsetsController() != null) {
            int lightBars = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            getWindow().getInsetsController().setSystemBarsAppearance(dark ? 0 : lightBars, lightBars);
        }
        root.requestApplyInsets();
        webView.loadUrl(ORIGIN + "/index.html");
    }

    private static boolean isLocal(Uri uri) {
        return "https".equals(uri.getScheme()) && "timering.local".equals(uri.getHost()) && uri.getPort() == -1;
    }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not found", java.util.Collections.emptyMap(),
            new ByteArrayInputStream(new byte[0]));
    }

    private String error(Exception ex) {
        return "{\"error\":" + JSONObject.quote("本地数据读写失败：" + ex.getMessage()) + "}";
    }

    public final class StorageBridge {
        @JavascriptInterface public String readDay(String date) {
            try {
                String raw = store.read(date);
                return new JSONObject().put("segments", raw == null ? JSONObject.NULL : new JSONArray(raw)).toString();
            } catch (Exception ex) { return error(ex); }
        }

        @JavascriptInterface public String writeDay(String date, String raw) {
            try {
                JSONArray segments = new JSONArray(raw);
                for (int i = 0; i < segments.length(); i++) {
                    JSONObject segment = segments.getJSONObject(i);
                    for (String key : new String[] {"start", "end"}) {
                        if (!segment.getString(key).matches("(?:[01]\\d|2[0-3]):[0-5]\\d")) throw new IllegalArgumentException("Invalid time");
                    }
                    segment.getString("label");
                }
                store.write(date, segments.toString());
                return "{}";
            } catch (Exception ex) { return error(ex); }
        }

        @JavascriptInterface public String listDays() {
            try {
                return new JSONObject().put("days", new JSONArray(store.list())).toString();
            } catch (Exception ex) { return error(ex); }
        }
    }

    @Override public void onBackPressed() {
        webView.evaluateJavascript("Boolean(window.timeringBack && window.timeringBack())", handled -> {
            if (!"true".equals(handled)) finish();
        });
    }

    @Override protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("TimeringAndroid");
            webView.destroy();
        }
        super.onDestroy();
    }
}
