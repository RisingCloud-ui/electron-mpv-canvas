# electron-mpv-canvas

Render [mpv](https://mpv.io)'s video output as a real WebGL texture inside an
Electron page — so your HTML/CSS controls (progress bar, subtitles overlay,
frosted-glass toolbars, whatever) sit *on top of* the video like any other DOM
element, instead of being covered by a separate native window.

**Status: early / unverified.** This is a from-scratch implementation of a
documented architecture pattern (GPU render API → PBO readback → WebGL
texture), built and type-checked, but **not yet build-tested on real Windows
hardware**. Treat it as "structurally correct, needs field-testing" rather
than a polished release. Issues and PRs very welcome — this is exactly the
stage where real-hardware feedback matters most.

## Why this exists

Every existing way to put mpv inside an Electron app has a real problem:

- **[mpv.js](https://github.com/Kagami/mpv.js)** (Kagami) embeds mpv as a
  Chromium PPAPI plugin — genuinely elegant when it worked, but Chromium has
  deprecated and removed PPAPI plugin support, and Electron tracks Chromium.
  This approach no longer works on current Electron/Chromium versions.
- **`--wid` window embedding** (mpv's native window-handle embedding) makes
  mpv a native child window sitting on top of Electron's Chromium-rendered
  content at the OS compositor level — HTML controls can't reliably overlay
  it. [IPTVnator](https://iptvnator.org), a real shipping Electron app, tried
  this and moved away from it because it wasn't reliable enough on macOS
  (audio playing with a black video surface). It's also unsupported on
  Wayland.
- **Spawning `mpv.exe` as a subprocess** with `--wid` gets you a *window*, not
  a *DOM element* — still the same overlay problem.

`electron-mpv-canvas` takes a different path: mpv never gets its own window.
libmpv's [render API](https://github.com/mpv-player/mpv/blob/master/libmpv/render.h)
renders each frame into an offscreen OpenGL FBO, the pixels are read back via
a double-buffered PBO (one GPU→CPU copy per frame, not per-pixel round trips),
and handed to the Electron renderer process where a `<canvas>`'s WebGL context
uploads them as a texture. The video is just pixels in a `<canvas>` — CSS,
z-index, blend modes, all work normally.

## Architecture

```
libmpv (hwdec + opengl render API)
  → offscreen FBO render (Windows: hidden-window WGL context)
  → double-buffered PBO async readback (one copy, not a busy-wait)
  → N-API ThreadSafeFunction → Electron UtilityProcess
  → MessagePort transfer (ArrayBuffer, not structured-clone copy) → renderer
  → WebGL texImage2D + requestAnimationFrame (latest-frame-only, drops stale frames)
```

Full write-up of the design decisions (why PBO double-buffering, why
UtilityProcess instead of the main process, why WGL instead of ANGLE) is in
[`DESIGN.md`](./DESIGN.md).

## Platform status

| Platform | Status |
|---|---|
| Windows | Implemented (WGL offscreen context). Untested on real hardware — see Status above. |
| macOS | Not implemented. Would need a CGL/Metal offscreen context in place of `gl_context_win.*`. PRs welcome. |
| Linux | Not implemented. Would need GLX/EGL. PRs welcome. |

## Quick start

```bash
npm install
# Requires: Visual Studio Build Tools, a libmpv Windows dev package
# (see LICENSING.md for GPL vs LGPL build sources), MPV_SDK_DIR env var set.
npm run build
npm run test:standalone -- path/to/video.mp4   # verify outside Electron first
npm run build:electron
npm start
```

See [`README-BUILD.md`](./README-BUILD.md) for the full build/troubleshooting
guide (this was the original skeleton's README; kept as-is since the build
instructions are still accurate).

## Licensing — read this before you ship

This project's own code is MIT. **libmpv itself is GPLv2+ by default**; an
LGPLv2.1+ build is possible via `-Dgpl=false` (and a matching non-GPL FFmpeg
build), which is what you need if you're linking this into closed-source
software. This project does not bundle any libmpv binary — you supply your
own build, and its license terms are your responsibility. See
[`LICENSING.md`](./LICENSING.md) for a longer explanation and known LGPL
Windows build sources.

## Contributing

Issues and PRs welcome, especially: real-hardware testing reports (any
platform), macOS/Linux offscreen-context implementations, and anything found
while actually wiring this into a real app. See [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## License

MIT — see [`LICENSE`](./LICENSE). Runtime dependency (libmpv) is separately
licensed; see Licensing section above.
