/**
 * 작은 WebGL 도구 — 전체 화면 사각형에 프래그먼트 셰이더를 돌리는 장면들이 함께 쓴다.
 * (물결 · 젠 가든 · 라바 램프 · 반응확산 · 점균)
 *
 * FluidSim 은 먼저 만들어져 자기 도구를 갖고 있다. 여기 것과 겹치지만 한쪽으로 합치는
 * 것은 유체 엔진을 다시 검증해야 하는 일이라 그대로 둔다.
 */

import { EngineUnsupportedError } from "@/lib/engines/types";

export const QUAD_VERTEX = `
precision highp float;
attribute vec2 aPosition;
varying vec2 vUv;
void main () {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export type GL = WebGL2RenderingContext | WebGLRenderingContext;

export type MiniProgram = {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
  use(): void;
};

export type Target = {
  texture: WebGLTexture;
  fbo: WebGLFramebuffer;
  width: number;
  height: number;
};

export type PingPong = {
  read: Target;
  write: Target;
  swap(): void;
  width: number;
  height: number;
};

export type MiniGL = {
  gl: GL;
  isWebGL2: boolean;
  floatType: number;
  /** RGBA 부동소수 텍스처에 렌더링할 수 있는가 (시뮬레이션에 필요) */
  canRenderFloat: boolean;
  linear: boolean;
  program(fragment: string, vertex?: string, defines?: string[]): MiniProgram;
  target(w: number, h: number, opts?: { filter?: number; float?: boolean }): Target;
  pingpong(w: number, h: number, opts?: { filter?: number; float?: boolean }): PingPong;
  /** target 이 null 이면 화면 */
  blit(target: Target | null): void;
  bindTexture(tex: WebGLTexture, unit: number): number;
  /** 캔버스 픽셀 크기를 CSS 크기에 맞춘다. 바뀌었으면 true */
  resize(maxDpr?: number): boolean;
  dispose(): void;
};

export function createMiniGL(canvas: HTMLCanvasElement, opts: { needFloat?: boolean; needVertexTexture?: boolean } = {}): MiniGL {
  const attrs: WebGLContextAttributes = { alpha: false, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false };
  let gl = canvas.getContext("webgl2", attrs) as GL | null;
  const isWebGL2 = !!gl;
  if (!gl) gl = canvas.getContext("webgl", attrs) as GL | null;
  if (!gl) throw new EngineUnsupportedError("이 브라우저는 WebGL 을 지원하지 않아요");

  let floatType: number = gl.UNSIGNED_BYTE;
  let linear = true;
  let canRenderFloat = false;

  if (isWebGL2) {
    const gl2 = gl as WebGL2RenderingContext;
    if (gl2.getExtension("EXT_color_buffer_float")) {
      floatType = gl2.HALF_FLOAT;
      canRenderFloat = true;
    }
  } else {
    const hf = gl.getExtension("OES_texture_half_float") as { HALF_FLOAT_OES: number } | null;
    if (hf) {
      floatType = hf.HALF_FLOAT_OES;
      canRenderFloat = true;
      linear = !!gl.getExtension("OES_texture_half_float_linear");
    }
  }

  if (opts.needFloat && !canRenderFloat) {
    throw new EngineUnsupportedError("이 기기의 WebGL 은 부동소수 텍스처를 그릴 수 없어요");
  }
  if (opts.needVertexTexture && gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) < 1) {
    throw new EngineUnsupportedError("이 기기의 WebGL 은 이 장면이 필요한 기능이 없어요");
  }

  // 화면 전체 사각형
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
  const ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);

  const compile = (type: number, src: string, defines: string[] = []) => {
    const sh = gl!.createShader(type);
    if (!sh) throw new Error("shader");
    gl!.shaderSource(sh, defines.map((d) => `#define ${d}\n`).join("") + src);
    gl!.compileShader(sh);
    if (!gl!.getShaderParameter(sh, gl!.COMPILE_STATUS)) {
      throw new Error(gl!.getShaderInfoLog(sh) ?? "compile failed");
    }
    return sh;
  };

  const mini: MiniGL = {
    gl,
    isWebGL2,
    floatType,
    canRenderFloat,
    linear,
    program(fragment, vertex = QUAD_VERTEX, defines = []) {
      const g = gl!;
      const p = g.createProgram();
      if (!p) throw new Error("program");
      g.attachShader(p, compile(g.VERTEX_SHADER, vertex, defines));
      g.attachShader(p, compile(g.FRAGMENT_SHADER, fragment, defines));
      g.bindAttribLocation(p, 0, "aPosition");
      g.linkProgram(p);
      if (!g.getProgramParameter(p, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(p) ?? "link");
      const uniforms: Record<string, WebGLUniformLocation | null> = {};
      const n = g.getProgramParameter(p, g.ACTIVE_UNIFORMS) as number;
      for (let i = 0; i < n; i++) {
        const info = g.getActiveUniform(p, i);
        if (info) uniforms[info.name.replace(/\[0\]$/, "")] = g.getUniformLocation(p, info.name);
      }
      return { program: p, uniforms, use: () => g.useProgram(p) };
    },
    target(w, h, o = {}) {
      const g = gl!;
      const useFloat = o.float !== false && canRenderFloat;
      const filter = o.filter ?? (useFloat && !linear ? g.NEAREST : g.LINEAR);
      const tex = g.createTexture();
      if (!tex) throw new Error("texture");
      g.activeTexture(g.TEXTURE0);
      g.bindTexture(g.TEXTURE_2D, tex);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, filter);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, filter);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
      const internal = useFloat && isWebGL2 ? (g as WebGL2RenderingContext).RGBA16F : g.RGBA;
      g.texImage2D(g.TEXTURE_2D, 0, internal, w, h, 0, g.RGBA, useFloat ? floatType : g.UNSIGNED_BYTE, null);
      const fbo = g.createFramebuffer();
      if (!fbo) throw new Error("fbo");
      g.bindFramebuffer(g.FRAMEBUFFER, fbo);
      g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, tex, 0);
      g.viewport(0, 0, w, h);
      g.clearColor(0, 0, 0, 0);
      g.clear(g.COLOR_BUFFER_BIT);
      return { texture: tex, fbo, width: w, height: h };
    },
    pingpong(w, h, o) {
      let a = mini.target(w, h, o);
      let b = mini.target(w, h, o);
      return {
        get read() { return a; },
        get write() { return b; },
        swap() { const t = a; a = b; b = t; },
        width: w,
        height: h,
      };
    },
    blit(target) {
      const g = gl!;
      if (target) {
        g.viewport(0, 0, target.width, target.height);
        g.bindFramebuffer(g.FRAMEBUFFER, target.fbo);
      } else {
        g.viewport(0, 0, g.drawingBufferWidth, g.drawingBufferHeight);
        g.bindFramebuffer(g.FRAMEBUFFER, null);
      }
      g.bindBuffer(g.ARRAY_BUFFER, vbo);
      g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, ibo);
      g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
      g.enableVertexAttribArray(0);
      g.drawElements(g.TRIANGLES, 6, g.UNSIGNED_SHORT, 0);
    },
    bindTexture(tex, unit) {
      const g = gl!;
      g.activeTexture(g.TEXTURE0 + unit);
      g.bindTexture(g.TEXTURE_2D, tex);
      return unit;
    },
    resize(maxDpr = 2) {
      const ratio = Math.min(window.devicePixelRatio || 1, maxDpr);
      const w = Math.max(1, Math.floor(canvas.clientWidth * ratio));
      const h = Math.max(1, Math.floor(canvas.clientHeight * ratio));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        return true;
      }
      return false;
    },
    dispose() {
      gl!.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
  return mini;
}

export function deleteTarget(gl: GL, t: Target) {
  gl.deleteTexture(t.texture);
  gl.deleteFramebuffer(t.fbo);
}
