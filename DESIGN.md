# Design decisions

## Why PBO double-buffering instead of a single synchronous readback?

A naive `glReadPixels` call blocks the GPU pipeline until the copy finishes.
With two PBOs, each frame's readback is kicked off asynchronously (DMA
transfer happens in the background), and the *previous* frame's buffer —
which has had a full frame's worth of time to finish transferring — is mapped
and read. This means the render thread almost never actually blocks waiting
for a GPU→CPU copy.

## Why a render thread + a separate event thread, not one thread for everything?

`mpv_render_context_render` must be called from the thread that holds the
OpenGL context current — that's a hard constraint, not a style choice. Event
handling (`mpv_wait_event`) doesn't need the GL context at all, and blocking
that thread on GL work would delay property-change/log-message delivery to
JS. Splitting them means a slow frame doesn't stall event delivery, and vice
versa.

## Why hand mpv a hidden window's HDC instead of using ANGLE / ambient GL context?

Electron's own GPU process and any ANGLE-backed context aren't something a
native addon can safely borrow to render onto — you'd be reaching into
Chromium's internal GPU process management, which is exactly the kind of
Electron-version-coupled fragility this project is trying to avoid. A
plain Win32 message-only window (`HWND_MESSAGE`) with its own `HDC` and a
`wglCreateContext` on top is boring, stable, and has been the standard way to
get an offscreen GL context on Windows for decades. Nothing here depends on
Electron internals at all — everything downstream of "frame bytes exist" is
plain N-API + WebGL.

## Why route frames through a UtilityProcess instead of the main process?

If the native addon crashes (a bad driver, an mpv edge case, whatever),
isolating it in a UtilityProcess means it doesn't take the whole app down
with it — the main process and any open windows survive, and you can restart
just the utility process. It also keeps native-module loading out of the
sandboxed renderer process, which can't load native addons directly.

## Why transfer frames via MessagePort instead of `webContents.send`?

`ipcRenderer`/`webContents.send` structured-clones its payload — for a 4K
RGBA frame (~33MB), that's a real copy on every single frame. A `MessagePort`
created via `MessageChannelMain`, with one end handed to the UtilityProcess
and the other end handed directly to the renderer (via the documented
preload → `window.postMessage(..., [port])` handoff), lets frame `ArrayBuffer`s
be *transferred* rather than cloned — no copy, ownership just moves. The one
thing to get right: the `ArrayBuffer` you transfer needs to be a real V8-owned
buffer, not one wrapping N-API "external" memory with a custom finalizer —
see the code comments in `mpv-worker.js` for why.

## Why does the renderer only ever draw the *latest* frame?

If the renderer can't keep up with incoming frames (a slow machine, a busy
main thread), queuing frames up and playing catch-up later means the video
visibly falls behind real-time and never recovers smoothly. Dropping stale
frames and only drawing whatever's newest when `requestAnimationFrame` fires
keeps playback visually in sync with audio, at the cost of the odd skipped
frame under load — a far less noticeable problem than accumulating latency.
