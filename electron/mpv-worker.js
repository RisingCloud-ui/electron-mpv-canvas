'use strict';

// Runtime: an Electron UtilityProcess (plain Node environment — can load native
// addons and is not sandboxed like the renderer).
// Communication design:
//   - Control commands (play/pause/seek/loadFile...) are low-volume: ordinary
//     process.parentPort messages relayed by the main process; one IPC copy is fine.
//   - Frame data (high-rate, large) travels over a dedicated MessagePort handed
//     straight to the renderer, with no second copy through main-process JS. The
//     main process transfers the port on demand (every request gets a fresh
//     channel — a MessagePort can only be transferred once; reuse hits a wall).

const { MpvPlayer } = require('../lib/index');

console.log('[worker] started, pid', process.pid);
const player = new MpvPlayer();
let framePort = null;
let frameTotal = 0;

try {
  player.init(1280, 720);
  // keep-open=yes is set by the C++ Init: at EOF mpv holds the last frame and
  // raises the eof-reached property. End-of-playback detection reads the property,
  // not the end-file event — switching files also fires end-file, which would get
  // confused with natural playback end; eof-reached only sets on true playback
  // completion / an error clearing the playlist.
  player.observeProperty('hwdec-current'); // verify hardware decoding is actually active
  player.observeProperty('time-pos');
  player.observeProperty('duration');
  player.observeProperty('pause');
  player.observeProperty('eof-reached');
  player.observeProperty('paused-for-cache'); // network-stream buffering state
  player.observeProperty('idle-active'); // playback-failure detection: after a failed
                                         // end-file mpv enters idle; neither keep-open
                                         // holding the last frame nor loadfile switching sets it
  console.log('[worker] init ok');
} catch (err) {
  console.error('[worker] init FAILED:', err && err.message);
}

player.on('frame', (buffer, w, h) => {
  if (!framePort) return; // drop frames until the port is up (or after it closed)
  frameTotal++;
  try {
    // ⚠️ Electron utilityProcess MessagePorts reject an ArrayBuffer in the
    // transferList ("Port at index 0 is not a valid port") — only structured-clone
    // copies work. Send the Buffer directly (it is already a cloneable view),
    // skipping the extra slice() copy.
    framePort.postMessage({ type: 'frame', width: w, height: h, data: buffer });
  } catch (err) {
    console.error('[worker] postMessage THROW:', err && err.message);
  }
});

player.on('event', (evt) => {
  if (evt.event === 'property-change' && evt.name === 'hwdec-current') {
    console.log('[worker] hwdec-current =', evt.value);
  }
  process.parentPort.postMessage({ type: 'mpv-event', payload: evt });
});

process.parentPort.on('message', (e) => {
  const msg = e.data;
  if (msg.type === 'frame-port') {
    // The main process hands over one end of the MessageChannel shared with the
    // renderer. Every renderer request delivers a fresh channel; the old one is
    // simply overwritten. Once a port's peer closes we stop sending — no point
    // paying for structured clones into a dead port.
    framePort = e.ports[0];
    try { framePort.addEventListener('close', () => { framePort = null; }); } catch (_) {}
    framePort.start();
    console.log('[worker] frame port ready');
    return;
  }
  if (msg.type === 'control') {
    const { method, args } = msg;
    console.log('[worker] control:', method, args && args[0]);
    try {
      switch (method) {
        case 'loadFile': player.loadFile(args[0]); break;
        case 'play': player.play(); break;
        case 'pause': player.pause(); break;
        case 'seek': player.seek(args[0], args[1]); break;
        case 'setProperty': player.setProperty(args[0], args[1]); break;
        case 'observeProperty': player.observeProperty(args[0]); break;
        case 'resize': player.resize(args[0], args[1]); break;
        default:
          process.parentPort.postMessage({ type: 'error', payload: `unknown method ${method}` });
      }
    } catch (err) {
      process.parentPort.postMessage({ type: 'error', payload: String(err) });
    }
  }
});

process.on('exit', () => player.destroy());
