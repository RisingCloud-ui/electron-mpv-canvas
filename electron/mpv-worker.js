'use strict';

// 运行环境:Electron UtilityProcess(纯 Node 环境,能加载原生 addon,
// 且不像渲染进程那样受沙箱限制)。
// 通信设计:
//   - 控制指令(play/pause/seek/loadFile...)量少,走 process.parentPort 普通消息,
//     由主进程转发,走一次 IPC 拷贝完全没问题。
//   - 帧数据(高频、大块)走一条专门的 MessagePort,直接交给渲染进程,
//     不经过主进程 JS 层的二次拷贝。这个 port 由主进程按需转交过来
//     (每次申请都是新 channel——MessagePort 只能转移一次,复用会撞墙)。

const { MpvPlayer } = require('../lib/index');

console.log('[worker] started, pid', process.pid);
const player = new MpvPlayer();
let framePort = null;
let frameTotal = 0;

try {
  player.init(1280, 720);
  // keep-open=yes 由 C++ Init 设置:EOF 时停在末帧并置 eof-reached 属性,
  // 播放结束检测读属性而不是 end-file 事件——主动换文件也会发 end-file,
  // 会和"播放自然结束"混淆;eof-reached 只在真正播完/出错清空列表时置位。
  player.observeProperty('hwdec-current'); // 验证硬解实际生效
  player.observeProperty('time-pos');
  player.observeProperty('duration');
  player.observeProperty('pause');
  player.observeProperty('eof-reached');
  player.observeProperty('paused-for-cache'); // 网络流缓冲状态
  player.observeProperty('idle-active'); // 播放失败检测:错误 end-file 后 mpv 进 idle;
                                         // keep-open 挂末帧/loadfile 换文件都不会置位
  console.log('[worker] init ok');
} catch (err) {
  console.error('[worker] init FAILED:', err && err.message);
}

player.on('frame', (buffer, w, h) => {
  if (!framePort) return; // 端口还没建立好(或已关闭)之前先丢帧
  frameTotal++;
  try {
    // ⚠️ Electron utilityProcess 的 MessagePort 不接受 ArrayBuffer 进 transferList
    // ("Port at index 0 is not a valid port"),只能 structured clone 拷贝传输。
    // 直接发 Buffer(本身就是可克隆视图),省掉先 slice 一次的额外拷贝。
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
    // 主进程把和渲染进程之间的 MessagePort 一端转交过来。
    // 渲染端每次申请都拿到新 channel,旧的直接被覆盖;
    // 端口对端关闭后停发帧,避免往死端口上白做 structured clone。
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
