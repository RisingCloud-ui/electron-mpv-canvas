# 构建与排障指南（Windows）

架构:libmpv `opengl` render API(硬解 + GPU 缩放/色彩管理)→ FBO → 双缓冲 PBO 异步
`glReadPixels` 单次读回 → N-API `ThreadSafeFunction` → Electron UtilityProcess →
MessagePort 直传渲染进程(structured clone;为什么不是零拷贝见 DESIGN.md)→
WebGL `texImage2D` 显示。

> ✅ **状态**:本仓库代码已在真实 Windows 环境独立编译并运行通过
> (standalone 测试 + Electron 集成,nvdec 硬解确认)。以下指南来自实测,
> 不是纸上推演。DESIGN.md 的"Field-tested constraints"一节记录了所有
> 实测踩坑,遇到问题先看那里。

## 前置依赖

1. **Visual Studio Build Tools**(含 C++ 桌面开发工作负载)+ **Python 3**(node-gyp 需要)
2. **Node.js**(建议 ≥ 20)+ 本仓库 devDependencies 里的 node-gyp/@electron/rebuild
   —— **必须 @electron/rebuild ≥ 4.2**:3.x 内置的 node-gyp fork 不认识新版
   VS Build Tools / Python,configure 阶段就会报"找不到 Python"
3. **libmpv 开发包**(Windows):推荐 shinchiro 的每日构建
   https://sourceforge.net/projects/mpv-player-windows/files/libmpv/
   (SourceForge 有反爬,浏览器下载即可)。
   **实测布局**:导入库 `libmpv.dll.a` 在 SDK **根目录**,不在 `lib/x64/` 下;
   `include/` 与 `libmpv-2.dll` 也在根目录。默认布局:

   ```
   third_party/mpv-dev/
   ├── include/mpv/client.h, render_gl.h, ...
   ├── libmpv.dll.a        # 导入库(链接用)
   └── libmpv-2.dll        # 运行时 DLL
   ```

   把 SDK 解压到 `third_party/mpv-dev`(已在 .gitignore 里,GPL 二进制不入库),
   或设 `MPV_SDK_DIR` 指向**仓库相对路径**:
   ```
   set MPV_SDK_DIR=path\relative\to\repo\mpv-dev
   ```
   (链接路径经 MSBuild `$(ProjectDir)` 宏从仓库根解析,所以要用相对路径;
   若你的包给的是 `mpv.lib` 而非 `libmpv.dll.a`,改 `binding.gyp` 里的库文件名。)
4. **GPU 驱动要求 GL 3.0+**(FBO/PBO 需要),现代独显/核显基本都满足。

## 构建步骤

```bash
npm install
npm run build              # node-gyp 编译(Node ABI),先跑通 standalone 测试
npm run test:standalone -- C:\path\to\video.mp4

# 确认 addon 独立能跑之后,再针对 Electron 的 Node ABI 重新编译一次:
npm run build:electron
npm start -- C:\path\to\video.mp4     # 带路径自动播放;不带则用窗口里的"打开视频"
```

**为什么要先跑 standalone test 再接 Electron:** 这样能把"GL 上下文 / libmpv / 硬解"
这一层的问题和"Electron 集成"这一层的问题分开排查,出问题时更容易定位是哪一层。

**⚠️ 两种 ABI 二选一**:`build` 产出 Node ABI,`build:electron` 产出 Electron ABI,
后者会覆盖前者——`build:electron` 之后 standalone 测试加载会失败,属正常现象,
不是坏了起来。

## 运行时依赖:libmpv-2.dll 怎么被找到

`libmpv-2.dll` 没有 `LoadLibrary` 显式路径,Windows loader 按"exe 目录 → 系统目录
→ **PATH**"搜索。本仓库的 `mpv-service.js` 在 fork worker 时把 SDK 目录**前置**进
子进程 PATH,所以 dev 下只要 SDK 在 `third_party/mpv-dev` 就能跑。自己集成时二选一:

- fork 时同样前置 PATH(推荐,见 `electron/mpv-service.js`)
- 或把 `libmpv-2.dll` 放到打包后 exe 同目录(打包应用)

standalone 测试没有 service 代劳,需要自己:
```
set PATH=C:\path\to\mpv-dev;%PATH%
node test/standalone-test.js video.mp4
```

## 已知需要你根据实际环境调整的地方

- **GL 上下文版本**(`src/gl_context_win.cpp`):当前用的是最基础的
  `wglCreateContext`,拿到的是驱动默认版本的兼容上下文。极少数老驱动上如果
  `LoadGlFunctions()` 返回 false,需要改用 `wglCreateContextAttribsARB` 显式
  请求 core profile 上下文。
- **`hwdec=auto` 具体落到哪个后端**:worker 已 observe `hwdec-current`,
  loadfile 后看日志(实测 NVIDIA 上是 `nvdec`)。始终软解就查驱动/编码格式,
  可以显式设 `hwdec=d3d11va` 缩小排查范围。
- **PBO 双缓冲的"上一帧应该已经 DMA 完成"这个假设**:极端高分辨率(8K)或
  渲染节奏很不稳定时理论上可能读到没传完的数据。实测 4K60 都稳;真遇到花屏
  再加 `glClientWaitSync` fence。

## 目录结构

```
src/               C++ addon 源码(N-API + libmpv render API + GL/PBO)
lib/index.js       JS 侧薄封装,更友好的 MpvPlayer API
electron/          Electron 集成示例(main 薄壳 / mpv-service 通用层 / worker / preload / renderer)
test/              不经过 Electron 的独立测试脚本
```

## 后续优化方向(不影响能不能跑,是进一步压榨性能用的)

- 用 `glClientWaitSync`/`GL_ARB_sync` 替代"隔一帧再读"的简化假设
- FrameData 的 heap 分配可以换成内存池,减少高帧率下的分配/释放次数
- Electron OSR 共享纹理这类更激进方案耦合 Electron 内部实现,稳定性代价高,
  不建议一上来就做
