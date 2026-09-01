'use strict';

const { app, BrowserWindow, ipcMain, utilityProcess, MessageChannelMain } = require('electron');
const path = require('path');

let win;
let mpvWorker;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer.html'));

  win.webContents.once('did-finish-load', () => {
    // 建一条 MessagePort 通道,一端给 utility process(帧生产者),
    // 一端直接转交给渲染进程(帧消费者),中间不经过主进程 JS 层。
    const { port1, port2 } = new MessageChannelMain();
    mpvWorker.postMessage({ type: 'frame-port' }, [port1]);
    win.webContents.postMessage('frame-port', null, [port2]);
  });
}

function createMpvWorker() {
  mpvWorker = utilityProcess.fork(path.join(__dirname, 'mpv-worker.js'), [], {
    stdio: 'inherit', // 方便调试时在主进程终端里看到 worker 的 console.log / stderr
  });
  mpvWorker.on('message', (msg) => {
    if (msg.type === 'error') console.error('[mpv-worker]', msg.payload);
    // mpv-event 之类可以按需转发给渲染进程做 UI 状态更新(进度条、播放状态等)
    if (win && !win.isDestroyed()) {
      win.webContents.send('mpv-worker-message', msg);
    }
  });
}

// 渲染进程发来的控制指令(播放/暂停/进度/加载文件),经主进程转发给 worker。
// 这一路是低频操作,走一次 IPC 拷贝完全没问题,不需要零拷贝优化。
ipcMain.handle('mpv-control', (_event, { method, args }) => {
  mpvWorker.postMessage({ type: 'control', method, args });
});

app.whenReady().then(() => {
  createMpvWorker();
  createWindow();
});

app.on('window-all-closed', () => {
  if (mpvWorker) mpvWorker.kill();
  if (process.platform !== 'darwin') app.quit();
});
