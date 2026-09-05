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
    // Extension functions (FBO/PBO and other 3.x+ entry points mpv needs) go
    // through wglGetProcAddress
    void *p = (void *)wglGetProcAddress(name);
    // Some drivers return the sentinel values 0/1/2/3/-1 for missing functions
    // instead of a null pointer — filter those out
    if (p == nullptr || p == (void *)0x1 || p == (void *)0x2 ||
        p == (void *)0x3 || p == (void *)-1) {
        // Fall back to the GL 1.1 core functions in opengl32.dll
        // (glGetString / glBindTexture / glReadPixels / ...)
        if (!gOpenGL32Module) {
            gOpenGL32Module = GetModuleHandleA("opengl32.dll");
        }
        if (gOpenGL32Module) {
            p = (void *)GetProcAddress(gOpenGL32Module, name);
        }
    }
    return p;
}
