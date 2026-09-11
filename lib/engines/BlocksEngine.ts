import { createCanvas2D, createLoop, DEEP_BG } from "@/lib/canvas/tools";
import { thud } from "@/lib/audio/tones";
import { clamp, damp, hexToRgb255, lerp, rand, TAU } from "@/lib/util/math";
import type { EngineFactory } from "./types";

/**
 * 블록 놀이 — bruno-simon.com 의 물리 놀이터(공을 몰아 벽돌을 무너뜨리는)에서 (2026-09-11 사용자 요청).
 *
 *   · 위에서 내려다본 판 위에 파스텔 나무 블록이 벽처럼 쌓여 있다(살짝 기울인 등각 투영으로 그린다)
 *   · 손가락을 누르면 공이 손을 따라오고, 블록에 부딪히면 밀려 미끄러지고 돌아간다. 블록끼리도 부딪힌다
 *   · 기울기: 판이 기울어 모두 그쪽으로 미끄러진다. 휠: 판을 튕겨 흩뜨린다. 지우기: 다시 쌓는다
 *   · 물리는 원(circle) 충돌 + 마찰만 — 라이브러리 없이 충분히 "쿵" 하고 밀린다
 */
type Body = { x: number; y: number; vx: number; vy: number; ang: number; vang: number; size: number; color: string; mass: number; kind: "block" | "ball" };

const COLORS = ["#f6b7cf", "#b9d7f2", "#f7ecb0", "#c7ecd2", "#dcc9f5", "#ffd9b3"];

export const createBlocksEngine: EngineFactory = (canvas, ctx0) => {
  const c = createCanvas2D(canvas);
  const { ctx } = c;
  let sound = ctx0.sound;
  let bodies: Body[] = [];
  let ball: Body;
  let tilt = { x: 0, y: 0 };
  let target: { x: number; y: number } | null = null;
  let lastThud = 0;

  const spawn = () => {
    bodies = [];
    const s = clamp(Math.min(c.w, c.h) * 0.075, 26, 46);
    const cols = c.w > c.h ? 5 : 4, rowsN = c.w > c.h ? 3 : 4;
    const ox = c.w / 2 - ((cols - 1) * s * 1.08) / 2, oy = c.h * 0.42 - ((rowsN - 1) * s * 1.08) / 2;
    let k = 0;
    for (let j = 0; j < rowsN; j++) for (let i = 0; i < cols; i++) {
      const size = s * rand(0.86, 1.05);
      bodies.push({ x: ox + i * s * 1.08 + (j % 2) * s * 0.3, y: oy + j * s * 1.08, vx: 0, vy: 0, ang: rand(-0.06, 0.06), vang: 0, size, color: COLORS[k++ % COLORS.length], mass: size * size, kind: "block" });
    }
    ball = { x: c.w / 2, y: c.h * 0.85, vx: 0, vy: 0, ang: 0, vang: 0, size: s * 0.6, color: "#eef7f8", mass: s * s * 2.2, kind: "ball" };
    bodies.push(ball);
    target = null;
  };
  spawn();

  const radiusOf = (b: Body) => (b.kind === "ball" ? b.size : b.size * 0.68);

  const loop = createLoop((dt) => {
    if (c.resize()) spawn();
    const h = Math.min(dt, 1 / 30);
    const sub = 3, hs = h / sub;
    for (let s = 0; s < sub; s++) {
      // 공은 손을 따라온다
      if (target) { ball.vx += (target.x - ball.x) * 40 * hs * 60 * hs; ball.vy += (target.y - ball.y) * 40 * hs * 60 * hs; ball.vx *= damp(6, hs); ball.vy *= damp(6, hs); }
      for (const b of bodies) {
        b.vx += tilt.x * 900 * hs; b.vy += tilt.y * 900 * hs;
        const fr = b.kind === "ball" ? 1.2 : 4.5; // 블록은 바닥 마찰이 크다
        b.vx *= damp(fr, hs); b.vy *= damp(fr, hs); b.vang *= damp(3.5, hs);
        b.x += b.vx * hs; b.y += b.vy * hs; b.ang += b.vang * hs;
        const r = radiusOf(b);
        if (b.x < r) { b.x = r; b.vx = Math.abs(b.vx) * 0.4; }
        if (b.x > c.w - r) { b.x = c.w - r; b.vx = -Math.abs(b.vx) * 0.4; }
        if (b.y < r) { b.y = r; b.vy = Math.abs(b.vy) * 0.4; }
        if (b.y > c.h - r) { b.y = c.h - r; b.vy = -Math.abs(b.vy) * 0.4; }
      }
      // 충돌 — 원끼리. 부딪힌 접선 방향 속도가 블록을 돌린다
      for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i], b = bodies[j];
        const dx = b.x - a.x, dy = b.y - a.y; const d = Math.hypot(dx, dy) || 0.001;
        const min = radiusOf(a) + radiusOf(b);
        if (d >= min) continue;
        const nx = dx / d, ny = dy / d; const overlap = min - d;
        const ma = a.mass, mb = b.mass, tot = ma + mb;
        a.x -= nx * overlap * (mb / tot); a.y -= ny * overlap * (mb / tot);
        b.x += nx * overlap * (ma / tot); b.y += ny * overlap * (ma / tot);
        const rvx = b.vx - a.vx, rvy = b.vy - a.vy; const vn = rvx * nx + rvy * ny;
        if (vn < 0) {
          const e = 0.35; const jimp = (-(1 + e) * vn) / (1 / ma + 1 / mb);
          a.vx -= (jimp / ma) * nx; a.vy -= (jimp / ma) * ny; b.vx += (jimp / mb) * nx; b.vy += (jimp / mb) * ny;
          const vt = rvx * -ny + rvy * nx; // 접선 성분 → 회전
          if (a.kind === "block") a.vang += vt * 0.004; if (b.kind === "block") b.vang -= vt * 0.004;
          const now = performance.now();
          if (sound && -vn > 60 && now - lastThud > 70) { lastThud = now; thud(140 + Math.random() * 60, clamp(-vn / 900, 0.1, 0.6)); }
        }
      }
    }

    // ── 그리기 ──
    const bg = ctx.createRadialGradient(c.w / 2, c.h * 0.4, 0, c.w / 2, c.h * 0.4, Math.max(c.w, c.h) * 0.8);
    bg.addColorStop(0, "#0f3038"); bg.addColorStop(1, DEEP_BG);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, c.w, c.h);
    // 판 무늬 — 옅은 격자
    ctx.strokeStyle = "rgba(255,255,255,0.035)"; ctx.lineWidth = 1;
    const gs = 48;
    for (let x = (c.w / 2) % gs; x < c.w; x += gs) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, c.h); ctx.stroke(); }
    for (let y = (c.h / 2) % gs; y < c.h; y += gs) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(c.w, y); ctx.stroke(); }

    const sorted = [...bodies].sort((a, b) => a.y - b.y);
    // 그림자 먼저
    for (const b of sorted) {
      const r = radiusOf(b);
      ctx.fillStyle = "rgba(0, 8, 12, 0.35)";
      ctx.beginPath(); ctx.ellipse(b.x + r * 0.18, b.y + r * 0.42, r * 1.05, r * 0.6, 0, 0, TAU); ctx.fill();
    }
    for (const b of sorted) {
      if (b.kind === "ball") {
        const r = b.size;
        const g = ctx.createRadialGradient(b.x - r * 0.35, b.y - r * 0.4, r * 0.1, b.x, b.y, r);
        g.addColorStop(0, "#ffffff"); g.addColorStop(0.5, "#dfeef2"); g.addColorStop(1, "#7c9ba3");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, TAU); ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 1; ctx.stroke();
        continue;
      }
      // 블록 — 윗면(돌아간 정사각형) + 아래로 늘인 옆면
      const s = b.size, hgt = s * 0.55;
      const [r, g, bl] = hexToRgb255(b.color);
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([px, py]) => {
        const ca = Math.cos(b.ang), sa = Math.sin(b.ang);
        return [b.x + (px * ca - py * sa) * s * 0.5, b.y + (px * sa + py * ca) * s * 0.5] as const;
      });
      // 옆면: 윗면의 아래쪽 두 변을 hgt 만큼 내려 사다리꼴로
      const shade = (k: number) => `rgb(${(r * k) | 0},${(g * k) | 0},${(bl * k) | 0})`;
      for (let i = 0; i < 4; i++) {
        const p = corners[i], q = corners[(i + 1) % 4];
        const midY = (p[1] + q[1]) / 2;
        if (midY < b.y) continue; // 뒤쪽 변은 가려진다
        const nx = q[1] - p[1], lit = 0.62 + 0.18 * (nx > 0 ? 1 : 0);
        ctx.fillStyle = shade(lit);
        ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.lineTo(q[0], q[1] + hgt); ctx.lineTo(p[0], p[1] + hgt); ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = shade(1);
      ctx.beginPath(); corners.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1]))); ctx.closePath(); ctx.fill();
      // 윗면 빛
      const tg = ctx.createLinearGradient(corners[0][0], corners[0][1], corners[2][0], corners[2][1]);
      tg.addColorStop(0, "rgba(255,255,255,0.28)"); tg.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = tg; ctx.fill();
      ctx.strokeStyle = "rgba(60, 40, 50, 0.35)"; ctx.lineWidth = 1; ctx.stroke();
      // 나무 결 한 줄
      ctx.strokeStyle = "rgba(90, 60, 60, 0.18)";
      ctx.beginPath(); ctx.moveTo(lerp(corners[0][0], corners[3][0], 0.35), lerp(corners[0][1], corners[3][1], 0.35)); ctx.lineTo(lerp(corners[1][0], corners[2][0], 0.42), lerp(corners[1][1], corners[2][1], 0.42)); ctx.stroke();
    }
  });

  return {
    start: () => loop.start(),
    stop: () => loop.stop(),
    dispose: () => loop.stop(),
    pointerDown(x, y) { target = { x, y }; },
    pointerMove(x, y, _dx, _dy, _id, pressed) { if (pressed) target = { x, y }; },
    pointerUp() { target = null; },
    wheel(_x, _y, delta) { for (const b of bodies) { b.vy -= delta * 4 * (0.6 + Math.random() * 0.8); b.vx += rand(-80, 80); b.vang += rand(-2, 2); } },
    tilt(fx, fy) { tilt = { x: fx, y: fy }; },
    idle() {},
    clear() { spawn(); },
    setSound(on) { sound = on; },
  };
};
