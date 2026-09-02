'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// 控制类 API:低频操作,直接走 ipcRenderer.invoke,简单可靠。
contextBridge.exposeInMainWorld('mpvControl', {
  loadFile: (path) => ipcRenderer.invoke('mpv-control', 'loadFile', [path]),
  play: () => ipcRenderer.invoke('mpv-control', 'play', []),
  pause: () => ipcRenderer.invoke('mpv-control', 'pause', []),
  seek: (seconds, mode) => ipcRenderer.invoke('mpv-control', 'seek', [seconds, mode]),
  setProperty: (name, value) => ipcRenderer.invoke('mpv-control', 'setProperty', [name, value]),
  observeProperty: (name) => ipcRenderer.invoke('mpv-control', 'observeProperty', [name]),
  resize: (w, h) => ipcRenderer.invoke('mpv-control', 'resize', [w, h]),
  getStatus: () => ipcRenderer.invoke('mpv-status'),
  pickFile: () => ipcRenderer.invoke('mpv-pick-file'),
  // 每次调用都让主进程新建一条 MessageChannel(MessagePort 只能转移一次——
  // 页面重载/重新挂载后必须重新申请,不能复用旧端口)
  requestFramePort: () => ipcRenderer.invoke('frame-port-request'),
  onWorkerMessage: (cb) => ipcRenderer.on('mpv-worker-message', (_e, msg) => cb(msg)),
  onStatus: (cb) => ipcRenderer.on('mpv-status', (_e, status) => cb(status)),
});

// 帧数据端口:contextBridge 不能直接传递 MessagePort 对象给主世界的 JS,
// 官方推荐做法是 preload 收到 port 后,用 window.postMessage 把它转交给页面,
// 页面在 message 事件里通过 event.ports[0] 拿到,后续帧数据就在页面里直接消费,
// 不再经过 preload 这层。
ipcRenderer.on('frame-port', (event) => {
  const [port] = event.ports;
  window.postMessage('mpv-frame-port', '*', [port]);
});
