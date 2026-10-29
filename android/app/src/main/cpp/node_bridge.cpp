// Node.js 运行时桥（本地版 APK 专用）
//
// 把 nodejs-mobile 的 libnode.so 嵌进 APK：libnode.so 放在 jniLibs 里，
// 系统从 APK 的原生库目录加载（Android 10+ 禁止从应用数据目录 exec，
// 但加载 .so 不受限——这是能在手机上跑 Node 的唯一合规路径）。
//
// 关键点：
//  · node::Start 必须跑在独立线程上，且栈要够大（V8 需要）
//  · 启动前用 setenv 指定 HOME 与 PORT：Node 的 os.homedir() 读 HOME，
//    应用进程默认没有可写 HOME，必须指向 filesDir
//  · 入口是解压出来的 serve.cjs，cwd 切到解压目录（相对 require 才能解析）

#include <jni.h>
#include <pthread.h>
#include <unistd.h>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include <android/log.h>
#include <node.h>

#define LOG_TAG "JutianNode"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

struct StartArgs {
    std::vector<std::string> args;
};

static void* startNodeThread(void* raw) {
    StartArgs* sa = static_cast<StartArgs*>(raw);
    std::vector<char*> argv;
    argv.reserve(sa->args.size() + 1);
    for (auto& s : sa->args) argv.push_back(const_cast<char*>(s.c_str()));
    argv.push_back(nullptr);
    LOGI("node::Start with %zu args, entry=%s", sa->args.size(), sa->args.size() > 1 ? sa->args[1].c_str() : "");
    int code = node::Start(static_cast<int>(argv.size()) - 1, argv.data());
    LOGE("node::Start returned %d（Node 退出）", code);
    delete sa;
    return nullptr;
}

extern "C" JNIEXPORT jint JNICALL
Java_com_jutian_agent_NodeRuntime_startNode(JNIEnv* env, jclass, jstring entryPath, jstring projectDir, jstring homeDir) {
    const char* entry = env->GetStringUTFChars(entryPath, nullptr);
    const char* proj = env->GetStringUTFChars(projectDir, nullptr);
    const char* home = env->GetStringUTFChars(homeDir, nullptr);

    setenv("HOME", home, 1);
    setenv("PORT", "3211", 1);
    // Node 18（nodejs-mobile）没有内置 WebSocket，语音引擎需要 ws 包；
    // 把项目内 node_modules 指到解压目录，require 才能解析到随包的 ws。
    std::string nodePath = std::string(proj) + "/node_modules";
    setenv("NODE_PATH", nodePath.c_str(), 1);

    if (chdir(proj) != 0) LOGE("chdir 失败: %s", proj);

    StartArgs* sa = new StartArgs();
    sa->args.push_back("node");
    sa->args.push_back(entry);

    pthread_attr_t attr;
    pthread_attr_init(&attr);
    // V8 需要大栈：默认 1MB 会栈溢出
    pthread_attr_setstacksize(&attr, 16 * 1024 * 1024);
    pthread_t tid;
    int rc = pthread_create(&tid, &attr, startNodeThread, sa);
    pthread_attr_destroy(&attr);

    env->ReleaseStringUTFChars(entryPath, entry);
    env->ReleaseStringUTFChars(projectDir, proj);
    env->ReleaseStringUTFChars(homeDir, home);
    return rc;
}
