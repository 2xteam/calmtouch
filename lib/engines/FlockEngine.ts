import { createCanvas2D, createLoop } from "@/lib/canvas/tools";
import { clamp, damp, noise3, rand, TAU } from "@/lib/util/math";
import type { EngineFactory } from "./types";

/**
 * 물고기떼 — 보이드(Reynolds) 세 규칙 + 손끝을 피하는 힘.
 * 무리는 손을 피하면서도 흩어지지 않고, 손이 멀어지면 다시 모인다.
 *
 * 근처 탐색은 격자로 한다(200마리 × 200마리 를 매 프레임 다 보면 느리다).
 * 물고기는 몸통 하나 + 꼬리 하나의 두 조각 삼각형, 헤엄 위상으로 꼬리를 흔든다.
 */
type Fish = { x: number; y: number; vx: number; vy: number; phase: number; size: number; tint: number };

export const createFlockEngine: EngineFactory = (canvas) => {
  const c = createCanvas2D(canvas);
  const { ctx } = c;

  const fish: Fish[] = [];
  const spawn = () => {
    fish.length = 0;
    const n = clamp(Math.round((c.w * c.h) / 5200), 90, 260);
    const cx = c.w / 2, cy = c.h / 2;
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      fish.push({ x: cx + Math.cos(a) * rand(0, 120), y: cy + Math.sin(a) * rand(0, 120), vx: rand(-30, 30), vy: rand(-30, 30), phase: rand(0, TAU), size: rand(0.8, 1.3), tint: Math.random() });
    }
  };
  spawn();

  const pointers = new Map<number, { x: number; y: number; at: number }>();
  let current = { x: 0, y: 0 };
  let food: { x: number; y: number; life: number } | null = null;

  const CELL = 60;
  const grid = new Map<number, Fish[]>();
  const key = (x: number, y: number) => Math.floor(x / CELL) * 73856 + Math.floor(y / CELL);

  const loop = createLoop((dt, t) => {
    if (c.resize()) spawn();
    const now = performance.now();
    current.x *= damp(1.2, dt);
    current.y *= damp(1.2, dt);
    for (const [id, p] of pointers) if (id === 0 && now - p.at > 1500) pointers.delete(id);
    if (food) { food.life -= dt; if (food.life <= 0) food = null; }

    grid.clear();
    for (const f of fish) {
      const k = key(f.x, f.y);
      const cell = grid.get(k);
      if (cell) cell.push(f); else grid.set(k, [f]);
    }

    const R = 55, SEP = 22;
    for (const f of fish) {
      let cnt = 0, ax = 0, ay = 0, cxs = 0, cys = 0, sx = 0, sy = 0;
      const gx = Math.floor(f.x / CELL), gy = Math.floor(f.y / CELL);
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        const cell = grid.get((gx + ox) * 73856 + (gy + oy));
        if (!cell) continue;
        for (const o of cell) {
          if (o === f) continue;
          const dx = o.x - f.x, dy = o.y - f.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > R * R) continue;
          cnt++;
          ax += o.vx; ay += o.vy;
          cxs += o.x; cys += o.y;
          if (d2 < SEP * SEP) { const d = Math.sqrt(d2) + 0.01; sx -= dx / d * (SEP - d); sy -= dy / d * (SEP - d); }
        }
      }
      let fx = 0, fy = 0;
      if (cnt > 0) {
        fx += (ax / cnt - f.vx) * 1.6 + (cxs / cnt - f.x) * 0.9 + sx * 9;
        fy += (ay / cnt - f.vy) * 1.6 + (cys / cnt - f.y) * 0.9 + sy * 9;
      }
      // 손끝 피하기
      for (const p of pointers.values()) {
        const dx = f.x - p.x, dy = f.y - p.y;
        const d = Math.hypot(dx, dy) + 0.01;
        if (d < 170) { const k = (1 - d / 170); fx += dx / d * k * k * 2600; fy += dy / d * k * k * 2600; }
      }
      // 먹이(탭) 로 모인다
      if (food) {
        const dx = food.x - f.x, dy = food.y - f.y;
        const d = Math.hypot(dx, dy) + 0.01;
        if (d > 30) { fx += dx / d * 140; fy += dy / d * 140; }
      }
      // 물살(휠·기울기) 과 아주 느린 배회
      fx += current.x + noise3(f.x * 0.003, f.y * 0.003, t * 0.2) * 40;
      fy += current.y + noise3(f.x * 0.003 + 50, f.y * 0.003, t * 0.2) * 40;
      // 가운데로 아주 약하게 — 화면 밖으로 다 나가지 않게
      fx += (c.w / 2 - f.x) * 0.08;
      fy += (c.h / 2 - f.y) * 0.08;

      f.vx = (f.vx + fx * dt) * damp(0.6, dt);
      f.vy = (f.vy + fy * dt) * damp(0.6, dt);
      const sp = Math.hypot(f.vx, f.vy);
      const min = 28, max = 150;
      if (sp > max) { f.vx *= max / sp; f.vy *= max / sp; }
      else if (sp < min && sp > 0.01) { f.vx *= min / sp; f.vy *= min / sp; }
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.phase += dt * (6 + sp * 0.05);
    }

    // 그리기
    const g = ctx.createLinearGradient(0, 0, 0, c.h);
    g.addColorStop(0, "#03141c");
    g.addColorStop(1, "#0a3040");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.w, c.h);
    // 수면의 빛
    const lg = ctx.createRadialGradient(c.w * 0.3, -c.h * 0.2, 0, c.w * 0.3, -c.h * 0.2, c.h * 1.1);
    lg.addColorStop(0, "rgba(95,184,201,0.22)");
    lg.addColorStop(1, "rgba(95,184,201,0)");
    ctx.fillStyle = lg;
    ctx.fillRect(0, 0, c.w, c.h);

    if (food) {
      ctx.beginPath(); ctx.arc(food.x, food.y, 3 + Math.sin(t * 6) * 1, 0, TAU);
      ctx.fillStyle = `rgba(232,209,138,${clamp(food.life / 2, 0, 1)})`; ctx.fill();
    }

    for (const f of fish) {
      const ang = Math.atan2(f.vy, f.vx);
      const s = 7 * f.size;
      const wag = Math.sin(f.phase) * 0.45;
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(ang);
      // 몸통
      const body = f.tint < 0.75 ? "rgba(95,184,201,0.9)" : "rgba(238,247,248,0.9)";
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.moveTo(s * 1.3, 0);
      ctx.quadraticCurveTo(s * 0.2, -s * 0.7, -s * 0.7, -s * 0.15);
      ctx.lineTo(-s * 0.7, s * 0.15);
      ctx.quadraticCurveTo(s * 0.2, s * 0.7, s * 1.3, 0);
      ctx.fill();
      // 꼬리
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.moveTo(-s * 0.6, 0);
      ctx.lineTo(-s * 1.5, -s * 0.55 + wag * s);
      ctx.lineTo(-s * 1.5, s * 0.55 + wag * s);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  });

  return {
    start: () => loop.start(),
    stop: () => loop.stop(),
    dispose: () => loop.stop(),
    pointerDown(x, y, id) {
      pointers.set(id, { x, y, at: performance.now() });
    },
    pointerMove(x, y, _dx, _dy, id) {
      pointers.set(id, { x, y, at: performance.now() });
    },
    pointerUp(id) {
      const p = pointers.get(id);
      // 짧게 탭하고 떼면 먹이 — 무리가 모인다
      if (p && performance.now() - p.at < 250 && id !== 0) food = { x: p.x, y: p.y, life: 6 };
      if (id !== 0) pointers.delete(id);
    },
    wheel(_x, _y, delta) {
      current.y -= delta * 4;
    },
    tilt(fx, fy) {
      current.x = fx * 220;
      current.y = fy * 220;
    },
    idle() {
      if (!food) food = { x: rand(c.w * 0.2, c.w * 0.8), y: rand(c.h * 0.2, c.h * 0.8), life: 5 };
    },
    clear() {
      spawn();
      food = null;
    },
  };
};
