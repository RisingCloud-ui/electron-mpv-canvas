// mpv_player.h
// 核心类:持有 libmpv 句柄 + opengl render context + 渲染线程 + 事件线程。
// 渲染线程职责:等待 mpv 发出"有新帧"信号 -> mpv_render_context_render 到 FBO
//              -> glReadPixels 异步写入 PBO(双缓冲)-> 把"上一帧"已经 DMA
//              完成的 PBO 映射出来,拷贝一份交给上层回调(在渲染线程里调用,
//              上层用 N-API ThreadSafeFunction 转发到 JS 线程)。
#pragma once

#include <mpv/client.h>
#include <mpv/render_gl.h>
#include <windows.h>
#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <functional>
#include <mutex>
#include <thread>
#include <vector>

#include "gl_context_win.h"

// 上层(addon.cpp)注入的回调类型
// FrameCallback: 渲染线程产出一帧后调用,data 的生命周期只在回调内有效,
//                上层需要自己拷贝/转移所有权。
using FrameCallback = std::function<void(const uint8_t *data, size_t size, int w, int h)>;
// EventCallback: mpv 事件(属性变化、日志、播放结束等)转发
using EventCallback = std::function<void(mpv_event *event)>;

class MpvPlayer {
public:
    MpvPlayer();
    ~MpvPlayer();

    // width/height: 初始渲染分辨率,后续可以用 Resize() 调整
    bool Init(int width, int height, std::string *errorOut);
    void Shutdown();

    // 播放控制,libmpv 的这些调用本身是线程安全的,可以直接从 N-API 线程调用
    bool Command(const std::vector<std::string> &args, std::string *errorOut);
    bool SetPropertyString(const std::string &name, const std::string &value, std::string *errorOut);
    bool GetPropertyString(const std::string &name, std::string *valueOut, std::string *errorOut);
    bool ObserveProperty(const std::string &name, mpv_format format, uint64_t userData);

    void Resize(int width, int height);

    void SetFrameCallback(FrameCallback cb) { frameCallback_ = std::move(cb); }
    void SetEventCallback(EventCallback cb) { eventCallback_ = std::move(cb); }

private:
    void RenderThreadMain();
    void EventThreadMain();
    void EnsureFboAndPbo(int w, int h); // 必须在渲染线程、GL 上下文 current 时调用
    void DestroyGlResources();

    static void OnMpvRenderUpdate(void *ctx);

    mpv_handle *mpv_ = nullptr;
    mpv_render_context *renderCtx_ = nullptr;
    GlOffscreenContext glCtx_;

    std::thread renderThread_;
    std::thread eventThread_;
    std::atomic<bool> running_{false};

    std::mutex renderMutex_;
    std::condition_variable renderCv_;
    std::atomic<bool> renderSignaled_{false};

    // 渲染尺寸,受 Resize() 影响,渲染线程消费前用 mutex 保护
    std::mutex sizeMutex_;
    int width_ = 0;
    int height_ = 0;
    bool sizeDirty_ = false;

    // GL 资源:FBO + 颜色附件纹理 + 两个 PBO(双缓冲异步读回)
    unsigned int fbo_ = 0;
    unsigned int fboTex_ = 0;
    unsigned int pbo_[2] = {0, 0};
    int pboW_ = 0, pboH_ = 0;
    int pboWriteIndex_ = 0;
    int framesRendered_ = 0; // 前两帧还没有"上一帧"数据可读,先跳过

    FrameCallback frameCallback_;
    EventCallback eventCallback_;
};
