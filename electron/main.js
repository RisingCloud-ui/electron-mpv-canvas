'use strict';

// Electron integration example. Layers:
//   renderer.js    — WebGL display + control panel (plain DOM, no framework)
//   preload.js     — contextBridge control-plane API + frame-port relay (a
//                    MessagePort cannot cross the context bridge)
//   main.js        — this file: window + IPC routing
//   mpv-service.js — worker lifecycle / frame-port distribution (reusable layer)
//   mpv-worker.js  — UtilityProcess: loads the native addon, libmpv render + PBO readback
//
// Usage: npm start [-- path/to/video] (passing a path auto-loads and plays it)

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
  // Benchmarking: --size=WxH pins the render resolution, passed to the renderer via query
  const cliArgs = process.argv.slice(2);
  const sizeArg = (cliArgs.find((a) => a.startsWith('--size=')) || '').split('=')[1];
  win.loadFile(path.join(__dirname, 'renderer.html'), sizeArg ? { query: { fixed: sizeArg } } : undefined);

  // Forward renderer console messages to the terminal (handy for debugging)
  win.webContents.on('console-message', (_e, _level, message) => {
    console.log('[renderer-console]', message);
  });

  // Video path on the command line -> auto-load and play once the window finishes
  // loading (electron main.js C:/path/video.mp4)
  const videoArg = cliArgs.find((a) => !a.startsWith('-'));
  if (videoArg) {
    win.webContents.once('did-finish-load', () => {
      mpv.control('loadFile', [path.resolve(videoArg)]);
      mpv.control('play', []);
    });
  }
}

// ---- IPC routing ----

// Control commands (play/pause/seek/load file): low-frequency, ordinary IPC copies are plenty
ipcMain.handle('mpv-control', (_event, method, args) => {
  try {
    mpv.control(method, args ?? []);
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

// Frame-port requests: the renderer asks for a fresh channel every time it becomes
// ready (a MessagePort can only be transferred once, so "requesting again" is the
// norm, not an exception — page reloads and component remounts all come through here)
ipcMain.handle('frame-port-request', (event) => {
  try {
    mpv.getFramePort(event.sender);
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

ipcMain.handle('mpv-status', () => ({ success: true, data: mpv.getStatus() }));

// Optional helper: a generic "pick a video file" dialog. The core API only needs
// loadFile(path); this just spares the demo page from typing absolute paths.
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
