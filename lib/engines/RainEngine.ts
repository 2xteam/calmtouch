import { createCanvas2D, createLoop, glowSprite } from "@/lib/canvas/tools";
import { clamp, rand } from "@/lib/util/math";
import type { EngineFactory } from "./types";

/**
 * 비 오는 창 — 유리 안쪽에서 본 밤. 빗방울이 맺혀 무거워지면 흘러내리며 자국을 남기고,
 * 작은 방울들을 삼킨다. 손가락으로 닦으면 그 자리가 잠깐 맑아진다(뒤 불빛이 선명해진다).
 *
 * 렌더 층 셋 — ① 흐린 배경(보케) ② 닦인 자리 마스크(선명한 배경이 보인다) ③ 방울.
 * 방울은 배경을 뒤집어 축소해 담은 것처럼 보이게 하이라이트 + 어두운 아랫가장자리로 그린다.
 */
type Drop = { x: number; y: number; r: number; vy: number; wob: number; seed: number; trail: number };

export const createRainEngine: EngineFactory = (canvas) => {
  const c = createCanvas2D(canvas);
  const { ctx } = c;

  let blurred = document.createElement("canvas");
  let sharp = document.createElement("canvas");
  let mask = document.createElement("canvas");
  let maskCtx!: CanvasRenderingContext2D;
  let cut = document.createElement("canvas");
  let cutCtx!: CanvasRenderingContext2D;
  const PALETTE: [number, number, number][] = [
    [232, 209, 138], [95, 184, 201], [255, 155, 122], [238, 247, 248], [185, 166, 240], [255, 209, 102],
  ];
  const drops: Drop[] = [];
  let intensity = 1;

  const paintBackdrop = (target: HTMLCanvasElement, blur: number) => {
    target.width = Math.floor(c.w * c.dpr);
    target.height = Math.floor(c.h * c.dpr);
    const b = target.getContext("2d")!;
    b.scale(c.dpr, c.dpr);
    const g = b.createLinearGradient(0, 0, 0, c.h);
    g.addColorStop(0, "#050d14");
    g.addColorStop(0.55, "#0a1b22");
    g.addColorStop(1, "#142f38");
    b.fillStyle = g;
    b.fillRect(0, 0, c.w, c.h);
    b.globalCompositeOperation = "lighter";
    const seedRand = mulberry(42);
    const n = Math.round((c.w * c.h) / 22000) + 14;
    for (let i = 0; i < n; i++) {
      const col = PALETTE[Math.floor(seedRand() * PALETTE.length)];
      const far = seedRand() < 0.6;
      const r = (far ? 4 + seedRand() * 8 : 12 + seedRand() * 26) * (blur > 0 ? 1.7 : 1.1);
      const x = seedRand() * c.w;
      const y = far ? c.h * (0.25 + seedRand() * 0.55) : c.h * (0.4 + seedRand() * 0.55);
      const s = glowSprite(128, col[0], col[1], col[2], blur > 0 ? 0.42 : 1);
      b.globalAlpha = blur > 0 ? (far ? 0.5 : 0.75) : (far ? 0.7 : 1);
      b.drawImage(s, x - r * 2, y - r * 2, r * 4, r * 4);
    }
    // 창틀 아래쪽 반사광
    b.globalCompositeOperation = "source-over";
  };

  const layout = () => {
    blurred = document.createElement("canvas");
    sharp = document.createElement("canvas");
    paintBackdrop(blurred, 1);
    paintBackdrop(sharp, 0);
    mask = document.createElement("canvas");
    mask.width = blurred.width; mask.height = blurred.height;
    maskCtx = mask.getContext("2d")!;
    maskCtx.scale(c.dpr, c.dpr);
    cut = document.createElement("canvas");
    cut.width = mask.width; cut.height = mask.height;
    cutCtx = cut.getContext("2d")!;
    drops.length = 0;
    for (let i = 0; i < 90; i++) drops.push(newDrop(rand(0, c.h)));
  };
  const newDrop = (y = -10): Drop => ({ x: rand(0, c.w), y, r: rand(1.2, 3.2), vy: 0, wob: rand(0, 6), seed: rand(0, 1), trail: 0 });
  layout();

  const wipe = (x0: number, y0: number, x1: number, y1: number) => {
    maskCtx.save();
    maskCtx.globalCompositeOperation = "source-over";
    maskCtx.strokeStyle = "rgba(255,255,255,1)";
    maskCtx.lineCap = "round";
    maskCtx.lineWidth = 46;
    maskCtx.beginPath(); maskCtx.moveTo(x0, y0); maskCtx.lineTo(x1, y1); maskCtx.stroke();
    maskCtx.restore();
    // 닦인 자리의 방울은 밀려난다
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      if (Math.hypot(d.x - x1, d.y - y1) < 26) drops.splice(i, 1);
    }
  };
  const pointers = new Map<number, { x: number; y: number }>();

  const loop = createLoop((dt, t) => {
    if (c.resize()) layout();

    // 마스크는 천천히 다시 흐려진다
    maskCtx.save();
    maskCtx.globalCompositeOperation = "destination-out";
    maskCtx.fillStyle = `rgba(0,0,0,${clamp(dt * 0.12, 0, 1)})`;
    maskCtx.fillRect(0, 0, c.w, c.h);
    maskCtx.restore();

    // 방울 생성 · 이동
    if (Math.random() < dt * 18 * intensity && drops.length < 260) drops.push(newDrop());
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      // 커질수록 무거워져 흐른다. 작은 방울은 매달려 있다
      const g = Math.max(0, d.r - 2.4) * 40;
      d.vy += g * dt;
      d.vy *= 0.985;
      if (d.vy > 0.5) {
        d.y += d.vy * dt;
        d.x += Math.sin(t * 3 + d.wob) * 0.25 * (d.vy / 40);
        d.trail = Math.min(1, d.trail + dt * 2);
        // 자국 — 마스크에 얇은 선(맑아진 흔적)
        maskCtx.save();
        maskCtx.globalCompositeOperation = "source-over";
        maskCtx.strokeStyle = "rgba(255,255,255,0.35)";
        maskCtx.lineWidth = d.r * 0.9;
        maskCtx.beginPath(); maskCtx.moveTo(d.x, d.y - d.vy * dt); maskCtx.lineTo(d.x, d.y); maskCtx.stroke();
        maskCtx.restore();
        d.r = Math.max(1.5, d.r - dt * 0.6);
        // 작은 방울을 삼킨다
        for (let j = drops.length - 1; j >= 0; j--) {
          const o = drops[j];
          if (o === d || o.vy > 0.5) continue;
          if (Math.abs(o.x - d.x) < d.r + o.r && o.y > d.y - d.r && o.y < d.y + d.r * 2) {
            d.r = Math.min(7, Math.sqrt(d.r * d.r + o.r * o.r));
            drops.splice(j, 1);
            if (j < i) i--;
          }
        }
      } else {
        // 매달린 방울은 조금씩 자란다(다른 물이 흘러든다)
        d.r += dt * 0.12 * d.seed;
      }
      if (d.y > c.h + 10) drops.splice(i, 1);
    }

    // ① 흐린 배경
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(blurred, 0, 0);
    // ② 닦인 자리에 선명한 배경
    ctx.globalCompositeOperation = "source-over";
    const tmp = ctx.globalAlpha;
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    // mask 를 알파로 쓰기: sharp 를 mask 로 잘라 그린다 (cut 캔버스는 layout 때 한 번 만든다)
    cutCtx.globalCompositeOperation = "source-over";
    cutCtx.clearRect(0, 0, cut.width, cut.height);
    cutCtx.drawImage(sharp, 0, 0);
    cutCtx.globalCompositeOperation = "destination-in";
    cutCtx.drawImage(mask, 0, 0);
    ctx.drawImage(cut, 0, 0);
    ctx.restore();
    ctx.globalAlpha = tmp;
    ctx.setTransform(c.dpr, 0, 0, c.dpr, 0, 0);

    // ③ 방울
    for (const d of drops) {
      const r = d.r;
      // 몸통 — 위는 어둡고 아래가 밝다(굴절로 뒤집힌 불빛), 가장자리는 진하다
      const g = ctx.createRadialGradient(d.x - r * 0.3, d.y - r * 0.35, r * 0.1, d.x, d.y, r);
      g.addColorStop(0, "rgba(210, 232, 238, 0.55)");
      g.addColorStop(0.6, "rgba(120, 160, 175, 0.25)");
      g.addColorStop(1, "rgba(20, 45, 55, 0.55)");
      ctx.beginPath();
      ctx.ellipse(d.x, d.y, r, r * (1 + Math.min(d.vy, 60) * 0.006), 0, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
      // 하이라이트
      ctx.beginPath();
      ctx.arc(d.x - r * 0.35, d.y - r * 0.4, r * 0.25, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(238, 247, 248, 0.75)";
      ctx.fill();
    }
  });

  return {
    start: () => loop.start(),
    stop: () => loop.stop(),
    dispose: () => loop.stop(),
    pointerDown(x, y, id) {
      pointers.set(id, { x, y });
      wipe(x, y, x, y);
    },
    pointerMove(x, y, dx, dy, id, pressed) {
      const p = pointers.get(id) ?? { x: x - dx, y: y - dy };
      if (pressed) wipe(p.x, p.y, x, y);
      pointers.set(id, { x, y });
    },
    pointerUp(id) {
      pointers.delete(id);
    },
    wheel(_x, _y, delta) {
      intensity = clamp(intensity - delta * 0.01, 0.2, 3);
    },
    tilt() {},
    idle() {
      // 굵은 방울 하나가 흘러내린다
      const d = newDrop(rand(0, c.h * 0.3));
      d.r = 5.5;
      drops.push(d);
    },
    clear() {
      layout();
    },
  };
};

/** 배경 보케 자리가 리사이즈마다 튀지 않게 고정 시드 난수 */
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
