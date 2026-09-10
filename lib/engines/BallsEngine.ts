import { createCanvas2D, createLoop, DEEP_BG } from "@/lib/canvas/tools";
import { thud } from "@/lib/audio/tones";
import { clamp, damp, hexToRgb255, rand, TAU } from "@/lib/util/math";
import type { EngineFactory } from "./types";

/**
 * 공 — 원 몇 개가 벽 안에서 굴러다닌다. 탭하면 튕기고, 잡아 던지고, 기울이면 그쪽으로 굴러간다.
 *
 * 물리는 직접 썼다(원 충돌 · 벽 · 마찰 · 반발). 라이브러리를 넣을 만큼 복잡하지 않다.
 * 품질은 렌더에서 — 바닥 그림자(공이 멀수록 흐리고 옅게), 충돌 순간의 스쿼시, 하이라이트,
 * 벽에 닿을 때의 짧은 소리(기본 무음).
 */
type Ball = {
  x: number; y: number; vx: number; vy: number; r: number; color: string;
  squash: number; sqAng: number; spin: number; held: number | null;
};

export const createBallsEngine: EngineFactory = (canvas, ctx0) => {
  const c = createCanvas2D(canvas);
  const { ctx } = c;
  const palette = ctx0.scene.color.kind === "palette" ? ctx0.scene.color.colors : ["#5fb8c9"];
  let sound = ctx0.sound;

  const balls: Ball[] = [];
  const spawn = () => {
    balls.length = 0;
    const n = clamp(Math.round((c.w * c.h) / 60000), 5, 11);
    for (let i = 0; i < n; i++) {
      const r = rand(18, 40);
      balls.push({
        x: rand(r, c.w - r), y: rand(r, c.h * 0.6), vx: rand(-60, 60), vy: 0, r,
        color: palette[i % palette.length], squash: 0, sqAng: 0, spin: 0, held: null,
      });
    }
  };
  spawn();

  let gravity = { x: 0, y: 900 };
  let gTarget = { x: 0, y: 900 };
  const grabs = new Map<number, { ball: Ball; ox: number; oy: number; x: number; y: number; px: number; py: number; t: number }>();

  const hit = (b: Ball, nx: number, ny: number, speed: number) => {
    if (speed < 40) return;
    b.squash = clamp(speed / 900, 0, 0.35);
    b.sqAng = Math.atan2(ny, nx);
    if (sound) thud(120 + (40 - b.r) * 6, clamp(speed / 1200, 0.05, 0.8));
  };

  const loop = createLoop((dt) => {
    if (c.resize()) spawn();
    gravity.x += (gTarget.x - gravity.x) * (1 - damp(3, dt));
    gravity.y += (gTarget.y - gravity.y) * (1 - damp(3, dt));

    const steps = 3;
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      for (const b of balls) {
        if (b.held !== null) continue;
        b.vx += gravity.x * h;
        b.vy += gravity.y * h;
        b.vx *= damp(0.15, h);
        b.vy *= damp(0.15, h);
        b.x += b.vx * h;
        b.y += b.vy * h;
        // 벽
        if (b.x < b.r) { b.x = b.r; if (b.vx < 0) { hit(b, 1, 0, -b.vx); b.vx = -b.vx * 0.72; } }
        if (b.x > c.w - b.r) { b.x = c.w - b.r; if (b.vx > 0) { hit(b, -1, 0, b.vx); b.vx = -b.vx * 0.72; } }
        if (b.y < b.r) { b.y = b.r; if (b.vy < 0) { hit(b, 0, 1, -b.vy); b.vy = -b.vy * 0.72; } }
        if (b.y > c.h - b.r) {
          b.y = c.h - b.r;
          if (b.vy > 0) { hit(b, 0, -1, b.vy); b.vy = -b.vy * 0.68; }
          // 바닥 마찰 · 회전
          b.vx *= damp(1.2, h);
          b.spin = b.vx / b.r;
        }
      }
      // 공끼리
      for (let i = 0; i < balls.length; i++) for (let j = i + 1; j < balls.length; j++) {
        const a = balls[i], b = balls[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.001;
        const min = a.r + b.r;
        if (d >= min) continue;
        const nx = dx / d, ny = dy / d;
        const overlap = min - d;
        const ma = a.r * a.r, mb = b.r * b.r;
        const wa = a.held !== null ? 0 : mb / (ma + mb);
        const wb = b.held !== null ? 0 : ma / (ma + mb);
        a.x -= nx * overlap * wa; a.y -= ny * overlap * wa;
        b.x += nx * overlap * wb; b.y += ny * overlap * wb;
        const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
        const vn = rvx * nx + rvy * ny;
        if (vn < 0) {
          const e = 0.75;
          const jImp = (-(1 + e) * vn) / (1 / ma + 1 / mb);
          if (a.held === null) { a.vx -= (jImp / ma) * nx; a.vy -= (jImp / ma) * ny; }
          if (b.held === null) { b.vx += (jImp / mb) * nx; b.vy += (jImp / mb) * ny; }
          hit(a, -nx, -ny, -vn * 0.6);
          hit(b, nx, ny, -vn * 0.6);
        }
      }
    }
    for (const b of balls) {
      b.squash *= damp(9, dt);
      if (b.held === null) b.spin *= damp(0.5, dt);
    }
    // 잡힌 공은 손을 따라간다
    for (const g of grabs.values()) {
      const b = g.ball;
      const tx = g.x - g.ox, ty = g.y - g.oy;
      b.vx = (tx - b.x) / Math.max(dt, 0.001) * 0.6;
      b.vy = (ty - b.y) / Math.max(dt, 0.001) * 0.6;
      b.x = tx; b.y = ty;
      b.x = clamp(b.x, b.r, c.w - b.r); b.y = clamp(b.y, b.r, c.h - b.r);
    }

    // 그리기
    const bg = ctx.createLinearGradient(0, 0, 0, c.h);
    bg.addColorStop(0, "#0b262e");
    bg.addColorStop(1, DEEP_BG);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, c.w, c.h);
    // 바닥선 빛
    const floor = ctx.createLinearGradient(0, c.h - 60, 0, c.h);
    floor.addColorStop(0, "rgba(95,184,201,0)");
    floor.addColorStop(1, "rgba(95,184,201,0.12)");
    ctx.fillStyle = floor;
    ctx.fillRect(0, c.h - 60, c.w, 60);

    // 그림자 — 바닥과의 거리로 흐림·크기
    for (const b of balls) {
      const dist = clamp((c.h - b.r - b.y) / 300, 0, 1);
      const sw = b.r * (1.1 - dist * 0.5);
      const sh = b.r * 0.32 * (1 - dist * 0.5);
      const sg = ctx.createRadialGradient(b.x, c.h - 6, 0, b.x, c.h - 6, sw);
      sg.addColorStop(0, `rgba(0, 12, 16, ${0.55 * (1 - dist * 0.7)})`);
      sg.addColorStop(1, "rgba(0, 12, 16, 0)");
      ctx.save();
      ctx.translate(b.x, c.h - 6);
      ctx.scale(1, sh / sw);
      ctx.translate(-b.x, -(c.h - 6));
      ctx.fillStyle = sg;
      ctx.fillRect(b.x - sw, c.h - 6 - sw, sw * 2, sw * 2);
      ctx.restore();
    }
    for (const b of balls) {
      const [R, G, B] = hexToRgb255(b.color);
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.sqAng);
      ctx.scale(1 - b.squash, 1 + b.squash);
      ctx.rotate(-b.sqAng);
      const g = ctx.createRadialGradient(-b.r * 0.35, -b.r * 0.4, b.r * 0.1, 0, 0, b.r);
      g.addColorStop(0, `rgb(${Math.min(255, R + 70)}, ${Math.min(255, G + 70)}, ${Math.min(255, B + 70)})`);
      g.addColorStop(0.55, b.color);
      g.addColorStop(1, `rgb(${R * 0.35 | 0}, ${G * 0.35 | 0}, ${B * 0.35 | 0})`);
      ctx.beginPath(); ctx.arc(0, 0, b.r, 0, TAU);
      ctx.fillStyle = g; ctx.fill();
      // 회전이 보이게 얇은 띠
      ctx.rotate(b.spin * 0.6);
      ctx.beginPath(); ctx.arc(0, 0, b.r * 0.62, 0.3, 1.6);
      ctx.strokeStyle = "rgba(255,255,255,0.14)"; ctx.lineWidth = b.r * 0.12; ctx.stroke();
      ctx.restore();
    }
  });

  const pick = (x: number, y: number) => balls.find((b) => Math.hypot(b.x - x, b.y - y) < b.r + 6);

  return {
    start: () => loop.start(),
    stop: () => loop.stop(),
    dispose: () => loop.stop(),
    pointerDown(x, y, id) {
      const b = pick(x, y);
      if (b) {
        b.held = id;
        grabs.set(id, { ball: b, ox: x - b.x, oy: y - b.y, x, y, px: x, py: y, t: performance.now() });
      } else {
        // 빈 곳을 탭하면 근처 공이 튀어 오른다
        for (const o of balls) {
          const d = Math.hypot(o.x - x, o.y - y);
          if (d < 160) { const k = 1 - d / 160; o.vx += ((o.x - x) / d) * k * 500; o.vy += -k * 700; }
        }
      }
    },
    pointerMove(x, y, _dx, _dy, id, pressed) {
      const g = grabs.get(id);
      if (g && pressed) { g.px = g.x; g.py = g.y; g.x = x; g.y = y; g.t = performance.now(); }
    },
    pointerUp(id) {
      const g = grabs.get(id);
      if (g) {
        g.ball.held = null;
        // 던진 속도는 마지막 이동으로 — 너무 빠르면 잘라 준다
        const sp = Math.hypot(g.ball.vx, g.ball.vy);
        if (sp > 1600) { g.ball.vx *= 1600 / sp; g.ball.vy *= 1600 / sp; }
        grabs.delete(id);
      }
    },
    wheel(_x, _y, delta) {
      for (const b of balls) if (b.held === null) b.vy -= delta * 8;
    },
    tilt(fx, fy) {
      // 기울인 쪽이 아래가 된다. fy 는 앞으로 기울이면 양수(화면 위쪽이 낮아짐)
      gTarget = { x: fx * 900, y: 900 * (1 - Math.abs(fx) * 0.5) - fy * 700 };
    },
    idle() {
      const b = balls[Math.floor(rand(0, balls.length))];
      if (b && b.held === null) { b.vy -= 350; b.vx += rand(-120, 120); }
    },
    clear() {
      spawn();
    },
    setSound(on) {
      sound = on;
    },
  };
};
