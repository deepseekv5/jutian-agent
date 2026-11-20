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
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.util.Base64;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
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
        // v16.7：文件保存桥——前端「保存」按钮 → 系统原生保存对话框（SAF），文件落到用户选的位置
        web.addJavascriptInterface(new FileSaverBridge(), "JutianNative");

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
     * 启动页全程可见：三个阶段各自有状态标记，解压有百分比进度，等待有秒数，
     * 失败时错误详情直接显示在页面上（可选中复制），并提供重试/连电脑出口。
     */

    // 启动页控件（startLocalThen 时构建）
    private TextView bootStages;
    private android.widget.ProgressBar bootBar;
    private TextView bootDetail;
    private TextView bootError;
    private LinearLayout bootActions;
    private int bootCurStage = -1;
    private boolean bootFailed = false;
    private static final String[] STAGE_TITLES = { "解压运行时", "启动服务", "等待就绪" };

    private void startLocalThen(final Runnable fallback) {
        if (!NodeRuntime.ensureLoaded()) {
            buildBootView();
            bootFail("加载运行时库",
                    "内置 Node 运行时无法加载。\n\n"
                    + "设备架构：" + deviceAbisAll() + "\n"
                    + "本包运行时：" + (apkHasRuntime() ? "存在，但加载失败" : "不包含此架构（装错了包）") + "\n"
                    + "已安装原生库：" + NodeRuntime.nativeLibList(getApplicationInfo().nativeLibraryDir) + "\n\n"
                    + "具体错误：\n" + (NodeRuntime.lastError().isEmpty() ? "(无详细信息)" : NodeRuntime.lastError()) + "\n\n"
                    + "本次安装包为通用版（含三种架构运行时），若仍失败多为设备页大小限制。\n"
                    + "3 秒后自动进入配置页，可用「连接电脑」模式继续使用。");
            // 本机模式起不来也不能让应用不可用：自动降级到配置页
            new android.os.Handler(getMainLooper()).postDelayed(this::showSetup, 3000);
            return;
        }
        buildBootView();
        bootStage(0);
        new Thread(() -> {
            try {
                if (!bundleReady()) {
                    final int total = Math.max(1, countZipEntries());
                    extractBundle(done -> runOnUiThread(() -> {
                        if (bootBar == null) return;
                        bootBar.setIndeterminate(false);
                        bootBar.setProgress(done * 100 / total);
                        bootDetail.setText("已解压 " + done + " / " + total + " 个文件");
                    }));
                }
                runOnUiThread(() -> {
                    bootBar.setIndeterminate(false);
                    bootBar.setProgress(100);
                    bootStageDone(0);
                    bootStage(1);
                });
                java.io.File dir = new java.io.File(getFilesDir(), "app");
                NodeRuntime.startNode(
                        new java.io.File(dir, "serve.cjs").getAbsolutePath(),
                        dir.getAbsolutePath(),
                        getFilesDir().getAbsolutePath(),
                        nodeLogPath());
                // startNode 阻塞到 Node 退出；退出即服务挂了——把 Node 日志尾部直接展示
                runOnUiThread(() -> {
                    if (!bootFailed) {
                        bootFail("服务进程退出", "内置服务已退出，日志最后几行：\n\n"
                                + NodeRuntime.tailLog(nodeLogPath(), 12)
                                + "\n\n可点「重试」再试，或改用「连接电脑」模式。");
                    }
                });
            } catch (Exception e) {
                final String msg = e.getMessage();
                runOnUiThread(() -> bootFail("解压或启动", msg == null ? e.getClass().getSimpleName() : msg));
            }
        }, "node-boot").start();
        bootStage(2);
        waitForHealth();
    }

    /** 在启动页标记当前阶段；note 附加说明可选 */
    private void bootStage(int idx) {
        bootCurStage = idx;
        renderStages(null);
        if (bootBar != null) bootBar.setIndeterminate(idx != 0); // 解压阶段用真实进度，其余转圈
        if (bootDetail != null && idx == 1) bootDetail.setText("正在启动内置服务…");
        if (bootDetail != null && idx == 2) bootDetail.setText("正在等待服务就绪…");
    }

    private void bootStageDone(int idx) {
        renderStages(idx < bootCurStage ? "done" : "done");
        if (idx == bootCurStage) { /* 当前阶段完成由下一阶段的 bootStage 推进 */ }
    }

    private void renderStages(String forceState) {
        if (bootStages == null) return;
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < STAGE_TITLES.length; i++) {
            String mark;
            if (forceState != null && i == bootCurStage) mark = "✕";       // 失败标记当前阶段
            else if (i < bootCurStage) mark = "✓";
            else if (i == bootCurStage) mark = "◐";
            else mark = "○";
            sb.append(mark).append(' ').append(STAGE_TITLES[i]);
            if (forceState != null && i == bootCurStage) sb.append("（失败）");
            sb.append('\n');
        }
        bootStages.setText(sb.toString());
    }

    /** 启动失败：错误详情可见、可复制，给出重试与连电脑两条出路 */
    private void bootFail(String where, String detail) {
        bootFailed = true;
        renderStages("fail");
        if (bootBar != null) bootBar.setIndeterminate(false);
        if (bootError != null) {
            bootError.setVisibility(TextView.VISIBLE);
            bootError.setText("【" + where + "】\n" + (detail == null || detail.isEmpty() ? "未知错误" : detail));
            bootError.setTextIsSelectable(true); // 长按可复制，方便反馈
        }
        if (bootActions != null) bootActions.setVisibility(LinearLayout.VISIBLE);
    }

    /** 构建启动页：品牌 + 阶段清单 + 进度条 + 详情 + 错误区 + 操作按钮 */
    private void buildBootView() {
        bootFailed = false;
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (24 * getResources().getDisplayMetrics().density);
        box.setPadding(pad, pad * 3, pad, pad);

        TextView title = new TextView(this);
        title.setText("巨天 Agent · 本机模式");
        title.setTextSize(22);
        box.addView(title);

        TextView ver = new TextView(this);
        ver.setText("版本 " + versionName() + " · 设备 " + deviceAbi() + " · 首次启动需解压运行时，约 10-30 秒");
        ver.setTextSize(12);
        ver.setTextColor(0xFF888888);
        ver.setPadding(0, pad / 4, 0, pad);
        box.addView(ver);

        bootStages = new TextView(this);
        bootStages.setTextSize(15);
        bootStages.setLineSpacing(4, 1.1f);
        box.addView(bootStages);

        bootBar = new android.widget.ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, pad / 2, 0, pad / 2);
        box.addView(bootBar, lp);

        bootDetail = new TextView(this);
        bootDetail.setTextSize(12);
        bootDetail.setTextColor(0xFF888888);
        box.addView(bootDetail);

        bootError = new TextView(this);
        bootError.setTextSize(12);
        bootError.setTextColor(0xFFCC0000);
        bootError.setVisibility(TextView.GONE);
        bootError.setPadding(0, pad / 2, 0, 0);
        box.addView(bootError);

        bootActions = new LinearLayout(this);
        bootActions.setOrientation(LinearLayout.HORIZONTAL);
        bootActions.setVisibility(LinearLayout.GONE);
        Button retry = new Button(this);
        retry.setText("重试");
        retry.setOnClickListener(v -> detectLocalThen(() -> startLocalThen(this::showSetup)));
        Button remote = new Button(this);
        remote.setText("改用连接电脑");
        remote.setOnClickListener(v -> showSetup());
        bootActions.addView(retry, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        bootActions.addView(remote, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        box.addView(bootActions);

        setContentView(box);
    }

    /** 轮询本机健康检查（最多 90 秒），每秒在启动页报秒数；超时给明确原因与出路 */
    private void waitForHealth() {
        final android.os.Handler main = new android.os.Handler(getMainLooper());
        final long startAt = System.currentTimeMillis();
        new Thread(() -> {
            long deadline = startAt + 90000;
            long lastTick = 0;
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
                final long waited = (System.currentTimeMillis() - startAt) / 1000;
                if (waited != lastTick) {
                    lastTick = waited;
                    main.post(() -> {
                        if (bootDetail != null && bootCurStage == 2 && !bootFailed) {
                            bootDetail.setText("已等待 " + waited + " 秒（服务冷启动通常 3-10 秒）");
                        }
                    });
                }
                try { Thread.sleep(500); } catch (InterruptedException ignored) { }
            }
            main.post(() -> bootFail("等待服务就绪超时", "90 秒内本机服务未响应。日志最后几行：\n\n"
                    + NodeRuntime.tailLog(nodeLogPath(), 12) + "\n\n可能原因：\n"
                    + "· 首次解压较慢，设备存储紧张\n"
                    + "· 3211 端口被其他应用占用\n"
                    + "· 设备可用内存不足，进程被系统回收\n\n"
                    + "可点「重试」再试一次；多次失败请改用「连接电脑」模式，并把本页错误信息反馈给我们。"));
        }, "node-health").start();
    }

    /** 统计内置包条目数（解压进度分母） */
    private int countZipEntries() throws Exception {
        int n = 0;
        try (java.util.zip.ZipInputStream zin =
                     new java.util.zip.ZipInputStream(getAssets().open("mobile.zip"))) {
            while (zin.getNextEntry() != null) n++;
        }
        return n;
    }

    /**
     * 内置运行时是否已解压且可用。
     *
     * 版本戳设计（应用内更新必须绕过此处，否则重启会被 APK 内置旧包覆盖）：
     *  - .bundle-version    ：当前生效 bundle 的版本（仅作信息/旧版兼容，不再作为新判定的唯一依据）
     *  - .bundle-base-version：该 bundle 所依赖的 APK 版本（APK 真实升级时才会变）
     * 判定：serve.cjs 存在为前提；有 base 戳时「base 戳 == 当前 APK 版本」即就绪
     *       （应用内更新只换 bundle、不动 APK，base 戳不变 → 重启不被覆盖）；
     *       无 base 戳（旧安装）时沿用旧规则「.bundle-version == 当前 APK 版本」。
     */
    private boolean bundleReady() {
        java.io.File dir = new java.io.File(getFilesDir(), "app");
        java.io.File stamp = new java.io.File(dir, ".bundle-version");
        if (!new java.io.File(dir, "serve.cjs").isFile() || !stamp.isFile()) return false;
        try {
            java.io.File base = new java.io.File(dir, ".bundle-base-version");
            if (base.isFile()) return versionName().equals(readStamp(base));
            // 兼容老版本 APK 解压出来的目录：只有 .bundle-version
            return versionName().equals(readStamp(stamp));
        } catch (Exception e) {
            return false;
        }
    }

    /** 读取一个版本戳文件（UTF-8、去首尾空白），读不全也不抛异常 */
    private static String readStamp(java.io.File f) throws Exception {
        byte[] buf = new byte[256];
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        try (java.io.FileInputStream in = new java.io.FileInputStream(f)) {
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        }
        return new String(out.toByteArray(), "UTF-8").trim();
    }

    /** 在指定 bundle 目录写入一个版本戳文件 */
    private static void writeStamp(java.io.File dir, String name, String value) throws Exception {
        try (java.io.FileOutputStream fos =
                     new java.io.FileOutputStream(new java.io.File(dir, name))) {
            fos.write((value == null ? "" : value).getBytes("UTF-8"));
        }
    }

    interface ExtractProgress { void onProgress(int filesDone); }

    /** 解压 assets/mobile.zip 到 filesDir/app，并写入 APK 内置包的版本戳 */
    private void extractBundle(ExtractProgress progress) throws Exception {
        java.io.File dir = new java.io.File(getFilesDir(), "app");
        dir.mkdirs();
        try (java.io.InputStream in = getAssets().open("mobile.zip")) {
            unzipBundle(in, dir, progress);
        }
        // APK 内置包：两个戳都写当前 APK 版本（bundle 版本信息对旧逻辑保持兼容）
        writeStamp(dir, ".bundle-version", versionName());
        writeStamp(dir, ".bundle-base-version", versionName());
    }

    /**
     * 把任意来源（assets / 下载临时文件）的 zip 流解压到目标目录。
     * 含路径穿越防护与逐文件进度；不写版本戳，由调用方决定写什么。
     * 应用内更新复用此方法把新包解到 filesDir/app-new，成功后再原子换名。
     */
    private void unzipBundle(java.io.InputStream source, java.io.File destDir, ExtractProgress progress) throws Exception {
        String base = destDir.getCanonicalPath();
        byte[] buf = new byte[64 * 1024];
        try (java.util.zip.ZipInputStream zin = new java.util.zip.ZipInputStream(source)) {
            java.util.zip.ZipEntry e;
            int done = 0;
            while ((e = zin.getNextEntry()) != null) {
                java.io.File out = new java.io.File(destDir, e.getName());
                if (!out.getCanonicalPath().startsWith(base + java.io.File.separator)) continue;
                if (e.isDirectory()) { out.mkdirs(); continue; }
                java.io.File parent = out.getParentFile();
                if (parent != null) parent.mkdirs();
                try (java.io.FileOutputStream fos = new java.io.FileOutputStream(out)) {
                    int n;
                    while ((n = zin.read(buf)) > 0) fos.write(buf, 0, n);
                }
                done++;
                if (progress != null && done % 5 == 0) progress.onProgress(done);
            }
            if (progress != null) progress.onProgress(done);
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

        // 若本机运行时加载失败过，在配置页明确告知（不让用户以为本机模式是"消失"了）
        if (!NodeRuntime.lastError().isEmpty()) {
            TextView warn = new TextView(this);
            warn.setText("本机模式不可用：" + NodeRuntime.lastError()
                    + "\n可继续使用下方「连接电脑」模式。");
            warn.setTextSize(11);
            warn.setTextColor(0xFFB45309);
            warn.setPadding(0, pad / 3, 0, pad / 2);
            box.addView(warn);
        }

        TextView ver = new TextView(this);
        ver.setText("版本 " + versionName() + " · 设备 " + deviceAbi() + " · 本机模式与远程模式都支持");
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

    /** Node 运行时日志路径（启动失败时展示尾部内容） */
    private String nodeLogPath() {
        return new java.io.File(getFilesDir(), "node.log").getAbsolutePath();
    }

    /** 设备主 ABI（如 arm64-v8a）——本地版按 ABI 分包，必须让用户看到装的是哪一档 */
    private String deviceAbi() {
        try {
            String[] abis = android.os.Build.SUPPORTED_ABIS;
            return (abis != null && abis.length > 0) ? abis[0] : "unknown";
        } catch (Throwable t) { return "unknown"; }
    }

    private String deviceAbisAll() {
        try {
            String[] abis = android.os.Build.SUPPORTED_ABIS;
            return (abis != null && abis.length > 0) ? android.text.TextUtils.join(" / ", abis) : "unknown";
        } catch (Throwable t) { return "unknown"; }
    }

    /** 本安装包是否真的带了当前 ABI 的运行时（装错架构的包会返回 false） */
    private boolean apkHasRuntime() {
        try {
            return new java.io.File(getApplicationInfo().nativeLibraryDir, "libnode.so").isFile();
        } catch (Throwable t) { return false; }
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

    // ═══ v16.7 文件保存（SAF）：文件系统就在 app 内部；用户想导出时点「保存」→
    // 调起系统原生的保存对话框（ACTION_CREATE_DOCUMENT），由用户选择落在哪里。 ═══

    /** SAF 保存请求码 */
    private static final int REQ_SAVE = 4721;
    /** 待写入的内容（base64）与回调 id，等待用户在系统对话框里选位置 */
    private String pendingSaveB64 = null;
    private String pendingSaveId = null;

    /**
     * 前端桥：注册为 window.JutianNative（一个 JS 对象名只能注册一个对象，
     * 故文件保存 / bundle 更新 / 重启都放进同一个类）。
     *  - saveBlob(name, mime, base64)       → 系统保存对话框（SAF）
     *  - fetchBundle(url, sha256)           → 后台下载 Release 的 jutian-mobile-<ver>.zip，
     *                                          SHA-256 校验后解压覆盖 filesDir/app；
     *                                          完成回调 window.__jutianUpdateDone(ok, msg)
     *  - restartApp()                       → 杀进程并重新拉起 Activity，使新 serve.cjs 生效
     */
    private class FileSaverBridge {
        @JavascriptInterface
        public String saveBlob(String name, String mime, String base64) {
            final String id = String.valueOf(System.currentTimeMillis());
            final String m = (mime == null || mime.isEmpty()) ? "application/octet-stream" : mime;
            runOnUiThread(() -> {
                try {
                    pendingSaveB64 = base64 == null ? "" : base64;
                    pendingSaveId = id;
                    Intent it = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    it.addCategory(Intent.CATEGORY_OPENABLE);
                    it.setType(m);
                    it.putExtra(Intent.EXTRA_TITLE, name == null || name.isEmpty() ? "未命名" : name);
                    startActivityForResult(it, REQ_SAVE);
                } catch (Exception e) {
                    notifySaveResult(id, false);
                }
            });
            return id;
        }

        /** 应用内 bundle 更新：下载 → 校验 → 解到临时目录 → 原子替换，失败保留原 bundle */
        @JavascriptInterface
        public String fetchBundle(String url, String sha256) {
            final String u = url == null ? "" : url.trim();
            if (!u.toLowerCase(java.util.Locale.ROOT).endsWith(".zip")) {
                notifyUpdateDone(false, "更新包地址无效");
                return "invalid";
            }
            new Thread(() -> {
                final java.io.File appDir = new java.io.File(getFilesDir(), "app");
                final java.io.File newDir = new java.io.File(getFilesDir(), "app-new");
                final java.io.File oldDir = new java.io.File(getFilesDir(), "app-old");
                java.io.File download = null;
                boolean ok = false;
                String resultMsg = "";
                try {
                    // 1) 下载到缓存临时文件（不动现有 bundle）
                    download = new java.io.File(getCacheDir(), "bundle-" + System.currentTimeMillis() + ".zip");
                    java.net.HttpURLConnection conn =
                            (java.net.HttpURLConnection) new java.net.URL(u).openConnection();
                    conn.setConnectTimeout(15000);
                    conn.setReadTimeout(30000);
                    conn.setInstanceFollowRedirects(true);
                    conn.setRequestProperty("User-Agent", "jutian-android");
                    int code = conn.getResponseCode();
                    if (code < 200 || code >= 300) throw new Exception("下载失败 HTTP " + code);
                    byte[] buf = new byte[64 * 1024];
                    try (java.io.InputStream in = conn.getInputStream();
                         java.io.FileOutputStream fos = new java.io.FileOutputStream(download)) {
                        int n;
                        while ((n = in.read(buf)) > 0) fos.write(buf, 0, n);
                    }
                    conn.disconnect();

                    // 2) SHA-256 校验（官方值来自 GitHub 资产 digest；为空则跳过，靠结构校验兜底）
                    String want = sha256 == null ? "" : sha256.trim()
                            .replace("sha256:", "").toLowerCase(java.util.Locale.ROOT);
                    if (!want.isEmpty()) {
                        String got = sha256File(download);
                        if (!want.equals(got)) throw new Exception("更新包校验失败（SHA-256 不匹配），已保留原版本");
                    }

                    // 3) 解压到 app-new —— 此步失败完全不触碰现有 app
                    deleteRecursive(newDir);
                    if (!newDir.exists() && !newDir.mkdirs()) throw new Exception("无法创建更新目录");
                    try (java.io.FileInputStream fis = new java.io.FileInputStream(download)) {
                        unzipBundle(fis, newDir, null);
                    }
                    if (!new java.io.File(newDir, "serve.cjs").isFile()) {
                        throw new Exception("更新包内容不完整（缺少 serve.cjs）");
                    }

                    // 4) 写新版本戳：bundle 版本从文件名解析，base 戳保持为当前 APK 版本
                    //    （APK 没升级 → base 戳不变 → 重启时 bundleReady() 不会用旧包覆盖）
                    String bundleVer = parseBundleVersion(u);
                    writeStamp(newDir, ".bundle-version", bundleVer.isEmpty() ? versionName() : bundleVer);
                    writeStamp(newDir, ".bundle-base-version", versionName());

                    // 5) 原子换名：app→app-old，app-new→app；任一步失败都回滚，绝不留下半套文件
                    deleteRecursive(oldDir);
                    boolean renamedOld = !appDir.exists() || appDir.renameTo(oldDir);
                    if (!renamedOld) throw new Exception("无法替换旧版本目录（可能被占用）");
                    if (!newDir.renameTo(appDir)) {
                        if (oldDir.isDirectory()) oldDir.renameTo(appDir); // 回滚
                        throw new Exception("无法应用新版本，已回滚");
                    }
                    deleteRecursive(oldDir); // 删除旧版本备份
                    ok = true;
                    resultMsg = "更新完成，重启应用生效";
                } catch (Exception e) {
                    String m = e.getMessage();
                    resultMsg = m == null || m.isEmpty() ? e.getClass().getSimpleName() : m;
                    // 兜底回滚：若 app 没了但 old 还在，恢复 old
                    if (!appDir.isDirectory() && oldDir.isDirectory()) oldDir.renameTo(appDir);
                } finally {
                    if (download != null) download.delete();
                    deleteRecursive(newDir); // 成功时 newDir 已被 rename，不存在；失败时清理残留
                }
                final boolean done = ok;
                final String msg = resultMsg;
                runOnUiThread(() -> notifyUpdateDone(done, msg));
            }, "bundle-update").start();
            return "started";
        }

        /** 重启应用：Node 与主进程同生命周期，必须整进程重启才能加载新的 serve.cjs */
        @JavascriptInterface
        public void restartApp() {
            runOnUiThread(() -> {
                try {
                    Intent it = new Intent(getApplicationContext(), MainActivity.class);
                    it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                    android.app.PendingIntent pi = android.app.PendingIntent.getActivity(
                            getApplicationContext(), 0, it,
                            android.app.PendingIntent.FLAG_ONE_SHOT | android.app.PendingIntent.FLAG_IMMUTABLE);
                    android.app.AlarmManager am =
                            (android.app.AlarmManager) getSystemService(ALARM_SERVICE);
                    long when = System.currentTimeMillis() + 600; // 给前端的 restart 回调留响应时间
                    if (am != null) {
                        try {
                            am.setExactAndAllowWhileIdle(android.app.AlarmManager.RTC, when, pi);
                        } catch (Exception ignored) {
                            am.set(android.app.AlarmManager.RTC, when, pi);
                        }
                    }
                } catch (Exception ignored) { /* 最差情况：只杀进程，用户手动重开 */ }
                android.os.Process.killProcess(android.os.Process.myPid());
                System.exit(10);
            });
        }
    }

    /** 从更新包 URL 的文件名解析 bundle 版本：jutian-mobile-<ver>.zip → <ver> */
    private static String parseBundleVersion(String url) {
        try {
            String name = new java.io.File(new java.net.URL(url).getPath()).getName();
            java.util.regex.Matcher m =
                    java.util.regex.Pattern.compile("jutian-mobile-(.+)\\.zip").matcher(name);
            if (m.find()) return m.group(1).trim();
        } catch (Exception ignored) { }
        return "";
    }

    /** 计算文件 SHA-256（十六进制小写），用于校验下载包完整性 */
    private static String sha256File(java.io.File f) throws Exception {
        java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-256");
        byte[] buf = new byte[64 * 1024];
        try (java.io.FileInputStream in = new java.io.FileInputStream(f)) {
            int n;
            while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
        }
        StringBuilder sb = new StringBuilder();
        for (byte b : md.digest()) sb.append(String.format(java.util.Locale.ROOT, "%02x", b & 0xff));
        return sb.toString();
    }

    /** 递归删除目录/文件（清理临时目录与旧版本备份），失败静默 */
    private static void deleteRecursive(java.io.File f) {
        if (f == null || !f.exists()) return;
        if (f.isDirectory()) {
            java.io.File[] children = f.listFiles();
            if (children != null) for (java.io.File c : children) deleteRecursive(c);
        }
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    /** 用户在系统对话框选完位置（或取消）后写文件 */
    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_SAVE) return;
        final String id = pendingSaveId;
        final String b64 = pendingSaveB64;
        pendingSaveId = null;
        pendingSaveB64 = null;
        if (id == null) return;
        if (resultCode != RESULT_OK || data == null || data.getData() == null) {
            notifySaveResult(id, false);
            return;
        }
        final Uri uri = data.getData();
        new Thread(() -> {
            boolean ok = false;
            try {
                byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
                try (java.io.OutputStream os = getContentResolver().openOutputStream(uri)) {
                    if (os != null) {
                        os.write(bytes);
                        os.flush();
                        ok = true;
                    }
                }
            } catch (Exception ignored) { /* 写失败也回调 false，前端提示 */ }
            final boolean done = ok;
            runOnUiThread(() -> notifySaveResult(id, done));
        }).start();
    }

    /** 通知前端保存结果：window.__jutianSaveDone(id, ok) */
    private void notifySaveResult(String id, boolean ok) {
        if (web == null) return;
        final String js = "window.__jutianSaveDone && window.__jutianSaveDone(" + id + "," + (ok ? "true" : "false") + ")";
        web.post(() -> web.evaluateJavascript(js, null));
    }

    /** 通知前端 bundle 更新结果：window.__jutianUpdateDone(ok, msg) */
    private void notifyUpdateDone(final boolean ok, final String msg) {
        if (web == null) return;
        String safe = (msg == null ? "" : msg)
                .replace("\\", "\\\\")
                .replace("'", "\\'")
                .replace("\n", "\\n")
                .replace("\r", "");
        final String js = "window.__jutianUpdateDone && window.__jutianUpdateDone("
                + (ok ? "true" : "false") + ",'" + safe + "')";
        web.post(() -> web.evaluateJavascript(js, null));
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
