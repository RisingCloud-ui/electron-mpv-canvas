# Contributing

This project is MIT licensed with no CLA/DCO requirement — a normal PR is
enough, your authorship is preserved via git history and that's sufficient
under MIT.

## What's most useful right now

Given the project's current "structurally correct, field-untested" status
(see README), the highest-value contributions are:

1. **Build reports** — did `npm run build` + `test:standalone` actually work
   on your machine? What GPU/driver? Please open an issue either way (works
   *and* doesn't work are both useful data).
2. **macOS/Linux offscreen context implementations** — `gl_context_win.*` is
   the only platform-specific piece; a `gl_context_mac.mm` (CGL or a hidden
   `NSOpenGLView`) or `gl_context_linux.*` (GLX/EGL) following the same
   `GlOffscreenContext` interface would make this cross-platform.
3. **Anything you find wrong while actually wiring this into a real app** —
   this was built from public API documentation, not from running it in
   production yet. If something in `DESIGN.md` turns out to be wrong once
   real usage stresses it, that's exactly the kind of issue worth filing.

## Before submitting a PR

- Run `tsc --noEmit` on the JS/TS glue if you touched it.
- If you touched the C++ side, note what compiler/toolchain you built with —
  Windows libmpv builds are commonly MinGW/Clang-based (see `README-BUILD.md`),
  and MSVC interop details matter.
- Keep platform-specific code behind the same interface shape
  (`GlOffscreenContext`) rather than branching inside shared files, so the
  three platforms stay easy to reason about independently.
