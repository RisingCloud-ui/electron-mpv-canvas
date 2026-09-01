#include "gl_context_win.h"
#include <cstdio>

static const wchar_t *kWndClassName = L"MpvOffscreenGlHost";

static LRESULT CALLBACK DummyWndProc(HWND h, UINT m, WPARAM w, LPARAM l) {
    return DefWindowProcW(h, m, w, l);
}

bool GlOffscreenContext::Create() {
    WNDCLASSW wc = {};
    wc.lpfnWndProc = DummyWndProc;
    wc.hInstance = GetModuleHandleW(nullptr);
    wc.lpszClassName = kWndClassName;
    // 多次 Create/Destroy(比如 addon 重复初始化)时 RegisterClass 可能已存在,忽略失败即可
    RegisterClassW(&wc);

    // HWND_MESSAGE:消息专用窗口,不会显示、不占任务栏,纯粹用来拿一个合法的 HDC
    hwnd_ = CreateWindowW(kWndClassName, L"", 0, 0, 0, 0, 0,
                          HWND_MESSAGE, nullptr, wc.hInstance, nullptr);
    if (!hwnd_) return false;

    hdc_ = GetDC(hwnd_);
    if (!hdc_) return false;

    PIXELFORMATDESCRIPTOR pfd = {};
    pfd.nSize = sizeof(pfd);
    pfd.nVersion = 1;
    pfd.dwFlags = PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL | PFD_DOUBLEBUFFER;
    pfd.iPixelType = PFD_TYPE_RGBA;
    pfd.cColorBits = 32;
    pfd.cDepthBits = 0;   // 离屏渲染视频帧不需要深度缓冲
    pfd.iLayerType = PFD_MAIN_PLANE;

    int pf = ChoosePixelFormat(hdc_, &pfd);
    if (pf == 0 || !SetPixelFormat(hdc_, pf, &pfd)) return false;

    hglrc_ = wglCreateContext(hdc_);
    if (!hglrc_) return false;

    // 注意:这里创建的是驱动默认版本的兼容上下文(通常足以支持到 GL 3.x/4.x 的函数指针,
    // 具体渲染时用到的核心 profile 特性由 gl_loader.cpp 里的 wglGetProcAddress 按需加载)。
    // 如果目标机器驱动较老导致 mpv 报 GL 版本不足,可以在这里改用
    // wglCreateContextAttribsARB 显式请求 core profile,详见 README 的"疑难排查"部分。
    return true;
}

bool GlOffscreenContext::MakeCurrent() {
    if (!hdc_ || !hglrc_) return false;
    return wglMakeCurrent(hdc_, hglrc_) == TRUE;
}

void GlOffscreenContext::Unbind() {
    wglMakeCurrent(nullptr, nullptr);
}

void GlOffscreenContext::Destroy() {
    Unbind();
    if (hglrc_) { wglDeleteContext(hglrc_); hglrc_ = nullptr; }
    if (hdc_ && hwnd_) { ReleaseDC(hwnd_, hdc_); hdc_ = nullptr; }
    if (hwnd_) { DestroyWindow(hwnd_); hwnd_ = nullptr; }
}
