# 本地版 APK 的 JNI 桥：链接 nodejs-mobile 预编译的 libnode.so
#
# libnode.so 与头文件不随仓库分发（62MB 二进制），由 CI 在构建前下载：
#   bin/arm64-v8a/libnode.so → app/src/local/jniLibs/arm64-v8a/
#   include/node/**          → app/src/main/cpp/include/node/
# 本机没有这两样时 CMake 会直接报错——这是预期的：本地版只能靠 CI 出包。

cmake_minimum_required(VERSION 3.18)
project(jutian_node_bridge CXX)

add_library(nodejs_bridge SHARED node_bridge.cpp)

target_include_directories(nodejs_bridge PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    ${CMAKE_CURRENT_SOURCE_DIR}/include/node)

add_library(libnode SHARED IMPORTED)
set_target_properties(libnode PROPERTIES
    IMPORTED_LOCATION ${CMAKE_CURRENT_SOURCE_DIR}/../../local/jniLibs/${ANDROID_ABI}/libnode.so)

target_link_libraries(nodejs_bridge libnode log)
