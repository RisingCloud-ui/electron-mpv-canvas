#include "gl_loader.h"

GlFunctions gGl;

static HMODULE gOpenGL32Module = nullptr;

bool LoadGlFunctions() {
    gGl.glGenFramebuffers = (PFNGLGENFRAMEBUFFERSPROC)wglGetProcAddress("glGenFramebuffers");
    gGl.glBindFramebuffer = (PFNGLBINDFRAMEBUFFERPROC)wglGetProcAddress("glBindFramebuffer");
    gGl.glFramebufferTexture2D = (PFNGLFRAMEBUFFERTEXTURE2DPROC)wglGetProcAddress("glFramebufferTexture2D");
    gGl.glCheckFramebufferStatus = (PFNGLCHECKFRAMEBUFFERSTATUSPROC)wglGetProcAddress("glCheckFramebufferStatus");
    gGl.glDeleteFramebuffers = (PFNGLDELETEFRAMEBUFFERSPROC)wglGetProcAddress("glDeleteFramebuffers");
    gGl.glGenBuffers = (PFNGLGENBUFFERSPROC)wglGetProcAddress("glGenBuffers");
    gGl.glBindBuffer = (PFNGLBINDBUFFERPROC)wglGetProcAddress("glBindBuffer");
    gGl.glBufferData = (PFNGLBUFFERDATAPROC)wglGetProcAddress("glBufferData");
    gGl.glMapBufferRange = (PFNGLMAPBUFFERRANGEPROC)wglGetProcAddress("glMapBufferRange");
    gGl.glUnmapBuffer = (PFNGLUNMAPBUFFERPROC)wglGetProcAddress("glUnmapBuffer");
    gGl.glDeleteBuffers = (PFNGLDELETEBUFFERSPROC)wglGetProcAddress("glDeleteBuffers");

    return gGl.glGenFramebuffers && gGl.glBindFramebuffer && gGl.glFramebufferTexture2D &&
           gGl.glCheckFramebufferStatus && gGl.glGenBuffers && gGl.glBindBuffer &&
           gGl.glBufferData && gGl.glMapBufferRange && gGl.glUnmapBuffer;
}

void *MpvGetProcAddress(void * /*ctx*/, const char *name) {
    // 扩展函数(FBO/PBO/以及 mpv 需要的其它 3.x+ 函数)走 wglGetProcAddress
    void *p = (void *)wglGetProcAddress(name);
    // 部分驱动对不存在的函数返回 0/1/2/3/-1 这几个哨兵值,不是合法指针,要过滤掉
    if (p == nullptr || p == (void *)0x1 || p == (void *)0x2 ||
        p == (void *)0x3 || p == (void *)-1) {
        // 回退到 opengl32.dll 里的 1.1 核心函数(glGetString / glBindTexture / glReadPixels 等)
        if (!gOpenGL32Module) {
            gOpenGL32Module = GetModuleHandleA("opengl32.dll");
        }
        if (gOpenGL32Module) {
            p = (void *)GetProcAddress(gOpenGL32Module, name);
        }
    }
    return p;
}
