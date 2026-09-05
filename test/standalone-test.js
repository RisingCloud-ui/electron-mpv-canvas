'use strict';

// Usage: node test/standalone-test.js <video-file-path>
// Purpose: before wiring up Electron, verify that the addon correctly
// initializes the GL context, hardware-decodes the video, reads frames back
// through the PBOs and delivers them to JS via the ThreadSafeFunction.
// Once running, you should see "frame #N ..." logs at roughly the video's
// frame rate.

const path = require('path');
const { MpvPlayer } = require('../lib/index');

const file = process.argv[2];
if (!file) {
  console.error('usage: node test/standalone-test.js <video-file>');
  process.exit(1);
}

const player = new MpvPlayer();
player.init(1280, 720);

let frameCount = 0;
let lastLogTime = Date.now();

player.on('frame', (buffer, w, h) => {
  frameCount++;
  const now = Date.now();
  if (now - lastLogTime >= 1000) {
    console.log(`frame #${frameCount}  ${w}x${h}  bytes=${buffer.length}  (~${frameCount}fps last 1s window not exact, see below)`);
    lastLogTime = now;
  }
});

player.on('event', (evt) => {
  if (evt.event !== 'none') {
    console.log('[mpv event]', JSON.stringify(evt));
  }
});

player.loadFile(path.resolve(file));
player.play();

process.on('SIGINT', () => {
  console.log('shutting down...');
  player.destroy();
  process.exit(0);
});

// auto-exit after 30 seconds, for scripted testing
setTimeout(() => {
  console.log(`done. total frames received: ${frameCount}`);
  player.destroy();
  process.exit(0);
}, 30000);
