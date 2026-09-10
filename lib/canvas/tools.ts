/**
 * Canvas 2D 장면들이 같이 쓰는 도구 — 크기 맞추기 · 글로우 스프라이트 · 루프.
 */

export type Canvas2D = {
  ctx: CanvasRenderingContext2D;
  /** CSS 픽셀 폭·높이. ctx 는 이미 dpr 만큼 scale 되어 있어 CSS 좌표로 그리면 된다 */
  w: number;
  h: number;
  dpr: number;
  /** 크기가 바뀌었으면 true */
  resize(): boolean;
};

export function createCanvas2D(canvas: HTMLCanvasElement, maxDpr = 2): Canvas2D {
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas 2D 를 만들 수 없어요");
  const c: Canvas2D = {
    ctx,
    w: 1,
    h: 1,
    dpr: 1,
    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
      const w = Math.max(1, canvas.clientWidth);
      const h = Math.max(1, canvas.clientHeight);
      const pw = Math.floor(w * dpr);
      const ph = Math.floor(h * dpr);
      if (canvas.width !== pw || canvas.height !== ph || c.dpr !== dpr) {
        canvas.width = pw;
        canvas.height = ph;
        c.w = w;
        c.h = h;
        c.dpr = dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        return true;
      }
      c.w = w;
      c.h = h;
      return false;
    },
  };
  c.resize();
  return c;
}

/**
 * 부드러운 빛 점 스프라이트. `shadowBlur` 대신 이걸 `lighter` 로 찍는다 — 폰에서 열 배 빠르다.
 * 반환 캔버스는 size×size, 가운데가 가장 밝고 가장자리는 0 이다.
 */
export function glowSprite(size: number, r: number, g: number, b: number, inner = 1): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const x = c.getContext("2d")!;
  const grad = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${inner})`);
  grad.addColorStop(0.25, `rgba(${r}, ${g}, ${b}, ${inner * 0.55})`);
  grad.addColorStop(0.6, `rgba(${r}, ${g}, ${b}, ${inner * 0.12})`);
  grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
  x.fillStyle = grad;
  x.fillRect(0, 0, size, size);
  return c;
}

/** requestAnimationFrame 루프. dt 는 초 단위, 0.05 로 상한(탭 복귀 때 튀지 않게) */
export function createLoop(tick: (dt: number, t: number) => void) {
  let frame = 0;
  let last = 0;
  let elapsed = 0;
  const step = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    elapsed += dt;
    tick(dt, elapsed);
    frame = requestAnimationFrame(step);
  };
  return {
    start() {
      if (frame) return;
      last = performance.now();
      frame = requestAnimationFrame(step);
    },
    stop() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}

/** 짙은 먹청 바탕 — 이 앱의 모든 장면이 같은 계열의 바닥을 쓴다 */
export const DEEP_BG = "#04161b";
export const DEEP_BG_2 = "#0b262e";
