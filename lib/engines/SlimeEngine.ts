import { createCanvas2D, createLoop, DEEP_BG } from "@/lib/canvas/tools";
import { clamp, damp, hexToRgb255, lerp, rand, TAU } from "@/lib/util/math";
import type { EngineFactory } from "./types";

/**
 * 슬라임 — 탁자 위에 놓인 점성 덩어리.
 *
 * 첫 판은 스프링으로 묶은 공이어서 "튕기는 젤리" 였다(2026-09-10 사용자 지적). 진짜 슬라임은
 *   · 무거워서 바닥에 퍼져 있고,
 *   · 누르면 손가락이 **잠기고** 옆이 불룩해지며,
 *   · 손에 **붙어서** 끌면 가늘게 늘어나고,
 *   · 놓으면 튕기지 않고 **천천히 흘러** 제 모양으로 돌아온다.
 * 그래서 둘레 96점을 두고 — 탄성은 약하게, 점성(이웃 속도 평균) 과 감쇠는 세게, 부피 보존은 강하게,
 * 바닥 접촉은 마찰 크게. 복원은 스프링이 아니라 "느린 기어가기" 로.
 *
 * 겉은 반투명 젤 — 위쪽 넓은 하이라이트, 윗가장자리 얇은 빛, 안에 갇힌 기포, 바닥 그림자.
 */
type Node = { x: number; y: number; vx: number; vy: number; rx: number; ry: number };
type Finger = { x: number; y: number; vx: number; vy: number; pressed: boolean; at: number };

export const createSlimeEngine: EngineFactory = (canvas, ctx0) => {
  const c = createCanvas2D(canvas);
  const { ctx } = c;
  let hex = ctx0.color;

  const N = 96;
  const nodes: Node[] = [];
  let floorY = 0;
  let radius = 100;
  let restArea = 0;
  let restPerimeter = 0;
  let tiltX = 0;
  const bubbles: { u: number; v: number; r: number; drift: number }[] = [];

  const spawn = () => {
    nodes.length = 0;
    radius = Math.min(c.w, c.h) * 0.24;
    floorY = c.h * 0.78;
    const cx = c.w / 2;
    const cy = floorY - radius * 0.62;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU;
      // 납작한 타원 — 이미 퍼져 있는 모양
      const rx = Math.cos(a) * radius * 1.15;
      const ry = Math.sin(a) * radius * 0.62;
      nodes.push({ x: cx + rx, y: Math.min(cy + ry, floorY), vx: 0, vy: 0, rx, ry });
    }
    restArea = area();
    restPerimeter = 0;
    for (let i = 0; i < N; i++) {
      const a = nodes[i], b = nodes[(i + 1) % N];
      restPerimeter += Math.hypot(b.x - a.x, b.y - a.y);
    }
    bubbles.length = 0;
    for (let i = 0; i < 16; i++) bubbles.push({ u: rand(0.12, 0.88), v: rand(0.2, 0.9), r: rand(1.5, 5), drift: rand(0, TAU) });
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
  const FINGER_R = 20;

  /** 현재 다각형을 따라 N 점을 같은 간격으로 다시 놓는다. 속도는 선형 보간 */
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
      out.push({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), vx: lerp(a.vx, b.vx, t), vy: lerp(a.vy, b.vy, t), rx: a.rx, ry: a.ry });
    }
    for (let i = 0; i < N; i++) nodes[i] = out[i];
  };

  const loop = createLoop((dt, t) => {
    if (c.resize()) spawn();
    const h = Math.min(dt, 1 / 45);
    const sub = 5;
    const hs = h / sub;
    tiltX *= damp(1.5, dt);
    const now = performance.now();
    for (const [id, f] of fingers) if (id === 0 && !f.pressed && now - f.at > 600) fingers.delete(id);

    for (let s = 0; s < sub; s++) {
      let cx = 0, cy = 0;
      for (const n of nodes) { cx += n.x; cy += n.y; }
      cx /= N; cy /= N;
      const A = area();
      // 부피 보존 — 눌리면 옆으로 불룩. 강하게
      const pressureK = clamp((restArea - A) / restArea, -0.6, 0.6) * 9000;
      const restLen = restPerimeter / N;

      for (let i = 0; i < N; i++) {
        const n = nodes[i];
        const l = nodes[(i + N - 1) % N], r = nodes[(i + 1) % N];
        let ax = tiltX * 260;
        let ay = 650; // 무겁다

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
        // 느린 기어가기 — 제 모양(납작한 타원)으로. 스프링이 아니라 속도에 직접 (튕기지 않는다)
        const ang = Math.atan2(n.y - cy, n.x - cx);
        const tx = c.w / 2 + Math.cos(ang) * radius * 1.15;
        const ty = Math.min(floorY - radius * 0.62 + Math.sin(ang) * radius * 0.62, floorY);
        n.vx += (tx - n.x) * 0.9 * hs;
        n.vy += (ty - n.y) * 0.9 * hs;

        n.vx += ax * hs; n.vy += ay * hs;
      }

      // 손가락 — 잠기고, 붙는다
      for (const f of fingers.values()) {
        const reach = radius * 0.6;
        for (const n of nodes) {
          const dx = n.x - f.x, dy = n.y - f.y;
          const d = Math.hypot(dx, dy) || 0.001;
          if (d > reach) continue;
          const w = (1 - d / reach);
          if (f.pressed) {
            // 붙어서 손을 따라온다 (가까울수록 세게)
            const k = w * w * 0.85;
            n.vx = lerp(n.vx, f.vx, k);
            n.vy = lerp(n.vy, f.vy, k);
          } else {
            // 누르지 않은 마우스는 살짝 스치기만
            n.vx += f.vx * w * 0.15; n.vy += f.vy * w * 0.15;
          }
          // 손가락 몸통 안으로는 못 들어온다 — 잠긴 자리(dent)
          if (d < FINGER_R) {
            const push = FINGER_R - d;
            n.x += (dx / d) * push; n.y += (dy / d) * push;
            n.vx *= 0.5; n.vy *= 0.5;
          }
        }
      }

      // 이웃이 아닌 점끼리 최소 간격 — 바닥에 쌓일 때 둘레가 자기 자신과 겹쳐 고리가 생기지 않게
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
        n.x += n.vx * hs; n.y += n.vy * hs;
        // 바닥 — 붙고 마찰이 크다
        if (n.y > floorY) { n.y = floorY; n.vy = 0; n.vx *= 0.6; }
        n.x = clamp(n.x, 6, c.w - 6);
        n.y = Math.max(n.y, 6);
      }
    }

    // 둘레를 호 길이 기준으로 고르게 다시 배치 — 늘어났다 돌아온 자리의 뭉침·꼬임이 사라진다
    resample();
    // 위치 스무딩 — 울퉁불퉁한 봉우리를 눌러 매끈한 곡선으로
    for (let k = 0; k < 2; k++) {
      const sx = new Float32Array(N), sy = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const l = nodes[(i + N - 1) % N], r = nodes[(i + 1) % N], n = nodes[i];
        sx[i] = lerp(n.x, (l.x + r.x) / 2, 0.25); sy[i] = lerp(n.y, (l.y + r.y) / 2, 0.25);
      }
      for (let i = 0; i < N; i++) { nodes[i].x = sx[i]; nodes[i].y = Math.min(sy[i], floorY); }
    }

    // ── 그리기 ──
    const [R, G, B] = hexToRgb255(hex);
    const bg = ctx.createLinearGradient(0, 0, 0, c.h);
    bg.addColorStop(0, "#0b262e");
    bg.addColorStop(0.78, DEEP_BG);
    bg.addColorStop(0.781, "#0d2a32");
    bg.addColorStop(1, "#071c22");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, c.w, c.h);
    // 탁자 면 — 아주 옅은 빛
    const tg = ctx.createLinearGradient(0, floorY, 0, c.h);
    tg.addColorStop(0, "rgba(95,184,201,0.10)");
    tg.addColorStop(1, "rgba(95,184,201,0)");
    ctx.fillStyle = tg;
    ctx.fillRect(0, floorY, c.w, c.h - floorY);

    // 경계 상자 · 중심
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (const n of nodes) { if (n.x < minX) minX = n.x; if (n.x > maxX) maxX = n.x; if (n.y < minY) minY = n.y; if (n.y > maxY) maxY = n.y; }
    const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
    const midX = (minX + maxX) / 2;

    // 바닥 그림자 · 비침
    const sg = ctx.createRadialGradient(midX, floorY + 4, 0, midX, floorY + 4, bw * 0.55);
    sg.addColorStop(0, `rgba(${R * 0.2 | 0},${G * 0.25 | 0},${B * 0.25 | 0},0.55)`);
    sg.addColorStop(1, "rgba(0,10,14,0)");
    ctx.save();
    ctx.translate(midX, floorY + 4); ctx.scale(1, 0.18); ctx.translate(-midX, -(floorY + 4));
    ctx.fillStyle = sg;
    ctx.fillRect(midX - bw, floorY + 4 - bw, bw * 2, bw * 2);
    ctx.restore();

    // 몸 — 부드러운 폐곡선
    const tracePath = () => {
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        const a = nodes[i], b = nodes[(i + 1) % N];
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        if (i === 0) ctx.moveTo(mx, my); else ctx.quadraticCurveTo(a.x, a.y, mx, my);
      }
      const a0 = nodes[0], b0 = nodes[1];
      ctx.quadraticCurveTo(a0.x, a0.y, (a0.x + b0.x) / 2, (a0.y + b0.y) / 2);
      ctx.closePath();
    };
    tracePath();
    const bodyG = ctx.createLinearGradient(0, minY, 0, maxY);
    bodyG.addColorStop(0, `rgba(${Math.min(255, R + 40)},${Math.min(255, G + 40)},${Math.min(255, B + 40)},0.92)`);
    bodyG.addColorStop(0.55, `rgba(${R},${G},${B},0.86)`);
    bodyG.addColorStop(1, `rgba(${R * 0.55 | 0},${G * 0.6 | 0},${B * 0.6 | 0},0.95)`);
    ctx.fillStyle = bodyG;
    ctx.fill();

    // 안쪽 — 클립해서 기포 · 하이라이트 · 손가락 자국
    ctx.save();
    ctx.clip();
    // 깊이 — 가장자리로 갈수록 진하게 (안쪽이 밝은 젤)
    const inner = ctx.createRadialGradient(midX, minY + bh * 0.45, bh * 0.1, midX, minY + bh * 0.5, bw * 0.55);
    inner.addColorStop(0, "rgba(255,255,255,0.10)");
    inner.addColorStop(0.7, "rgba(0,0,0,0)");
    inner.addColorStop(1, `rgba(${R * 0.3 | 0},${G * 0.3 | 0},${B * 0.3 | 0},0.45)`);
    ctx.fillStyle = inner;
    ctx.fillRect(minX, minY, bw, bh);
    // 기포 — 몸이 늘어나면 같이 늘어난다
    for (const bb of bubbles) {
      const bx = minX + bw * bb.u + Math.sin(t * 0.4 + bb.drift) * 2;
      const by = minY + bh * bb.v + Math.cos(t * 0.3 + bb.drift) * 1.5;
      ctx.beginPath(); ctx.arc(bx, by, bb.r, 0, TAU);
      ctx.fillStyle = "rgba(255,255,255,0.10)"; ctx.fill();
      ctx.beginPath(); ctx.arc(bx - bb.r * 0.3, by - bb.r * 0.3, bb.r * 0.35, 0, TAU);
      ctx.fillStyle = "rgba(255,255,255,0.45)"; ctx.fill();
    }
    // 큰 하이라이트 — 왼쪽 위
    const hl = ctx.createRadialGradient(minX + bw * 0.3, minY + bh * 0.22, 0, minX + bw * 0.3, minY + bh * 0.25, bw * 0.28);
    hl.addColorStop(0, "rgba(255,255,255,0.55)");
    hl.addColorStop(0.5, "rgba(255,255,255,0.12)");
    hl.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = hl;
    ctx.fillRect(minX, minY, bw, bh);
    // 손가락 자국 — 눌린 자리는 진하고 둘레가 밝다
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

    // 윗가장자리 얇은 빛 · 아래 가장자리 진한 선
    tracePath();
    ctx.lineWidth = 2;
    const rim = ctx.createLinearGradient(0, minY, 0, maxY);
    rim.addColorStop(0, "rgba(255,255,255,0.75)");
    rim.addColorStop(0.35, "rgba(255,255,255,0.15)");
    rim.addColorStop(1, `rgba(${R * 0.3 | 0},${G * 0.3 | 0},${B * 0.3 | 0},0.8)`);
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
      // 속도는 너무 크지 않게 — 슬라임은 손을 완전히 따라오지 못한다
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
      // 위로 밀면 살짝 들린다
      for (const n of nodes) n.vy -= delta * 3;
    },
    tilt(fx) {
      tiltX = fx;
    },
    idle() {
      // 저절로 아주 조금 출렁 — 살아 있다는 신호
      const i = Math.floor(Math.random() * N);
      nodes[i].vy -= 90;
    },
    clear() {
      spawn();
    },
    setColor(h) {
      hex = h;
    },
  };
};
