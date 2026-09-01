{
  "variables": {
    "mpv_sdk_dir%": "<!(node -e \"console.log(process.env.MPV_SDK_DIR || './third_party/mpv-dev')\")"
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
            "-l<(mpv_sdk_dir)/lib/x64/libmpv.dll.a",
            "-lopengl32.lib",
            "-lgdi32.lib",
            "-luser32.lib"
          ],
          "msvs_settings": {
            "VCCLCompilerTool": { "ExceptionHandling": 1 }
          }
        }]
      ]
    }
  ]
}
