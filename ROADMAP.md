# Roadmap

Status tags used below: **shipped** (in this repo today, field-tested per
README) / **planned, unblocked** (nothing architectural stops it, just not
built yet) / **planned, hard** (real unsolved engineering problem, not a
matter of just writing the code) / **blocked upstream** (depends on mpv/
Chromium changes outside this project's control).

## v0.1 — Core pipeline (shipped)

- [x] Local file playback
- [x] Network stream playback
- [x] Hardware decoding (nvdec confirmed; other backends untested)
- [x] DOM-composited playback controls (the entire point of this project)
- [x] 1080p/1440p/4K frame delivery holding source frame rate (measured in
      the production app this was extracted from — see `DESIGN.md` for the
      real constraints and bugs found getting here)
- [x] Windows support (WGL offscreen context)

## v0.2 — Cross-platform + hardening (planned, unblocked)

- [ ] macOS support (CGL or Metal offscreen context, mirroring
      `gl_context_win.*`)
- [ ] Linux support (GLX or EGL)
- [ ] Frame pacing / sync polish beyond "drop stale frames" (current
      behavior is adequate but not tuned)
- [ ] `examples/` beyond the current minimal demo

## v0.3 — Classic GLSL shader pass-through (planned, unblocked)

mpv's classic `gpu` video output (which the render API this project uses is
built on) already supports custom GLSL shaders — this is how projects like
[Anime4K](https://github.com/bloc97/Anime4K) work in standalone mpv today.
Nothing in this repo's architecture blocks passing `--glsl-shaders` through;
it's just not exposed as a configuration option yet.

- [ ] Expose shader-path configuration through the JS API
- [ ] Document known-good shader packs and any perf tradeoffs observed

**Not in this tier:** mpv's newer `libplacebo`-based renderer (`gpu-next`) —
better HDR tone-mapping, Dolby Vision handling, more modern upscaling
algorithms — is **blocked upstream**. mpv's own render API doesn't expose
gpu-next yet ([mpv-player/mpv#10810](https://github.com/mpv-player/mpv/issues/10810),
open as of this writing); only `--wid`/standalone-window mode can use it.
This isn't something this project can route around — it needs to land in
mpv's render API first.

## v0.4 — GPU-resident processing hooks (planned, hard)

This is the tier where "AI super-resolution" / frame interpolation / video
analysis live, and it's worth being explicit about why it's a separate,
harder tier rather than "just add a hook":

- The frame this project already reads back is sitting in CPU memory by the
  time it reaches JS (see `DESIGN.md` — this was a deliberate, hard-won
  tradeoff to get something that actually works inside Electron's real
  constraints, not a theoretical zero-copy path).
- Feeding that frame into GPU-based AI inference (CUDA / DirectML / Vulkan)
  and getting an enhanced frame back out **without** paying for a second
  GPU→CPU→GPU round trip requires real cross-API GPU resource sharing
  (texture interop, synchronization primitives). This is a materially
  different, harder engineering problem than the frame-delivery pipeline
  this repo currently solves — not a small extension of it.
- Until that interop work exists, "AI enhancement" here would mean routing
  frames through CPU-side inference, which works but gives up the
  performance story that makes this worth doing on a GPU pipeline at all.

This tier is tracked here honestly because it's a real, interesting
direction — not because it's close. If you're interested in this specific
problem (GPU texture interop across graphics/compute APIs inside Electron),
that's a great thing to open a discussion about; it's the kind of problem
best solved with more than one person thinking about it.

## Explicitly not planned

- Bundling any libmpv binary (licensing — see `LICENSING.md`; you always
  supply your own build)
- A full-featured player UI — this project is a rendering bridge, not a
  player. `examples/` shows the minimum needed to use it; building a real
  player UI on top is the consuming application's job.
