import { createCanvas2D, createLoop, DEEP_BG } from "@/lib/canvas/tools";
import { clamp, damp, hexToRgb255, noise3 } from "@/lib/util/math";
import type { EngineFactory } from "./types";

/**
 * 천 커튼 — 위쪽이 고정된 Verlet 천. 바람(노이즈)에 흔들리고, 손으로 젖히면 되돌아온다.
 *
 * 격자 셀마다 이웃 두 벡터의 외적으로 "얼마나 빛을 향해 기울었나"를 구해 음영을 넣는다 —
 * 그래서 접히는 곳이 어둡고 펴진 곳이 밝다. 단색 천 위에 얇은 세로 줄무늬(직조 느낌).
 */
type P = { x: number; y: number; px: number; py: number; pin: boolean };

export const createClothEngine: EngineFactory = (canvas, ctx0) => {
  const c = createCanvas2D(canvas);
  const { ctx } = c;
  let hex = ctx0.color;

  let COLS = 28, ROWS = 36;
  let pts: P[] = [];
  let spacing = 20;
  let ox = 0, oy = 0;
  let wind = { x: 0, y: 0 };
  let gust = 0;

  const spawn = () => {
    COLS = clamp(Math.round(c.w / 24), 18, 44);
    ROWS = clamp(Math.round(c.h / 20), 22, 48);
    spacing = Math.min(c.w * 0.82 / (COLS - 1), (c.h * 0.9) / (ROWS - 1));
    ox = (c.w - spacing * (COLS - 1)) / 2;
    oy = 24;
    pts = [];
    for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
      const x = ox + i * spacing, y = oy + j * spacing;
      pts.push({ x, y, px: x, py: y, pin: j === 0 });
    }
  };
  spawn();
  const at = (i: number, j: number) => pts[j * COLS + i];

  const grabs = new Map<number, { i: number; j: number; ox: number; oy: number; x: number; y: number }>();

  const loop = createLoop((dt, t) => {
    if (c.resize()) spawn();
    const h = Math.min(dt, 1 / 40);
    gust *= damp(0.8, dt);
    wind.x *= damp(1.0, dt);
    wind.y *= damp(1.0, dt);

    // 힘 · 적분
    const dampK = Math.exp(-1.6 * h);
    for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
      const p = at(i, j);
      if (p.pin) continue;
      const n = noise3(i * 0.12, j * 0.08, t * 0.6);
      const ax = 30 + n * 120 + gust * 300 * (0.5 + n) + wind.x * 400;
      const ay = 900 + noise3(i * 0.1 + 9, j * 0.1, t * 0.4) * 40 + wind.y * 200;
      const vx = (p.x - p.px) * dampK, vy = (p.y - p.py) * dampK;
      p.px = p.x; p.py = p.y;
      p.x += vx + ax * h * h;
      p.y += vy + ay * h * h;
    }
    // 잡은 점
    for (const g of grabs.values()) {
      const p = at(g.i, g.j);
      p.x = p.px = g.x + g.ox; p.y = p.py = g.y + g.oy;
    }
    // 제약 — 이웃 간 거리 유지 (반복 여러 번)
    for (let k = 0; k < 6; k++) {
      for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
        const p = at(i, j);
        if (i < COLS - 1) relax(p, at(i + 1, j), spacing);
        if (j < ROWS - 1) relax(p, at(i, j + 1), spacing);
      }
      for (const g of grabs.values()) { const p = at(g.i, g.j); p.x = g.x + g.ox; p.y = g.y + g.oy; }
    }

    // 그리기
    ctx.fillStyle = DEEP_BG;
    ctx.fillRect(0, 0, c.w, c.h);
    // 뒤 창문의 빛
    const lg = ctx.createRadialGradient(c.w * 0.5, c.h * 0.35, 0, c.w * 0.5, c.h * 0.35, c.h * 0.9);
    lg.addColorStop(0, "rgba(232,209,138,0.18)");
    lg.addColorStop(1, "rgba(232,209,138,0)");
    ctx.fillStyle = lg;
    ctx.fillRect(0, 0, c.w, c.h);
    // 커튼 봉
    ctx.fillStyle = "rgba(201,168,76,0.9)";
    ctx.fillRect(ox - 20, oy - 8, spacing * (COLS - 1) + 40, 4);

    const [R, G, B] = hexToRgb255(hex);
    for (let j = 0; j < ROWS - 1; j++) for (let i = 0; i < COLS - 1; i++) {
      const a = at(i, j), b = at(i + 1, j), d = at(i, j + 1), e = at(i + 1, j + 1);
      // 셀의 늘어남으로 음영 — 가로로 눌린 곳(접힘)은 어둡고, 펴진 곳은 밝다
      const w = Math.hypot(b.x - a.x, b.y - a.y) / spacing;
      const shade = clamp(0.45 + (w - 1) * 2.2 + (i % 2 === 0 ? 0.04 : -0.04), 0.2, 1.05);
      ctx.fillStyle = `rgb(${clamp(R * shade, 0, 255) | 0}, ${clamp(G * shade, 0, 255) | 0}, ${clamp(B * shade, 0, 255) | 0})`;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(e.x, e.y); ctx.lineTo(d.x, d.y);
      ctx.closePath();
      ctx.fill();
      // 이음새를 덮어 격자선이 안 보이게
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // 아래단
    ctx.strokeStyle = `rgba(${R * 0.4 | 0},${G * 0.4 | 0},${B * 0.4 | 0},0.9)`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i < COLS; i++) { const p = at(i, ROWS - 1); if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }
    ctx.stroke();
  });

  function relax(a: P, b: P, rest: number) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.hypot(dx, dy) || 0.001;
    const diff = (d - rest) / d * 0.5;
    const mx = dx * diff, my = dy * diff;
    if (!a.pin) { a.x += mx; a.y += my; }
    if (!b.pin) { b.x -= mx; b.y -= my; }
  }

  const nearestIdx = (x: number, y: number) => {
    let best = -1, bd = 60 * 60;
    for (let j = 1; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
      const p = at(i, j);
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bd) { bd = d; best = j * COLS + i; }
    }
    return best;
  };

  return {
    start: () => loop.start(),
    stop: () => loop.stop(),
    dispose: () => loop.stop(),
    pointerDown(x, y, id) {
      const k = nearestIdx(x, y);
      if (k >= 0) {
        const i = k % COLS, j = Math.floor(k / COLS);
        const p = at(i, j);
        grabs.set(id, { i, j, ox: p.x - x, oy: p.y - y, x, y });
      }
    },
    pointerMove(x, y, dx, dy, id, pressed) {
      const g = grabs.get(id);
      if (g && pressed) { g.x = x; g.y = y; return; }
      // 누르지 않은 마우스는 바람처럼 스친다
      if (!pressed && Math.hypot(dx, dy) > 1) {
        for (let j = 1; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
          const p = at(i, j);
          const d = Math.hypot(p.x - x, p.y - y);
          if (d < 90) { const k = (1 - d / 90) * 0.35; p.x += dx * k; p.y += dy * k; }
        }
      }
    },
    pointerUp(id) {
      grabs.delete(id);
    },
    wheel(_x, _y, delta) {
      gust = clamp(gust - delta * 0.02, -1.5, 1.5);
    },
    tilt(fx, fy) {
      wind = { x: fx, y: fy };
    },
    idle() {
      gust = 0.9; // 한 줄기 바람
    },
    clear() {
      spawn();
    },
    setColor(h) {
      hex = h;
    },
  };
};
