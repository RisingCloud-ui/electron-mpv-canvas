'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Control-plane API: low-frequency operations, plain ipcRenderer.invoke — simple and reliable.
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
  // Each call makes the main process create a fresh MessageChannel (a MessagePort
  // can only be transferred once — after a page reload/remount a new one must be
  // requested; a used port cannot be reused)
  requestFramePort: () => ipcRenderer.invoke('frame-port-request'),
  onWorkerMessage: (cb) => ipcRenderer.on('mpv-worker-message', (_e, msg) => cb(msg)),
  onStatus: (cb) => ipcRenderer.on('mpv-status', (_e, status) => cb(status)),
});

// Frame-data port: contextBridge cannot pass a MessagePort object to the main
// world's JS. The officially recommended pattern: preload receives the port,
// then hands it to the page via window.postMessage; the page picks it up as
// event.ports[0] in its message handler and consumes frame data directly from
// there, with preload no longer in the path.
ipcRenderer.on('frame-port', (event) => {
  const [port] = event.ports;
  window.postMessage('mpv-frame-port', '*', [port]);
});
