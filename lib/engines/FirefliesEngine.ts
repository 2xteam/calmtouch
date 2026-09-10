import { createCanvas2D, createLoop, glowSprite, DEEP_BG } from "@/lib/canvas/tools";
import { clamp, damp, hexToRgb255, noise3, rand, TAU } from "@/lib/util/math";
import type { EngineFactory } from "./types";

/**
 * 반짝이 — 손끝을 피해 도망 다니는 작은 빛. 몇 마리는 겁이 없어서 손끝에 앉는다.
 *
 * 배회는 curl 노이즈(2D 노이즈의 회전 기울기)라 서로 부딧히지 않고 흐른다.
 * 도망칠 때 방향이 아니라 **속도만** 바뀌게 한다 — 허둥대면 보는 사람이 불안하다.
 * 글로우는 `shadowBlur` 대신 미리 그린 스프라이트를 `lighter` 로 찍는다.
 */
type Fly = {
  x: number; y: number; vx: number; vy: number;
  size: number; phase: number; blink: number; brave: boolean; seed: number;
};

export const createFirefliesEngine: EngineFactory = (canvas, ctx0) => {
  const c = createCanvas2D(canvas);
  const { ctx } = c;
  let hex = ctx0.color;
  let sprite = makeSprite(hex);
  let core = glowSprite(32, 255, 255, 240, 1);

  function makeSprite(h: string) {
    const [r, g, b] = hexToRgb255(h);
    return glowSprite(128, r, g, b, 0.9);
  }

  const flies: Fly[] = [];
  const spawn = () => {
    flies.length = 0;
    const n = clamp(Math.round((c.w * c.h) / 4200), 120, 420);
    for (let i = 0; i < n; i++) {
      flies.push({
        x: rand(0, c.w), y: rand(0, c.h),
        vx: rand(-10, 10), vy: rand(-10, 10),
        size: rand(0.7, 1.6), phase: rand(0, TAU), blink: rand(0.6, 2.2),
        brave: Math.random() < 0.12, seed: rand(0, 1000),
      });
    }
  };
  spawn();

  const pointers = new Map<number, { x: number; y: number; vx: number; vy: number; at: number }>();
  let wind = { x: 0, y: 0 };
  let flash = 0;

  const loop = createLoop((dt, t) => {
    if (c.resize()) spawn();
    const now = performance.now();
    wind.x *= damp(1.5, dt);
    wind.y *= damp(1.5, dt);
    flash *= damp(4, dt);

    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = DEEP_BG;
    ctx.fillRect(0, 0, c.w, c.h);
    // 바닥의 아주 옅은 풀빛
    const g = ctx.createLinearGradient(0, c.h * 0.55, 0, c.h);
    g.addColorStop(0, "rgba(20, 60, 45, 0)");
    g.addColorStop(1, "rgba(20, 60, 45, 0.55)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.w, c.h);

    ctx.globalCompositeOperation = "lighter";
    for (const f of flies) {
      // 배회 — curl 노이즈
      const e = 0.6;
      const s = 0.004;
      const n1 = noise3((f.x + e) * s, f.y * s, t * 0.25 + f.seed);
      const n2 = noise3((f.x - e) * s, f.y * s, t * 0.25 + f.seed);
      const n3 = noise3(f.x * s, (f.y + e) * s, t * 0.25 + f.seed);
      const n4 = noise3(f.x * s, (f.y - e) * s, t * 0.25 + f.seed);
      let ax = (n3 - n4) / (2 * e) * 900;
      let ay = -(n1 - n2) / (2 * e) * 900;

      // 손끝 — 무서운 애는 피하고 겁 없는 애는 다가간다
      for (const p of pointers.values()) {
        const dx = f.x - p.x;
        const dy = f.y - p.y;
        const d2 = dx * dx + dy * dy;
        const R = 150;
        if (d2 < R * R) {
          const d = Math.sqrt(d2) + 0.001;
          const k = (1 - d / R);
          if (f.brave) {
            ax -= (dx / d) * k * 260;
            ay -= (dy / d) * k * 260;
            // 가까우면 손 위에 앉는다 — 속도를 죽인다
            if (d < 26) { f.vx *= damp(6, dt); f.vy *= damp(6, dt); }
          } else {
            // 속도만 키우고 방향은 흐름을 유지한다
            const speed = Math.hypot(f.vx, f.vy) + 0.001;
            const boost = 1 + k * k * 3.5;
            ax += (f.vx / speed) * boost * 120 + (dx / d) * k * 90;
            ay += (f.vy / speed) * boost * 120 + (dy / d) * k * 90;
          }
        }
      }
      ax += wind.x;
      ay += wind.y;

      f.vx = (f.vx + ax * dt) * damp(1.8, dt);
      f.vy = (f.vy + ay * dt) * damp(1.8, dt);
      const sp = Math.hypot(f.vx, f.vy);
      const max = f.brave ? 60 : 110;
      if (sp > max) { f.vx *= max / sp; f.vy *= max / sp; }
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      if (f.x < -20) f.x = c.w + 20; else if (f.x > c.w + 20) f.x = -20;
      if (f.y < -20) f.y = c.h + 20; else if (f.y > c.h + 20) f.y = -20;

      // 깜빡임 — 느리게 밝아지고 빨리 꺼지는 반딧불 곡선
      const ph = (t * f.blink + f.phase) % TAU;
      let glow = Math.pow(Math.max(0, Math.sin(ph)), 3);
      glow = 0.25 + glow * 0.75 + flash * 0.4;
      // 손 가까이 있으면 더 밝다
      let near = 0;
      for (const p of pointers.values()) {
        const d = Math.hypot(f.x - p.x, f.y - p.y);
        near = Math.max(near, 1 - clamp(d / 180, 0, 1));
      }
      glow = Math.min(1, glow + near * 0.5);
      const r = (10 + near * 8) * f.size;
      ctx.globalAlpha = glow * 0.85;
      ctx.drawImage(sprite, f.x - r * 2, f.y - r * 2, r * 4, r * 4);
      ctx.globalAlpha = glow;
      const cr = 2.2 * f.size;
      ctx.drawImage(core, f.x - cr, f.y - cr, cr * 2, cr * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    // 오래 안 움직인 포인터는 지운다 (마우스 hover 잔상)
    for (const [id, p] of pointers) if (now - p.at > 1200 && id === 0) pointers.delete(id);
  });

  return {
    start: () => loop.start(),
    stop: () => loop.stop(),
    dispose: () => loop.stop(),
    pointerDown(x, y, id) {
      pointers.set(id, { x, y, vx: 0, vy: 0, at: performance.now() });
    },
    pointerMove(x, y, dx, dy, id) {
      pointers.set(id, { x, y, vx: dx, vy: dy, at: performance.now() });
    },
    pointerUp(id) {
      if (id !== 0) pointers.delete(id);
    },
    wheel(_x, _y, delta) {
      wind.y -= delta * 6;
    },
    tilt(fx, fy) {
      wind.x = fx * 240;
      wind.y = fy * 240;
    },
    idle() {
      flash = 0.6; // 다 같이 한 번 밝아진다
    },
    clear() {
      spawn();
    },
    setColor(h) {
      hex = h;
      sprite = makeSprite(hex);
      core = glowSprite(32, 255, 255, 240, 1);
    },
  };
};
