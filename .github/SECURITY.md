# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| latest on `main` | yes |

This project moves quickly; only the current `main` branch is supported.

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/RisingCloud-ui/electron-mpv-canvas/security/advisories/new)
instead of opening a public issue.

## Areas worth particular scrutiny

- Memory ownership across the N-API ThreadSafeFunction boundary (`src/addon.cpp` —
  frame buffers are allocated on the render thread and freed in the JS callback)
- The IPC surfaces in `electron/main.js` / `electron/preload.js`. The demo
  intentionally lets the renderer control local-file playback; contextIsolation
  is on and the frame port is relayed per the official MessagePort pattern, but
  treat any scenario where the renderer loads untrusted content as out of
  scope for the demo's hardening.
