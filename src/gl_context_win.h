// gl_context_win.h
// Creates an invisible message-only window (HWND_MESSAGE), attaches a
// compatibility pixel format and builds a WGL context. The context exists
// solely to host libmpv's opengl render API — the user never sees it; it is
// purely an offscreen rendering host.
#pragma once
#include <windows.h>
#include <GL/gl.h>

class GlOffscreenContext {
public:
    bool Create();
    void Destroy();
    bool MakeCurrent();   // Call on the render thread; binds the context to it
    void Unbind();
    HGLRC GetHglrc() const { return hglrc_; }

private:
    HWND hwnd_ = nullptr;
    HDC hdc_ = nullptr;
    HGLRC hglrc_ = nullptr;
};
