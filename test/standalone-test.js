'use strict';

// 用法: node test/standalone-test.js <视频文件路径>
// 目的:在接入 Electron 之前,先确认 addon 能正确初始化 GL 上下文、
// 硬解视频、通过 PBO 读回帧数据、并把帧通过 ThreadSafeFunction 传到 JS。
// 跑起来后应该能看到稳定接近视频帧率的 "frame #N ..." 日志。

const path = require('path');
const { MpvPlayer } = require('../lib/index');

const file = process.argv[2];
if (!file) {
  console.error('用法: node test/standalone-test.js <video-file>');
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

// 跑 30 秒后自动退出,方便脚本化测试
setTimeout(() => {
  console.log(`done. total frames received: ${frameCount}`);
  player.destroy();
  process.exit(0);
}, 30000);
