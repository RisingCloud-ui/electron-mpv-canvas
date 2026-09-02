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
            # gyp 不转换 libraries 里的相对路径，MSBuild 会从 build/ 子目录解析导致
            # LNK1181——用 MSBuild 宏指回仓库根再拼 SDK 相对路径（$(ProjectDir) 在
            # 链接期由 MSBuild 展开，<(mpv_sdk_dir) 在 gyp 期展开，两者可叠加）。
            # 注意：shinchiro 等常见 libmpv Windows 包的导入库在 SDK 根目录，
            # 不在 lib/x64/ 下（实测 2026-09）；MPV_SDK_DIR 覆盖时请保持相对路径
            # 或直接把 SDK 放进 third_party/（见 README-BUILD.md）。
            "$(ProjectDir)..\\<(mpv_sdk_dir)\\libmpv.dll.a",
            "opengl32.lib",
            "gdi32.lib",
            "user32.lib"
          ],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1,
              # 源码含中文注释：MSVC 默认按 GBK 读 UTF-8 文件，全角标点尾字节
              # 会吞掉行尾换行、把下一行代码并进注释（错误行号漂移的元凶）
              "AdditionalOptions": [ "/utf-8" ]
            }
          }
        }]
      ]
    }
  ]
}
