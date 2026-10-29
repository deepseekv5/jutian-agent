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
    public static synchronized boolean ensureLoaded() {
        if (loaded) return true;
        try {
            System.loadLibrary("node");
            System.loadLibrary("nodejs_bridge");
            loaded = true;
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    /**
     * 在后台线程启动 Node（node::Start 会阻塞到进程退出）。
     * @param entryPath  解压后的 serve.cjs 绝对路径
     * @param projectDir 解压目录（cwd，相对 require 的解析基准）
     * @param homeDir    可写 HOME（数据落在 ~/.lyclaw）
     */
    public static native int startNode(String entryPath, String projectDir, String homeDir);
}
