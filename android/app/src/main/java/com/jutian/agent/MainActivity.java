// 巨天agent 安卓壳 —— 两种运行模式
//
// 1) 本机模式（优先探测）：若 Termux 等环境已在手机本机跑起 serve.cjs
//    （127.0.0.1:3211），直接加载本机完整版界面——手机独立运行，不依赖电脑。
// 2) 远程模式（回退）：探测失败时进入配对页，连接局域网内电脑的
//    /remote.html?t=<配对码>（与历史行为一致）。
//
// 判定逻辑：launch 时异步探测一次本机端口；已保存过配对信息的用户
// 直接进远程模式（不打断），首次使用（无配对信息）且本机有服务时进本机模式。
package com.jutian.agent;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

public class MainActivity extends Activity {
    private WebView web;
    private SharedPreferences prefs;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("jutian", MODE_PRIVATE);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        // 允许明文 http：手机连的是局域网内的电脑，没有证书
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        web.setWebViewClient(new WebViewClient());

        String host = prefs.getString("host", "");
        String token = prefs.getString("token", "");
        if (host.isEmpty() || token.isEmpty()) {
            // 没配对过：先探测本机是否有 serve.cjs（Termux 独立模式），
            // 有则直接进本机完整版；否则进配对页
            detectLocalThen(() -> showSetup());
        } else {
            openRemote(host, token);
        }
    }

    /**
     * 异步探测 127.0.0.1:3211/api/health。
     * 有本机服务 → 加载完整版界面（手机独立运行，数据全在本机）；
     * 无 → 执行 fallback（通常是显示配对页）。
     * 探测在后台线程做（主线程不允许网络请求），结果回主线程。
     */
    private void detectLocalThen(final Runnable fallback) {
        final android.os.Handler main = new android.os.Handler(getMainLooper());
        new Thread(() -> {
            boolean local = false;
            try {
                java.net.URL u = new java.net.URL("http://127.0.0.1:3211/api/health");
                java.net.HttpURLConnection c = (java.net.HttpURLConnection) u.openConnection();
                c.setConnectTimeout(800);
                c.setReadTimeout(800);
                int code = c.getResponseCode();
                local = (code == 200);
                c.disconnect();
            } catch (Exception e) { /* 连不上 = 无本机服务 */ }
            final boolean ok = local;
            main.post(() -> {
                if (ok) openLocal();
                else fallback.run();
            });
        }, "local-probe").start();
    }

    /** 本机模式：加载手机本机 serve.cjs 的完整界面 */
    private void openLocal() {
        setContentView(web);
        web.loadUrl("http://127.0.0.1:3211/");
    }

    /** 首次配置界面：填电脑地址与配对码 */
    private void showSetup() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (24 * getResources().getDisplayMetrics().density);
        box.setPadding(pad, pad * 2, pad, pad);
        box.setGravity(Gravity.CENTER_HORIZONTAL);

        TextView title = new TextView(this);
        title.setText("连接你的电脑");
        title.setTextSize(22);
        box.addView(title);

        TextView hint = new TextView(this);
        hint.setText("在电脑端「设置 → 复制手机远程地址」得到形如\n"
                + "http://192.168.1.5:3211/remote.html?t=abc123\n"
                + "把地址和配对码填在下面。手机与电脑需在同一局域网。");
        hint.setTextSize(13);
        hint.setPadding(0, pad / 2, 0, pad);
        box.addView(hint);

        EditText hostInput = new EditText(this);
        hostInput.setHint("电脑地址，如 192.168.1.5:3211");
        hostInput.setInputType(InputType.TYPE_TEXT_VARIATION_URI);
        hostInput.setText(prefs.getString("host", ""));
        box.addView(hostInput, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        EditText tokenInput = new EditText(this);
        tokenInput.setHint("配对码（地址里 t= 后面那串）");
        tokenInput.setText(prefs.getString("token", ""));
        box.addView(tokenInput, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView err = new TextView(this);
        err.setTextColor(0xFFCC0000);
        err.setTextSize(12);
        box.addView(err);

        Button go = new Button(this);
        go.setText("连接");
        go.setOnClickListener(v -> {
            String h = hostInput.getText().toString().trim()
                    .replaceAll("^https?://", "")
                    .replaceAll("/.*$", "");
            String t = tokenInput.getText().toString().trim();
            if (h.isEmpty() || t.isEmpty()) {
                err.setText("地址和配对码都要填");
                return;
            }
            prefs.edit().putString("host", h).putString("token", t).apply();
            openRemote(h, t);
        });
        box.addView(go);

        setContentView(box);
    }

    /** 加载电脑端的手机版界面 */
    private void openRemote(String host, String token) {
        String url = "http://" + host + "/remote.html?t=" + token;
        setContentView(web);
        web.loadUrl(url);
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
            return;
        }
        super.onBackPressed();
    }
}
