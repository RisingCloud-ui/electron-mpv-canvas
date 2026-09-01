// gl_context_win.h
// 创建一个不可见的消息窗口(HWND_MESSAGE),挂上一个兼容像素格式,
// 建立 WGL 上下文。这个上下文只用来给 libmpv 的 opengl render API 渲染,
// 从头到尾不会被用户看到,纯粹是离屏渲染的宿主。
#pragma once
#include <windows.h>
#include <GL/gl.h>

class GlOffscreenContext {
public:
    bool Create();
    void Destroy();
    bool MakeCurrent();   // 在渲染线程里调用,把上下文绑定到当前线程
    void Unbind();
    HGLRC GetHglrc() const { return hglrc_; }

private:
    HWND hwnd_ = nullptr;
    HDC hdc_ = nullptr;
    HGLRC hglrc_ = nullptr;
};
