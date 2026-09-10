import { createMiniGL, type PingPong } from "@/lib/gl/mini";
import { createLoop } from "@/lib/canvas/tools";
import { hexToRgb255, rand } from "@/lib/util/math";
import { EngineUnsupportedError, type EngineFactory } from "./types";

/**
 * 점균(physarum) — 수만 개의 점이 앞의 세 방향을 감지하고 흔적이 많은 쪽으로 돌면서
 * 실 같은 그물을 짠다(Jeff Jones 2010). 손끝은 먹이 — 흔적을 뿌려 점들을 끌어온다.
 *
 * WebGL2 만 지원한다. 점의 위치는 텍스처에 있고(에이전트 텍스처), 흔적은 다른 텍스처다.
 *   ① 에이전트 갱신 셰이더 — 감지 · 회전 · 이동 (프래그먼트)
 *   ② 흔적 쌓기 — POINTS 로 에이전트 수만큼 그리며 정점 셰이더가 텍스처에서 위치를 읽는다
 *   ③ 흔적 확산 · 감쇠
 *   ④ 렌더 — 흔적 농도를 고른 색의 램프로
 */
const AGENT_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uAgents;
uniform sampler2D uTrail;
uniform vec2 uTrailSize;
uniform float uTime;
uniform float uSensorDist;
uniform float uSensorAngle;
uniform float uTurn;
uniform float uSpeed;
float hash (vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime) * 43758.5453); }
float sense (vec2 pos, float ang) {
  vec2 s = pos + vec2(cos(ang), sin(ang)) * uSensorDist;
  return texture(uTrail, fract(s)).r;
}
void main () {
  vec4 a = texture(uAgents, vUv);
  vec2 pos = a.xy;
  float ang = a.z;
  float f = sense(pos, ang);
  float l = sense(pos, ang + uSensorAngle);
  float r = sense(pos, ang - uSensorAngle);
  float rnd = hash(vUv + pos);
  if (f > l && f > r) { }
  else if (f < l && f < r) { ang += (rnd < 0.5 ? -1.0 : 1.0) * uTurn; }
  else if (l < r) { ang -= uTurn; }
  else if (r < l) { ang += uTurn; }
  vec2 step = vec2(cos(ang), sin(ang)) * uSpeed / uTrailSize;
  pos = fract(pos + step);
  outColor = vec4(pos, ang, 1.0);
}
`;

const DEPOSIT_VERT = `#version 300 es
precision highp float;
uniform sampler2D uAgents;
uniform ivec2 uAgentsSize;
void main () {
  int id = gl_VertexID;
  ivec2 tc = ivec2(id % uAgentsSize.x, id / uAgentsSize.x);
  vec4 a = texelFetch(uAgents, tc, 0);
  gl_Position = vec4(a.xy * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 1.0;
}
`;
const DEPOSIT_FRAG = `#version 300 es
precision highp float;
out vec4 outColor;
uniform float uAmount;
void main () { outColor = vec4(uAmount, 0.0, 0.0, 1.0); }
`;

const DIFFUSE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTrail;
uniform vec2 texel;
uniform float uDecay;
void main () {
  float s = 0.0;
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) {
    s += texture(uTrail, vUv + vec2(float(x), float(y)) * texel).r;
  }
  float v = (s / 9.0) * uDecay;
  outColor = vec4(v, 0.0, 0.0, 1.0);
}
`;

const FOOD_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTrail;
uniform vec2 point;
uniform float radius;
uniform float aspect;
void main () {
  float v = texture(uTrail, vUv).r;
  vec2 d = vUv - point; d.x *= aspect;
  float g = exp(-dot(d, d) / (radius * radius));
  outColor = vec4(v + g * 1.5, 0.0, 0.0, 1.0);
}
`;

const RENDER_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTrail;
uniform vec3 uColor;
void main () {
  float v = texture(uTrail, vUv).r;
  float m = 1.0 - exp(-v * 1.8);
  vec3 bg = vec3(0.016, 0.086, 0.106);
  vec3 col = mix(bg, uColor * 0.55, smoothstep(0.0, 0.5, m));
  col = mix(col, uColor * 1.15, smoothstep(0.45, 1.0, m));
  outColor = vec4(col, 1.0);
}
`;

const QUAD_VERT_300 = `#version 300 es
precision highp float;
in vec2 aPosition;
out vec2 vUv;
void main () { vUv = aPosition * 0.5 + 0.5; gl_Position = vec4(aPosition, 0.0, 1.0); }
`;

export const createPhysarumEngine: EngineFactory = (canvas, ctx0) => {
  const mini = createMiniGL(canvas, { needFloat: true, needVertexTexture: true });
  if (!mini.isWebGL2) throw new EngineUnsupportedError("점균 장면은 WebGL 2 가 필요해요. 브라우저를 최신으로 올려 주세요");
  const gl = mini.gl as WebGL2RenderingContext;

  const agentProg = mini.program(AGENT_FRAG, QUAD_VERT_300);
  const depositProg = mini.program(DEPOSIT_FRAG, DEPOSIT_VERT);
  const diffuseProg = mini.program(DIFFUSE_FRAG, QUAD_VERT_300);
  const foodProg = mini.program(FOOD_FRAG, QUAD_VERT_300);
  const renderProg = mini.program(RENDER_FRAG, QUAD_VERT_300);
  let color = hexToRgb255(ctx0.color).map((v) => v / 255);

  const isMobile = /Mobi|Android/i.test(navigator.userAgent);
  const AW = isMobile ? 128 : 256; // 에이전트 텍스처 한 변 → 16k / 65k 마리
  const AGENTS = AW * AW;
  let agents!: PingPong;
  let trail!: PingPong;
  let tw = 0, th = 0;

  const seedAgents = () => {
    const data = new Float32Array(AGENTS * 4);
    for (let i = 0; i < AGENTS; i++) {
      // 가운데 원 안에서 시작 — 처음 몇 초 동안 밖으로 퍼지며 그물이 짜인다
      const a = rand(0, Math.PI * 2);
      const r = Math.sqrt(Math.random()) * 0.25;
      data[i * 4] = 0.5 + Math.cos(a) * r;
      data[i * 4 + 1] = 0.5 + Math.sin(a) * r;
      data[i * 4 + 2] = rand(0, Math.PI * 2);
      data[i * 4 + 3] = 1;
    }
    gl.bindTexture(gl.TEXTURE_2D, agents.read.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, AW, AW, 0, gl.RGBA, gl.FLOAT, data);
  };

  const init = () => {
    const aspect = canvas.width / canvas.height;
    const base = isMobile ? 384 : 512;
    tw = aspect >= 1 ? Math.round(base * aspect) : base;
    th = aspect >= 1 ? base : Math.round(base / aspect);
    trail = mini.pingpong(tw, th, { filter: gl.LINEAR });
    // 에이전트 텍스처는 32비트 부동소수라야 위치가 뭉개지지 않는다
    agents = mini.pingpong(AW, AW, { filter: gl.NEAREST });
    for (const t of [agents.read, agents.write]) {
      gl.bindTexture(gl.TEXTURE_2D, t.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, AW, AW, 0, gl.RGBA, gl.FLOAT, null);
    }
    seedAgents();
  };
  if (!gl.getExtension("EXT_color_buffer_float")) throw new EngineUnsupportedError("이 기기의 WebGL 은 부동소수 텍스처를 그릴 수 없어요");
  mini.resize();
  init();

  const food = (x: number, y: number, radius: number) => {
    foodProg.use();
    gl.uniform1i(foodProg.uniforms.uTrail, mini.bindTexture(trail.read.texture, 0));
    gl.uniform2f(foodProg.uniforms.point, x / canvas.clientWidth, 1 - y / canvas.clientHeight);
    gl.uniform1f(foodProg.uniforms.radius, radius);
    gl.uniform1f(foodProg.uniforms.aspect, canvas.width / canvas.height);
    mini.blit(trail.write);
    trail.swap();
  };

  const loop = createLoop((dt, t) => {
    if (mini.resize()) init();
    gl.disable(gl.BLEND);

    // ① 에이전트
    agentProg.use();
    gl.uniform1i(agentProg.uniforms.uAgents, mini.bindTexture(agents.read.texture, 0));
    gl.uniform1i(agentProg.uniforms.uTrail, mini.bindTexture(trail.read.texture, 1));
    gl.uniform2f(agentProg.uniforms.uTrailSize, tw, th);
    gl.uniform1f(agentProg.uniforms.uTime, t);
    gl.uniform1f(agentProg.uniforms.uSensorDist, 9 / tw);
    gl.uniform1f(agentProg.uniforms.uSensorAngle, 0.42);
    gl.uniform1f(agentProg.uniforms.uTurn, 0.32);
    gl.uniform1f(agentProg.uniforms.uSpeed, 1.0);
    mini.blit(agents.write);
    agents.swap();

    // ② 흔적 쌓기 — 가산
    gl.bindFramebuffer(gl.FRAMEBUFFER, trail.read.fbo);
    gl.viewport(0, 0, tw, th);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    depositProg.use();
    gl.uniform1i(depositProg.uniforms.uAgents, mini.bindTexture(agents.read.texture, 0));
    gl.uniform2i(depositProg.uniforms.uAgentsSize, AW, AW);
    gl.uniform1f(depositProg.uniforms.uAmount, 0.06);
    gl.disableVertexAttribArray(0);
    gl.drawArrays(gl.POINTS, 0, AGENTS);
    gl.disable(gl.BLEND);

    // ③ 확산 · 감쇠
    diffuseProg.use();
    gl.uniform1i(diffuseProg.uniforms.uTrail, mini.bindTexture(trail.read.texture, 0));
    gl.uniform2f(diffuseProg.uniforms.texel, 1 / tw, 1 / th);
    gl.uniform1f(diffuseProg.uniforms.uDecay, 0.96);
    mini.blit(trail.write);
    trail.swap();

    // ④ 렌더
    renderProg.use();
    gl.uniform1i(renderProg.uniforms.uTrail, mini.bindTexture(trail.read.texture, 0));
    gl.uniform3f(renderProg.uniforms.uColor, color[0], color[1], color[2]);
    mini.blit(null);
  });

  return {
    start: () => loop.start(),
    stop: () => loop.stop(),
    dispose: () => { loop.stop(); mini.dispose(); },
    pointerDown(x, y) {
      food(x, y, 0.03);
    },
    pointerMove(x, y, _dx, _dy, _id, pressed) {
      food(x, y, pressed ? 0.02 : 0.008);
    },
    pointerUp() {},
    wheel(x, y) {
      food(x, y, 0.05);
    },
    tilt() {},
    idle() {
      food(rand(0.1, 0.9) * canvas.clientWidth, rand(0.1, 0.9) * canvas.clientHeight, 0.03);
    },
    clear() {
      init();
    },
    setColor(hex) {
      color = hexToRgb255(hex).map((v) => v / 255);
    },
  };
};
