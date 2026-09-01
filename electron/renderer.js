'use strict';

const canvas = document.getElementById('video-canvas');
const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });

// ---- 最小可用的"画一张贴图铺满全屏"WebGL 管线 ----
const vsSrc = `#version 300 es
  const vec2 pos[4] = vec2[4](vec2(-1.,-1.), vec2(1.,-1.), vec2(-1.,1.), vec2(1.,1.));
  const vec2 uv[4]  = vec2[4](vec2(0.,1.), vec2(1.,1.), vec2(0.,0.), vec2(1.,0.));
  out vec2 vUv;
  void main() {
    vUv = uv[gl_VertexID];
    gl_Position = vec4(pos[gl_VertexID], 0.0, 1.0);
  }
`;
const fsSrc = `#version 300 es
  precision mediump float;
  in vec2 vUv;
  uniform sampler2D uTex;
  out vec4 outColor;
  void main() { outColor = texture(uTex, vUv); }
`;

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(s));
  }
  return s;
}

const program = gl.createProgram();
gl.attachShader(program, compile(gl.VERTEX_SHADER, vsSrc));
gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fsSrc));
gl.linkProgram(program);
gl.useProgram(program);

const tex = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, tex);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

// ---- 帧队列:只保留"最新一帧",rAF 消费,旧帧直接丢弃 ----
let latestFrame = null; // { width, height, data: ArrayBuffer }
let frameCount = 0;
let fpsWindowStart = performance.now();

window.addEventListener('message', (event) => {
  if (event.data === 'mpv-frame-port') {
    const port = event.ports[0];
    port.onmessage = (e) => {
      if (e.data.type === 'frame') {
        latestFrame = e.data; // 覆盖旧帧,天然实现"丢帧不丢延迟"
      }
    };
  }
});

function resizeCanvasToDisplaySize() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
    window.mpvControl.resize(w, h); // 通知 mpv 侧同步渲染分辨率
  }
}

function draw() {
  resizeCanvasToDisplaySize();

  if (latestFrame) {
    const { width, height, data } = latestFrame;
    latestFrame = null;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(data));
    frameCount++;
  }

  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  const now = performance.now();
  if (now - fpsWindowStart >= 1000) {
    document.getElementById('fps').textContent = `${frameCount} fps`;
    frameCount = 0;
    fpsWindowStart = now;
  }

  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

// ---- 控件绑定 ----
document.getElementById('btn-play').onclick = () => window.mpvControl.play();
document.getElementById('btn-pause').onclick = () => window.mpvControl.pause();
document.getElementById('btn-open').onclick = () => {
  const path = prompt('输入视频文件绝对路径:');
  if (path) window.mpvControl.loadFile(path);
};

window.mpvControl.onWorkerMessage((msg) => {
  if (msg.type === 'mpv-event') {
    // 按需在这里根据 evt.name/evt.value 更新进度条等 UI 状态
    // console.log('mpv event:', msg.payload);
  }
});
