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
    // RegisterClass may already exist across Create/Destroy cycles (e.g. the
    // addon being re-initialized) — ignore the failure
    RegisterClassW(&wc);

    // HWND_MESSAGE: a message-only window — never shown, no taskbar entry;
    // exists purely to obtain a valid HDC
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
    pfd.cDepthBits = 0;   // no depth buffer needed for offscreen video frames
    pfd.iLayerType = PFD_MAIN_PLANE;

    int pf = ChoosePixelFormat(hdc_, &pfd);
    if (pf == 0 || !SetPixelFormat(hdc_, pf, &pfd)) return false;

    hglrc_ = wglCreateContext(hdc_);
    if (!hglrc_) return false;

    // Note: this creates the driver's default compatibility context (its function
    // pointers usually reach GL 3.x/4.x; the core-profile features used at render
    // time are loaded on demand via wglGetProcAddress in gl_loader.cpp). If mpv
    // complains about an insufficient GL version on older drivers, switch to
    // wglCreateContextAttribsARB here to request a core profile explicitly — see
    // the troubleshooting guide in README-BUILD.md.
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
