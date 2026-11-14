package com.jutian.agent;

/**
 * Node.js 运行时入口（仅本地版 APK 使用）。
 *
 * libnode.so 由 nodejs-mobile 提供，随 APK 的原生库目录分发；
 * nodejs_bridge 是本工程编译的 JNI 桥（见 src/main/cpp/node_bridge.cpp）。
 * 加载顺序不能反：先 libnode，再桥接库（桥接库依赖它的符号）。
 */
public final class NodeRuntime {
    private static boolean loaded = false;

    private NodeRuntime() {}

    /** 加载原生库；本地版缺失原生库时返回 false（远控版不包含它们） */
    /** 最后一次加载失败的原始信息（启动页直接展示，便于定位是缺依赖还是对齐问题） */
    private static String lastError = "";

    public static String lastError() { return lastError; }

    public static synchronized boolean ensureLoaded() {
        if (loaded) return true;
        try {
            System.loadLibrary("node");
        } catch (Throwable t) {
            // 典型：dlopen failed: library "libc++_shared.so" not found（依赖未打包）
            //      或 empty/missing PT_LOAD segment（16KB 页对齐不符）
            lastError = "libnode.so: " + t.getClass().getSimpleName() + ": " + String.valueOf(t.getMessage());
            return false;
        }
        try {
            System.loadLibrary("nodejs_bridge");
        } catch (Throwable t) {
            lastError = "nodejs_bridge.so: " + t.getClass().getSimpleName() + ": " + String.valueOf(t.getMessage());
            return false;
        }
        loaded = true;
        lastError = "";
        return true;
    }

    /** 读取 Node 日志尾部（启动失败时展示，含 V8/模块加载的真实报错） */
    public static String tailLog(String logPath, int maxLines) {
        try {
            java.io.File f = new java.io.File(logPath);
            if (!f.isFile()) return "(无日志文件)";
            java.io.RandomAccessFile raf = new java.io.RandomAccessFile(f, "r");
            long len = raf.length();
            int take = (int) Math.min(len, 8192);
            raf.seek(len - take);
            byte[] buf = new byte[take];
            raf.readFully(buf);
            raf.close();
            String all = new String(buf, "UTF-8");
            String[] lines = all.split("\n");
            int from = Math.max(0, lines.length - maxLines);
            StringBuilder sb = new StringBuilder();
            for (int i = from; i < lines.length; i++) sb.append(lines[i]).append('\n');
            return sb.toString().trim();
        } catch (Throwable t) { return "(读取日志失败: " + t.getMessage() + ")"; }
    }

    /** 列出安装后 lib 目录里的原生库（排查"依赖到底打没打进包"） */
    public static String nativeLibList(String nativeDir) {
        try {
            java.io.File dir = new java.io.File(nativeDir);
            String[] names = dir.list();
            if (names == null || names.length == 0) return "(空)";
            java.util.Arrays.sort(names);
            StringBuilder sb = new StringBuilder();
            for (String n : names) sb.append(n).append(' ');
            return sb.toString().trim();
        } catch (Throwable t) { return "(读取失败: " + t.getMessage() + ")"; }
    }

    /**
     * 在后台线程启动 Node（node::Start 会阻塞到进程退出）。
     * @param entryPath  解压后的 serve.cjs 绝对路径
     * @param projectDir 解压目录（cwd，相对 require 的解析基准）
     * @param homeDir    可写 HOME（数据落在 ~/.lyclaw）
     */
    public static native int startNode(String entryPath, String projectDir, String homeDir, String logPath);
}
