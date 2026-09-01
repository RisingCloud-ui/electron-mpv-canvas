'use strict';

// 运行环境:Electron UtilityProcess(纯 Node 环境,能加载原生 addon,
// 且不像渲染进程那样受沙箱限制)。
// 通信设计:
//   - 控制指令(play/pause/seek/loadFile...)量少,走 process.parentPort 普通消息,
//     由主进程转发,走一次 IPC 拷贝完全没问题。
//   - 帧数据(高频、大块)走一条专门的 MessagePort,直接转移(transfer)给渲染进程,
//     不经过主进程 JS 层的二次拷贝。这个 port 由主进程在启动时转交过来。

const { MpvPlayer } = require('../lib/index');

const player = new MpvPlayer();
let framePort = null;

player.init(1280, 720);

player.on('frame', (buffer, w, h) => {
  if (!framePort) return; // 端口还没建立好之前先丢帧
  // buffer 是这一帧独占分配的 Node Buffer(见 addon.cpp),
  // 其底层 ArrayBuffer 没有被其它地方引用,可以放心 transfer(零拷贝转移所有权)。
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  framePort.postMessage({ type: 'frame', width: w, height: h, data: arrayBuffer }, [arrayBuffer]);
});

player.on('event', (evt) => {
  process.parentPort.postMessage({ type: 'mpv-event', payload: evt });
});

process.parentPort.on('message', (e) => {
  const msg = e.data;
  if (msg.type === 'frame-port') {
    // 主进程把和渲染进程之间的 MessagePort 一端转交给我们
    framePort = e.ports[0];
    framePort.start();
    return;
  }
  if (msg.type === 'control') {
    const { method, args } = msg;
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
