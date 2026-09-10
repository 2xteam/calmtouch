import { createCanvas2D, createLoop, glowSprite } from "@/lib/canvas/tools";
import { clamp, noise2, rand } from "@/lib/util/math";
import type { EngineFactory } from "./types";

/**
 * 김 서린 유리 — 뒤에는 흐릿한 밤 불빛(보케), 앞에는 김 한 겹.
 * 손가락이 지나간 자리는 닦여서 뒤가 보이고, 시간이 지나면 다시 서린다.
 *
 * 구현: 김은 별도 오프스크린 캔버스다. 닦기는 destination-out 으로 지우고,
 * 매 프레임 아주 낮은 알파의 흰색을 덧칠해 천천히 되돌린다. 닦인 가장자리에
 * 물방울이 생겨 아래로 흘러내린다 — 진짜 유리에서 손가락 자국이 그렇다.
 */
export const createFogEngine: EngineFactory = (canvas) => {
  const c = createCanvas2D(canvas);
  const { ctx } = c;

  // 뒤 풍경 — 미리 한 번 그린다
  let backdrop = document.createElement("canvas");
  let fog = document.createElement("canvas");
  let fogCtx!: CanvasRenderingContext2D;
  const lights: { x: number; y: number; r: number; color: [number, number, number]; a: number; tw: number }[] = [];
  const drops: { x: number; y: number; r: number; vy: number; life: number }[] = [];
  const sprites = new Map<string, HTMLCanvasElement>();
  const spriteFor = (rgb: [number, number, number]) => {
    const k = rgb.join(",");
    let s = sprites.get(k);
    if (!s) {
      s = glowSprite(256, rgb[0], rgb[1], rgb[2], 1);
      sprites.set(k, s);
    }
    return s;
  };

  const PALETTE: [number, number, number][] = [
    [232, 209, 138], // 금
    [95, 184, 201], // 먹청 밝은
    [255, 155, 122], // 코랄
    [238, 247, 248], // 청백
    [185, 166, 240], // 라일락
  ];

  const layout = () => {
    backdrop = document.createElement("canvas");
    backdrop.width = Math.floor(c.w * c.dpr);
    backdrop.height = Math.floor(c.h * c.dpr);
    const b = backdrop.getContext("2d")!;
    b.scale(c.dpr, c.dpr);
    const g = b.createLinearGradient(0, 0, 0, c.h);
    g.addColorStop(0, "#050f16");
    g.addColorStop(0.6, "#0a1d26");
    g.addColorStop(1, "#122f3a");
    b.fillStyle = g;
    b.fillRect(0, 0, c.w, c.h);

    lights.length = 0;
    const n = Math.round((c.w * c.h) / 26000) + 12;
    for (let i = 0; i < n; i++) {
      const far = Math.random() < 0.6;
      lights.push({
        x: rand(0, c.w),
        y: far ? rand(c.h * 0.2, c.h * 0.85) : rand(c.h * 0.35, c.h * 0.95),
        r: far ? rand(6, 14) : rand(16, 42),
        color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
        a: far ? rand(0.35, 0.7) : rand(0.5, 0.9),
        tw: rand(0, 100),
      });
    }

    fog = document.createElement("canvas");
    fog.width = backdrop.width;
    fog.height = backdrop.height;
    fogCtx = fog.getContext("2d")!;
    fogCtx.scale(c.dpr, c.dpr);
    fogCtx.fillStyle = "rgba(214, 226, 230, 0.86)";
    fogCtx.fillRect(0, 0, c.w, c.h);
  };
  layout();

  const wipe = (x: number, y: number, px: number, py: number, radius: number) => {
    fogCtx.save();
    fogCtx.globalCompositeOperation = "destination-out";
    fogCtx.lineCap = "round";
    fogCtx.lineJoin = "round";
    // 중심은 깨끗하게, 가장자리는 조금 남게 — 두 번 그린다
    fogCtx.strokeStyle = "rgba(0,0,0,0.55)";
    fogCtx.lineWidth = radius * 2.2;
    fogCtx.beginPath(); fogCtx.moveTo(px, py); fogCtx.lineTo(x, y); fogCtx.stroke();
    fogCtx.strokeStyle = "rgba(0,0,0,1)";
    fogCtx.lineWidth = radius * 1.5;
    fogCtx.beginPath(); fogCtx.moveTo(px, py); fogCtx.lineTo(x, y); fogCtx.stroke();
    fogCtx.restore();
    if (Math.random() < 0.25 && drops.length < 80) {
      drops.push({ x: x + rand(-radius, radius), y: y + radius * 0.6, r: rand(1.5, 3.5), vy: rand(20, 60), life: rand(2, 5) });
    }
  };

  const pointers = new Map<number, { x: number; y: number }>();
  let time = 0;

  const loop = createLoop((dt, t) => {
    time = t;
    if (c.resize()) layout();

    // 김이 다시 서린다 — 아주 천천히
    fogCtx.save();
    fogCtx.globalCompositeOperation = "source-over";
    fogCtx.fillStyle = `rgba(214, 226, 230, ${0.86 * dt * 0.06})`;
    fogCtx.fillRect(0, 0, c.w, c.h);
    fogCtx.restore();

    // 물방울 — 닦인 자국 아래로 흘러 자국을 남긴다
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.life -= dt;
      const ny = d.y + d.vy * dt;
      wipe(d.x + noise2(d.y * 0.02, t) * 0.6, ny, d.x, d.y, d.r);
      d.y = ny;
      d.vy += 30 * dt;
      if (d.life <= 0 || d.y > c.h + 10) drops.splice(i, 1);
    }

    // 뒤 풍경: 그라디언트 + 깜빡이는 보케
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(backdrop, 0, 0);
    ctx.setTransform(c.dpr, 0, 0, c.dpr, 0, 0);
    ctx.globalCompositeOperation = "lighter";
    for (const l of lights) {
      const a = l.a * (0.75 + 0.25 * Math.sin(t * 0.7 + l.tw));
      ctx.globalAlpha = a;
      const s = spriteFor(l.color);
      const r = l.r * 3.2;
      ctx.drawImage(s, l.x - r, l.y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    // 김: 뒤를 흐리게 보이게 하는 층. 색 있는 흰색을 그대로 덮는다
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(fog, 0, 0);
    ctx.setTransform(c.dpr, 0, 0, c.dpr, 0, 0);
  });

  return {
    start: () => loop.start(),
    stop: () => loop.stop(),
    dispose: () => loop.stop(),
    pointerDown(x, y, id) {
      pointers.set(id, { x, y });
      wipe(x, y, x, y, 22);
    },
    pointerMove(x, y, dx, dy, id, pressed) {
      const p = pointers.get(id) ?? { x: x - dx, y: y - dy };
      if (pressed) wipe(x, y, p.x, p.y, 22);
      pointers.set(id, { x, y });
    },
    pointerUp(id) {
      pointers.delete(id);
    },
    wheel(x, y, delta) {
      wipe(x, y + delta, x, y, 16);
    },
    tilt() {
      /* 유리는 기울여도 그대로다 */
    },
    idle() {
      // 손대지 않으면 물방울 하나가 스스로 흘러내린다
      if (drops.length < 40) drops.push({ x: rand(20, c.w - 20), y: rand(0, c.h * 0.3), r: rand(2, 4), vy: rand(15, 40), life: rand(3, 6) });
    },
    clear() {
      fogCtx.save();
      fogCtx.globalCompositeOperation = "source-over";
      fogCtx.fillStyle = "rgba(214, 226, 230, 0.86)";
      fogCtx.fillRect(0, 0, c.w, c.h);
      fogCtx.restore();
      drops.length = 0;
      void time;
      void clamp;
    },
  };
};
