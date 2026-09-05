# electron-mpv-canvas

[![Build](https://github.com/RisingCloud-ui/electron-mpv-canvas/actions/workflows/build.yml/badge.svg)](https://github.com/RisingCloud-ui/electron-mpv-canvas/actions/workflows/build.yml)

**A GPU video rendering bridge for Electron: it hands your app mpv's decoded
frames as a real WebGL texture, not a native window sitting on top of your
UI.** That distinction is the whole point — once video is a texture, it's
just pixels in a `<canvas>`. HTML/CSS controls, subtitle overlays,
frosted-glass toolbars, blend modes, z-index — all of it works the way it
already works on every other DOM element, because that's what the video
region actually is now.

**Status: works on Windows, field-tested.** The code in this repository was
extracted from a production Electron app that has shipped this exact pipeline
(GPU render API → PBO readback → WebGL texture) through real playback on
NVIDIA hardware (nvdec hardware decoding confirmed), including the standalone
native test and the full Electron integration. It is a small, focused codebase
rather than a polished release — macOS/Linux are still unimplemented, and the
API surface may still move. Issues and PRs very welcome.

## What this makes possible

Today, this repo gets you a working video surface inside Electron with full
DOM overlay capability — see "Why this exists" below for exactly what that
solves. But "video is now a texture in a compositing pipeline" is a more
general foundation than "a video player embeds correctly," and it's worth
being explicit about where that foundation can go, **without pretending any
of the further-out items are built yet**:

| | Status |
|---|---|
| Local file + network stream playback, hardware decoding, DOM-composited controls | **Built, field-tested** (this repo) |
| Custom GLSL shaders (e.g. [Anime4K](https://github.com/bloc97/Anime4K)) via mpv's classic `--glsl-shaders` path | **Compatible today** — not wired up as a feature in this repo yet, but nothing in the architecture blocks it; mpv applies shaders before handing over the rendered frame, so it's transparent to everything downstream |
| Reading back the rendered frame for other purposes (screenshots, frame analysis, feeding a separate processing step before display) | **Architecturally possible** — the frame already exists as raw pixels in the readback step; nothing beyond that exists in this repo today |
| AI upscaling / frame interpolation / other GPU-inference-based enhancement | **Not implemented, and not a small step from here.** This needs GPU resource interop (CUDA/DirectML/Vulkan ↔ OpenGL texture sharing) to avoid a costly GPU→CPU→GPU round trip, which is a materially different engineering problem from what this repo currently solves. Tracked as a real but distant roadmap item, not a claim about current capability |
| mpv's newer `libplacebo`-based renderer (`gpu-next`) — better HDR/tone-mapping/Dolby Vision | **Blocked upstream**, not by this repo: mpv's own render API (what embedding requires) [doesn't yet expose gpu-next](https://github.com/mpv-player/mpv/issues/10810) — only `--wid`/standalone window mode can use it as of this writing. Worth knowing if you were hoping for it; not something extracting more code from this repo would fix |

The point of this table isn't to oversell — it's the opposite: to be precise
about exactly one layer that's solid (frame → texture → DOM) versus several
adjacent, genuinely interesting problems that are *not* solved here, so
nobody mistakes "the plumbing exists" for "the advanced features exist."
Full breakdown with what's actually blocking each tier: [`ROADMAP.md`](./ROADMAP.md).

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
  → MessagePort handoff to renderer (structured clone; see DESIGN.md why
    a true zero-copy transfer is not possible inside Electron)
  → WebGL texImage2D + requestAnimationFrame (latest-frame-only, drops stale frames)
```

Full write-up of the design decisions (why PBO double-buffering, why
UtilityProcess instead of the main process, why WGL instead of ANGLE) is in
[`DESIGN.md`](./DESIGN.md).

## Platform status

| Platform | Status |
|---|---|
| Windows | Implemented (WGL offscreen context). Field-tested: standalone + Electron integration, hwdec (nvdec) confirmed, 1080p/1440p/4K60 all hold full frame rate in the source app this was extracted from (canvas at window size — see caveat below). |
| Windows caveat | On hybrid-GPU laptops the driver may downclock the dGPU; a canvas sized to a 4K display then throttles compositing to single-digit fps (frame *delivery* stays at full rate — decode is a fixed-function block and is unaffected). Keep the canvas at window size, or pin the app's GPU preference to "prefer maximum performance". |
| macOS | Not implemented. Would need a CGL/Metal offscreen context in place of `gl_context_win.*`. PRs welcome. |
| Linux | Not implemented. Would need GLX/EGL. PRs welcome. |

> Development currently focuses on Windows production use. macOS/Linux are
> tracked in [`ROADMAP.md`](./ROADMAP.md) (v0.2) — community contributions
> welcome.

## Quick start

```bash
npm install
# Requires: Visual Studio Build Tools (with C++ workload), Node.js, and a
# libmpv Windows dev package (see LICENSING.md for GPL vs LGPL build sources).
# By default the build expects the SDK at ./third_party/mpv-dev — drop your
# SDK there (include/ + libmpv.dll.a + libmpv-2.dll), or set MPV_SDK_DIR to a
# repo-relative path.
npm run build
npm run test:standalone -- path/to/video.mp4   # verify outside Electron first
npm run build:electron
npm start -- path/to/video.mp4                 # auto-plays; or use the Open button
```

The demo window renders the video into a WebGL `<canvas>` with HTML controls
floating on top (play/pause, seek bar, fps counter) — that overlay is the whole
point.

> **Windows toolchain note:** use `@electron/rebuild` ≥ 4.2 (what this repo
> pins). Older 3.x bundles a node-gyp fork that fails on current VS Build
> Tools / Python. See [`README-BUILD.md`](./README-BUILD.md).

See [`README-BUILD.md`](./README-BUILD.md) for the full build/troubleshooting
guide.

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
