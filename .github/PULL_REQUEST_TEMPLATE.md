## What does this PR change?

## Checklist

- [ ] `npm run build` passes (Node ABI)
- [ ] `npm run test:standalone` plays a video without errors (required when
      touching the render path)
- [ ] Electron-specific changes: `npm run build:electron` + `npm start`
      checked manually
- [ ] Docs updated where behavior is described (README / README-BUILD /
      DESIGN.md / ROADMAP.md)
- [ ] Core library stays framework-free and dependency-free (no React/Vue in
      `lib/` or `electron/renderer.js` logic)
- [ ] If frame plumbing changed: DESIGN.md "Field-tested constraints" reviewed
