{
  "variables": {
    "mpv_sdk_dir%": "<!(node -e \"console.log(process.env.MPV_SDK_DIR || 'third_party/mpv-dev')\")"
  },
  "targets": [
    {
      "target_name": "mpv_addon",
      "sources": [
        "src/addon.cpp",
        "src/gl_loader.cpp",
        "src/gl_context_win.cpp",
        "src/mpv_player.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "<(mpv_sdk_dir)/include"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS",
        "NAPI_VERSION=8"
      ],
      "conditions": [
        ["OS=='win'", {
          "libraries": [
            # gyp does not rewrite relative paths in "libraries"; MSBuild would
            # resolve them from the build/ subdirectory and fail with LNK1181 —
            # anchor back to the repo root with the $(ProjectDir) MSBuild macro
            # and append the SDK-relative path ($(ProjectDir) expands at link
            # time, <(mpv_sdk_dir) expands at gyp time; the two compose).
            # Note: common libmpv Windows dev packages (e.g. shinchiro builds)
            # place the import library at the SDK root, not under lib/x64/
            # (verified 2026-09). When overriding MPV_SDK_DIR, keep it a
            # relative path or drop the SDK into third_party/ (README-BUILD.md).
            "$(ProjectDir)..\\<(mpv_sdk_dir)\\libmpv.dll.a",
            "opengl32.lib",
            "gdi32.lib",
            "user32.lib"
          ],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1,
              # Keep /utf-8: without it MSVC reads sources in the system codepage
              # (GBK on zh-CN Windows), where a multibyte sequence can swallow the
              # line's trailing newline and merge the next code line into a
              # comment — the classic "MSVC errors point at the wrong lines" trap
              "AdditionalOptions": [ "/utf-8" ]
            }
          }
        }]
      ]
    }
  ]
}
