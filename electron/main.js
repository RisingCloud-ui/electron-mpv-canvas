'use strict';

// Electron 集成示例。分层:
//   renderer.js  —— WebGL 显示 + 控制面板(纯 DOM,无框架)
//   preload.js   —— contextBridge 控制面 API + 帧端口中继(MessagePort 无法过桥)
//   main.js      —— 本文件:窗口 + IPC 路由
//   mpv-service.js —— worker 生命周期/帧端口分发(可复用的通用层)
//   mpv-worker.js —— UtilityProcess:加载原生 addon,libmpv 渲染 + PBO 读回
//
// 用法:npm start [-- 视频文件路径](带路径则窗口打开后自动加载播放)

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { MpvService } = require('./mpv-service');

const mpv = new MpvService();
let win;

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
  // 压测:--size=WxH 锁定渲染分辨率,经 query 传给 renderer
  const cliArgs = process.argv.slice(2);
  const sizeArg = (cliArgs.find((a) => a.startsWith('--size=')) || '').split('=')[1];
  win.loadFile(path.join(__dirname, 'renderer.html'), sizeArg ? { query: { fixed: sizeArg } } : undefined);

  // 渲染进程 console 转发到终端(调试方便)
  win.webContents.on('console-message', (_e, _level, message) => {
    console.log('[renderer-console]', message);
  });

  // 命令行带视频路径 → 窗口加载完成后自动播放(electron main.js C:/path/video.mp4)
  const videoArg = cliArgs.find((a) => !a.startsWith('-'));
  if (videoArg) {
    win.webContents.once('did-finish-load', () => {
      mpv.control('loadFile', [path.resolve(videoArg)]);
      mpv.control('play', []);
    });
  }
}

// ---- IPC 路由 ----

// 控制指令(播放/暂停/进度/加载文件):低频操作,普通 IPC 拷贝完全够用
ipcMain.handle('mpv-control', (_event, method, args) => {
  try {
    mpv.control(method, args ?? []);
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

// 帧端口申请:渲染端每次就绪都来要一条新 channel(MessagePort 只能转移一次,
// 所以"重复申请"是常态而非异常——页面重载/组件重挂载都走这里)
ipcMain.handle('frame-port-request', (event) => {
  try {
    mpv.getFramePort(event.sender);
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

ipcMain.handle('mpv-status', () => ({ success: true, data: mpv.getStatus() }));

// 可选 helper:通用"选一个视频文件"对话框。核心 API 只需要 loadFile(路径),
// 这个只是让示例页不用手敲绝对路径。
ipcMain.handle('mpv-pick-file', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Open a video file',
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

app.whenReady().then(() => {
  createWindow();
});

app.on('window-all-closed', () => {
  mpv.stop();
  if (process.platform !== 'darwin') app.quit();
});
