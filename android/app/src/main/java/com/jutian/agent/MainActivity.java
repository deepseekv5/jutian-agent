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
        boolean preferRemote = "remote".equals(prefs.getString("mode", "")) && !host.isEmpty() && !token.isEmpty();
        if (preferRemote) {
            openRemote(host, token);
            return;
        }
        // 先探测本机 3211：Termux 已启动，或本地版上次启动的 Node 还在跑
        detectLocalThen(() -> {
            if (BuildConfig.MODE.equals("local") && prefs.getBoolean("localEnabled", true)) {
                startLocalThen(this::showSetup);
            } else {
                showSetup();
            }
        });
    }

    /**
     * 本地版：解压内置运行时 → 启动 Node → 等健康检查通过 → 打开本机界面。
     * 任何一步失败都回落到配置页并说明原因，不让用户面对白屏。
     */
    private void startLocalThen(final Runnable fallback) {
        if (!NodeRuntime.ensureLoaded()) {
            fallback.run();
            return;
        }
        showStatus("正在启动本机服务…", "首次启动需要解压运行时，约 10-30 秒");
        new Thread(() -> {
            String err = null;
            try {
                if (!bundleReady()) extractBundle();
                java.io.File dir = new java.io.File(getFilesDir(), "app");
                NodeRuntime.startNode(
                        new java.io.File(dir, "serve.cjs").getAbsolutePath(),
                        dir.getAbsolutePath(),
                        getFilesDir().getAbsolutePath());
            } catch (Exception e) {
                err = e.getMessage();
            }
            final String e2 = err;
            runOnUiThread(() -> {
                if (e2 != null) {
                    showStatus("本机服务启动失败", e2 + "\n可改用「连接电脑」模式");
                    new android.os.Handler(getMainLooper()).postDelayed(this::showSetup, 2500);
                }
            });
        }, "node-boot").start();
        waitForHealth(fallback);
    }

    /** 轮询本机健康检查（Node 冷启动 + 解压需要时间，最多等 60 秒） */
    private void waitForHealth(final Runnable onTimeout) {
        final android.os.Handler main = new android.os.Handler(getMainLooper());
        new Thread(() -> {
            long deadline = System.currentTimeMillis() + 60000;
            while (System.currentTimeMillis() < deadline) {
                try {
                    java.net.URL u = new java.net.URL("http://127.0.0.1:3211/api/health");
                    java.net.HttpURLConnection c = (java.net.HttpURLConnection) u.openConnection();
                    c.setConnectTimeout(700);
                    c.setReadTimeout(700);
                    int code = c.getResponseCode();
                    c.disconnect();
                    if (code == 200) {
                        main.post(this::openLocal);
                        return;
                    }
                } catch (Exception ignored) { /* 还没起来 */ }
                try { Thread.sleep(600); } catch (InterruptedException ignored) { }
            }
            main.post(onTimeout);
        }, "node-health").start();
    }

    /** 内置运行时是否已解压且版本匹配（升级 APK 后自动重新解压） */
    private boolean bundleReady() {
        java.io.File dir = new java.io.File(getFilesDir(), "app");
        java.io.File stamp = new java.io.File(dir, ".bundle-version");
        if (!new java.io.File(dir, "serve.cjs").isFile() || !stamp.isFile()) return false;
        try {
            byte[] buf = new byte[(int) stamp.length()];
            try (java.io.FileInputStream in = new java.io.FileInputStream(stamp)) { in.read(buf); }
            return versionName().equals(new String(buf, "UTF-8").trim());
        } catch (Exception e) {
            return false;
        }
    }

    /** 解压 assets/mobile.zip 到 filesDir/app（含路径穿越防护） */
    private void extractBundle() throws Exception {
        java.io.File dir = new java.io.File(getFilesDir(), "app");
        dir.mkdirs();
        String base = dir.getCanonicalPath();
        byte[] buf = new byte[64 * 1024];
        try (java.util.zip.ZipInputStream zin =
                     new java.util.zip.ZipInputStream(getAssets().open("mobile.zip"))) {
            java.util.zip.ZipEntry e;
            while ((e = zin.getNextEntry()) != null) {
                java.io.File out = new java.io.File(dir, e.getName());
                if (!out.getCanonicalPath().startsWith(base + java.io.File.separator)) continue;
                if (e.isDirectory()) { out.mkdirs(); continue; }
                java.io.File parent = out.getParentFile();
                if (parent != null) parent.mkdirs();
                try (java.io.FileOutputStream fos = new java.io.FileOutputStream(out)) {
                    int n;
                    while ((n = zin.read(buf)) > 0) fos.write(buf, 0, n);
                }
            }
        }
        try (java.io.FileOutputStream fos =
                     new java.io.FileOutputStream(new java.io.File(dir, ".bundle-version"))) {
            fos.write(versionName().getBytes("UTF-8"));
        }
    }

    /** 启动中的过渡界面 */
    private void showStatus(String title, String detail) {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (24 * getResources().getDisplayMetrics().density);
        box.setPadding(pad, pad * 3, pad, pad);
        TextView t = new TextView(this);
        t.setText(title);
        t.setTextSize(20);
        box.addView(t);
        TextView d = new TextView(this);
        d.setText(detail);
        d.setTextSize(13);
        d.setTextColor(0xFF666666);
        d.setPadding(0, pad / 2, 0, 0);
        box.addView(d);
        setContentView(box);
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

    /** 首次配置界面：本机模式（Termux）或连接电脑 */
    private void showSetup() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (24 * getResources().getDisplayMetrics().density);
        box.setPadding(pad, pad * 2, pad, pad);

        TextView title = new TextView(this);
        title.setText("巨天 Agent");
        title.setTextSize(24);
        box.addView(title);

        TextView ver = new TextView(this);
        ver.setText("版本 " + versionName() + " · 本机模式与远程模式都支持");
        ver.setTextSize(12);
        ver.setTextColor(0xFF888888);
        ver.setPadding(0, pad / 4, 0, pad);
        box.addView(ver);

        // 模式一：本机（本地版内置运行时；远控版需 Termux）
        TextView localTitle = new TextView(this);
        localTitle.setText("方式一 · 本机运行（不需要电脑）");
        localTitle.setTextSize(15);
        box.addView(localTitle);

        TextView localHint = new TextView(this);
        if (BuildConfig.MODE.equals("local")) {
            localHint.setText("本安装包已内置运行时，点下面的按钮即可在手机上运行完整 Agent。\n"
                    + "数据保存在手机本地（~/.lyclaw）。");
        } else {
            localHint.setText("本安装包是远控版（体积小）。要在手机本地运行完整 Agent，请下载\n"
                    + "「本地版」APK，或用 Termux + jutian-mobile-*.zip 独立部署。");
        }
        localHint.setTextSize(12);
        localHint.setTextColor(0xFF666666);
        localHint.setPadding(0, pad / 4, 0, pad / 2);
        box.addView(localHint);

        Button detect = new Button(this);
        if (BuildConfig.MODE.equals("local")) {
            detect.setText("启动本机服务");
            detect.setOnClickListener(v -> {
                prefs.edit().putString("mode", "local").putBoolean("localEnabled", true).apply();
                startLocalThen(this::showSetup);
            });
        } else {
            detect.setText("检测本机服务（Termux）");
            detect.setOnClickListener(v -> {
                detect.setEnabled(false);
                detect.setText("检测中…");
                detectLocalThen(() -> {
                    detect.setEnabled(true);
                    detect.setText("检测本机服务（Termux）");
                    showSetup();
                });
            });
        }
        box.addView(detect);

        // 模式二：连接电脑
        TextView remoteTitle = new TextView(this);
        remoteTitle.setText("方式二 · 连接电脑");
        remoteTitle.setTextSize(15);
        remoteTitle.setPadding(0, pad, 0, 0);
        box.addView(remoteTitle);

        TextView hint = new TextView(this);
        hint.setText("在电脑端「设置 → 复制手机远程地址」得到形如\n"
                + "http://192.168.1.5:3211/remote.html?t=abc123\n"
                + "把地址和配对码填在下面。手机与电脑需在同一局域网。");
        hint.setTextSize(12);
        hint.setTextColor(0xFF666666);
        hint.setPadding(0, pad / 4, 0, pad / 2);
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
            prefs.edit().putString("host", h).putString("token", t).putString("mode", "remote").apply();
            openRemote(h, t);
        });
        box.addView(go);

        android.widget.ScrollView scroll = new android.widget.ScrollView(this);
        scroll.addView(box);
        setContentView(scroll);
    }

    /** 安装包版本号（欢迎页展示，便于确认装的是不是最新包） */
    private String versionName() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "未知";
        }
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
