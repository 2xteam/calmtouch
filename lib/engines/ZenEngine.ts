import { createMiniGL, type PingPong } from "@/lib/gl/mini";
import { createLoop } from "@/lib/canvas/tools";
import type { EngineFactory } from "./types";

/**
 * 젠 가든 — 모래 높이장. 손가락이 지나간 자리는 갈퀴(갈래 넷)가 골을 내고 양옆에 둔덕을 남긴다.
 * 손을 떼면 아주 천천히 평평해진다. 탭은 돌을 놓는다(최대 8개).
 *
 * 렌더는 높이의 기울기로 법선을 만들어 왼쪽 위 빛으로 음영을 넣고, 알갱이 노이즈를 얹는다.
 */
const MAX_STONES = 8;

const RAKE_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uField;
uniform vec2 a;
uniform vec2 b;
uniform float width;
uniform float aspect;
uniform float depth;
void main () {
  float h = texture2D(uField, vUv).r;
  vec2 p = vUv; p.x *= aspect;
  vec2 pa = a; pa.x *= aspect;
  vec2 pb = b; pb.x *= aspect;
  vec2 ab = pb - pa;
  float len2 = max(dot(ab, ab), 1e-6);
  float t = clamp(dot(p - pa, ab) / len2, 0.0, 1.0);
  vec2 q = pa + ab * t;
  vec2 d = p - q;
  vec2 nrm = normalize(vec2(-ab.y, ab.x) + 1e-6);
  float across = dot(d, nrm) / width; // -1~1 갈퀴 폭 안
  float along = length(d);
  if (abs(across) < 1.0 && along < width * 1.4) {
    // 갈래 넷: cos 로 골 네 개, 가장자리는 둔덕
    float tines = cos(across * 3.14159 * 4.0);
    float profile = -tines * 0.6 + 0.25;
    float edge = smoothstep(1.0, 0.6, abs(across));
    float target = profile * depth * edge;
    // 이미 판 곳은 더 파지 않고 목표 높이로 당긴다
    h = mix(h, target, 0.55 * edge);
  }
  gl_FragColor = vec4(h, 0.0, 0.0, 1.0);
}
`;

const RELAX_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uField;
uniform vec2 texel;
uniform float rate;
void main () {
  float c = texture2D(uField, vUv).r;
  float s = texture2D(uField, vUv + vec2(texel.x, 0.0)).r
          + texture2D(uField, vUv - vec2(texel.x, 0.0)).r
          + texture2D(uField, vUv + vec2(0.0, texel.y)).r
          + texture2D(uField, vUv - vec2(0.0, texel.y)).r;
  float h = mix(c, s * 0.25, rate);
  h *= 1.0 - rate * 0.5;
  gl_FragColor = vec4(h, 0.0, 0.0, 1.0);
}
`;

const RENDER_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uField;
uniform vec2 texel;
uniform vec3 uStones[${MAX_STONES}];
uniform int uStoneCount;
uniform float aspect;

float hash (vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main () {
  float l = texture2D(uField, vUv - vec2(texel.x, 0.0)).r;
  float r = texture2D(uField, vUv + vec2(texel.x, 0.0)).r;
  float t = texture2D(uField, vUv + vec2(0.0, texel.y)).r;
  float b = texture2D(uField, vUv - vec2(0.0, texel.y)).r;
  vec3 n = normalize(vec3((l - r) * 40.0, (b - t) * 40.0, 1.0));
  vec3 L = normalize(vec3(-0.6, 0.7, 0.55));
  float diff = max(dot(n, L), 0.0);
  vec3 sand = vec3(0.80, 0.73, 0.58);
  vec3 col = sand * (0.55 + 0.55 * diff);
  // 알갱이
  float g = hash(floor(vUv * vec2(aspect, 1.0) * 900.0));
  col *= 0.93 + g * 0.14;
  // 돌
  for (int i = 0; i < ${MAX_STONES}; i++) {
    if (i >= uStoneCount) break;
    vec2 d = vUv - uStones[i].xy; d.x *= aspect;
    float rad = uStones[i].z;
    float dist = length(d);
    float shadow = smoothstep(rad * 1.9, rad * 0.9, length(d - vec2(-0.008, 0.008)));
    col *= 1.0 - shadow * 0.35;
    if (dist < rad) {
      float z = sqrt(max(0.0, 1.0 - (dist / rad) * (dist / rad)));
      vec3 sn = normalize(vec3(d / rad, z * 0.9));
      float sd = max(dot(sn, L), 0.0);
      vec3 stone = vec3(0.30, 0.31, 0.32) * (0.35 + 0.75 * sd);
      stone += vec3(0.12) * pow(max(dot(sn, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0), 20.0);
      float aa = smoothstep(rad, rad * 0.94, dist);
      col = mix(col, stone, aa);
    }
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

export const createZenEngine: EngineFactory = (canvas) => {
  const mini = createMiniGL(canvas, { needFloat: true });
  const { gl } = mini;
  const rake = mini.program(RAKE_FRAG);
  const relax = mini.program(RELAX_FRAG);
  const render = mini.program(RENDER_FRAG);

  let field!: PingPong;
  let tw = 0, th = 0;
  const init = () => {
    const aspect = canvas.width / canvas.height;
    const base = 512;
    tw = aspect >= 1 ? Math.round(base * aspect) : base;
    th = aspect >= 1 ? base : Math.round(base / aspect);
    field = mini.pingpong(tw, th, { filter: gl.LINEAR });
  };
  mini.resize();
  init();

  const stones: { x: number; y: number; r: number }[] = [];
  const stoneData = new Float32Array(MAX_STONES * 3);
  const last = new Map<number, { x: number; y: number; moved: number }>();
  let restSince = performance.now();

  const uv = (x: number, y: number) => [x / canvas.clientWidth, 1 - y / canvas.clientHeight] as const;

  const rakeSegment = (x0: number, y0: number, x1: number, y1: number) => {
    const [ax, ay] = uv(x0, y0);
    const [bx, by] = uv(x1, y1);
    rake.use();
    gl.uniform1i(rake.uniforms.uField, mini.bindTexture(field.read.texture, 0));
    gl.uniform2f(rake.uniforms.a, ax, ay);
    gl.uniform2f(rake.uniforms.b, bx, by);
    gl.uniform1f(rake.uniforms.width, 0.045);
    gl.uniform1f(rake.uniforms.aspect, canvas.width / canvas.height);
    gl.uniform1f(rake.uniforms.depth, 0.06);
    mini.blit(field.write);
    field.swap();
  };

  const loop = createLoop((dt) => {
    if (mini.resize()) init();
    gl.disable(gl.BLEND);
    // 손을 뗀 지 3초 지나면 아주 천천히 평평해진다
    const idleFor = (performance.now() - restSince) / 1000;
    if (idleFor > 3) {
      relax.use();
      gl.uniform1i(relax.uniforms.uField, mini.bindTexture(field.read.texture, 0));
      gl.uniform2f(relax.uniforms.texel, 1 / tw, 1 / th);
      gl.uniform1f(relax.uniforms.rate, Math.min(0.02, dt * 0.12));
      mini.blit(field.write);
      field.swap();
    }
    for (let i = 0; i < MAX_STONES; i++) {
      const s = stones[i];
      stoneData[i * 3] = s ? s.x : -10; stoneData[i * 3 + 1] = s ? s.y : -10; stoneData[i * 3 + 2] = s ? s.r : 0;
    }
    render.use();
    gl.uniform1i(render.uniforms.uField, mini.bindTexture(field.read.texture, 0));
    gl.uniform2f(render.uniforms.texel, 1 / tw, 1 / th);
    gl.uniform3fv(render.uniforms.uStones, stoneData);
    gl.uniform1i(render.uniforms.uStoneCount, stones.length);
    gl.uniform1f(render.uniforms.aspect, canvas.width / canvas.height);
    mini.blit(null);
  });

  return {
    start: () => loop.start(),
    stop: () => loop.stop(),
    dispose: () => { loop.stop(); mini.dispose(); },
    pointerDown(x, y, id) {
      last.set(id, { x, y, moved: 0 });
      restSince = performance.now();
    },
    pointerMove(x, y, dx, dy, id, pressed) {
      if (!pressed) return;
      const p = last.get(id);
      if (p) {
        rakeSegment(p.x, p.y, x, y);
        p.moved += Math.hypot(dx, dy);
        p.x = x; p.y = y;
      } else last.set(id, { x, y, moved: 0 });
      restSince = performance.now();
    },
    pointerUp(id) {
      const p = last.get(id);
      // 거의 움직이지 않았으면 탭 — 돌을 놓는다. 이미 돌이 있으면 치운다
      if (p && p.moved < 6) {
        const [ux, uy] = uv(p.x, p.y);
        const aspect = canvas.width / canvas.height;
        const hit = stones.findIndex((s) => Math.hypot((s.x - ux) * aspect, s.y - uy) < s.r);
        if (hit >= 0) stones.splice(hit, 1);
        else {
          if (stones.length >= MAX_STONES) stones.shift();
          stones.push({ x: ux, y: uy, r: 0.03 + Math.random() * 0.025 });
        }
      }
      last.delete(id);
      restSince = performance.now();
    },
    wheel(x, y, delta) {
      rakeSegment(x, y, x, y + delta);
      restSince = performance.now();
    },
    tilt() {},
    idle() {},
    clear() {
      init();
      stones.length = 0;
    },
  };
};
