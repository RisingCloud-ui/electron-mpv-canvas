# mpv-electron-addon(Windows 骨架)

架构:libmpv `opengl` render API(硬解 + GPU 缩放/色彩管理)→ FBO → 双缓冲 PBO 异步
`glReadPixels` 单次读回 → N-API `ThreadSafeFunction` → Electron UtilityProcess →
MessagePort 直传渲染进程(零拷贝 transfer ArrayBuffer)→ WebGL `texImage2D` 显示。

控件是真正的 HTML/CSS,浮在 `<canvas>` 之上,可以随意加圆角、阴影、毛玻璃半透明背景。

> ⚠️ **重要声明**:这份代码是按照 libmpv / N-API / Electron 官方文档的公开接口写的完整骨架,
> 但没有在真实 Windows 环境里编译验证过(当前环境没有 Windows 工具链、libmpv 开发包和
> GPU,无法实际构建测试)。当作"结构正确、可以在此基础上调试"的起点,而不是"开箱即用"
> 的成品。第一次构建大概率需要按下面的排查指南修一些细节(尤其是 GL 版本/驱动相关的部分)。

## 前置依赖

1. **Visual Studio Build Tools**(含 C++ 桌面开发工作负载)+ Python(node-gyp 需要)
2. **Node.js** + **node-gyp** 全局或本地可用
3. **libmpv 开发包**(Windows):推荐用 shinchiro 的每日构建
   https://sourceforge.net/projects/mpv-player-windows/files/libmpv/
   下载后解压,把路径设为环境变量:
   ```
   set MPV_SDK_DIR=C:\path\to\mpv-dev-x86_64
   ```
   目录里应该有 `include/mpv/client.h`、`include/mpv/render_gl.h`,
   以及 `lib/x64` 下的导入库(`.dll.a` 或 `.lib`,视你下载的包而定 —— 如果
   是 `.lib` 而不是 `.dll.a`,记得改 `binding.gyp` 里的库名后缀)。
   运行时还需要把对应的 `libmpv-2.dll` 放到最终可执行文件同目录或 PATH 里。
4. **GPU 驱动要求 GL 3.0+**(FBO/PBO 需要),现代独显/核显基本都满足。

## 构建步骤

```bash
npm install
npm run build              # 先用 node-gyp 编译一遍,跑通 test/standalone-test.js 验证 addon 本身
npm run test:standalone -- C:\path\to\some-video.mp4

# 确认 addon 独立能跑之后,再针对 Electron 的 Node ABI 重新编译一次:
npm run build:electron
npm start                  # 启动 electron/main.js
```

**为什么要先跑 standalone test 再接 Electron:** 这样能把"GL 上下文 / libmpv / 硬解"
这一层的问题和"Electron 集成"这一层的问题分开排查,出问题时更容易定位是哪一层。

## 已知需要你根据实际环境调整的地方

- **`binding.gyp` 里的库文件名**:不同来源的 libmpv Windows 包,导入库命名不完全一致
  (`libmpv.dll.a` / `mpv.lib` / `libmpv.lib` 都有可能),按你下载的包实际情况改。
- **GL 上下文版本**(`src/gl_context_win.cpp`):当前用的是最基础的
  `wglCreateContext`,拿到的是驱动默认版本的兼容上下文。极少数老驱动上如果
  `LoadGlFunctions()` 返回 false,说明驱动没给到 FBO/PBO 相关函数指针,需要改用
  `wglCreateContextAttribsARB` 显式请求一个 core profile 上下文(在
  `GlOffscreenContext::Create` 里,`wglCreateContext` 那行的位置替换)。
- **`hwdec=auto` 具体落到哪个后端**:可以用 `player.getProperty('hwdec-current')`
  在 loadfile 之后查看实际生效的解码器,如果发现始终是软解,check 一下显卡驱动/
  编码格式是否被硬解支持(可以显式设 `hwdec=d3d11va` 缩小排查范围)。
- **PBO 双缓冲的"上一帧应该已经 DMA 完成"这个假设**:在极端高分辨率
  (比如 8K)或者渲染节奏很不稳定时,理论上可能读到还没传完的数据导致轻微花屏。
  如果遇到这种情况,可以用 `glClientWaitSync` 加一个 fence 做保险(当前骨架为了
  简洁没加,多数 1080p/4K 场景不需要)。
- **`electron/main.js` 里的 `stdio: 'inherit'`**:方便开发时看 worker 的 log,
  正式打包时建议改成默认的 pipe,避免打包应用弹出多余控制台。

## 目录结构

```
src/               C++ addon 源码(N-API + libmpv render API + GL/PBO)
lib/index.js       JS 侧薄封装,更友好的 MpvPlayer API
electron/          Electron 集成示例(UtilityProcess + MessagePort 直连 + WebGL 显示)
test/              不经过 Electron 的独立测试脚本
```

## 后续优化方向(不影响能不能跑,是进一步压榨性能用的)

- 用 `glClientWaitSync`/`GL_ARB_sync` 替代"隔一帧再读"的简化假设
- FrameData 的 heap 分配可以换成内存池,减少高帧率下的分配/释放次数
- 如果确认 CPU 读回本身成为瓶颈(极少见),再评估 Electron OSR 共享纹理这类
  更激进但耦合 Electron 内部实现的方案(参考之前讨论,这条路稳定性代价更高,
  不建议一上来就做)
