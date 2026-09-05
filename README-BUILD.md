# Build & Troubleshooting Guide (Windows)

Architecture: libmpv's `opengl` render API (hardware decoding + GPU scaling/color
management) → FBO → double-buffered PBO async `glReadPixels` single readback →
N-API `ThreadSafeFunction` → Electron UtilityProcess → MessagePort straight to the
renderer process (structured clone; why it is not zero-copy — see DESIGN.md) →
WebGL `texImage2D` display.

> ✅ **Status**: this repo's code has been independently compiled and run in a real
> Windows environment (standalone test + Electron integration, nvdec hardware
> decoding confirmed). Everything below comes from real testing, not paper
> reasoning. DESIGN.md's "Field-tested constraints" section records every pitfall
> hit in practice — start there when something breaks.

## Prerequisites

1. **Visual Studio Build Tools** (with the C++ desktop development workload) +
   **Python 3** (needed by node-gyp)
2. **Node.js** (≥ 20 recommended) + the node-gyp/@electron/rebuild from this
   repo's devDependencies — **@electron/rebuild must be ≥ 4.2**: the node-gyp
   fork bundled in 3.x does not recognize newer VS Build Tools / Python and fails
   at the configure stage with "Python not found"
3. **libmpv dev package** (Windows): shinchiro's daily builds are recommended,
   https://sourceforge.net/projects/mpv-player-windows/files/libmpv/
   (SourceForge has anti-scraping; a plain browser download works).
   **Measured layout**: the import library `libmpv.dll.a` sits at the SDK **root**,
   not under `lib/x64/`; `include/` and `libmpv-2.dll` are also at the root.
   Expected layout:

   ```
   third_party/mpv-dev/
   ├── include/mpv/client.h, render_gl.h, ...
   ├── libmpv.dll.a        # import library (for linking)
   └── libmpv-2.dll        # runtime DLL
   ```

   Extract the SDK into `third_party/mpv-dev` (already gitignored — GPL binaries
   stay out of the repo), or set `MPV_SDK_DIR` to a **repo-relative path**:
   ```
   set MPV_SDK_DIR=path\relative\to\repo\mpv-dev
   ```
   (The link path is resolved from the repo root via the MSBuild `$(ProjectDir)`
   macro, so it must be relative; if your package ships `mpv.lib` instead of
   `libmpv.dll.a`, change the library filename in `binding.gyp`.)
4. **GPU driver with GL 3.0+** (required for FBO/PBO) — virtually any modern
   discrete or integrated GPU qualifies.

## Build steps

```bash
npm install
npm run build              # node-gyp build (Node ABI); get the standalone test passing first
npm run test:standalone -- C:\path\to\video.mp4

# Once the addon runs standalone, rebuild against Electron's Node ABI:
npm run build:electron
npm start -- C:\path\to\video.mp4     # with a path it auto-plays; otherwise use "Open Video" in the window
```

**Why run the standalone test before Electron:** it separates "GL context /
libmpv / hardware decoding" problems from "Electron integration" problems, so
when something breaks you can tell which layer to look at.

**⚠️ The two ABIs are mutually exclusive**: `build` produces the Node ABI,
`build:electron` the Electron ABI, and the latter overwrites the former — after
`build:electron`, the standalone test failing to load the addon is expected, not
a breakage.

## Runtime dependency: how libmpv-2.dll gets found

`libmpv-2.dll` is loaded without an explicit `LoadLibrary` path; the Windows
loader searches "exe directory → system directory → **PATH**". This repo's
`mpv-service.js` **prepends** the SDK directory to the child process's PATH when
forking the worker, so in development everything works as long as the SDK is at
`third_party/mpv-dev`. When integrating yourself, pick one:

- Prepend PATH the same way at fork time (recommended — see `electron/mpv-service.js`)
- Or place `libmpv-2.dll` next to the packaged exe (for packaged apps)

The standalone test has no service to do this for you, so do it yourself:
```
set PATH=C:\path\to\mpv-dev;%PATH%
node test/standalone-test.js video.mp4
```

## Known spots you may need to adjust for your environment

- **GL context version** (`src/gl_context_win.cpp`): currently the plainest
  `wglCreateContext` is used, yielding the driver's default compatibility
  context. On the rare old driver where `LoadGlFunctions()` returns false,
  switch to `wglCreateContextAttribsARB` and request a core profile explicitly.
- **Which backend `hwdec=auto` lands on**: the worker already observes
  `hwdec-current`; check the log after loadfile (measured: `nvdec` on NVIDIA).
  If it always software-decodes, check drivers/codecs; setting `hwdec=d3d11va`
  explicitly narrows the search.
- **The "previous frame's DMA should be done" assumption of the double-buffered
  PBO**: at extreme resolutions (8K) or with very irregular render pacing, a
  read could theoretically land on not-yet-transferred data. 4K60 measured
  rock-solid; if you ever see corruption, add a `glClientWaitSync` fence.

## Layout

```
src/               C++ addon sources (N-API + libmpv render API + GL/PBO)
lib/index.js       thin JS wrapper — friendlier MpvPlayer API
electron/          Electron integration example (thin main shell / mpv-service generic layer / worker / preload / renderer)
test/              standalone test script, no Electron involved
```

## Future optimizations (not needed to run; for squeezing out more performance)

- Replace the simplified "read one frame behind" assumption with
  `glClientWaitSync`/`GL_ARB_sync` fences
- The heap allocation in FrameData could become a memory pool to reduce
  allocate/free churn at high frame rates
- More aggressive routes like Electron OSR shared textures couple to Electron
  internals and carry a real stability cost — not recommended as a first move
