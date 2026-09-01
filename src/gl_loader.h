// gl_loader.h
// Windows 的 opengl32.lib 只暴露 OpenGL 1.1 的函数。FBO / PBO 相关函数(GL 3.0+/ARB)
// 必须在运行时通过 wglGetProcAddress 自己拿函数指针,这里手写一个最小加载器,
// 避免引入 GLEW/GLAD 之类的第三方依赖(减少构建链上的不确定性)。
#pragma once
#include <windows.h>
#include <GL/gl.h>

// ---- 手动声明缺失的常量(来自 Khronos 官方枚举值,跨厂商稳定) ----
#ifndef GL_FRAMEBUFFER
#define GL_FRAMEBUFFER 0x8D40
#define GL_COLOR_ATTACHMENT0 0x8CE0
#define GL_FRAMEBUFFER_COMPLETE 0x8CD5
#define GL_RGBA8 0x8058
#define GL_PIXEL_PACK_BUFFER 0x88EB
#define GL_STREAM_READ 0x88E1
#define GL_READ_ONLY 0x88B8
#define GL_MAP_READ_BIT 0x0001
#endif

typedef ptrdiff_t GLsizeiptr;
typedef ptrdiff_t GLintptr;
typedef char GLchar;

typedef void (APIENTRY *PFNGLGENFRAMEBUFFERSPROC)(GLsizei n, GLuint *framebuffers);
typedef void (APIENTRY *PFNGLBINDFRAMEBUFFERPROC)(GLenum target, GLuint framebuffer);
typedef void (APIENTRY *PFNGLFRAMEBUFFERTEXTURE2DPROC)(GLenum target, GLenum attachment, GLenum textarget, GLuint texture, GLint level);
typedef GLenum (APIENTRY *PFNGLCHECKFRAMEBUFFERSTATUSPROC)(GLenum target);
typedef void (APIENTRY *PFNGLDELETEFRAMEBUFFERSPROC)(GLsizei n, const GLuint *framebuffers);
typedef void (APIENTRY *PFNGLGENBUFFERSPROC)(GLsizei n, GLuint *buffers);
typedef void (APIENTRY *PFNGLBINDBUFFERPROC)(GLenum target, GLuint buffer);
typedef void (APIENTRY *PFNGLBUFFERDATAPROC)(GLenum target, GLsizeiptr size, const void *data, GLenum usage);
typedef void *(APIENTRY *PFNGLMAPBUFFERRANGEPROC)(GLenum target, GLintptr offset, GLsizeiptr length, GLbitfield access);
typedef GLboolean (APIENTRY *PFNGLUNMAPBUFFERPROC)(GLenum target);
typedef void (APIENTRY *PFNGLDELETEBUFFERSPROC)(GLsizei n, const GLuint *buffers);

struct GlFunctions {
    PFNGLGENFRAMEBUFFERSPROC glGenFramebuffers = nullptr;
    PFNGLBINDFRAMEBUFFERPROC glBindFramebuffer = nullptr;
    PFNGLFRAMEBUFFERTEXTURE2DPROC glFramebufferTexture2D = nullptr;
    PFNGLCHECKFRAMEBUFFERSTATUSPROC glCheckFramebufferStatus = nullptr;
    PFNGLDELETEFRAMEBUFFERSPROC glDeleteFramebuffers = nullptr;
    PFNGLGENBUFFERSPROC glGenBuffers = nullptr;
    PFNGLBINDBUFFERPROC glBindBuffer = nullptr;
    PFNGLBUFFERDATAPROC glBufferData = nullptr;
    PFNGLMAPBUFFERRANGEPROC glMapBufferRange = nullptr;
    PFNGLUNMAPBUFFERPROC glUnmapBuffer = nullptr;
    PFNGLDELETEBUFFERSPROC glDeleteBuffers = nullptr;
};

// 全局单例,GL 上下文 current 之后调用一次 LoadGlFunctions()
extern GlFunctions gGl;

// 加载上面这些扩展函数指针。必须在 wglMakeCurrent 之后调用。
bool LoadGlFunctions();

// 提供给 libmpv render API 的 get_proc_address 回调,同时兼容
// 1.1 核心函数(走 opengl32.dll 的 GetProcAddress)和扩展函数(走 wglGetProcAddress)。
void *MpvGetProcAddress(void *ctx, const char *name);
