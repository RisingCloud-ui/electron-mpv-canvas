// mpv_player.h
// Core class: owns the libmpv handle + opengl render context + a render thread
// + an event thread.
// Render thread: waits for mpv's "new frame available" signal
//                -> mpv_render_context_render into the FBO
//                -> async glReadPixels into a PBO (double-buffered)
//                -> maps the PBO holding the *previous* frame, whose DMA has by
//                now completed, copies it and hands it to the upper-layer
//                callback (invoked on the render thread; the upper layer
//                forwards it to the JS thread via an N-API ThreadSafeFunction).
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

// Callback types injected by the upper layer (addon.cpp)
// FrameCallback: invoked when the render thread produces a frame. `data` is only
//                valid inside the callback — copy it or take ownership.
using FrameCallback = std::function<void(const uint8_t *data, size_t size, int w, int h)>;
// EventCallback: forwards mpv events (property changes, log messages, end of playback, ...)
using EventCallback = std::function<void(mpv_event *event)>;

class MpvPlayer {
public:
    MpvPlayer();
    ~MpvPlayer();

    // width/height: initial render resolution; adjust later via Resize()
    bool Init(int width, int height, std::string *errorOut);
    void Shutdown();

    // Playback controls. These libmpv calls are thread-safe and can be made
    // directly from the N-API thread
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
    void EnsureFboAndPbo(int w, int h); // must run on the render thread with the GL context current
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

    // Render size, updated by Resize(); mutex-guarded until the render thread consumes it
    std::mutex sizeMutex_;
    int width_ = 0;
    int height_ = 0;
    bool sizeDirty_ = false;

    // GL resources: FBO + color-attachment texture + two PBOs (double-buffered async readback)
    unsigned int fbo_ = 0;
    unsigned int fboTex_ = 0;
    unsigned int pbo_[2] = {0, 0};
    int pboW_ = 0, pboH_ = 0;
    int pboWriteIndex_ = 0;
    int framesRendered_ = 0; // the first two frames have no "previous frame" PBO to read — skip them

    FrameCallback frameCallback_;
    EventCallback eventCallback_;
};
