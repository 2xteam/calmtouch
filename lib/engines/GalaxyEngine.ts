import { createMiniGL } from "@/lib/gl/mini";
import { createLoop } from "@/lib/canvas/tools";
import { clamp, damp, hexToRgb255, rand, TAU } from "@/lib/util/math";
import type { EngineFactory } from "./types";

/**
 * 은하 — 별 수천 개가 나선 궤도로 돈다. 손끝 근처는 밀려나고, 스프링으로 제자리에 돌아온다.
 *
 * 궤도는 CPU 가 계산한다(별 하나에 곱셈 몇 번). 밀려난 변위는 임계 감쇠 스프링으로 복귀시켜
 * 출렁이지 않는다. 렌더는 WebGL POINTS — 가산 블렌딩 + 부드러운 원, 가운데는 금빛, 바깥은 청록.
 */
const VERT = `
precision highp float;
attribute vec2 aPosition;
attribute float aSize;
attribute float aMix;
uniform vec2 uResolution;
uniform float uDpr;
varying float vMix;
varying float vAlpha;
void main () {
  vec2 clip = (aPosition / uResolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  gl_PointSize = aSize * uDpr;
  vMix = aMix;
  vAlpha = clamp(aSize / 6.0, 0.35, 1.0);
}
`;
const FRAG = `
precision mediump float;
varying float vMix;
varying float vAlpha;
uniform vec3 uCore;
uniform vec3 uEdge;
void main () {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float a = exp(-r * r * 4.5) * (1.0 - smoothstep(0.85, 1.0, r));
  vec3 col = mix(uCore, uEdge, vMix);
  gl_FragColor = vec4(col * a * vAlpha, a * vAlpha);
}
`;

export const createGalaxyEngine: EngineFactory = (canvas, ctx0) => {
  const mini = createMiniGL(canvas);
  const { gl } = mini;
  const prog = mini.program(FRAG, VERT);
  const colors = ctx0.scene.color.kind === "palette" ? ctx0.scene.color.colors : ["#e8d18a", "#5fb8c9"];
  const core = hexToRgb255(colors[0]).map((v) => v / 255);
  const edge = hexToRgb255(colors[1] ?? colors[0]).map((v) => v / 255);

  const isMobile = typeof navigator !== "undefined" && /Mobi|Android/i.test(navigator.userAgent);
  const N = isMobile ? 7000 : 14000;
  const radius = new Float32Array(N);
  const theta0 = new Float32Array(N);
  const speed = new Float32Array(N);
  const spread = new Float32Array(N); // 팔에서 벗어난 정도 (법선 방향)
  const dx = new Float32Array(N), dy = new Float32Array(N), vx = new Float32Array(N), vy = new Float32Array(N);
  const pos = new Float32Array(N * 2);
  const size = new Float32Array(N);
  const mixv = new Float32Array(N);
  const ARMS = 3;
  for (let i = 0; i < N; i++) {
    // 중심에 몰리게 — 제곱근 분포를 한 번 더 눌러 준다
    const u = Math.pow(Math.random(), 1.6);
    radius[i] = 0.04 + u * 0.96;
    const arm = i % ARMS;
    const twist = radius[i] * 5.2; // 나선
    const jitter = rand(-1, 1) * rand(0, 1) * (0.25 + radius[i] * 0.5);
    theta0[i] = (arm / ARMS) * TAU + twist + jitter;
    speed[i] = (0.28 / Math.sqrt(0.08 + radius[i])) * (0.9 + Math.random() * 0.2); // 케플러 느낌
    spread[i] = rand(-1, 1) * rand(0, 1) * 0.05;
    size[i] = (Math.random() < 0.06 ? rand(3, 5.2) : rand(1.1, 2.6)) * (1.15 - radius[i] * 0.4);
    mixv[i] = clamp(radius[i] * 1.1 + rand(-0.15, 0.15), 0, 1);
  }

  const posBuf = gl.createBuffer()!;
  const sizeBuf = gl.createBuffer()!;
  const mixBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuf); gl.bufferData(gl.ARRAY_BUFFER, size, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, mixBuf); gl.bufferData(gl.ARRAY_BUFFER, mixv, gl.STATIC_DRAW);
  const aSize = gl.getAttribLocation(prog.program, "aSize");
  const aMix = gl.getAttribLocation(prog.program, "aMix");

  const pointers = new Map<number, { x: number; y: number; vx: number; vy: number; at: number }>();
  let center = { x: 0, y: 0 };
  let centerTarget = { x: 0, y: 0 };
  let spin = 1;
  let spinTarget = 1;
  let pulse = 0;
  let time = 0;

  const loop = createLoop((dt, t) => {
    mini.resize();
    time += dt * spin;
    const now = performance.now();
    for (const [id, p] of pointers) if (id === 0 && now - p.at > 800) pointers.delete(id);
    center.x += (centerTarget.x - center.x) * (1 - damp(2, dt));
    center.y += (centerTarget.y - center.y) * (1 - damp(2, dt));
    spin += (spinTarget - spin) * (1 - damp(1.5, dt));
    spinTarget += (1 - spinTarget) * (1 - damp(0.5, dt));
    pulse *= damp(2.5, dt);

    const W = canvas.clientWidth, H = canvas.clientHeight;
    const cx = W / 2 + center.x, cy = H / 2 + center.y;
    const R = Math.min(W, H) * 0.46;
    const K = 18, C = 2 * Math.sqrt(K); // 임계 감쇠

    for (let i = 0; i < N; i++) {
      const th = theta0[i] + time * speed[i];
      const r = radius[i] * R * (1 + pulse * 0.08 * Math.sin(radius[i] * 12 - t * 3));
      const cos = Math.cos(th), sin = Math.sin(th);
      // 궤도 위치 + 팔 두께(법선 방향) — 살짝 납작한 타원
      const bx = cx + cos * r * 1.0 + (-sin) * spread[i] * R;
      const by = cy + sin * r * 0.72 + cos * spread[i] * R * 0.72;

      let ax = -K * dx[i] - C * vx[i];
      let ay = -K * dy[i] - C * vy[i];
      const px = bx + dx[i], py = by + dy[i];
      for (const p of pointers.values()) {
        const ddx = px - p.x, ddy = py - p.y;
        const d2 = ddx * ddx + ddy * ddy;
        const RR = 130;
        if (d2 < RR * RR) {
          const d = Math.sqrt(d2) + 0.01;
          const k = (1 - d / RR);
          ax += (ddx / d) * k * k * 4200 + p.vx * k * 18;
          ay += (ddy / d) * k * k * 4200 + p.vy * k * 18;
        }
      }
      vx[i] += ax * dt; vy[i] += ay * dt;
      dx[i] += vx[i] * dt; dy[i] += vy[i] * dt;
      pos[i * 2] = bx + dx[i];
      pos[i * 2 + 1] = by + dy[i];
    }

    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(0.012, 0.03, 0.07, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);

    prog.use();
    gl.uniform2f(prog.uniforms.uResolution, W, H);
    gl.uniform1f(prog.uniforms.uDpr, Math.min(window.devicePixelRatio || 1, 2));
    gl.uniform3f(prog.uniforms.uCore, core[0], core[1], core[2]);
    gl.uniform3f(prog.uniforms.uEdge, edge[0], edge[1], edge[2]);
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuf);
    gl.enableVertexAttribArray(aSize);
    gl.vertexAttribPointer(aSize, 1, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, mixBuf);
    gl.enableVertexAttribArray(aMix);
    gl.vertexAttribPointer(aMix, 1, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.POINTS, 0, N);
    gl.disableVertexAttribArray(aSize);
    gl.disableVertexAttribArray(aMix);
    gl.disable(gl.BLEND);
  });

  return {
    start: () => loop.start(),
    stop: () => loop.stop(),
    dispose: () => { loop.stop(); mini.dispose(); },
    pointerDown(x, y, id) {
      pointers.set(id, { x, y, vx: 0, vy: 0, at: performance.now() });
    },
    pointerMove(x, y, dx, dy, id) {
      pointers.set(id, { x, y, vx: dx, vy: dy, at: performance.now() });
    },
    pointerUp(id) {
      if (id !== 0) pointers.delete(id);
    },
    wheel(_x, _y, delta) {
      spinTarget = clamp(spinTarget - delta * 0.02, -2.5, 3.5);
    },
    tilt(fx, fy) {
      centerTarget = { x: fx * 60, y: fy * 60 };
    },
    idle() {
      pulse = 1; // 한 번 숨 쉬듯 부풀었다 돌아온다
    },
    clear() {
      dx.fill(0); dy.fill(0); vx.fill(0); vy.fill(0);
    },
  };
};
