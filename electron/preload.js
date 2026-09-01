'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// 控制类 API:低频操作,直接走 ipcRenderer.invoke,简单可靠。
contextBridge.exposeInMainWorld('mpvControl', {
  loadFile: (path) => ipcRenderer.invoke('mpv-control', { method: 'loadFile', args: [path] }),
  play: () => ipcRenderer.invoke('mpv-control', { method: 'play', args: [] }),
  pause: () => ipcRenderer.invoke('mpv-control', { method: 'pause', args: [] }),
  seek: (seconds, mode) => ipcRenderer.invoke('mpv-control', { method: 'seek', args: [seconds, mode] }),
  setProperty: (name, value) => ipcRenderer.invoke('mpv-control', { method: 'setProperty', args: [name, value] }),
  observeProperty: (name) => ipcRenderer.invoke('mpv-control', { method: 'observeProperty', args: [name] }),
  resize: (w, h) => ipcRenderer.invoke('mpv-control', { method: 'resize', args: [w, h] }),
  onWorkerMessage: (cb) => ipcRenderer.on('mpv-worker-message', (_e, msg) => cb(msg)),
});

// 帧数据端口:contextBridge 不能直接传递 MessagePort 对象给主世界的 JS,
// 官方推荐做法是 preload 收到 port 后,用 window.postMessage 把它转交给页面,
// 页面在 message 事件里通过 event.ports[0] 拿到,后续帧数据就在页面里直接消费,
// 不再经过 preload 这层。
ipcRenderer.on('frame-port', (event) => {
  const [port] = event.ports;
  window.postMessage('mpv-frame-port', '*', [port]);
});
