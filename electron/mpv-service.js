'use strict';

// MpvService — 主进程侧的 worker 生命周期与帧端口分发(从真实产品代码中提取的
// 通用层,不含任何业务概念:它不知道"播放列表/源/集",只知道 loadFile 一个路径)。
//
// 职责:
//   - 懒启动 worker(首个控制指令/端口申请时 fork),崩溃后下次调用自动重启
//   - libmpv-2.dll 的加载:Windows loader 按 PATH 搜 DLL——把 SDK 目录前置进
//     子进程 PATH,而不是要求用户把 DLL 拷进 system32 或全局 PATH
//   - 帧端口:MessagePort 只能转移一次,所以"渲染端每申请一次就新建一条
//     MessageChannel";worker 侧保留最后到达的端口(页面重载/组件重挂载
//     天然用新端口,旧端口 close 后 worker 自行停发)
//   - stdio 用 pipe + 显式转发:Windows 上 utilityProcess 的 'inherit' 接不通,
//     worker 日志会整个丢掉;转发写入要防 EPIPE(管道对端死亡不能炸主进程)

const { BrowserWindow, utilityProcess, MessageChannelMain } = require('electron');
const path = require('path');
const fs = require('fs');

const WORKER_PATH = path.join(__dirname, 'mpv-worker.js');
const DLL_DIR = path.join(__dirname, '..', 'third_party', 'mpv-dev');

function safeWrite(stream, data) {
  try { stream.write(data); } catch { /* EPIPE: 终端/管道已断,忽略 */ }
}

class MpvService {
  constructor() {
    this.worker = null;
  }

  getStatus() {
    return { running: this.worker !== null };
  }

  /** 幂等:已在跑就返回。utilityProcess 会缓冲 postMessage 直到子进程开始收听,
   *  所以调用方不需要等 ready。 */
  ensureStarted() {
    if (this.worker) return;

    if (!fs.existsSync(WORKER_PATH)) {
      throw new Error(`mpv worker not found: ${WORKER_PATH} (addon not built?)`);
    }
    if (!fs.existsSync(path.join(DLL_DIR, 'libmpv-2.dll'))) {
      console.warn(`[mpv-service] libmpv-2.dll not found in ${DLL_DIR} — worker will fail to load the addon`);
    }

    this.worker = utilityProcess.fork(WORKER_PATH, [], {
      stdio: 'pipe',
      // 让 Node-API 回调里的异常直接炸出堆栈(默认只给 DEP0168 警告,难排查)
      execArgv: ['--force-node-api-uncaught-exceptions-policy=true'],
      env: {
        ...process.env,
        PATH: `${DLL_DIR};${process.env.PATH ?? ''}`,
      },
    });

    this.worker.stdout?.on('data', (d) => safeWrite(process.stdout, `[worker] ${d}`));
    this.worker.stderr?.on('data', (d) => safeWrite(process.stderr, `[worker:err] ${d}`));

    this.worker.on('message', (msg) => {
      if (msg?.type === 'mpv-event') {
        for (const win of BrowserWindow.getAllWindows()) {
          try { win.webContents.send('mpv-worker-message', msg); } catch {}
        }
      } else if (msg?.type === 'error') {
        console.error('[mpv-service] worker error:', msg.payload);
      }
    });

    this.worker.on('exit', (code) => {
      // 崩溃/被杀只丢句柄——下一次 ensureStarted() 按需拉起新 worker
      console.warn(`[mpv-service] worker exited (code ${code})`);
      this.worker = null;
      for (const win of BrowserWindow.getAllWindows()) {
        try { win.webContents.send('mpv-status', { running: false }); } catch {}
      }
    });

    for (const win of BrowserWindow.getAllWindows()) {
      try { win.webContents.send('mpv-status', { running: true }); } catch {}
    }
  }

  /** 给渲染端一条新 MessageChannel 的渲染端;worker 拿另一端。
   *  注意 event.data 就是 postMessage 的 message 参数(不是 channel 名),
   *  preload 侧靠它匹配——传 null 渲染端会收到空标记。 */
  getFramePort(sender) {
    this.ensureStarted();
    const { port1, port2 } = new MessageChannelMain();
    this.worker.postMessage({ type: 'frame-port' }, [port1]);
    sender.postMessage('frame-port', 'frame-port', [port2]);
  }

  control(method, args) {
    this.ensureStarted();
    this.worker.postMessage({ type: 'control', method, args });
  }

  stop() {
    if (!this.worker) return;
    const worker = this.worker;
    this.worker = null;
    try { worker.kill(); } catch {}
  }
}

module.exports = { MpvService };
