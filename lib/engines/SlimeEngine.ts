import { createCanvas2D, createLoop, DEEP_BG } from "@/lib/canvas/tools";
import { clamp, damp, hexToRgb255, lerp, noise2, rand, TAU } from "@/lib/util/math";
import type { EngineFactory } from "./types";

/**
 * 슬라임 — 화면 가운데에 위에서 내려다본 점성 덩어리. 지름은 화면 짧은 변의 약 2/5.
 *
 * 세 번째 판(2026-09-10). 첫 판은 튕기는 젤리, 둘째 판은 탁자 위 옆모습이었는데 아래에 몰려 보였다.
 * 지금은 —
 *   · 가운데에 놓여 **스스로 물컹거린다** (둘레 목표 반지름에 느린 노이즈)
 *   · 누르면 손가락이 **잠기고** 옆이 불룩해진다 (부피 보존)
 *   · 끌면 **붙어서** 늘어나고, 놓으면 튕기지 않고 **천천히 흘러** 돌아온다
 *   · 기울이면 그쪽으로 조금 늘어진다
 * 둘레 96점 · 약한 탄성 · 센 점성(이웃 속도 평균)과 감쇠 · 매 프레임 둘레 재배치.
 */
type Node = { x: number; y: number; vx: number; vy: number };
type Finger = { x: number; y: number; vx: number; vy: number; pressed: boolean; at: number };

export const createSlimeEngine: EngineFactory = (canvas, ctx0) => {
  const c = createCanvas2D(canvas);
  const { ctx } = c;
  let hex = ctx0.color;

  const N = 96;
  let nodes: Node[] = [];
  let radius = 100;
  let restArea = 0;
  let restPerimeter = 0;
  let tilt = { x: 0, y: 0 };
  const bubbles: { u: number; v: number; r: number; drift: number }[] = [];

  const center = () => ({ x: c.w / 2, y: c.h / 2 });

  const spawn = () => {
    nodes = [];
    radius = Math.min(c.w, c.h) * 0.19;
    const { x: cx, y: cy } = center();
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU;
      nodes.push({ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius, vx: 0, vy: 0 });
    }
    restArea = area();
    restPerimeter = TAU * radius;
    bubbles.length = 0;
    for (let i = 0; i < 18; i++) {
      const a = rand(0, TAU), rr = Math.sqrt(Math.random()) * 0.8;
      bubbles.push({ u: 0.5 + Math.cos(a) * rr * 0.5, v: 0.5 + Math.sin(a) * rr * 0.5, r: rand(1.5, 5), drift: rand(0, TAU) });
    }
  };
  const area = () => {
    let s = 0;
    for (let i = 0; i < N; i++) {
      const a = nodes[i], b = nodes[(i + 1) % N];
      s += a.x * b.y - b.x * a.y;
    }
    return Math.abs(s) / 2;
  };
  spawn();

  const fingers = new Map<number, Finger>();
  const FINGER_R = 22;

  /** 현재 다각형을 따라 N 점을 같은 간격으로 다시 놓는다 — 늘어났다 돌아온 자리의 뭉침·꼬임이 사라진다 */
  const resample = () => {
    const segs: number[] = [];
    let total = 0;
    for (let i = 0; i < N; i++) {
      const a = nodes[i], b = nodes[(i + 1) % N];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      segs.push(d); total += d;
    }
    if (total < 1) return;
    const step = total / N;
    const out: Node[] = [];
    let seg = 0, along = 0;
    for (let k = 0; k < N; k++) {
      const target = k * step;
      while (along + segs[seg] < target && seg < N - 1) { along += segs[seg]; seg++; }
      const a = nodes[seg], b = nodes[(seg + 1) % N];
      const t = segs[seg] > 0 ? (target - along) / segs[seg] : 0;
      out.push({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), vx: lerp(a.vx, b.vx, t), vy: lerp(a.vy, b.vy, t) });
    }
    nodes = out;
  };

  const loop = createLoop((dt, t) => {
    if (c.resize()) spawn();
    const h = Math.min(dt, 1 / 45);
    const sub = 5;
    const hs = h / sub;
    tilt.x *= damp(1.2, dt);
    tilt.y *= damp(1.2, dt);
    const now = performance.now();
    for (const [id, f] of fingers) if (id === 0 && !f.pressed && now - f.at > 600) fingers.delete(id);
    const { x: cx0, y: cy0 } = center();
    // 기울이면 그쪽으로 조금 늘어진다
    const restX = cx0 + tilt.x * radius * 0.35, restY = cy0 + tilt.y * radius * 0.35;

    for (let s = 0; s < sub; s++) {
      let cx = 0, cy = 0;
      for (const n of nodes) { cx += n.x; cy += n.y; }
      cx /= N; cy /= N;
      const A = area();
      const pressureK = clamp((restArea - A) / restArea, -0.6, 0.6) * 9000;
      const restLen = restPerimeter / N;

      for (let i = 0; i < N; i++) {
        const n = nodes[i];
        const l = nodes[(i + N - 1) % N], r = nodes[(i + 1) % N];
        let ax = 0, ay = 0;
        // 둘레 스프링 — 약하다. 슬라임은 잘 늘어난다
        for (const o of [l, r]) {
          const dx = o.x - n.x, dy = o.y - n.y;
          const d = Math.hypot(dx, dy) || 0.001;
          const f = (d - restLen) * 18;
          ax += (dx / d) * f; ay += (dy / d) * f;
        }
        // 굽힘 — 이웃 중점으로 (매끈하게)
        ax += ((l.x + r.x) / 2 - n.x) * 70;
        ay += ((l.y + r.y) / 2 - n.y) * 70;
        // 압력 — 바깥 법선
        const nx = (r.y - l.y), ny = -(r.x - l.x);
        const nl = Math.hypot(nx, ny) || 0.001;
        ax += (nx / nl) * pressureK; ay += (ny / nl) * pressureK;
        // 느린 기어가기 — 제 모양(살짝 물컹거리는 원)으로. 속도에 직접 (튕기지 않는다)
        const ang = Math.atan2(n.y - cy, n.x - cx);
        const wobble = 1 + noise2(Math.cos(ang) * 1.3 + t * 0.35, Math.sin(ang) * 1.3 - t * 0.27) * 0.07;
        const tx = restX + Math.cos(ang) * radius * wobble;
        const ty = restY + Math.sin(ang) * radius * wobble;
        n.vx += (tx - n.x) * 1.1 * hs;
        n.vy += (ty - n.y) * 1.1 * hs;
        n.vx += ax * hs; n.vy += ay * hs;
      }

      // 손가락 — 잠기고, 붙는다
      for (const f of fingers.values()) {
        const reach = radius * 0.7;
        for (const n of nodes) {
          const dx = n.x - f.x, dy = n.y - f.y;
          const d = Math.hypot(dx, dy) || 0.001;
          if (d > reach) continue;
          const w = 1 - d / reach;
          if (f.pressed) {
            const k = w * w * 0.85;
            n.vx = lerp(n.vx, f.vx, k);
            n.vy = lerp(n.vy, f.vy, k);
          } else {
            n.vx += f.vx * w * 0.15; n.vy += f.vy * w * 0.15;
          }
          if (d < FINGER_R) {
            const push = FINGER_R - d;
            n.x += (dx / d) * push; n.y += (dy / d) * push;
            n.vx *= 0.5; n.vy *= 0.5;
          }
        }
      }

      // 이웃이 아닌 점끼리 최소 간격 — 둘레가 자기 자신과 겹치지 않게
      const minD = restLen * 0.9;
      for (let i = 0; i < N; i++) {
        const a = nodes[i];
        for (let j = i + 2; j < N; j++) {
          if (i === 0 && j === N - 1) continue;
          const b = nodes[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          if (Math.abs(dx) > minD || Math.abs(dy) > minD) continue;
          const d = Math.hypot(dx, dy) || 0.001;
          if (d >= minD) continue;
          const push = (minD - d) * 0.5;
          a.x -= (dx / d) * push; a.y -= (dy / d) * push;
          b.x += (dx / d) * push; b.y += (dy / d) * push;
        }
      }

      // 점성 — 이웃과 속도를 나눈다 (튕김이 사라지고 흐르는 느낌이 난다)
      const vxs = new Float32Array(N), vys = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const l = nodes[(i + N - 1) % N], r = nodes[(i + 1) % N], n = nodes[i];
        vxs[i] = n.vx * 0.4 + (l.vx + r.vx) * 0.3;
        vys[i] = n.vy * 0.4 + (l.vy + r.vy) * 0.3;
      }
      const dampK = Math.exp(-5.5 * hs);
      for (let i = 0; i < N; i++) {
        const n = nodes[i];
        n.vx = vxs[i] * dampK; n.vy = vys[i] * dampK;
        n.x = clamp(n.x + n.vx * hs, 6, c.w - 6);
        n.y = clamp(n.y + n.vy * hs, 6, c.h - 6);
      }
    }

    resample();
    for (let k = 0; k < 2; k++) {
      const sx = new Float32Array(N), sy = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const l = nodes[(i + N - 1) % N], r = nodes[(i + 1) % N], n = nodes[i];
        sx[i] = lerp(n.x, (l.x + r.x) / 2, 0.25); sy[i] = lerp(n.y, (l.y + r.y) / 2, 0.25);
      }
      for (let i = 0; i < N; i++) { nodes[i].x = sx[i]; nodes[i].y = sy[i]; }
    }

    // ── 그리기 (위에서 내려다본 젤) ──
    const [R, G, B] = hexToRgb255(hex);
    const bg = ctx.createRadialGradient(c.w / 2, c.h / 2, 0, c.w / 2, c.h / 2, Math.max(c.w, c.h) * 0.75);
    bg.addColorStop(0, "#0b262e");
    bg.addColorStop(1, DEEP_BG);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, c.w, c.h);

    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (const n of nodes) { if (n.x < minX) minX = n.x; if (n.x > maxX) maxX = n.x; if (n.y < minY) minY = n.y; if (n.y > maxY) maxY = n.y; }
    const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
    const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;

    const tracePath = (ox = 0, oy = 0) => {
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        const a = nodes[i], b = nodes[(i + 1) % N];
        const mx = (a.x + b.x) / 2 + ox, my = (a.y + b.y) / 2 + oy;
        if (i === 0) ctx.moveTo(mx, my); else ctx.quadraticCurveTo(a.x + ox, a.y + oy, mx, my);
      }
      const a0 = nodes[0], b0 = nodes[1];
      ctx.quadraticCurveTo(a0.x + ox, a0.y + oy, (a0.x + b0.x) / 2 + ox, (a0.y + b0.y) / 2 + oy);
      ctx.closePath();
    };

    // 그림자 — 오른쪽 아래로 살짝, 부드럽게 (같은 모양을 조금 밀어서 여러 겹)
    for (let k = 3; k >= 1; k--) {
      tracePath(k * 4, k * 6);
      ctx.fillStyle = `rgba(0, 10, 14, ${0.10 * k})`;
      ctx.fill();
    }

    // 몸 — 가운데가 살짝 밝고 가장자리가 진한 젤
    tracePath();
    const bodyG = ctx.createRadialGradient(midX - bw * 0.12, midY - bh * 0.14, bw * 0.05, midX, midY, Math.max(bw, bh) * 0.6);
    bodyG.addColorStop(0, `rgba(${Math.min(255, R + 45)},${Math.min(255, G + 45)},${Math.min(255, B + 45)},0.94)`);
    bodyG.addColorStop(0.65, `rgba(${R},${G},${B},0.9)`);
    bodyG.addColorStop(1, `rgba(${R * 0.5 | 0},${G * 0.55 | 0},${B * 0.55 | 0},0.96)`);
    ctx.fillStyle = bodyG;
    ctx.fill();

    ctx.save();
    ctx.clip();
    // 기포
    for (const bb of bubbles) {
      const bx = minX + bw * bb.u + Math.sin(t * 0.4 + bb.drift) * 2;
      const by = minY + bh * bb.v + Math.cos(t * 0.3 + bb.drift) * 1.5;
      ctx.beginPath(); ctx.arc(bx, by, bb.r, 0, TAU);
      ctx.fillStyle = "rgba(255,255,255,0.10)"; ctx.fill();
      ctx.beginPath(); ctx.arc(bx - bb.r * 0.3, by - bb.r * 0.3, bb.r * 0.35, 0, TAU);
      ctx.fillStyle = "rgba(255,255,255,0.45)"; ctx.fill();
    }
    // 큰 하이라이트 — 왼쪽 위
    const hl = ctx.createRadialGradient(minX + bw * 0.32, minY + bh * 0.26, 0, minX + bw * 0.32, minY + bh * 0.28, bw * 0.3);
    hl.addColorStop(0, "rgba(255,255,255,0.55)");
    hl.addColorStop(0.5, "rgba(255,255,255,0.12)");
    hl.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = hl;
    ctx.fillRect(minX, minY, bw, bh);
    // 손가락 자국
    for (const f of fingers.values()) {
      if (!f.pressed) continue;
      const dg = ctx.createRadialGradient(f.x, f.y, FINGER_R * 0.4, f.x, f.y, FINGER_R * 2.2);
      dg.addColorStop(0, `rgba(${R * 0.35 | 0},${G * 0.35 | 0},${B * 0.35 | 0},0.55)`);
      dg.addColorStop(0.6, "rgba(255,255,255,0.10)");
      dg.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = dg;
      ctx.fillRect(f.x - FINGER_R * 3, f.y - FINGER_R * 3, FINGER_R * 6, FINGER_R * 6);
    }
    ctx.restore();

    // 가장자리 — 왼쪽 위는 얇은 빛, 오른쪽 아래는 진한 선
    tracePath();
    ctx.lineWidth = 2;
    const rim = ctx.createLinearGradient(minX, minY, maxX, maxY);
    rim.addColorStop(0, "rgba(255,255,255,0.7)");
    rim.addColorStop(0.5, "rgba(255,255,255,0.12)");
    rim.addColorStop(1, `rgba(${R * 0.3 | 0},${G * 0.3 | 0},${B * 0.3 | 0},0.85)`);
    ctx.strokeStyle = rim;
    ctx.stroke();
  });

  const setFinger = (id: number, x: number, y: number, dx: number, dy: number, pressed: boolean, dt = 1 / 60) => {
    const f = fingers.get(id);
    const vx = dx / dt, vy = dy / dt;
    if (f) { f.x = x; f.y = y; f.vx = vx; f.vy = vy; f.pressed = pressed; f.at = performance.now(); }
    else fingers.set(id, { x, y, vx, vy, pressed, at: performance.now() });
  };

  return {
    start: () => loop.start(),
    stop: () => loop.stop(),
    dispose: () => loop.stop(),
    pointerDown(x, y, id) {
      setFinger(id, x, y, 0, 0, true);
    },
    pointerMove(x, y, dx, dy, id, pressed) {
      const sp = Math.hypot(dx, dy);
      const k = sp > 18 ? 18 / sp : 1;
      setFinger(id, x, y, dx * k, dy * k, pressed);
    },
    pointerUp(id) {
      const f = fingers.get(id);
      if (f) { f.pressed = false; f.vx = 0; f.vy = 0; }
      if (id !== 0) fingers.delete(id);
    },
    wheel(_x, _y, delta) {
      for (const n of nodes) n.vy -= delta * 3;
    },
    tilt(fx, fy) {
      tilt = { x: fx, y: fy };
    },
    idle() {
      // 저절로 한 번 물컹 — 한쪽을 살짝 밀어 넣는다
      const i = Math.floor(Math.random() * N);
      const n = nodes[i];
      const { x: cx, y: cy } = center();
      const d = Math.hypot(n.x - cx, n.y - cy) || 1;
      n.vx -= ((n.x - cx) / d) * 120; n.vy -= ((n.y - cy) / d) * 120;
    },
    clear() {
      spawn();
    },
    setColor(h) {
      hex = h;
    },
  };
};
