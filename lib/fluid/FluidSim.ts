import {
  ADVECTION_FRAG,
  BASE_VERTEX,
  BUOYANCY_FRAG,
  CLEAR_FRAG,
  COPY_FRAG,
  CURL_FRAG,
  DISPLAY_FRAG,
  DIVERGENCE_FRAG,
  GRADIENT_SUBTRACT_FRAG,
  PRESSURE_FRAG,
  SPLAT_FRAG,
  VORTICITY_FRAG,
} from "./shaders";

export type RGB = { r: number; g: number; b: number };

/**
 * 시뮬레이션 매개변수. 장면(scene)마다 다른 값을 넣는다 → lib/scenes.ts
 *
 * 값의 뜻 —
 *   densityDissipation  염료가 사라지는 속도. 작을수록 색이 오래 남는다
 *   velocityDissipation 흐름이 멎는 속도. 클수록 금방 잠잠해진다
 *   pressure            압력 풀이의 감쇠. 0.8 에 가까우면 소용돌이가 오래 남는다
 *   curl                와도(vorticity) 보강. 크면 물감이 말려 들어간다
 *   splatRadius         한 번 터치가 퍼지는 반경(화면 비율)
 *   splatForce          움직임이 흐름에 주는 힘
 */
export type FluidConfig = {
  simResolution: number;
  dyeResolution: number;
  densityDissipation: number;
  velocityDissipation: number;
  pressure: number;
  pressureIterations: number;
  curl: number;
  splatRadius: number;
  splatForce: number;
  shading: boolean;
  background: RGB;
  /**
   * 염료 최대 밝기(가장 밝은 채널 기준). 넘으면 색 전체를 함께 줄여 **색상을 지킨다.**
   * 0.15 짜리 방울이 같은 자리에 쌓이면 금방 1.0 을 넘고, 채널마다 따로 잘리면
   * 어떤 색을 골라도 하얗게 탄다. 0 이면 끈다
   */
  dyeClamp: number;
  /** 부력. 염료가 있는 곳이 위로 뜬다. 0 이면 끈다 (구름 · 연기용) */
  buoyancy: number;
};

/** toukoum.fr 가 쓰는 값에 가깝다 — 색은 오래 남고 흐름은 금방 멎는 "물감 번짐" */
export const DEFAULT_FLUID_CONFIG: FluidConfig = {
  simResolution: 128,
  dyeResolution: 1024,
  densityDissipation: 0.5,
  velocityDissipation: 3,
  pressure: 0.1,
  pressureIterations: 20,
  curl: 3,
  splatRadius: 0.2,
  splatForce: 6000,
  shading: true,
  background: { r: 0.016, g: 0.086, b: 0.106 },
  dyeClamp: 1.0,
  buoyancy: 0,
};

type FBO = {
  texture: WebGLTexture;
  fbo: WebGLFramebuffer;
  width: number;
  height: number;
  texelSizeX: number;
  texelSizeY: number;
  attach: (id: number) => number;
};

type DoubleFBO = {
  width: number;
  height: number;
  texelSizeX: number;
  texelSizeY: number;
  read: FBO;
  write: FBO;
  swap: () => void;
};

type TexFormat = { internalFormat: number; format: number };

type Ext = {
  formatRGBA: TexFormat;
  formatRG: TexFormat;
  formatR: TexFormat;
  halfFloatTexType: number;
  supportLinearFiltering: boolean;
};

class Program {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null> = {};

  constructor(
    private gl: WebGLRenderingContext,
    vertex: WebGLShader,
    fragment: WebGLShader,
  ) {
    const program = gl.createProgram();
    if (!program) throw new Error("WebGL program 을 만들 수 없습니다");
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? "link failed");
    }
    this.program = program;
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(program, i);
      if (info) this.uniforms[info.name] = gl.getUniformLocation(program, info.name);
    }
  }

  bind() {
    this.gl.useProgram(this.program);
  }
}

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
  keywords: string[] = [],
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("shader 를 만들 수 없습니다");
  const defines = keywords.map((k) => `#define ${k}\n`).join("");
  gl.shaderSource(shader, defines + source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? "compile failed");
  }
  return shader;
}

/** 브라우저가 WebGL 을 지원하는지만 본다 — 지원하지 않으면 안내 문구를 보여 준다 */
export function supportsWebGL(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export class FluidSim {
  readonly config: FluidConfig;
  private gl: WebGLRenderingContext;
  private ext: Ext;
  private isWebGL2: boolean;

  private copyProgram!: Program;
  private clearProgram!: Program;
  private splatProgram!: Program;
  private advectionProgram!: Program;
  private divergenceProgram!: Program;
  private curlProgram!: Program;
  private vorticityProgram!: Program;
  private buoyancyProgram!: Program;
  private pressureProgram!: Program;
  private gradientProgram!: Program;
  private displayProgram!: Program;

  private dye!: DoubleFBO;
  private velocity!: DoubleFBO;
  private divergence!: FBO;
  private curl!: FBO;
  private pressure!: DoubleFBO;

  private vertexBuffer!: WebGLBuffer;
  private frame = 0;
  private lastTime = 0;
  private disposed = false;

  constructor(
    private canvas: HTMLCanvasElement,
    config: Partial<FluidConfig> = {},
  ) {
    this.config = { ...DEFAULT_FLUID_CONFIG, ...config };

    const params: WebGLContextAttributes = {
      alpha: false,
      depth: false,
      stencil: false,
      antialias: false,
      preserveDrawingBuffer: false,
    };
    let gl = canvas.getContext("webgl2", params) as WebGLRenderingContext | null;
    this.isWebGL2 = !!gl;
    if (!gl) {
      gl =
        (canvas.getContext("webgl", params) as WebGLRenderingContext | null) ??
        (canvas.getContext("experimental-webgl", params) as WebGLRenderingContext | null);
    }
    if (!gl) throw new Error("이 브라우저는 WebGL 을 지원하지 않습니다");
    this.gl = gl;
    this.ext = this.detectExtensions();

    if (!this.ext.supportLinearFiltering) {
      // 선형 필터링이 없으면 염료 해상도를 낮추고 음영을 끈다 — 저사양 기기
      this.config.dyeResolution = Math.min(this.config.dyeResolution, 512);
      this.config.shading = false;
    }

    this.resizeCanvas();
    this.createPrograms();
    this.createGeometry();
    this.initFramebuffers();
  }

  // ───────────────────────────── 초기화

  private detectExtensions(): Ext {
    const gl = this.gl;
    let halfFloatTexType: number;
    let supportLinearFiltering: boolean;

    if (this.isWebGL2) {
      gl.getExtension("EXT_color_buffer_float");
      // WebGL2 에서 16F 텍스처의 선형 필터링은 코어 기능이다
      supportLinearFiltering = true;
      halfFloatTexType = (gl as unknown as WebGL2RenderingContext).HALF_FLOAT;
    } else {
      const halfFloat = gl.getExtension("OES_texture_half_float") as { HALF_FLOAT_OES: number } | null;
      supportLinearFiltering = !!gl.getExtension("OES_texture_half_float_linear");
      halfFloatTexType = halfFloat?.HALF_FLOAT_OES ?? gl.UNSIGNED_BYTE;
    }

    gl.clearColor(0, 0, 0, 1);

    let formatRGBA: TexFormat | null;
    let formatRG: TexFormat | null;
    let formatR: TexFormat | null;

    if (this.isWebGL2) {
      const gl2 = gl as unknown as WebGL2RenderingContext;
      formatRGBA = this.supportedFormat(gl2.RGBA16F, gl.RGBA, halfFloatTexType);
      formatRG = this.supportedFormat(gl2.RG16F, gl2.RG, halfFloatTexType);
      formatR = this.supportedFormat(gl2.R16F, gl2.RED, halfFloatTexType);
    } else {
      formatRGBA = this.supportedFormat(gl.RGBA, gl.RGBA, halfFloatTexType);
      formatRG = formatRGBA;
      formatR = formatRGBA;
    }

    if (!formatRGBA || !formatRG || !formatR) {
      throw new Error("이 기기의 WebGL 은 부동소수 텍스처를 렌더링하지 못합니다");
    }

    return { formatRGBA, formatRG, formatR, halfFloatTexType, supportLinearFiltering };
  }

  private supportedFormat(internalFormat: number, format: number, type: number): TexFormat | null {
    const gl = this.gl;
    if (!this.canRender(internalFormat, format, type)) {
      if (!this.isWebGL2) return null;
      const gl2 = gl as unknown as WebGL2RenderingContext;
      switch (internalFormat) {
        case gl2.R16F:
          return this.supportedFormat(gl2.RG16F, gl2.RG, type);
        case gl2.RG16F:
          return this.supportedFormat(gl2.RGBA16F, gl.RGBA, type);
        default:
          return null;
      }
    }
    return { internalFormat, format };
  }

  private canRender(internalFormat: number, format: number, type: number): boolean {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);

    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(texture);
    return status === gl.FRAMEBUFFER_COMPLETE;
  }

  private createPrograms() {
    const gl = this.gl;
    const vs = compileShader(gl, gl.VERTEX_SHADER, BASE_VERTEX);
    const frag = (src: string, keywords: string[] = []) =>
      new Program(gl, vs, compileShader(gl, gl.FRAGMENT_SHADER, src, keywords));

    this.copyProgram = frag(COPY_FRAG);
    this.clearProgram = frag(CLEAR_FRAG);
    this.splatProgram = frag(SPLAT_FRAG);
    this.advectionProgram = frag(
      ADVECTION_FRAG,
      this.ext.supportLinearFiltering ? [] : ["MANUAL_FILTERING"],
    );
    this.divergenceProgram = frag(DIVERGENCE_FRAG);
    this.curlProgram = frag(CURL_FRAG);
    this.vorticityProgram = frag(VORTICITY_FRAG);
    this.buoyancyProgram = frag(BUOYANCY_FRAG);
    this.pressureProgram = frag(PRESSURE_FRAG);
    this.gradientProgram = frag(GRADIENT_SUBTRACT_FRAG);
    this.displayProgram = frag(DISPLAY_FRAG);
  }

  private createGeometry() {
    const gl = this.gl;
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error("buffer");
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
    const index = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);
    this.vertexBuffer = buffer;
  }

  private createFBO(w: number, h: number, fmt: TexFormat, type: number, filter: number): FBO {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    const texture = gl.createTexture();
    if (!texture) throw new Error("texture");
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internalFormat, w, h, 0, fmt.format, type, null);

    const fbo = gl.createFramebuffer();
    if (!fbo) throw new Error("framebuffer");
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);

    return {
      texture,
      fbo,
      width: w,
      height: h,
      texelSizeX: 1 / w,
      texelSizeY: 1 / h,
      attach: (id: number) => {
        gl.activeTexture(gl.TEXTURE0 + id);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        return id;
      },
    };
  }

  private createDoubleFBO(w: number, h: number, fmt: TexFormat, type: number, filter: number): DoubleFBO {
    let fbo1 = this.createFBO(w, h, fmt, type, filter);
    let fbo2 = this.createFBO(w, h, fmt, type, filter);
    return {
      width: w,
      height: h,
      texelSizeX: fbo1.texelSizeX,
      texelSizeY: fbo1.texelSizeY,
      get read() {
        return fbo1;
      },
      set read(v: FBO) {
        fbo1 = v;
      },
      get write() {
        return fbo2;
      },
      set write(v: FBO) {
        fbo2 = v;
      },
      swap() {
        const t = fbo1;
        fbo1 = fbo2;
        fbo2 = t;
      },
    };
  }

  private resizeFBO(target: FBO, w: number, h: number, fmt: TexFormat, type: number, filter: number): FBO {
    const next = this.createFBO(w, h, fmt, type, filter);
    this.copyProgram.bind();
    this.gl.uniform1i(this.copyProgram.uniforms.uTexture, target.attach(0));
    this.blit(next);
    this.deleteFBO(target);
    return next;
  }

  private resizeDoubleFBO(target: DoubleFBO, w: number, h: number, fmt: TexFormat, type: number, filter: number): DoubleFBO {
    if (target.width === w && target.height === h) return target;
    target.read = this.resizeFBO(target.read, w, h, fmt, type, filter);
    this.deleteFBO(target.write);
    target.write = this.createFBO(w, h, fmt, type, filter);
    target.width = w;
    target.height = h;
    target.texelSizeX = 1 / w;
    target.texelSizeY = 1 / h;
    return target;
  }

  private deleteFBO(f: FBO) {
    this.gl.deleteTexture(f.texture);
    this.gl.deleteFramebuffer(f.fbo);
  }

  private initFramebuffers() {
    const gl = this.gl;
    const sim = this.resolution(this.config.simResolution);
    const dye = this.resolution(this.config.dyeResolution);
    const type = this.ext.halfFloatTexType;
    const { formatRGBA, formatRG, formatR } = this.ext;
    const filtering = this.ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;

    gl.disable(gl.BLEND);

    if (!this.dye) this.dye = this.createDoubleFBO(dye.width, dye.height, formatRGBA, type, filtering);
    else this.dye = this.resizeDoubleFBO(this.dye, dye.width, dye.height, formatRGBA, type, filtering);

    if (!this.velocity) this.velocity = this.createDoubleFBO(sim.width, sim.height, formatRG, type, filtering);
    else this.velocity = this.resizeDoubleFBO(this.velocity, sim.width, sim.height, formatRG, type, filtering);

    if (this.divergence) this.deleteFBO(this.divergence);
    if (this.curl) this.deleteFBO(this.curl);
    if (this.pressure) {
      this.deleteFBO(this.pressure.read);
      this.deleteFBO(this.pressure.write);
    }
    this.divergence = this.createFBO(sim.width, sim.height, formatR, type, gl.NEAREST);
    this.curl = this.createFBO(sim.width, sim.height, formatR, type, gl.NEAREST);
    this.pressure = this.createDoubleFBO(sim.width, sim.height, formatR, type, gl.NEAREST);
  }

  private resolution(res: number) {
    const gl = this.gl;
    let aspect = gl.drawingBufferWidth / gl.drawingBufferHeight;
    if (aspect < 1) aspect = 1 / aspect;
    const min = Math.round(res);
    const max = Math.round(res * aspect);
    return gl.drawingBufferWidth > gl.drawingBufferHeight
      ? { width: max, height: min }
      : { width: min, height: max };
  }

  /** 캔버스 픽셀 크기를 CSS 크기 × 배율에 맞춘다. 바뀌었으면 true */
  private resizeCanvas(): boolean {
    // 유체는 해상도를 조금 낮춰도 티가 안 난다 — 배율 상한 2 로 고사양 폰의 발열을 줄인다
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * ratio));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      return true;
    }
    return false;
  }

  private blit(target: FBO | null) {
    const gl = this.gl;
    if (target) {
      gl.viewport(0, 0, target.width, target.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    } else {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  }

  // ───────────────────────────── 공개 API

  /** 렌더 루프 시작. 이미 돌고 있으면 무시 */
  start() {
    if (this.frame || this.disposed) return;
    this.lastTime = performance.now();
    const loop = () => {
      if (this.disposed) return;
      this.update();
      this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
  }

  stop() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  dispose() {
    this.stop();
    this.disposed = true;
    const gl = this.gl;
    const lose = gl.getExtension("WEBGL_lose_context");
    lose?.loseContext();
  }

  /** 설정 일부를 바꾼다(색·감쇠 등). 해상도는 바꾸지 않는다 */
  setConfig(patch: Partial<FluidConfig>) {
    Object.assign(this.config, patch);
  }

  /**
   * 한 점에 색과 힘을 떨어뜨린다.
   *   x, y   0~1 텍스처 좌표 (y 는 아래가 0)
   *   dx, dy 흐름에 더할 속도
   */
  splat(x: number, y: number, dx: number, dy: number, color: RGB, radiusScale = 1) {
    const gl = this.gl;
    const aspect = this.canvas.width / this.canvas.height;
    let radius = (this.config.splatRadius / 100) * radiusScale;
    if (aspect > 1) radius *= aspect;

    this.splatProgram.bind();
    gl.uniform1i(this.splatProgram.uniforms.uTarget, this.velocity.read.attach(0));
    gl.uniform1f(this.splatProgram.uniforms.aspectRatio, aspect);
    gl.uniform2f(this.splatProgram.uniforms.point, x, y);
    gl.uniform3f(this.splatProgram.uniforms.color, dx, dy, 0);
    gl.uniform1f(this.splatProgram.uniforms.radius, radius);
    gl.uniform1f(this.splatProgram.uniforms.uClamp, 0); // 속도는 자르지 않는다
    this.blit(this.velocity.write);
    this.velocity.swap();

    gl.uniform1i(this.splatProgram.uniforms.uTarget, this.dye.read.attach(0));
    gl.uniform3f(this.splatProgram.uniforms.color, color.r, color.g, color.b);
    // 염료는 색상을 지키며 최대 밝기에서 멈춘다 — 고른 색이 흰색으로 타지 않게
    gl.uniform1f(this.splatProgram.uniforms.uClamp, this.config.dyeClamp);
    this.blit(this.dye.write);
    this.dye.swap();
  }

  /** 화면 좌표(CSS px) 이동을 splat 으로 바꾼다. 포인터 입력용 */
  splatPointer(px: number, py: number, deltaX: number, deltaY: number, color: RGB) {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    const aspect = w / h;
    let dx = deltaX / w;
    let dy = -deltaY / h;
    if (aspect < 1) dx *= aspect;
    else dy /= aspect;
    this.splat(px / w, 1 - py / h, dx * this.config.splatForce, dy * this.config.splatForce, color);
  }

  /** 염료를 모두 지운다 */
  clearDye() {
    const gl = this.gl;
    this.clearProgram.bind();
    gl.uniform1i(this.clearProgram.uniforms.uTexture, this.dye.read.attach(0));
    gl.uniform1f(this.clearProgram.uniforms.value, 0);
    this.blit(this.dye.write);
    this.dye.swap();
  }

  // ───────────────────────────── 프레임

  private update() {
    const now = performance.now();
    let dt = (now - this.lastTime) / 1000;
    // 탭이 잠들었다가 돌아오면 dt 가 커져 흐름이 터진다 — 한 프레임 상한
    dt = Math.min(dt, 0.016666);
    this.lastTime = now;

    if (this.resizeCanvas()) this.initFramebuffers();
    this.step(dt);
    this.render();
  }

  private step(dt: number) {
    const gl = this.gl;
    const { velocity, dye, curl, divergence, pressure } = this;
    gl.disable(gl.BLEND);

    this.curlProgram.bind();
    gl.uniform2f(this.curlProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(this.curlProgram.uniforms.uVelocity, velocity.read.attach(0));
    this.blit(curl);

    this.vorticityProgram.bind();
    gl.uniform2f(this.vorticityProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(this.vorticityProgram.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(this.vorticityProgram.uniforms.uCurl, curl.attach(1));
    gl.uniform1f(this.vorticityProgram.uniforms.curl, this.config.curl);
    gl.uniform1f(this.vorticityProgram.uniforms.dt, dt);
    this.blit(velocity.write);
    velocity.swap();

    if (this.config.buoyancy > 0) {
      this.buoyancyProgram.bind();
      gl.uniform1i(this.buoyancyProgram.uniforms.uVelocity, velocity.read.attach(0));
      gl.uniform1i(this.buoyancyProgram.uniforms.uDye, dye.read.attach(1));
      gl.uniform1f(this.buoyancyProgram.uniforms.buoyancy, this.config.buoyancy);
      gl.uniform1f(this.buoyancyProgram.uniforms.dt, dt);
      this.blit(velocity.write);
      velocity.swap();
    }

    this.divergenceProgram.bind();
    gl.uniform2f(this.divergenceProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(this.divergenceProgram.uniforms.uVelocity, velocity.read.attach(0));
    this.blit(divergence);

    this.clearProgram.bind();
    gl.uniform1i(this.clearProgram.uniforms.uTexture, pressure.read.attach(0));
    gl.uniform1f(this.clearProgram.uniforms.value, this.config.pressure);
    this.blit(pressure.write);
    pressure.swap();

    this.pressureProgram.bind();
    gl.uniform2f(this.pressureProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(this.pressureProgram.uniforms.uDivergence, divergence.attach(0));
    for (let i = 0; i < this.config.pressureIterations; i++) {
      gl.uniform1i(this.pressureProgram.uniforms.uPressure, pressure.read.attach(1));
      this.blit(pressure.write);
      pressure.swap();
    }

    this.gradientProgram.bind();
    gl.uniform2f(this.gradientProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(this.gradientProgram.uniforms.uPressure, pressure.read.attach(0));
    gl.uniform1i(this.gradientProgram.uniforms.uVelocity, velocity.read.attach(1));
    this.blit(velocity.write);
    velocity.swap();

    this.advectionProgram.bind();
    gl.uniform2f(this.advectionProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    if (!this.ext.supportLinearFiltering) {
      gl.uniform2f(this.advectionProgram.uniforms.dyeTexelSize, velocity.texelSizeX, velocity.texelSizeY);
    }
    const velocityId = velocity.read.attach(0);
    gl.uniform1i(this.advectionProgram.uniforms.uVelocity, velocityId);
    gl.uniform1i(this.advectionProgram.uniforms.uSource, velocityId);
    gl.uniform1f(this.advectionProgram.uniforms.dt, dt);
    gl.uniform1f(this.advectionProgram.uniforms.dissipation, this.config.velocityDissipation);
    this.blit(velocity.write);
    velocity.swap();

    if (!this.ext.supportLinearFiltering) {
      gl.uniform2f(this.advectionProgram.uniforms.dyeTexelSize, dye.texelSizeX, dye.texelSizeY);
    }
    gl.uniform1i(this.advectionProgram.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(this.advectionProgram.uniforms.uSource, dye.read.attach(1));
    gl.uniform1f(this.advectionProgram.uniforms.dissipation, this.config.densityDissipation);
    this.blit(dye.write);
    dye.swap();
  }

  private render() {
    const gl = this.gl;
    const bg = this.config.background;
    this.displayProgram.bind();
    gl.uniform2f(
      this.displayProgram.uniforms.texelSize,
      1 / gl.drawingBufferWidth,
      1 / gl.drawingBufferHeight,
    );
    gl.uniform1i(this.displayProgram.uniforms.uTexture, this.dye.read.attach(0));
    gl.uniform3f(this.displayProgram.uniforms.uBackground, bg.r, bg.g, bg.b);
    gl.uniform1f(this.displayProgram.uniforms.uShading, this.config.shading ? 1 : 0);
    this.blit(null);
  }
}
