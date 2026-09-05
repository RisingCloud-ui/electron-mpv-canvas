# AGENTS.md

Guidance for AI coding agents (Codex, Claude Code, ...) working in this repository.

## What this repo is

electron-mpv-canvas renders mpv's decoded video as a real WebGL texture inside
an Electron page, so HTML/CSS controls can overlay the video like any other
DOM element. Pipeline: libmpv `opengl` render API → FBO → double-buffered PBO
async readback → N-API `ThreadSafeFunction` → Electron UtilityProcess →
MessagePort → WebGL.

## Layout

- `src/` — C++ N-API addon:
  `gl_context_win` (offscreen WGL context) · `gl_loader` (minimal GL 3.x
  function loader) · `mpv_player` (render + event threads, FBO/PBO) ·
  `addon` (N-API class wrappers, frame/event callbacks)
- `lib/index.js` — thin JS wrapper exposing a friendly `MpvPlayer` EventEmitter API
- `electron/` — integration example: `main.js` (window + IPC routing) ·
  `mpv-service.js` (worker lifecycle + frame-port distribution, the reusable
  layer) · `mpv-worker.js` (UtilityProcess hosting the addon) · `preload.js`
  (contextBridge control API + frame-port relay) · `renderer.js` (WebGL +
  plain-DOM controls)
- `test/standalone-test.js` — smoke test without Electron
- `DESIGN.md` — why the architecture looks this way; the "Field-tested
  constraints" section lists every pitfall hit in practice. **Read it before
  changing the frame plumbing.**
- `README-BUILD.md` — build steps and troubleshooting
- `ROADMAP.md` — versioned plans and explicit non-goals

## Build & test

```bash
npm install
npm run build                 # Node ABI; requires a libmpv dev SDK (below)
npm run test:standalone -- path/to/video.mp4
npm run build:electron        # Electron ABI (overwrites the Node-ABI .node)
npm start -- path/to/video.mp4
```

- Requires a libmpv Windows dev package at `third_party/mpv-dev/` (or set
  `MPV_SDK_DIR`). Sources and layout: README-BUILD.md; licensing: LICENSING.md.
- **The two ABIs are mutually exclusive**: `build` (Node) and `build:electron`
  (Electron) overwrite each other's `.node`. After `build:electron`, the
  standalone test failing to load the addon is expected, not a regression.

## Hard constraints (already learned the hard way — do not re-learn them)

- Electron disables external N-API buffers (`NAPI_NO_EXTERNAL_BUFFERS`): frames
  reach JS via `Buffer::Copy`. The extra copy is a hard runtime constraint, not
  an optimization to remove.
- A MessagePort can only be transferred once. Every renderer request creates a
  fresh MessageChannel (`mpv-service.js`); the worker keeps the most recently
  arrived port and stops sending once a port closes.
- utilityProcess MessagePorts reject an `ArrayBuffer` in the transferList; send
  the Buffer itself (structured clone).
- Properties are observed with `MPV_FORMAT_STRING`: numeric values arrive as
  strings and must be converted on the JS side.
- `flipY=0` is correct — `glReadPixels` already delivers bottom-up rows; adding
  `flipY=1` produces an upside-down image.

## Conventions

- The repository is English-only: code, comments, docs, commit messages.
- Commit messages use conventional prefixes (`feat:`, `fix:`, `docs:`) in English.
- Comment-only C++ changes do not require rebuilding the addon binary.
- Never bundle libmpv binaries — users supply their own SDK (see LICENSING.md).
- Windows-first scope. Before adding cross-platform abstractions, check
  ROADMAP.md (macOS/Linux are planned in v0.2, nothing exists yet).
