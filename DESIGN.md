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

## Why send frames via MessagePort instead of `webContents.send`?

`ipcRenderer`/`webContents.send` structured-clones its payload — for a 4K
RGBA frame (~33MB), that's a real copy on every single frame. A `MessagePort`
created via `MessageChannelMain`, with one end handed to the UtilityProcess
and the other end handed directly to the renderer (via the documented
preload → `window.postMessage(..., [port])` handoff), skips the main process
entirely: frames flow worker → renderer without an extra hop through the
main process's JS. (Originally the hope was *zero-copy* ArrayBuffer transfer
here; reality inside Electron is more constrained — see "Field-tested
constraints" below.)

## Field-tested constraints (learned the hard way, verified on hardware)

These were discovered by actually building and running this pipeline inside a
production Electron app. They contradict what the docs alone would suggest:

1. **Electron forbids external buffers.** `napi_create_external_buffer` is
   disabled in Electron (`NAPI_NO_EXTERNAL_BUFFERS`) — you cannot wrap the
   addon's own memory in a zero-copy Buffer. Standalone Node allows it, so
   the standalone test can hide this bug. The addon must `Buffer::Copy`.
2. **MessagePort transferList rejects ArrayBuffers.** Inside a
   utilityProcess, `port.postMessage(msg, [arrayBuffer])` throws
   "Port at index 0 is not a valid port" — only MessagePorts are transferable.
   So frames cross via structured clone of a Node `Buffer` (itself a clonable
   view): one copy, but no main-process hop and no per-frame `postMessage`
   through `webContents`.
3. **`flipY`: glReadPixels is already bottom-up.** Flipping again in the
   shader yields an upside-down image. Verified empirically; the pixel path
   needs no flip at all.
4. **`stdio: 'inherit'` silently loses worker logs on Windows.** Use
   `stdio: 'pipe'` and forward the streams yourself (guard the writes — a
   dead terminal must not take the main process down via EPIPE).
5. **MSVC reads UTF-8 sources as GBK** unless `/utf-8` is passed. A full-width
   punctuation byte at end of a comment line swallows the newline and merges
   the next code line into the comment — with error line numbers that point
   nowhere. `binding.gyp` sets it; keep it.
6. **A MessagePort can only be transferred once.** Every renderer
   (re)mount must request a fresh `MessageChannel` — the worker keeps
   whichever port arrived last and drops the old one on its `close` event.
   Hardcoding one port in the startup flow breaks page reloads and
   multi-mount UIs.
7. **`loop-file=inf` swallows EOF.** Playback-end detection reads the
   `eof-reached` property (set under `keep-open=yes`), not the `end-file`
   event — seeking/loading files also fires `end-file`, which would
   conflate "user switched file" with "playback finished". Never loop by
   default; the property only sets on natural end or error-induced idle.
8. **DLL loading is PATH-based.** `libmpv-2.dll` has no explicit
   `LoadLibrary` path, so the worker's `PATH` gets the SDK directory
   prepended at fork time (see `mpv-service.js`) — don't rely on the DLL
   being globally installed.
9. **Toolchain:** `@electron/rebuild` ≥ 4.2 (older 3.x bundles a node-gyp
   fork that fails on current VS Build Tools / Python), `node-gyp` ≥ 13,
   `/utf-8` as above.

## Why does the renderer only ever draw the *latest* frame?

If the renderer can't keep up with incoming frames (a slow machine, a busy
main thread), queuing frames up and playing catch-up later means the video
visibly falls behind real-time and never recovers smoothly. Dropping stale
frames and only drawing whatever's newest when `requestAnimationFrame` fires
keeps playback visually in sync with audio, at the cost of the odd skipped
frame under load — a far less noticeable problem than accumulating latency.
