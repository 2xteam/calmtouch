import { createCanvas2D, createLoop, DEEP_BG } from "@/lib/canvas/tools";
import { crackle } from "@/lib/audio/tones";
import { clamp, damp, hexToRgb255, lerp, noise2, rand, TAU } from "@/lib/util/math";
import type { EngineFactory } from "./types";

/**
 * 슬라임 — 화면 가운데에 위에서 내려다본 점성 덩어리. 지름은 화면 짧은 변의 약 3/4, **두툼하게** 쌓인 양.
 *
 *   · 가운데에 놓여 **스스로 물컹거린다** (둘레 목표 반지름에 느린 노이즈)
 *   · 누르면 **꾹 잠긴다** — 자국(dent)이 0.35초 동안 깊어지고, 그만큼 둘레가 불룩해지고, 놓으면 천천히 메워진다
 *   · 끌면 **붙어서** 늘어나고, 놓으면 튕기지 않고 **천천히 흘러** 돌아온다
 *   · 기울이면 그쪽으로 조금 늘어진다
 * 둘레 96점 · 약한 탄성 · 센 점성(이웃 속도 평균)과 감쇠 · 부피 보존 · 매 프레임 둘레 재배치.
 *
 * `params.wax` 가 true 면 **왁뿌**(왁스 뿌시기 볼) — 겉에 굳은 왁스 껍질이 있어 누르면 균열이 퍼지고
 * 조각이 떨어져 속의 슬라임이 드러난다. 껍질은 몸의 경계 상자 (u,v) 좌표에 그린 오프스크린 캔버스라
 * 몸이 늘어나면 같이 늘어난다. "지우기" 는 왁스를 다시 입힌다. 바삭 소리는 기본 꺼짐.
 */
type Node = { x: number; y: number; vx: number; vy: number };
type Finger = { x: number; y: number; vx: number; vy: number; pressed: boolean; at: number; dent: Dent; lastCrackX: number; lastCrackY: number };
type Dent = { x: number; y: number; depth: number; held: boolean };
type Crack = { u: number; v: number; rays: { ang: number; len: number; pts: [number, number][] }[]; grow: number; chipped: number };
type Chip = { pts: [number, number][]; x: number; y: number; vx: number; vy: number; rot: number; vr: number; life: number };

const WAX_RES = 640;

export const createSlimeEngine: EngineFactory = (canvas, ctx0) => {
  const c = createCanvas2D(canvas);
  const { ctx } = c;
  let hex = ctx0.color;
  const wax = ctx0.scene.params?.wax === true;
  let sound = ctx0.sound;

  const N = 96;
  let nodes: Node[] = [];
  let radius = 100;
  let restArea = 0;
  let restPerimeter = 0;
  let tilt = { x: 0, y: 0 };
  const bubbles: { u: number; v: number; r: number; drift: number }[] = [];
  const dents: Dent[] = [];
  const cracks: Crack[] = [];
  const chips: Chip[] = [];

  // 왁스 껍질 (u,v) 캔버스
  const waxCanvas = document.createElement("canvas");
  waxCanvas.width = WAX_RES; waxCanvas.height = WAX_RES;
  const wctx = waxCanvas.getContext("2d")!;
  const recoat = () => {
    wctx.globalCompositeOperation = "source-over";
    wctx.clearRect(0, 0, WAX_RES, WAX_RES);
    wctx.fillStyle = "#efe9dc";
    wctx.fillRect(0, 0, WAX_RES, WAX_RES);
    // 굳은 왁스의 얼룩 · 알갱이
    for (let i = 0; i < 2600; i++) {
      const x = Math.random() * WAX_RES, y = Math.random() * WAX_RES;
      wctx.fillStyle = Math.random() < 0.5 ? "rgba(255,255,255,0.35)" : "rgba(120,100,80,0.10)";
      wctx.fillRect(x, y, rand(1, 3), rand(1, 3));
    }
    for (let i = 0; i < 60; i++) {
      const g = wctx.createRadialGradient(Math.random() * WAX_RES, Math.random() * WAX_RES, 0, 0, 0, 0);
      void g;
    }
    // 가장자리로 갈수록 살짝 어둡게 — 두께감
    const edge = wctx.createRadialGradient(WAX_RES / 2, WAX_RES / 2, WAX_RES * 0.25, WAX_RES / 2, WAX_RES / 2, WAX_RES * 0.72);
    edge.addColorStop(0, "rgba(0,0,0,0)");
    edge.addColorStop(1, "rgba(80,60,40,0.22)");
    wctx.fillStyle = edge;
    wctx.fillRect(0, 0, WAX_RES, WAX_RES);
    cracks.length = 0;
    chips.length = 0;
  };
  if (wax) recoat();

  const center = () => ({ x: c.w / 2, y: c.h / 2 });

  const spawn = () => {
    nodes = [];
    radius = Math.min(c.w, c.h) * 0.38; // 지름 ≈ 짧은 변의 3/4
    const { x: cx, y: cy } = center();
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU;
      nodes.push({ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius, vx: 0, vy: 0 });
    }
    restArea = area();
    restPerimeter = TAU * radius;
    bubbles.length = 0;
    for (let i = 0; i < 34; i++) {
      const a = rand(0, TAU), rr = Math.sqrt(Math.random()) * 0.8;
      bubbles.push({ u: 0.5 + Math.cos(a) * rr * 0.5, v: 0.5 + Math.sin(a) * rr * 0.5, r: rand(2, 8), drift: rand(0, TAU) });
    }
    dents.length = 0;
    if (wax) recoat();
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
  const FINGER_R = 30;

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

  // 경계 상자 — 그리기와 (u,v) 변환에 쓴다
  let minX = 0, maxX = 1, minY = 0, maxY = 1, bw = 1, bh = 1;
  const bbox = () => {
    minX = 1e9; maxX = -1e9; minY = 1e9; maxY = -1e9;
    for (const n of nodes) { if (n.x < minX) minX = n.x; if (n.x > maxX) maxX = n.x; if (n.y < minY) minY = n.y; if (n.y > maxY) maxY = n.y; }
    bw = Math.max(1, maxX - minX); bh = Math.max(1, maxY - minY);
  };
  const toUV = (x: number, y: number) => [(x - minX) / bw, (y - minY) / bh] as const;
  const inside = (x: number, y: number) => {
    // 짝수-홀수 규칙
    let ins = false;
    for (let i = 0, j = N - 1; i < N; j = i++) {
      const a = nodes[i], b = nodes[j];
      if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y + 1e-9) + a.x) ins = !ins;
    }
    return ins;
  };

  /** 왁스에 균열을 낸다 — 누른 자리에서 방사형 6~9줄 */
  const startCrack = (x: number, y: number) => {
    const [u, v] = toUV(x, y);
    const rays: Crack["rays"] = [];
    const k = 6 + Math.floor(Math.random() * 4);
    for (let i = 0; i < k; i++) {
      const ang = (i / k) * TAU + rand(-0.25, 0.25);
      const len = rand(0.10, 0.26);
      const pts: [number, number][] = [[u, v]];
      let px = u, py = v, a = ang;
      const segs = 3 + Math.floor(Math.random() * 3);
      for (let s = 1; s <= segs; s++) {
        a += rand(-0.45, 0.45);
        const l = len / segs;
        px += Math.cos(a) * l; py += Math.sin(a) * l;
        pts.push([px, py]);
      }
      rays.push({ ang, len, pts });
    }
    cracks.push({ u, v, rays, grow: 0, chipped: 0 });
    if (sound) crackle(0.5);
  };

  /** 균열을 grow 만큼 그린다 (누른 깊이를 따라 자란다) */
  const drawCracks = () => {
    // 왁스가 남아 있는 곳에만 — 구멍(투명) 위에 균열 선이 떠 보이지 않게
    wctx.globalCompositeOperation = "source-atop";
    wctx.lineCap = "round";
    for (const cr of cracks) {
      for (const r of cr.rays) {
        const total = r.pts.length - 1;
        const upto = cr.grow * total;
        wctx.beginPath();
        wctx.moveTo(r.pts[0][0] * WAX_RES, r.pts[0][1] * WAX_RES);
        for (let i = 1; i <= total; i++) {
          const f = clamp(upto - (i - 1), 0, 1);
          if (f <= 0) break;
          const [ax, ay] = r.pts[i - 1], [bx, by] = r.pts[i];
          wctx.lineTo(lerp(ax, bx, f) * WAX_RES, lerp(ay, by, f) * WAX_RES);
        }
        wctx.strokeStyle = "rgba(70, 48, 32, 0.9)";
        wctx.lineWidth = 2.2;
        wctx.stroke();
        wctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
        wctx.lineWidth = 1;
        wctx.stroke();
      }
    }
  };

  /** 균열 사이 조각을 떼어 낸다 — 왁스 캔버스에서 지우고 조각 입자를 날린다 */
  const chipOff = (cr: Crack, rNorm: number, skip = 0.25) => {
    const k = cr.rays.length;
    let any = false;
    for (let i = 0; i < k; i++) {
      if (Math.random() < skip) continue;
      const a = cr.rays[i], b = cr.rays[(i + 1) % k];
      const pa = pointOnRay(a, rNorm), pb = pointOnRay(b, rNorm);
      const pm = pointOnRay(a, rNorm * rand(1.05, 1.35));
      const pn = pointOnRay(b, rNorm * rand(1.05, 1.35));
      const poly: [number, number][] = [[cr.u, cr.v], pa, pm, pn, pb];
      // destination-out 은 소스의 알파만큼 지운다 — 직전 fillStyle 이 반투명 그라디언트라 지워지지 않았다
      wctx.globalCompositeOperation = "destination-out";
      wctx.fillStyle = "rgb(0, 0, 0)";
      wctx.beginPath();
      poly.forEach(([px, py], j) => (j === 0 ? wctx.moveTo(px * WAX_RES, py * WAX_RES) : wctx.lineTo(px * WAX_RES, py * WAX_RES)));
      wctx.closePath();
      wctx.fill();
      wctx.globalCompositeOperation = "source-over";
      // 떨어지는 조각 (화면 좌표로)
      const sx = minX + cr.u * bw, sy = minY + cr.v * bh;
      const pts: [number, number][] = poly.map(([px, py]) => [(px - cr.u) * bw, (py - cr.v) * bh]);
      const mid = pointOnRay(a, rNorm * 0.6);
      const dir = Math.atan2(mid[1] - cr.v, mid[0] - cr.u);
      chips.push({ pts, x: sx, y: sy, vx: Math.cos(dir) * rand(40, 110), vy: Math.sin(dir) * rand(40, 110) + 60, rot: 0, vr: rand(-3, 3), life: 1 });
      any = true;
    }
    if (any && sound) crackle(0.9);
  };
  const pointOnRay = (r: Crack["rays"][number], rNorm: number): [number, number] => {
    const total = r.pts.length - 1;
    const f = clamp(rNorm / r.len, 0, 1) * total;
    const i = Math.min(total - 1, Math.floor(f));
    const t = f - i;
    const [ax, ay] = r.pts[i], [bx, by] = r.pts[i + 1];
    return [lerp(ax, bx, t), lerp(ay, by, t)];
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
    const restX = cx0 + tilt.x * radius * 0.35, restY = cy0 + tilt.y * radius * 0.35;

    // 자국 — 누르는 동안 깊어지고(0.35초), 놓으면 천천히 메워진다(약 1.5초)
    for (let i = dents.length - 1; i >= 0; i--) {
      const d = dents[i];
      if (d.held) d.depth = Math.min(1, d.depth + dt / 0.35);
      else { d.depth -= dt / 1.5; if (d.depth <= 0) { dents.splice(i, 1); continue; } }
    }
    // 왁스 균열은 자국 깊이를 따라 자라고, 깊이 문턱을 넘으면 조각이 떨어진다
    if (wax) {
      bbox();
      for (const f of fingers.values()) {
        if (!f.pressed) continue;
        const cr = cracks[cracks.length - 1];
        if (!cr) continue;
        const d = f.dent.depth;
        if (d > cr.grow) cr.grow = d;
        // 첫 문턱에서 안쪽 조각 몇 개, 끝까지 누르면 둘레 조각까지 다 떨어져 구멍이 뚫린다
        if (d > 0.45 && cr.chipped < 1) { cr.chipped = 1; chipOff(cr, 0.09); }
        if (d > 0.9 && cr.chipped < 2) { cr.chipped = 2; chipOff(cr, 0.17, 0); }
      }
      drawCracks();
      for (let i = chips.length - 1; i >= 0; i--) {
        const ch = chips[i];
        ch.life -= dt / 1.4;
        if (ch.life <= 0) { chips.splice(i, 1); continue; }
        ch.vy += 260 * dt;
        ch.vx *= damp(1.5, dt);
        ch.x += ch.vx * dt; ch.y += ch.vy * dt; ch.rot += ch.vr * dt;
      }
    }

    for (let s = 0; s < sub; s++) {
      let cx = 0, cy = 0;
      for (const n of nodes) { cx += n.x; cy += n.y; }
      cx /= N; cy /= N;
      const A = area();
      const pressureK = clamp((restArea - A) / restArea, -0.6, 0.6) * 9000;
      const restLen = restPerimeter / N;
      // 왁스 껍질이 있으면 스스로 덜 물컹거린다
      const wobbleAmp = wax ? 0.025 : 0.07;

      for (let i = 0; i < N; i++) {
        const n = nodes[i];
        const l = nodes[(i + N - 1) % N], r = nodes[(i + 1) % N];
        let ax = 0, ay = 0;
        for (const o of [l, r]) {
          const dx = o.x - n.x, dy = o.y - n.y;
          const d = Math.hypot(dx, dy) || 0.001;
          const f = (d - restLen) * 18;
          ax += (dx / d) * f; ay += (dy / d) * f;
        }
        ax += ((l.x + r.x) / 2 - n.x) * 70;
        ay += ((l.y + r.y) / 2 - n.y) * 70;
        const nx = (r.y - l.y), ny = -(r.x - l.x);
        const nl = Math.hypot(nx, ny) || 0.001;
        ax += (nx / nl) * pressureK; ay += (ny / nl) * pressureK;
        const ang = Math.atan2(n.y - cy, n.x - cx);
        const wobble = 1 + noise2(Math.cos(ang) * 1.3 + t * 0.35, Math.sin(ang) * 1.3 - t * 0.27) * wobbleAmp;
        const tx = restX + Math.cos(ang) * radius * wobble;
        const ty = restY + Math.sin(ang) * radius * wobble;
        n.vx += (tx - n.x) * 1.1 * hs;
        n.vy += (ty - n.y) * 1.1 * hs;
        // 자국 — 눌린 자리 근처 둘레가 밀려 불룩해진다 (부피가 옆으로 간다)
        for (const d of dents) {
          const dx = n.x - d.x, dy = n.y - d.y;
          const dist = Math.hypot(dx, dy) || 0.001;
          const w = Math.exp(-((dist / (radius * 0.55)) ** 2));
          ax += (dx / dist) * d.depth * 2600 * w;
          ay += (dy / dist) * d.depth * 2600 * w;
        }
        n.vx += ax * hs; n.vy += ay * hs;
      }

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

    // ── 그리기 ──
    const [R, G, B] = hexToRgb255(hex);
    const bg = ctx.createRadialGradient(c.w / 2, c.h / 2, 0, c.w / 2, c.h / 2, Math.max(c.w, c.h) * 0.75);
    bg.addColorStop(0, "#0b262e");
    bg.addColorStop(1, DEEP_BG);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, c.w, c.h);
    bbox();
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

    for (let k = 6; k >= 1; k--) {
      tracePath(k * 4, k * 7);
      ctx.fillStyle = `rgba(0, 10, 14, ${0.07 * k})`;
      ctx.fill();
    }
    for (let k = 5; k >= 1; k--) {
      tracePath(k * 1.2, k * 3.2);
      ctx.fillStyle = wax ? `rgba(120, 104, 84, 0.95)` : `rgba(${R * 0.28 | 0},${G * 0.32 | 0},${B * 0.32 | 0},0.95)`;
      ctx.fill();
    }

    tracePath();
    const bodyG = ctx.createRadialGradient(midX - bw * 0.12, midY - bh * 0.14, bw * 0.05, midX, midY, Math.max(bw, bh) * 0.6);
    bodyG.addColorStop(0, `rgba(${Math.min(255, R + 60)},${Math.min(255, G + 60)},${Math.min(255, B + 60)},0.97)`);
    bodyG.addColorStop(0.5, `rgba(${R},${G},${B},0.95)`);
    bodyG.addColorStop(0.85, `rgba(${R * 0.7 | 0},${G * 0.74 | 0},${B * 0.74 | 0},0.97)`);
    bodyG.addColorStop(1, `rgba(${R * 0.42 | 0},${G * 0.48 | 0},${B * 0.48 | 0},1)`);
    ctx.fillStyle = bodyG;
    ctx.fill();

    ctx.save();
    ctx.clip();
    // 기포 — 눌린 자리에서 밀려난다
    for (const bb of bubbles) {
      let bx = minX + bw * bb.u + Math.sin(t * 0.4 + bb.drift) * 2;
      let by = minY + bh * bb.v + Math.cos(t * 0.3 + bb.drift) * 1.5;
      for (const d of dents) {
        const dx = bx - d.x, dy = by - d.y;
        const dist = Math.hypot(dx, dy) || 0.001;
        const w = Math.exp(-((dist / (FINGER_R * 2.2)) ** 2)) * d.depth * 26;
        bx += (dx / dist) * w; by += (dy / dist) * w;
      }
      ctx.beginPath(); ctx.arc(bx, by, bb.r, 0, TAU);
      ctx.fillStyle = "rgba(255,255,255,0.10)"; ctx.fill();
      ctx.beginPath(); ctx.arc(bx - bb.r * 0.3, by - bb.r * 0.3, bb.r * 0.35, 0, TAU);
      ctx.fillStyle = "rgba(255,255,255,0.45)"; ctx.fill();
    }
    const hl = ctx.createRadialGradient(minX + bw * 0.32, minY + bh * 0.26, 0, minX + bw * 0.32, minY + bh * 0.28, bw * 0.36);
    hl.addColorStop(0, "rgba(255,255,255,0.6)");
    hl.addColorStop(0.5, "rgba(255,255,255,0.12)");
    hl.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = hl;
    ctx.fillRect(minX, minY, bw, bh);

    // 왁스 껍질 — 몸의 (u,v) 에 맞춰 늘어난다. 지워진 곳으로 속이 보인다
    if (wax) {
      ctx.globalAlpha = 0.98;
      ctx.drawImage(waxCanvas, minX, minY, bw, bh);
      ctx.globalAlpha = 1;
    }

    // 자국 — 꾹 눌린 우물: 가운데는 어둡고, 테두리는 밀려 올라와 밝다
    for (const d of dents) {
      const rr = FINGER_R * (1 + d.depth * 0.7);
      const dg = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, rr * 1.9);
      const dark = wax ? 0.22 : 0.55;
      dg.addColorStop(0, `rgba(0, 12, 16, ${dark * d.depth})`);
      dg.addColorStop(0.42, `rgba(0, 12, 16, ${dark * 0.5 * d.depth})`);
      dg.addColorStop(0.62, `rgba(255, 255, 255, ${0.22 * d.depth})`);
      dg.addColorStop(0.8, `rgba(255, 255, 255, ${0.06 * d.depth})`);
      dg.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = dg;
      ctx.fillRect(d.x - rr * 2, d.y - rr * 2, rr * 4, rr * 4);
      // 우물 안쪽 — 아래쪽 벽면에 빛
      ctx.beginPath();
      ctx.arc(d.x, d.y + rr * 0.25, rr * 0.75, Math.PI * 1.15, Math.PI * 1.85);
      ctx.strokeStyle = `rgba(255,255,255,${0.35 * d.depth})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();

    // 떨어지는 왁스 조각
    for (const ch of chips) {
      ctx.save();
      ctx.translate(ch.x, ch.y);
      ctx.rotate(ch.rot);
      ctx.globalAlpha = clamp(ch.life, 0, 1);
      ctx.beginPath();
      ch.pts.forEach(([px, py], j) => (j === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
      ctx.closePath();
      ctx.fillStyle = "#efe9dc";
      ctx.fill();
      ctx.strokeStyle = "rgba(70,48,32,0.6)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }

    tracePath();
    ctx.lineWidth = 3.5;
    const rim = ctx.createLinearGradient(minX, minY, maxX, maxY);
    rim.addColorStop(0, "rgba(255,255,255,0.7)");
    rim.addColorStop(0.5, "rgba(255,255,255,0.12)");
    rim.addColorStop(1, wax ? "rgba(90,70,50,0.85)" : `rgba(${R * 0.3 | 0},${G * 0.3 | 0},${B * 0.3 | 0},0.85)`);
    ctx.strokeStyle = rim;
    ctx.stroke();
  });

  const setFinger = (id: number, x: number, y: number, dx: number, dy: number, pressed: boolean, dt = 1 / 60) => {
    const f = fingers.get(id);
    const vx = dx / dt, vy = dy / dt;
    if (f) {
      f.x = x; f.y = y; f.vx = vx; f.vy = vy; f.pressed = pressed; f.at = performance.now();
      if (pressed) { f.dent.x = x; f.dent.y = y; }
      return f;
    }
    const dent: Dent = { x, y, depth: 0, held: pressed };
    if (pressed) dents.push(dent);
    const nf: Finger = { x, y, vx, vy, pressed, at: performance.now(), dent, lastCrackX: x, lastCrackY: y };
    fingers.set(id, nf);
    return nf;
  };

  return {
    start: () => loop.start(),
    stop: () => loop.stop(),
    dispose: () => loop.stop(),
    pointerDown(x, y, id) {
      bbox();
      const f = fingers.get(id);
      if (f) {
        // 같은 마우스가 다시 눌렀다 — 새 자국
        f.dent = { x, y, depth: 0, held: true };
        dents.push(f.dent);
        f.pressed = true; f.x = x; f.y = y; f.vx = 0; f.vy = 0; f.at = performance.now();
        f.lastCrackX = x; f.lastCrackY = y;
      } else setFinger(id, x, y, 0, 0, true);
      if (wax && inside(x, y)) startCrack(x, y);
    },
    pointerMove(x, y, dx, dy, id, pressed) {
      const sp = Math.hypot(dx, dy);
      const k = sp > 18 ? 18 / sp : 1;
      const f = setFinger(id, x, y, dx * k, dy * k, pressed);
      // 누른 채 끌면 40px 마다 새 균열 — 바삭바삭 이어진다
      if (wax && pressed && Math.hypot(x - f.lastCrackX, y - f.lastCrackY) > 40 && inside(x, y)) {
        f.lastCrackX = x; f.lastCrackY = y;
        bbox();
        startCrack(x, y);
        const cr = cracks[cracks.length - 1];
        cr.grow = 0.6; cr.chipped = 1; chipOff(cr, 0.08);
      }
    },
    pointerUp(id) {
      const f = fingers.get(id);
      if (f) { f.pressed = false; f.vx = 0; f.vy = 0; f.dent.held = false; }
      if (id !== 0) fingers.delete(id);
    },
    wheel(_x, _y, delta) {
      for (const n of nodes) n.vy -= delta * 3;
    },
    tilt(fx, fy) {
      tilt = { x: fx, y: fy };
    },
    idle() {
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
    setSound(on) {
      sound = on;
    },
  };
};
