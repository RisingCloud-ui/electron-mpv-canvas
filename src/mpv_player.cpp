#include "mpv_player.h"
#include "gl_loader.h"
#include <cstdio>

MpvPlayer::MpvPlayer() {}
MpvPlayer::~MpvPlayer() { Shutdown(); }

void MpvPlayer::OnMpvRenderUpdate(void *ctx) {
    // 这个回调可能从 mpv 内部的任意线程触发,只做最轻量的事:置位标志、唤醒渲染线程。
    // 不能在这里直接调用 GL/渲染逻辑。
    auto *self = static_cast<MpvPlayer *>(ctx);
    {
        std::lock_guard<std::mutex> lk(self->renderMutex_);
        self->renderSignaled_ = true;
    }
    self->renderCv_.notify_one();
}

bool MpvPlayer::Init(int width, int height, std::string *errorOut) {
    width_ = width;
    height_ = height;

    mpv_ = mpv_create();
    if (!mpv_) {
        if (errorOut) *errorOut = "mpv_create failed";
        return false;
    }

    // ---- 硬解 + 画质相关选项 ----
    mpv_set_option_string(mpv_, "hwdec", "auto");      // 硬件解码,Windows 上通常落到 d3d11va
    mpv_set_option_string(mpv_, "vo", "libmpv");       // 通过 render API 而不是自己开窗口
    mpv_set_option_string(mpv_, "gpu-api", "opengl");
    mpv_set_option_string(mpv_, "keep-open", "yes");
    mpv_set_option_string(mpv_, "video-timing-offset", "0");

    if (mpv_initialize(mpv_) < 0) {
        if (errorOut) *errorOut = "mpv_initialize failed";
        return false;
    }

    if (!glCtx_.Create()) {
        if (errorOut) *errorOut = "failed to create offscreen WGL context";
        return false;
    }
    if (!glCtx_.MakeCurrent()) {
        if (errorOut) *errorOut = "wglMakeCurrent failed";
        return false;
    }
    if (!LoadGlFunctions()) {
        if (errorOut) *errorOut = "failed to load required GL extension functions (need GL 3.0+ driver)";
        return false;
    }

    mpv_opengl_init_params glInitParams{};
    glInitParams.get_proc_address = MpvGetProcAddress;
    glInitParams.get_proc_address_ctx = nullptr;

    int advanced = 1;
    mpv_render_param params[] = {
        {MPV_RENDER_PARAM_API_TYPE, const_cast<char *>(MPV_RENDER_API_TYPE_OPENGL)},
        {MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &glInitParams},
        {MPV_RENDER_PARAM_ADVANCED_CONTROL, &advanced},
        {MPV_RENDER_PARAM_INVALID, nullptr}};

    if (mpv_render_context_create(&renderCtx_, mpv_, params) < 0) {
        if (errorOut) *errorOut = "mpv_render_context_create failed";
        return false;
    }
    mpv_render_context_set_update_callback(renderCtx_, OnMpvRenderUpdate, this);

    EnsureFboAndPbo(width_, height_);
    glCtx_.Unbind(); // 渲染线程会自己重新 MakeCurrent

    running_ = true;
    renderThread_ = std::thread(&MpvPlayer::RenderThreadMain, this);
    eventThread_ = std::thread(&MpvPlayer::EventThreadMain, this);
    return true;
}

void MpvPlayer::EnsureFboAndPbo(int w, int h) {
    if (fbo_ != 0 && pboW_ == w && pboH_ == h) return; // 尺寸没变,复用
    DestroyGlResources();

    glGenTextures(1, &fboTex_);
    glBindTexture(GL_TEXTURE_2D, fboTex_);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, w, h, 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);

    gGl.glGenFramebuffers(1, &fbo_);
    gGl.glBindFramebuffer(GL_FRAMEBUFFER, fbo_);
    gGl.glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, fboTex_, 0);
    GLenum status = gGl.glCheckFramebufferStatus(GL_FRAMEBUFFER);
    if (status != GL_FRAMEBUFFER_COMPLETE) {
        fprintf(stderr, "[mpv_addon] FBO incomplete: 0x%x\n", status);
    }
    gGl.glBindFramebuffer(GL_FRAMEBUFFER, 0);

    size_t bufSize = static_cast<size_t>(w) * h * 4;
    gGl.glGenBuffers(2, pbo_);
    for (int i = 0; i < 2; i++) {
        gGl.glBindBuffer(GL_PIXEL_PACK_BUFFER, pbo_[i]);
        gGl.glBufferData(GL_PIXEL_PACK_BUFFER, bufSize, nullptr, GL_STREAM_READ);
    }
    gGl.glBindBuffer(GL_PIXEL_PACK_BUFFER, 0);

    pboW_ = w;
    pboH_ = h;
    pboWriteIndex_ = 0;
    framesRendered_ = 0;
}

void MpvPlayer::DestroyGlResources() {
    if (fbo_) { gGl.glDeleteFramebuffers(1, &fbo_); fbo_ = 0; }
    if (fboTex_) { glDeleteTextures(1, &fboTex_); fboTex_ = 0; }
    if (pbo_[0] || pbo_[1]) { gGl.glDeleteBuffers(2, pbo_); pbo_[0] = pbo_[1] = 0; }
}

void MpvPlayer::RenderThreadMain() {
    if (!glCtx_.MakeCurrent()) {
        fprintf(stderr, "[mpv_addon] render thread: wglMakeCurrent failed\n");
        return;
    }

    while (running_) {
        {
            std::unique_lock<std::mutex> lk(renderMutex_);
            renderCv_.wait(lk, [this] { return renderSignaled_.load() || !running_; });
            renderSignaled_ = false;
        }
        if (!running_) break;

        uint64_t flags = mpv_render_context_update(renderCtx_);
        if (!(flags & MPV_RENDER_UPDATE_FRAME)) continue;

        int w, h;
        {
            std::lock_guard<std::mutex> lk(sizeMutex_);
            w = width_;
            h = height_;
        }
        EnsureFboAndPbo(w, h);

        mpv_opengl_fbo mpvFbo{};
        mpvFbo.fbo = static_cast<int>(fbo_);
        mpvFbo.w = w;
        mpvFbo.h = h;
        mpvFbo.internal_format = GL_RGBA8;

        int flipY = 0; // 实测:glReadPixels 自带自底向上翻转,再 flipY=1 会二次翻转成倒像(skeleton 未编译验证的猜测,阶段 0 实测修正)
        mpv_render_param renderParams[] = {
            {MPV_RENDER_PARAM_OPENGL_FBO, &mpvFbo},
            {MPV_RENDER_PARAM_FLIP_Y, &flipY},
            {MPV_RENDER_PARAM_INVALID, nullptr}};
        mpv_render_context_render(renderCtx_, renderParams);

        // ---- 异步 PBO 读回:写入本帧到 pboWriteIndex_,读取"上一帧"的另一个 PBO ----
        size_t bufSize = static_cast<size_t>(w) * h * 4;
        gGl.glBindFramebuffer(GL_FRAMEBUFFER, fbo_);
        gGl.glBindBuffer(GL_PIXEL_PACK_BUFFER, pbo_[pboWriteIndex_]);
        glReadPixels(0, 0, w, h, GL_RGBA, GL_UNSIGNED_BYTE, nullptr); // offset=0,写入当前绑定的 PBO
        gGl.glBindBuffer(GL_PIXEL_PACK_BUFFER, 0);
        gGl.glBindFramebuffer(GL_FRAMEBUFFER, 0);

        int readIndex = 1 - pboWriteIndex_;
        framesRendered_++;
        if (framesRendered_ > 1 && frameCallback_) {
            // 这个 PBO 里的数据是上一次迭代发起的 glReadPixels,
            // 经过了一整帧的时间,DMA 传输大概率已经完成,map 时几乎不会阻塞。
            gGl.glBindBuffer(GL_PIXEL_PACK_BUFFER, pbo_[readIndex]);
            void *ptr = gGl.glMapBufferRange(GL_PIXEL_PACK_BUFFER, 0, bufSize, GL_MAP_READ_BIT);
            if (ptr) {
                // 阶段 0 优化:直接把映射内存交给回调(addon.cpp 同步 memcpy 进 FrameData),
                // 省掉 skeleton 的 scratch 中转拷贝(原①②两次合成一次)。
                frameCallback_(static_cast<const uint8_t *>(ptr), bufSize, w, h);
                gGl.glUnmapBuffer(GL_PIXEL_PACK_BUFFER);
            }
            gGl.glBindBuffer(GL_PIXEL_PACK_BUFFER, 0);
        }
        pboWriteIndex_ = readIndex;
    }

    DestroyGlResources();
    glCtx_.Unbind();
}

void MpvPlayer::EventThreadMain() {
    while (running_) {
        mpv_event *event = mpv_wait_event(mpv_, 0.5); // 超时轮询,方便响应 running_=false
        if (event->event_id == MPV_EVENT_NONE) continue;
        if (event->event_id == MPV_EVENT_SHUTDOWN) break;
        if (eventCallback_) eventCallback_(event);
    }
}

void MpvPlayer::Resize(int width, int height) {
    {
        std::lock_guard<std::mutex> lk(sizeMutex_);
        width_ = width;
        height_ = height;
    }
    // 借用渲染信号机制触发一次重建 + 重绘
    {
        std::lock_guard<std::mutex> lk(renderMutex_);
        renderSignaled_ = true;
    }
    renderCv_.notify_one();
}

bool MpvPlayer::Command(const std::vector<std::string> &args, std::string *errorOut) {
    std::vector<const char *> cargs;
    for (auto &s : args) cargs.push_back(s.c_str());
    cargs.push_back(nullptr);
    int rc = mpv_command(mpv_, cargs.data());
    if (rc < 0 && errorOut) *errorOut = mpv_error_string(rc);
    return rc >= 0;
}

bool MpvPlayer::SetPropertyString(const std::string &name, const std::string &value, std::string *errorOut) {
    int rc = mpv_set_property_string(mpv_, name.c_str(), value.c_str());
    if (rc < 0 && errorOut) *errorOut = mpv_error_string(rc);
    return rc >= 0;
}

bool MpvPlayer::GetPropertyString(const std::string &name, std::string *valueOut, std::string *errorOut) {
    char *result = mpv_get_property_string(mpv_, name.c_str());
    if (!result) {
        if (errorOut) *errorOut = "property not available";
        return false;
    }
    *valueOut = result;
    mpv_free(result);
    return true;
}

bool MpvPlayer::ObserveProperty(const std::string &name, mpv_format format, uint64_t userData) {
    return mpv_observe_property(mpv_, userData, name.c_str(), format) >= 0;
}

void MpvPlayer::Shutdown() {
    if (!running_) return;
    running_ = false;
    renderCv_.notify_all();
    if (renderThread_.joinable()) renderThread_.join();

    if (mpv_) mpv_wakeup(mpv_); // 唤醒 event 线程里的 mpv_wait_event
    if (eventThread_.joinable()) eventThread_.join();

    if (renderCtx_) { mpv_render_context_free(renderCtx_); renderCtx_ = nullptr; }
    if (mpv_) { mpv_terminate_destroy(mpv_); mpv_ = nullptr; }
}
