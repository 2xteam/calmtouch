import { createMiniGL, type MiniGL, type PingPong } from "@/lib/gl/mini";
import { createLoop } from "@/lib/canvas/tools";
import { hexToRgb255, rand } from "@/lib/util/math";
import type { EngineFactory } from "./types";

/**
 * 물결 — 수면 높이장(height field). 탭하면 동심원, 끌면 잔물결, 기울이면 빛이 그쪽으로.
 *
 * 텍스처 한 장에 r=높이, g=속도를 둔다. 매 프레임 이웃 넷의 평균으로 당기는 스프링 +
 * 감쇠(Verlet). 렌더는 높이의 기울기로 법선을 만들어 뒤 배경을 굴절시키고 하이라이트를 얹는다.
 */
const STEP_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uField;
uniform vec2 texel;
uniform float damping;
void main () {
  vec2 c = texture2D(uField, vUv).rg;
  float l = texture2D(uField, vUv - vec2(texel.x, 0.0)).r;
  float r = texture2D(uField, vUv + vec2(texel.x, 0.0)).r;
  float t = texture2D(uField, vUv + vec2(0.0, texel.y)).r;
  float b = texture2D(uField, vUv - vec2(0.0, texel.y)).r;
  float avg = (l + r + t + b) * 0.25;
  float v = c.g + (avg - c.r) * 1.9;
  v *= damping;
  float h = c.r + v;
  // 가장자리는 벽 — 반사가 아니라 흡수되게 조금 줄인다
  float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
  h *= smoothstep(0.0, 0.02, edge) * 0.05 + 0.95;
  gl_FragColor = vec4(h, v, 0.0, 1.0);
}
`;

const DROP_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uField;
uniform vec2 point;
uniform float radius;
uniform float strength;
uniform float aspect;
void main () {
  vec2 c = texture2D(uField, vUv).rg;
  vec2 d = vUv - point;
  d.x *= aspect;
  float g = exp(-dot(d, d) / (radius * radius));
  c.r -= g * strength;
  gl_FragColor = vec4(c, 0.0, 1.0);
}
`;

const RENDER_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uField;
uniform vec2 texel;
uniform vec3 uTint;
uniform vec2 uLight;
uniform float uTime;
void main () {
  float l = texture2D(uField, vUv - vec2(texel.x, 0.0)).r;
  float r = texture2D(uField, vUv + vec2(texel.x, 0.0)).r;
  float t = texture2D(uField, vUv + vec2(0.0, texel.y)).r;
  float b = texture2D(uField, vUv - vec2(0.0, texel.y)).r;
  vec3 n = normalize(vec3((l - r) * 6.0, (b - t) * 6.0, 1.0));
  // 굴절된 배경 — 깊은 물의 그라디언트. 아래가 어둡다
  vec2 uv = vUv + n.xy * 0.06;
  float depth = smoothstep(-0.2, 1.1, uv.y);
  vec3 deep = vec3(0.016, 0.086, 0.106);
  vec3 shallow = vec3(0.06, 0.26, 0.32);
  vec3 col = mix(deep, shallow, depth * 0.8);
  // 빛 — 기울기에 따라 자리가 옮겨 가는 부드러운 광원
  vec2 lp = vec2(0.5, 1.15) + uLight;
  float glow = exp(-length(uv - lp) * 1.6) * 0.35;
  col += uTint * glow;
  // 스페큘러 하이라이트
  vec3 L = normalize(vec3(lp - vUv, 0.9));
  float spec = pow(max(dot(n, L), 0.0), 60.0);
  col += uTint * spec * 0.8 + vec3(spec) * 0.35;
  // 물결 자체의 가느다란 선(코스틱 느낌)
  float slope = length(n.xy);
  col += uTint * slope * 0.9;
  gl_FragColor = vec4(col, 1.0);
}
`;

export const createRippleEngine: EngineFactory = (canvas, ctx0) => {
  const mini: MiniGL = createMiniGL(canvas, { needFloat: true });
  const { gl } = mini;
  const step = mini.program(STEP_FRAG);
  const drop = mini.program(DROP_FRAG);
  const render = mini.program(RENDER_FRAG);

  let field!: PingPong;
  let tw = 0, th = 0;
  const resolution = () => {
    const aspect = canvas.width / canvas.height;
    const base = 384;
    return aspect >= 1 ? { w: Math.round(base * aspect), h: base } : { w: base, h: Math.round(base / aspect) };
  };
  const init = () => {
    const r = resolution();
    tw = r.w; th = r.h;
    field = mini.pingpong(tw, th, { filter: gl.LINEAR });
  };
  mini.resize();
  init();

  const tint = hexToRgb255(ctx0.scene.color.kind === "palette" ? ctx0.scene.color.colors[0] : ctx0.color).map((v) => v / 255);
  let light = { x: 0, y: 0 };
  let lightTarget = { x: 0, y: 0 };
  const last = new Map<number, { x: number; y: number }>();

  const addDrop = (x: number, y: number, radius: number, strength: number) => {
    drop.use();
    gl.uniform1i(drop.uniforms.uField, mini.bindTexture(field.read.texture, 0));
    gl.uniform2f(drop.uniforms.point, x / canvas.clientWidth, 1 - y / canvas.clientHeight);
    gl.uniform1f(drop.uniforms.radius, radius);
    gl.uniform1f(drop.uniforms.strength, strength);
    gl.uniform1f(drop.uniforms.aspect, canvas.width / canvas.height);
    mini.blit(field.write);
    field.swap();
  };

  const loop = createLoop((dt, t) => {
    if (mini.resize()) init();
    light.x += (lightTarget.x - light.x) * Math.min(1, dt * 3);
    light.y += (lightTarget.y - light.y) * Math.min(1, dt * 3);

    gl.disable(gl.BLEND);
    // 시뮬레이션은 프레임당 두 번 — 물결이 너무 느리지 않게
    for (let i = 0; i < 2; i++) {
      step.use();
      gl.uniform1i(step.uniforms.uField, mini.bindTexture(field.read.texture, 0));
      gl.uniform2f(step.uniforms.texel, 1 / tw, 1 / th);
      gl.uniform1f(step.uniforms.damping, 0.985);
      mini.blit(field.write);
      field.swap();
    }
    render.use();
    gl.uniform1i(render.uniforms.uField, mini.bindTexture(field.read.texture, 0));
    gl.uniform2f(render.uniforms.texel, 1 / tw, 1 / th);
    gl.uniform3f(render.uniforms.uTint, tint[0], tint[1], tint[2]);
    gl.uniform2f(render.uniforms.uLight, light.x, light.y);
    gl.uniform1f(render.uniforms.uTime, t);
    mini.blit(null);
  });

  return {
    start() {
      // 처음 들어올 때 물방울 몇 개
      for (let i = 0; i < 3; i++) addDrop(rand(0.2, 0.8) * canvas.clientWidth, rand(0.2, 0.8) * canvas.clientHeight, 0.02, 0.6);
      loop.start();
    },
    stop: () => loop.stop(),
    dispose: () => { loop.stop(); mini.dispose(); },
    pointerDown(x, y, id) {
      last.set(id, { x, y });
      addDrop(x, y, 0.025, 1.4);
    },
    pointerMove(x, y, dx, dy, id, pressed) {
      const p = last.get(id);
      last.set(id, { x, y });
      const speed = Math.hypot(dx, dy);
      // 마우스 hover 도 아주 약하게 물결이 간다 — 손가락으로 수면을 스치는 느낌
      const k = pressed ? 1 : 0.25;
      if (p && speed > 0.5) addDrop(x, y, 0.012 + Math.min(speed, 40) * 0.0004, Math.min(0.9, 0.12 + speed * 0.012) * k);
    },
    pointerUp(id) {
      last.delete(id);
    },
    wheel(x, y, delta) {
      addDrop(x, y, 0.05, delta > 0 ? 0.8 : -0.8);
    },
    tilt(fx, fy) {
      lightTarget = { x: fx * 0.5, y: -fy * 0.4 };
    },
    idle() {
      addDrop(rand(0.1, 0.9) * canvas.clientWidth, rand(0.1, 0.9) * canvas.clientHeight, 0.02, 0.5);
    },
    clear() {
      init();
    },
  };
};
