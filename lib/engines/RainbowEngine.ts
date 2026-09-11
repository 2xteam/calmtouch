import { createCanvas2D, createLoop, DEEP_BG } from "@/lib/canvas/tools";
import { clamp, damp, lerp, noise2, rand, TAU } from "@/lib/util/math";
import type { EngineFactory } from "./types";

/**
 * 무지개 — joshwcomeau.com 첫 화면의 손으로 그린 듯한 점선 무지개에서 (2026-09-11 사용자 요청).
 *
 *   · 줄(row) 몇 개가 밤 언덕 위에 걸려 있다. 줄마다 둥근 점선으로, 살짝 떨리는 손그림 결
 *   · 손가락이 가까이 오면 그 자리 줄이 밀려나 휘고, 놓으면 줄처럼 튕겨 돌아온다(이웃끼리 당긴다)
 *   · 휠·두 손가락: 줄 개수 3~9. 기울기: 무지개가 그쪽으로 기운다. 가만히 두면 잔물결이 한 번 지나간다
 */
type Pt = { d: number; v: number };

const M = 120; // 줄 하나의 점 수

export const createRainbowEngine: EngineFactory = (canvas) => {
  const c = createCanvas2D(canvas);
  const { ctx } = c;
  let rows = 5;
  let rowsTarget = 5;
  let rowsShown = 5; // 부드럽게 늘고 준다
  let pts: Pt[][] = [];
  let tilt = { x: 0, y: 0 };
  let tiltNow = { x: 0, y: 0 };
  const fingers = new Map<number, { x: number; y: number; pressed: boolean; at: number }>();
  let ripple = -1; // idle 잔물결 위치 0~1, 음수면 없음
  const stars = Array.from({ length: 70 }, () => ({ u: Math.random(), v: Math.random() * 0.7, r: rand(0.5, 1.6), tw: rand(0, TAU) }));

  const build = () => {
    pts = [];
    for (let r = 0; r < 9; r++) pts.push(Array.from({ length: M }, () => ({ d: 0, v: 0 })));
  };
  build();

  const geom = () => {
    const cx = c.w / 2 + tiltNow.x * c.w * 0.06;
    const cy = c.h * 0.9 + tiltNow.y * c.h * 0.05;
    const th = clamp(Math.min(c.w, c.h) * 0.055, 14, 34);
    const gap = th * 0.42;
    const r0 = Math.min(c.w * 0.36, c.h * 0.55);
    return { cx, cy, th, gap, r0 };
  };
  const hue = (i: number, n: number) => 275 - (i / Math.max(1, n - 1)) * 275; // 보라 → 빨강
  const pointAt = (row: number, i: number, g: ReturnType<typeof geom>) => {
    const a = Math.PI + (i / (M - 1)) * Math.PI;
    const rr = g.r0 + row * (g.th + g.gap) + pts[row][i].d;
    return [g.cx + Math.cos(a) * rr, g.cy + Math.sin(a) * rr, a] as const;
  };

  const loop = createLoop((dt, t) => {
    c.resize();
    const h = Math.min(dt, 1 / 30);
    tiltNow.x = lerp(tiltNow.x, tilt.x, 1 - damp(3, dt));
    tiltNow.y = lerp(tiltNow.y, tilt.y, 1 - damp(3, dt));
    rowsShown = lerp(rowsShown, rowsTarget, 1 - damp(6, dt));
    rows = Math.ceil(rowsShown - 0.02);
    const g = geom();
    const now = performance.now();
    for (const [id, f] of fingers) if (!f.pressed && now - f.at > 800) fingers.delete(id);
    if (ripple >= 0) { ripple += dt * 0.9; if (ripple > 1.3) ripple = -1; }

    // 줄 물리 — 손가락에 밀리고, 이웃과 당기고, 제자리로
    for (let r = 0; r < rows; r++) {
      const row = pts[r];
      for (let i = 0; i < M; i++) {
        const p = row[i];
        const [x, y] = pointAt(r, i, g);
        let a = -p.d * 60; // 복원
        for (const f of fingers.values()) {
          const dx = x - f.x, dy = y - f.y; const dist = Math.hypot(dx, dy);
          const reach = f.pressed ? 150 : 110;
          if (dist < reach) {
            const w = (1 - dist / reach) ** 2;
            // 손가락에서 멀어지는 쪽으로 — 반지름 방향 성분만 (줄은 반지름으로만 움직인다)
            const ra = Math.atan2(y - g.cy, x - g.cx);
            const away = (dx * Math.cos(ra) + dy * Math.sin(ra)) / (dist || 1);
            a += away * w * (f.pressed ? 3000 : 1600);
          }
        }
        if (ripple >= 0) { const k = Math.exp(-(((i / M - ripple) / 0.06) ** 2)); a += k * 900 * Math.sin(r * 0.9 + t); }
        const l = row[Math.max(0, i - 1)], rt = row[Math.min(M - 1, i + 1)];
        a += ((l.d + rt.d) / 2 - p.d) * 2600; // 줄의 장력 — 세야 뾰족하지 않고 활처럼 휜다
        p.v = (p.v + a * h) * damp(3.2, h);
      }
      for (let i = 0; i < M; i++) { const p = row[i]; p.d = clamp(p.d + p.v * h, -g.th * 4, g.th * 4); }
    }

    // ── 그리기 ──
    const bg = ctx.createLinearGradient(0, 0, 0, c.h);
    bg.addColorStop(0, DEEP_BG); bg.addColorStop(1, "#0b1a2e");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, c.w, c.h);
    for (const s of stars) {
      const tw = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * 1.3 + s.tw));
      ctx.fillStyle = `rgba(230, 240, 255, ${0.35 * tw})`;
      ctx.beginPath(); ctx.arc(s.u * c.w, s.v * c.h, s.r, 0, TAU); ctx.fill();
    }
    // 언덕 — 두 겹
    const hill = (yBase: number, amp: number, col: string, seed: number) => {
      ctx.beginPath(); ctx.moveTo(0, c.h);
      for (let x = 0; x <= c.w; x += 12) ctx.lineTo(x, yBase + noise2(x * 0.0022 + seed, seed) * amp);
      ctx.lineTo(c.w, c.h); ctx.closePath(); ctx.fillStyle = col; ctx.fill();
    };
    hill(c.h * 0.86, c.h * 0.05, "#0d2233", 3.1);
    hill(c.h * 0.92, c.h * 0.03, "#0a1a28", 7.7);

    // 무지개 — 바깥 줄부터 (안쪽이 위에 얹힌다)
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (let r = rows - 1; r >= 0; r--) {
      const fade = clamp(rowsShown - r, 0, 1); // 막 생기는 줄은 옅게
      const hh = hue(r, Math.max(rows, 2));
      ctx.lineWidth = g.th;
      // 그림자 줄
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.setLineDash([g.th * 1.7, g.th * 0.55]); ctx.lineDashOffset = -r * g.th * 0.6;
      ctx.beginPath();
      for (let i = 0; i < M; i++) { const [x, y] = pointAt(r, i, g); if (i === 0) ctx.moveTo(x + 3, y + 5); else ctx.lineTo(x + 3, y + 5); }
      ctx.globalAlpha = fade; ctx.stroke();
      // 본 줄 — 손그림 결: 점마다 노이즈로 살짝
      ctx.strokeStyle = `hsl(${hh} 88% 60%)`;
      ctx.beginPath();
      for (let i = 0; i < M; i++) {
        const [x, y] = pointAt(r, i, g);
        const wob = noise2(i * 0.35 + r * 9, t * 0.4) * g.th * 0.08;
        if (i === 0) ctx.moveTo(x, y + wob); else ctx.lineTo(x, y + wob);
      }
      ctx.stroke();
      // 윗면 하이라이트
      ctx.lineWidth = g.th * 0.32;
      ctx.strokeStyle = `hsla(${hh} 95% 82% / 0.55)`;
      ctx.setLineDash([g.th * 1.7, g.th * 0.55]); ctx.lineDashOffset = -r * g.th * 0.6;
      ctx.beginPath();
      for (let i = 0; i < M; i++) { const [x, y] = pointAt(r, i, g); if (i === 0) ctx.moveTo(x - 1, y - g.th * 0.22); else ctx.lineTo(x - 1, y - g.th * 0.22); }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.setLineDash([]);
  });

  return {
    start: () => loop.start(),
    stop: () => loop.stop(),
    dispose: () => loop.stop(),
    pointerDown(x, y, id) { fingers.set(id, { x, y, pressed: true, at: performance.now() }); },
    pointerMove(x, y, _dx, _dy, id, pressed) { fingers.set(id, { x, y, pressed, at: performance.now() }); },
    pointerUp(id) { const f = fingers.get(id); if (f) f.pressed = false; },
    wheel(_x, _y, delta) { rowsTarget = clamp(rowsTarget + (delta > 0 ? -1 : 1), 3, 9); },
    tilt(fx, fy) { tilt = { x: fx, y: fy }; },
    idle() { if (ripple < 0) ripple = 0; },
    clear() { build(); rowsTarget = 5; ripple = -1; },
  };
};
