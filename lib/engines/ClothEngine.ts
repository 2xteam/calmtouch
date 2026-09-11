import { createCanvas2D, createLoop, DEEP_BG } from "@/lib/canvas/tools";
import { clamp, damp, hexToRgb255, lerp, noise3 } from "@/lib/util/math";
import type { EngineFactory } from "./types";

/**
 * 천 커튼 — 위쪽이 봉에 걸린 Verlet 천. 바람(노이즈)에 흔들리고, 손으로 젖히면 되돌아온다.
 *
 * 두 번째 판(2026-09-11). 첫 판은 셀마다 단색을 칠해 줄무늬 판처럼 보였다. 지금은 —
 *   · 열(세로 줄)마다 **매끈한 곡선**으로 그리고, 옆 열까지 **가로 그라디언트**로 이어 면이 아니라 천으로 보이게
 *   · 음영은 접힘(가로 압축)과 빛 방향(왼쪽 위 창문)으로 — 접힌 골은 어둡고, 펴진 산은 밝다
 *   · 얇은 천 — 뒤 창문의 빛이 은은히 비친다. 아랫단은 무겁게(추) 처져 천천히 흔들린다
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
    COLS = clamp(Math.round(c.w / 22), 20, 48);
    ROWS = clamp(Math.round(c.h / 18), 24, 52);
    spacing = Math.min((c.w * 0.84) / (COLS - 1), (c.h * 0.86) / (ROWS - 1));
    ox = (c.w - spacing * (COLS - 1)) / 2;
    oy = 34;
    pts = [];
    for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
      const x = ox + i * spacing, y = oy + j * spacing;
      pts.push({ x, y, px: x, py: y, pin: j === 0 });
    }
  };
  spawn();
  const at = (i: number, j: number) => pts[j * COLS + i];

  /** 잡은 자리 — 한 점을 당기면 뾰족해지므로 주변 점들을 무게로 함께 끈다 */
  const grabs = new Map<number, { i: number; j: number; ox: number; oy: number; x: number; y: number; offs: { di: number; dj: number; ox: number; oy: number; w: number }[] }>();

  function relax(a: P, b: P, rest: number) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.hypot(dx, dy) || 0.001;
    const diff = ((d - rest) / d) * 0.5;
    const mx = dx * diff, my = dy * diff;
    if (!a.pin) { a.x += mx; a.y += my; }
    if (!b.pin) { b.x -= mx; b.y -= my; }
  }

  const loop = createLoop((dt, t) => {
    if (c.resize()) spawn();
    const h = Math.min(dt, 1 / 40);
    gust *= damp(0.8, dt);
    wind.x *= damp(1.0, dt);
    wind.y *= damp(1.0, dt);

    const dampK = Math.exp(-1.4 * h);
    for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
      const p = at(i, j);
      if (p.pin) continue;
      // 바람 — 큰 물결(느린 노이즈) + 잔결. 아래로 갈수록 더 흔들린다
      const depth = j / ROWS;
      const n = noise3(i * 0.10, j * 0.06, t * 0.45);
      const n2 = noise3(i * 0.3 + 7, j * 0.2, t * 1.1) * 0.35;
      const ax = 22 + (n + n2) * 150 * (0.4 + depth) + gust * 320 * (0.5 + n) + wind.x * 420;
      // 아랫단은 추가 달린 듯 무겁다
      const ay = 900 + (j === ROWS - 1 ? 500 : 0) + noise3(i * 0.1 + 9, j * 0.1, t * 0.4) * 30 + wind.y * 200;
      const vx = (p.x - p.px) * dampK, vy = (p.y - p.py) * dampK;
      p.px = p.x; p.py = p.y;
      p.x += vx + ax * h * h;
      p.y += vy + ay * h * h;
    }
    const applyGrab = (g: NonNullable<ReturnType<typeof grabs.get>>) => {
      for (const o of g.offs) {
        const ii = g.i + o.di, jj = g.j + o.dj;
        if (ii < 0 || ii >= COLS || jj < 1 || jj >= ROWS) continue;
        const p = at(ii, jj);
        p.x = lerp(p.x, g.x + o.ox, o.w); p.y = lerp(p.y, g.y + o.oy, o.w);
        p.px = p.x; p.py = p.y;
      }
    };
    for (const g of grabs.values()) applyGrab(g);
    for (let k = 0; k < 7; k++) {
      for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
        const p = at(i, j);
        if (i < COLS - 1) relax(p, at(i + 1, j), spacing);
        if (j < ROWS - 1) relax(p, at(i, j + 1), spacing);
      }
      for (const g of grabs.values()) applyGrab(g);
    }

    // ── 그리기 ──
    ctx.fillStyle = DEEP_BG;
    ctx.fillRect(0, 0, c.w, c.h);
    // 뒤 창문 — 저녁 빛. 천이 얇아 비친다
    const win = ctx.createRadialGradient(c.w * 0.45, c.h * 0.32, 0, c.w * 0.45, c.h * 0.32, c.h * 0.95);
    win.addColorStop(0, "rgba(232,209,138,0.30)");
    win.addColorStop(0.5, "rgba(232,209,138,0.10)");
    win.addColorStop(1, "rgba(232,209,138,0)");
    ctx.fillStyle = win;
    ctx.fillRect(0, 0, c.w, c.h);

    const [R, G, B] = hexToRgb255(hex);
    // 열별 음영 — 이웃 열과의 가로 간격(압축)으로 접힘을 읽는다. 위·아래 이웃과 섞어 부드럽게
    const shade = new Float32Array(COLS * ROWS);
    for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
      const l = at(Math.max(0, i - 1), j), r = at(Math.min(COLS - 1, i + 1), j);
      const w = (r.x - l.x) / (spacing * (i === 0 || i === COLS - 1 ? 1 : 2));
      // 기울기(왼쪽 위 빛): 오른쪽으로 내려가는 면은 밝고, 왼쪽으로 내려가는 면은 어둡다
      const slope = (r.y - l.y) / (spacing * 2);
      shade[j * COLS + i] = clamp(0.72 + (w - 1) * 1.0 - slope * 0.25, 0.4, 1.08);
    }
    const sm = new Float32Array(shade);
    for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
      let s = 0, n = 0;
      for (let dj = -1; dj <= 1; dj++) { const jj = j + dj; if (jj < 0 || jj >= ROWS) continue; s += shade[jj * COLS + i]; n++; }
      sm[j * COLS + i] = s / n;
    }
    const col = (s: number, a = 1) => `rgba(${clamp(R * s, 0, 255) | 0},${clamp(G * s, 0, 255) | 0},${clamp(B * s, 0, 255) | 0},${a})`;

    // 열 띠 — 왼쪽 열과 오른쬭 열 사이를 하나의 띠로. 위에서 아래로 곡선, 가로로 그라디언트
    for (let i = 0; i < COLS - 1; i++) {
      ctx.beginPath();
      // 왼쪽 열 아래로
      for (let j = 0; j < ROWS; j++) {
        const p = at(i, j);
        if (j === 0) ctx.moveTo(p.x, p.y);
        else { const q = at(i, j - 1); ctx.quadraticCurveTo(q.x, q.y, (q.x + p.x) / 2, (q.y + p.y) / 2); }
      }
      ctx.lineTo(at(i, ROWS - 1).x, at(i, ROWS - 1).y);
      // 오른쬭 열 위로
      for (let j = ROWS - 1; j >= 0; j--) {
        const p = at(i + 1, j);
        if (j === ROWS - 1) ctx.lineTo(p.x, p.y);
        else { const q = at(i + 1, j + 1); ctx.quadraticCurveTo(q.x, q.y, (q.x + p.x) / 2, (q.y + p.y) / 2); }
      }
      ctx.closePath();
      // 띠의 가로 그라디언트 — 가운데 행의 음영으로 좌우 끝을 정한다
      const midJ = Math.floor(ROWS / 2);
      const a = at(i, midJ), b = at(i + 1, midJ);
      const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      const sA = sm[midJ * COLS + i], sB = sm[midJ * COLS + i + 1];
      g.addColorStop(0, col(sA, 0.93));
      g.addColorStop(1, col(sB, 0.93));
      ctx.fillStyle = g;
      ctx.fill();
      // 이음새를 같은 색으로 덮어 격자선이 보이지 않게
      ctx.strokeStyle = col((sA + sB) / 2, 0.93);
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    // 세로 음영 덧칠 — 위쪽(봉 근처)은 접혀 조금 어둡고, 아래는 빛을 받아 밝다
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    const vg = ctx.createLinearGradient(0, oy, 0, oy + spacing * (ROWS - 1));
    vg.addColorStop(0, "rgba(190,205,210,1)");
    vg.addColorStop(0.22, "rgba(240,244,245,1)");
    vg.addColorStop(1, "rgba(255,255,255,1)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, c.w, c.h);
    ctx.restore();
    // 직조 결 — 아주 옅은 가로 실 무늬
    ctx.save();
    ctx.globalAlpha = 0.03;
    ctx.strokeStyle = "rgba(255,255,255,1)";
    ctx.lineWidth = 1;
    for (let j = 2; j < ROWS; j += 3) {
      ctx.beginPath();
      for (let i = 0; i < COLS; i++) { const p = at(i, j); if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }
      ctx.stroke();
    }
    ctx.restore();
    // 아랫단 — 두꺼운 밑단과 그림자
    ctx.beginPath();
    for (let i = 0; i < COLS; i++) { const p = at(i, ROWS - 1); if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }
    ctx.strokeStyle = col(0.42, 0.95);
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = col(0.9, 0.5);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // 봉과 고리
    const rodY = oy - 10;
    const rod = ctx.createLinearGradient(0, rodY - 5, 0, rodY + 5);
    rod.addColorStop(0, "#f1dd97"); rod.addColorStop(0.5, "#c9a84c"); rod.addColorStop(1, "#7a5f1e");
    ctx.fillStyle = rod;
    ctx.fillRect(ox - 26, rodY - 4, spacing * (COLS - 1) + 52, 8);
    ctx.beginPath(); ctx.arc(ox - 26, rodY, 7, 0, Math.PI * 2); ctx.arc(ox + spacing * (COLS - 1) + 26, rodY, 7, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(201,168,76,0.9)";
    ctx.lineWidth = 2;
    for (let i = 0; i < COLS; i += 3) {
      const p = at(i, 0);
      ctx.beginPath(); ctx.arc(p.x, rodY + 4, 5, 0, Math.PI * 2); ctx.stroke();
    }
  });

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
        const offs: { di: number; dj: number; ox: number; oy: number; w: number }[] = [];
        for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || ii >= COLS || jj < 1 || jj >= ROWS) continue;
          const p = at(ii, jj);
          const dist = Math.hypot(di, dj);
          offs.push({ di, dj, ox: p.x - x, oy: p.y - y, w: dist === 0 ? 1 : clamp(1 - dist / 2.6, 0.15, 0.85) });
        }
        grabs.set(id, { i, j, ox: 0, oy: 0, x, y, offs });
      }
    },
    pointerMove(x, y, dx, dy, id, pressed) {
      const g = grabs.get(id);
      if (g && pressed) { g.x = x; g.y = y; return; }
      if (!pressed && Math.hypot(dx, dy) > 1) {
        for (let j = 1; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
          const p = at(i, j);
          const d = Math.hypot(p.x - x, p.y - y);
          if (d < 110) { const k = (1 - d / 110) * 0.3; p.x += dx * k; p.y += dy * k; }
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
      gust = 0.9;
    },
    clear() {
      spawn();
    },
    setColor(h) {
      hex = h;
    },
  };
};
