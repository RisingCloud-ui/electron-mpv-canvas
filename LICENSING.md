# Licensing

This repository's own code (the N-API addon, the JS glue, the Electron
integration example) is **MIT licensed**. See [`LICENSE`](./LICENSE).

**This is not legal advice.** The following is a summary of publicly
documented facts to help you get started; verify against your own situation
before shipping a commercial product.

## The part that actually matters: libmpv itself

This project does not bundle libmpv — you build or download it separately and
point `MPV_SDK_DIR` at it. What license *that* binary carries determines your
obligations, independent of this project's MIT license.

- **Default mpv/libmpv build: GPLv2+.** If you dynamically link a GPL build
  of libmpv into a proprietary application and distribute it, the mpv project
  itself doesn't give a fully settled answer on whether that's permitted —
  their own binding docs say "it's up to lawyers to decide." What's not
  ambiguous is that the mpv project built an entire LGPL compile option
  specifically to make this a non-issue for non-GPL applications, which
  should tell you how much they trust the GPL-linking argument to hold up in
  your favor.
- **LGPL build: `meson setup -Dgpl=false build`.** This is the officially
  supported path for embedding libmpv in proprietary software. It disables a
  specific, documented list of components — almost all Linux-specific
  (X11 video output, OSS audio, vdpau hardware decoding) or legacy Windows
  paths (the old Direct3D9 VO). If you're targeting Windows with the modern
  `opengl` render API and `d3d11va`/`nvdec` hardware decoding (which is what
  this project uses), none of the disabled items are things you're using.
  **Caveat: this is what the documentation implies, not something this
  project has verified by actually running an LGPL build.** Test your
  specific build before relying on it.
- **Linked dependencies can re-taint an LGPL build.** If the FFmpeg your
  libmpv links against was itself built with `--enable-gpl` (which pulls in
  GPL-only encoders like x264/x265), your "LGPL" libmpv build isn't actually
  LGPL end-to-end. You need an FFmpeg built without `--enable-gpl` too.

## Known LGPL Windows build sources

- [zhongfly/mpv-winbuild](https://github.com/zhongfly/mpv-winbuild) — CI-built
  from latest mpv commits, publishes an `mpv-dev-lgpl-*.7z` artifact
  specifically. The maintainer's own words: *"I'm not a lawyer and can't
  guarantee I've disabled all LGPL-incompatible packages, use at your own
  risk."* Good for getting unblocked quickly during development; verify
  independently before shipping something you charge money for.
- [shinchiro/mpv-winbuild-cmake](https://github.com/shinchiro/mpv-winbuild-cmake) —
  the most commonly recommended source for Windows libmpv dev packages, but
  as of this writing there's an open, unaddressed issue asking for an LGPL
  variant. Assume its default builds are GPL unless you build it yourself
  with `-Dgpl=false` (and a non-`--enable-gpl` FFmpeg).
- Building it yourself: see [mpv's own Windows compile docs](https://github.com/mpv-player/mpv/blob/master/DOCS/compile-windows.md).
  You'll need to build FFmpeg from source too — the FFmpeg package in
  MSYS2's default repositories is GPL, not LGPL.

## If you want to build a closed-source product on this

1. Get an LGPL build of libmpv (a source above, or build your own).
2. Verify the features you actually use still work as expected — don't just
   trust the "should be fine" reasoning above, test it.
3. Bundle the LGPL license text and a source offer (pointing at the public
   repo/commit you built from satisfies this — you don't need to host your
   own mirror).
4. Keep the library dynamically loaded (this project already does — it's
   loaded via `MPV_SDK_DIR` at build time, not statically embedded), so users
   retain the ability to substitute a compatible build, which is part of
   what LGPL requires.
5. Get an actual legal review before you ship something you charge money for.
   Everything above is engineering-level research, not a legal opinion.
