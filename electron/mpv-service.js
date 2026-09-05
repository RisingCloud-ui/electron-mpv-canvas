'use strict';

// MpvService — worker lifecycle and frame-port distribution on the main-process
// side (a generic layer extracted from real production code, carrying no business
// concepts: it knows nothing about playlists/sources/episodes — only loadFile(path)).
//
// Responsibilities:
//   - Lazy-start the worker (fork on the first control command / port request);
//     if it crashes, the next call restarts it automatically
//   - Loading libmpv-2.dll: the Windows loader searches DLLs along PATH — prepend
//     the SDK directory to the child process PATH instead of asking users to copy
//     the DLL into system32 or the global PATH
//   - Frame ports: a MessagePort can only be transferred once, so every renderer
//     request creates a fresh MessageChannel; the worker keeps the most recently
//     arrived port (page reloads/component remounts naturally use new ports, and
//     the worker stops sending once an old port closes)
//   - stdio via pipe + explicit forwarding: utilityProcess's 'inherit' does not
//     hook up on Windows and worker logs would be lost entirely; forwarded writes
//     must be EPIPE-safe (a dead pipe must not take down the main process)

const { BrowserWindow, utilityProcess, MessageChannelMain } = require('electron');
const path = require('path');
const fs = require('fs');

const WORKER_PATH = path.join(__dirname, 'mpv-worker.js');
const DLL_DIR = path.join(__dirname, '..', 'third_party', 'mpv-dev');

function safeWrite(stream, data) {
  try { stream.write(data); } catch { /* EPIPE: terminal/pipe already gone — ignore */ }
}

class MpvService {
  constructor() {
    this.worker = null;
  }

  getStatus() {
    return { running: this.worker !== null };
  }

  /** Idempotent: returns immediately if already running. utilityProcess buffers
   *  postMessage until the child starts listening, so callers need not wait for ready. */
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
      // Surface exceptions in Node-API callbacks as real stack traces (the default
      // is a DEP0168 warning, which is nearly impossible to debug from)
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
      // A crash/kill only drops the handle — the next ensureStarted() spawns a fresh worker on demand
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

  /** Hand the renderer one end of a new MessageChannel; the worker gets the other.
   *  Note: event.data is the message argument of postMessage (not a channel name) —
   *  the preload side matches on it; passing null would deliver an empty marker. */
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
