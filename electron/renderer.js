'use strict';

const canvas = document.getElementById('video-canvas');
const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });

if (!gl) {
  document.getElementById('fps').textContent = 'WebGL2 unavailable';
  throw new Error('WebGL2 unavailable');
}

// ---- Minimal "draw one texture fullscreen" WebGL pipeline ----
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

// ---- Frame queue: keep only the latest frame, consume it in rAF, drop stale ones ----
let latestFrame = null; // { width, height, data }
let frameCount = 0;
let fpsWindowStart = performance.now();
let recvCount = 0;

window.addEventListener('message', (event) => {
  if (event.data === 'mpv-frame-port') {
    const port = event.ports[0];
    console.log('[renderer] frame port received');
    port.onmessage = (e) => {
      if (e.data.type === 'frame') {
        recvCount++;
        if (recvCount % 60 === 1) console.log('[renderer] frames recv:', recvCount);
        latestFrame = e.data; // overwrite the old frame — slow rendering drops frames instead of accumulating latency
      }
    };
  }
});

// Ask for a frame port. Safe to call repeatedly: after a page reload or remount
// you should request a fresh one — the worker keeps the most recently arrived
// port and automatically stops sending once the old port closes.
window.mpvControl.requestFramePort();

// Benchmarking: ?fixed=WxH in the URL pins the render resolution (no window-resize follow)
const fixedSize = (() => {
  const m = /[?&]fixed=(\d+)x(\d+)/.exec(location.search);
  return m ? { w: +m[1], h: +m[2] } : null;
})();

function resizeCanvasToDisplaySize() {
  if (fixedSize) {
    if (canvas.width !== fixedSize.w) {
      canvas.width = fixedSize.w;
      canvas.height = fixedSize.h;
      gl.viewport(0, 0, canvas.width, canvas.height);
      window.mpvControl.resize(canvas.width, canvas.height);
    }
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
    window.mpvControl.resize(w, h); // keep mpv's render resolution in sync
  }
}

function draw() {
  resizeCanvasToDisplaySize();

  if (latestFrame) {
    const { width, height, data } = latestFrame;
    latestFrame = null;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // The worker sends a structured-cloned Buffer (a Uint8Array view) — upload it
    // directly; also compatible with a future transferable ArrayBuffer shape
    const pixels = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
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

// ---- Control bindings ----
document.getElementById('btn-play').onclick = () => window.mpvControl.play();
document.getElementById('btn-pause').onclick = () => window.mpvControl.pause();
document.getElementById('btn-open').onclick = async () => {
  const file = await window.mpvControl.pickFile();
  if (file) window.mpvControl.loadFile(file);
};

// ---- Seek bar: the worker observes time-pos/duration; events are relayed here
// through the main process ----
// ⚠️ the addon observes properties with MPV_FORMAT_STRING — numeric values come
// back as strings and must be converted with Number()/parseFloat
const progress = document.getElementById('progress');
let duration = 0;
progress.addEventListener('change', () => {
  // After EOF holds the last frame (keep-open), seeking anywhere resumes playback —
  // seek resets eof-reached
  window.mpvControl.seek(progress.value, 'absolute');
  window.mpvControl.play();
});

window.mpvControl.onWorkerMessage((msg) => {
  if (msg.type !== 'mpv-event') return;
  const evt = msg.payload ?? {};
  if (evt.event !== 'property-change') return;
  if (evt.name === 'duration') {
    const d = Number(evt.value);
    if (Number.isFinite(d) && d > 0) {
      duration = d;
      progress.max = d;
    }
  } else if (evt.name === 'time-pos') {
    const t = Number(evt.value);
    if (Number.isFinite(t) && duration > 0) progress.value = t;
  }
});
