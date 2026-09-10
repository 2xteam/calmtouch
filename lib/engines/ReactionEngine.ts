import { createMiniGL, type PingPong } from "@/lib/gl/mini";
import { createLoop } from "@/lib/canvas/tools";
import { hexToRgb255, rand } from "@/lib/util/math";
import type { EngineFactory } from "./types";

/**
 * 무늬 — Gray-Scott 반응확산. 두 화학물질 A(r), B(g) 가 확산하고 반응하면서
 * 산호 · 얼룩 같은 무늬를 천천히 키운다. 손끝은 B 를 떨어뜨린다 → 그 자리에서 새 무늬.
 *
 * f=0.0545 k=0.062 는 "미로처럼 자라는" 영역이다. 사용자가 고른 색은 B 농도의 색 램프에 쓴다.
 */
const STEP_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uState;
uniform vec2 texel;
uniform float f;
uniform float k;
void main () {
  vec2 c = texture2D(uState, vUv).rg;
  vec2 lap = -c;
  lap += texture2D(uState, vUv + vec2(texel.x, 0.0)).rg * 0.2;
  lap += texture2D(uState, vUv - vec2(texel.x, 0.0)).rg * 0.2;
  lap += texture2D(uState, vUv + vec2(0.0, texel.y)).rg * 0.2;
  lap += texture2D(uState, vUv - vec2(0.0, texel.y)).rg * 0.2;
  lap += texture2D(uState, vUv + texel).rg * 0.05;
  lap += texture2D(uState, vUv - texel).rg * 0.05;
  lap += texture2D(uState, vUv + vec2(texel.x, -texel.y)).rg * 0.05;
  lap += texture2D(uState, vUv + vec2(-texel.x, texel.y)).rg * 0.05;
  float a = c.r;
  float b = c.g;
  float abb = a * b * b;
  float na = a + (1.0 * lap.r - abb + f * (1.0 - a));
  float nb = b + (0.5 * lap.g + abb - (k + f) * b);
  gl_FragColor = vec4(clamp(na, 0.0, 1.0), clamp(nb, 0.0, 1.0), 0.0, 1.0);
}
`;

const SEED_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uState;
uniform vec2 point;
uniform float radius;
uniform float aspect;
void main () {
  vec2 c = texture2D(uState, vUv).rg;
  vec2 d = vUv - point;
  d.x *= aspect;
  float g = smoothstep(radius, radius * 0.4, length(d));
  c.g = max(c.g, g * 0.9);
  gl_FragColor = vec4(c, 0.0, 1.0);
}
`;

const RENDER_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uState;
uniform vec2 texel;
uniform vec3 uColor;
void main () {
  float b = texture2D(uState, vUv).g;
  float bl = texture2D(uState, vUv - vec2(texel.x, 0.0)).g;
  float bt = texture2D(uState, vUv + vec2(0.0, texel.y)).g;
  float edge = (bl - b) * 6.0 + (bt - b) * 4.0;
  vec3 bg = vec3(0.016, 0.086, 0.106);
  float m = smoothstep(0.12, 0.4, b);
  vec3 col = mix(bg, uColor, m);
  col += uColor * max(edge, 0.0) * 1.6 * m;
  col *= 1.0 - max(-edge, 0.0) * 1.2 * m;
  // 아주 옅은 안쪽 어둠 — 무늬가 도톨하게 보이도록
  col = mix(col, col * 0.7, smoothstep(0.5, 0.9, b) * 0.5);
  gl_FragColor = vec4(col, 1.0);
}
`;

export const createReactionEngine: EngineFactory = (canvas, ctx0) => {
  const mini = createMiniGL(canvas, { needFloat: true });
  const { gl } = mini;
  const step = mini.program(STEP_FRAG);
  const seed = mini.program(SEED_FRAG);
  const render = mini.program(RENDER_FRAG);
  let color = hexToRgb255(ctx0.color).map((v) => v / 255);

  let state!: PingPong;
  let tw = 0, th = 0;
  const init = () => {
    const aspect = canvas.width / canvas.height;
    const base = 320;
    tw = aspect >= 1 ? Math.round(base * aspect) : base;
    th = aspect >= 1 ? base : Math.round(base / aspect);
    state = mini.pingpong(tw, th, { filter: gl.LINEAR });
    // A=1 로 채운다 — 첫 프레임에 클리어 색으로 쓴다
    gl.bindFramebuffer(gl.FRAMEBUFFER, state.read.fbo);
    gl.viewport(0, 0, tw, th);
    gl.clearColor(1, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, state.write.fbo);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.clearColor(0, 0, 0, 1);
  };
  mini.resize();
  init();

  const addSeed = (x: number, y: number, radius: number) => {
    seed.use();
    gl.uniform1i(seed.uniforms.uState, mini.bindTexture(state.read.texture, 0));
    gl.uniform2f(seed.uniforms.point, x / canvas.clientWidth, 1 - y / canvas.clientHeight);
    gl.uniform1f(seed.uniforms.radius, radius);
    gl.uniform1f(seed.uniforms.aspect, canvas.width / canvas.height);
    mini.blit(state.write);
    state.swap();
  };

  const loop = createLoop(() => {
    if (mini.resize()) init();
    gl.disable(gl.BLEND);
    for (let i = 0; i < 10; i++) {
      step.use();
      gl.uniform1i(step.uniforms.uState, mini.bindTexture(state.read.texture, 0));
      gl.uniform2f(step.uniforms.texel, 1 / tw, 1 / th);
      gl.uniform1f(step.uniforms.f, 0.0545);
      gl.uniform1f(step.uniforms.k, 0.062);
      mini.blit(state.write);
      state.swap();
    }
    render.use();
    gl.uniform1i(render.uniforms.uState, mini.bindTexture(state.read.texture, 0));
    gl.uniform2f(render.uniforms.texel, 1 / tw, 1 / th);
    gl.uniform3f(render.uniforms.uColor, color[0], color[1], color[2]);
    mini.blit(null);
  });

  return {
    start() {
      for (let i = 0; i < 4; i++) addSeed(rand(0.25, 0.75) * canvas.clientWidth, rand(0.25, 0.75) * canvas.clientHeight, 0.02);
      loop.start();
    },
    stop: () => loop.stop(),
    dispose: () => { loop.stop(); mini.dispose(); },
    pointerDown(x, y) {
      addSeed(x, y, 0.018);
    },
    pointerMove(x, y, _dx, _dy, _id, pressed) {
      if (pressed) addSeed(x, y, 0.012);
    },
    pointerUp() {},
    wheel(x, y) {
      addSeed(x, y, 0.03);
    },
    tilt() {},
    idle() {
      addSeed(rand(0.1, 0.9) * canvas.clientWidth, rand(0.1, 0.9) * canvas.clientHeight, 0.012);
    },
    clear() {
      init();
    },
    setColor(hex) {
      color = hexToRgb255(hex).map((v) => v / 255);
    },
  };
};
