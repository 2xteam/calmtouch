import { createMiniGL } from "@/lib/gl/mini";
import { createLoop } from "@/lib/canvas/tools";
import { clamp, damp, hexToRgb255, noise3, rand } from "@/lib/util/math";
import type { EngineFactory } from "./types";

/**
 * 라바 램프 — 메타볼. 방울은 CPU 에서 움직이고(부력 · 냉각 · 손끝 반발) 셰이더가
 * 거리 필드의 합으로 겉면을 그린다. 합쳐지고 갈라지는 것은 필드 합의 성질이라 따로 할 게 없다.
 *
 * 방울은 아래(뜨거움)에서 위(차가움)로 올라가며 식고, 식으면 무거워져 내려온다.
 */
const MAX = 14;

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform vec3 uBlobs[${MAX}];
uniform int uCount;
uniform float uAspect;
uniform vec3 uColor;
uniform float uTime;

float field (vec2 p) {
  float f = 0.0;
  for (int i = 0; i < ${MAX}; i++) {
    if (i >= uCount) break;
    vec2 d = p - uBlobs[i].xy;
    d.x *= uAspect;
    float r = uBlobs[i].z;
    f += (r * r) / (dot(d, d) + 1e-5);
  }
  return f;
}

void main () {
  vec2 p = vUv;
  float f = field(p);
  // 법선 — 필드의 기울기
  float e = 0.004;
  float fx = field(p + vec2(e, 0.0)) - field(p - vec2(e, 0.0));
  float fy = field(p + vec2(0.0, e)) - field(p - vec2(0.0, e));
  vec3 n = normalize(vec3(-fx, -fy, 0.06));
  float body = smoothstep(0.85, 1.05, f);
  float rim = smoothstep(0.85, 1.6, f) - smoothstep(1.6, 3.0, f);
  // 유리 안 배경 — 아래는 따뜻하게 달아 있다
  vec3 bg = mix(vec3(0.10, 0.05, 0.06), vec3(0.03, 0.02, 0.05), vUv.y);
  bg += uColor * 0.10 * (1.0 - vUv.y) * (1.0 - vUv.y);
  // 방울 색 — 안쪽은 밝고 가장자리는 진하다
  vec3 L = normalize(vec3(-0.4, 0.6, 0.8));
  float diff = max(dot(n, L), 0.0);
  vec3 blob = uColor * (0.55 + 0.45 * diff);
  blob += vec3(1.0, 0.95, 0.85) * pow(max(dot(n, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0), 40.0) * 0.5;
  blob = mix(blob, uColor * 0.55, rim * 0.6);
  vec3 col = mix(bg, blob, body);
  // 유리 가장자리의 비네트
  float vig = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x);
  col *= 0.65 + 0.35 * vig;
  gl_FragColor = vec4(col, 1.0);
}
`;

type Blob = { x: number; y: number; vx: number; vy: number; r: number; heat: number; seed: number };

export const createLavaEngine: EngineFactory = (canvas, ctx0) => {
  const mini = createMiniGL(canvas);
  const { gl } = mini;
  const prog = mini.program(FRAG);
  let color = hexToRgb255(ctx0.color).map((v) => v / 255);

  const blobs: Blob[] = [];
  const spawn = () => {
    blobs.length = 0;
    const n = 9;
    for (let i = 0; i < n; i++) {
      blobs.push({ x: rand(0.2, 0.8), y: rand(0.1, 0.9), vx: 0, vy: 0, r: rand(0.05, 0.11), heat: rand(0, 1), seed: rand(0, 100) });
    }
    // 바닥에 큰 덩어리 하나 — 진짜 램프의 밑바닥
    blobs.push({ x: 0.5, y: 0.0, vx: 0, vy: 0, r: 0.19, heat: 1, seed: 7 });
  };
  spawn();

  const pointers = new Map<number, { x: number; y: number; at: number }>();
  let gravity = { x: 0, y: 0 };
  const data = new Float32Array(MAX * 3);

  const loop = createLoop((dt, t) => {
    mini.resize();
    const aspect = canvas.width / canvas.height;
    const now = performance.now();
    for (const [id, p] of pointers) if (id === 0 && now - p.at > 1000) pointers.delete(id);
    gravity.x *= damp(1.5, dt);

    for (let i = 0; i < blobs.length; i++) {
      const b = blobs[i];
      if (i === blobs.length - 1) continue; // 바닥 덩어리는 고정
      // 아래에서 달아오르고 위에서 식는다
      b.heat += ((b.y < 0.18 ? 1 : b.y > 0.7 ? 0 : 0.5) - b.heat) * dt * 0.25;
      const buoy = (b.heat - 0.5) * 0.09 / (b.r * 8);
      let ax = noise3(b.seed, t * 0.1, 0) * 0.02 + gravity.x * 0.15;
      let ay = buoy + gravity.y * 0.1;
      // 손끝 — 갈라진다
      for (const p of pointers.values()) {
        const dx = (b.x - p.x) * aspect;
        const dy = b.y - p.y;
        const d = Math.hypot(dx, dy) + 0.001;
        const R = b.r * 2.2 + 0.08;
        if (d < R) { const k = (1 - d / R); ax += (dx / d) * k * 0.9; ay += (dy / d) * k * 0.9; }
      }
      // 서로 조금 밀어 낸다 — 다 뭉쳐 버리지 않게
      for (let j = 0; j < blobs.length - 1; j++) {
        if (j === i) continue;
        const o = blobs[j];
        const dx = (b.x - o.x) * aspect, dy = b.y - o.y;
        const d = Math.hypot(dx, dy) + 0.001;
        const R = (b.r + o.r) * 0.9;
        if (d < R) { const k = (1 - d / R) * 0.12; ax += dx / d * k; ay += dy / d * k; }
      }
      b.vx = (b.vx + ax * dt) * damp(1.2, dt);
      b.vy = (b.vy + ay * dt) * damp(1.2, dt);
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      const m = b.r * 0.6;
      if (b.x < m) { b.x = m; b.vx = Math.abs(b.vx) * 0.4; }
      if (b.x > 1 - m) { b.x = 1 - m; b.vx = -Math.abs(b.vx) * 0.4; }
      if (b.y < 0.02) { b.y = 0.02; b.vy = Math.abs(b.vy) * 0.2; }
      if (b.y > 0.96) { b.y = 0.96; b.vy = -Math.abs(b.vy) * 0.2; }
    }

    for (let i = 0; i < MAX; i++) {
      const b = blobs[i];
      data[i * 3] = b ? b.x : 0; data[i * 3 + 1] = b ? b.y : -10; data[i * 3 + 2] = b ? b.r : 0;
    }
    prog.use();
    gl.uniform3fv(prog.uniforms.uBlobs, data);
    gl.uniform1i(prog.uniforms.uCount, blobs.length);
    gl.uniform1f(prog.uniforms.uAspect, aspect);
    gl.uniform3f(prog.uniforms.uColor, color[0], color[1], color[2]);
    gl.uniform1f(prog.uniforms.uTime, t);
    mini.blit(null);
  });

  const toUv = (x: number, y: number) => ({ x: x / canvas.clientWidth, y: 1 - y / canvas.clientHeight });

  return {
    start: () => loop.start(),
    stop: () => loop.stop(),
    dispose: () => { loop.stop(); mini.dispose(); },
    pointerDown(x, y, id) {
      const u = toUv(x, y);
      pointers.set(id, { ...u, at: performance.now() });
    },
    pointerMove(x, y, _dx, _dy, id) {
      const u = toUv(x, y);
      pointers.set(id, { ...u, at: performance.now() });
    },
    pointerUp(id) {
      if (id !== 0) pointers.delete(id);
    },
    wheel(_x, _y, delta) {
      for (const b of blobs) b.vy -= delta * 0.002;
    },
    tilt(fx, fy) {
      gravity = { x: fx * 0.6, y: clamp(fy, -1, 1) * 0.3 };
    },
    idle() {
      // 바닥에서 새 방울이 떠오른다
      const b = blobs[Math.floor(rand(0, blobs.length - 1))];
      if (b.y < 0.15) b.vy += 0.08;
    },
    clear() {
      spawn();
    },
    setColor(hex) {
      color = hexToRgb255(hex).map((v) => v / 255);
    },
  };
};
