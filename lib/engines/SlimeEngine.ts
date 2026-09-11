import { createCanvas2D, createLoop, DEEP_BG } from "@/lib/canvas/tools";
import { crackle } from "@/lib/audio/tones";
import { clamp, damp, hexToRgb255, lerp, noise2, rand, TAU } from "@/lib/util/math";
import type { EngineFactory } from "./types";

/**
 * 슬라임 · 왁뿌 — 화면 가운데에 위에서 내려다본 덩어리. 재질이 둘이다.
 *
 * **슬라임** (`params.clay` 없음): 점성 액체가 고인 두터움. 가운데가 두껍고 가장자리로 얇아지는 돔 —
 *   두께는 색의 농도·투명도·가장자리 안쪽의 부드러운 어둠(메니스커스)으로 읽힌다. 스스로 물컹거리고,
 *   누르면 우물이 생기며 둘레가 불룩해지고, 끌면 붙어 늘어나고, 놓으면 천천히 흘러 제 모양으로 돌아온다.
 *
 * **점토** (`params.clay`): 왁뿌 속살. 제 모양으로 돌아가지 않는다 — 누른 자국도, 끌어 바꾼 윤곽도 그대로 남는다.
 *   불투명하고 무광이며 기포가 없다.
 *
 * **왁스 껍질** (`params.wax`): 굳은 왁스가 덮고 있다. 꾹 누르면 균열이 자국 깊이를 따라 자라고 문턱을 넘으면
 *   조각이 떨어져 속이 드러난다. 그 뒤 **문지르면(누른 채 끌기) 남은 왁스가 부서져 속살에 섞인다** —
 *   문지른 거리(knead)가 쌓일수록 섞임(mix)이 커져 왁스 결이 흐려지고 속살 색이 왁스 쪽으로 옅어지며,
 *   다 섞이면 왁스는 남지 않는다. "지우기" 가 왁스를 다시 입힌다.
 */
type Node = { x: number; y: number; vx: number; vy: number };
type Finger = { x: number; y: number; vx: number; vy: number; pressed: boolean; at: number; dent: Dent; lastCrackX: number; lastCrackY: number };
/** through: 바닥까지 눌려 뚫린 정도 0~1 — 손을 떼면 슬라임이 흘러 메운다 */
type Dent = { x: number; y: number; depth: number; held: boolean; through: number };
type Crack = { u: number; v: number; rays: { len: number; pts: [number, number][] }[]; grow: number; chipped: number };
type Chip = { pts: [number, number][]; x: number; y: number; vx: number; vy: number; rot: number; vr: number; life: number };

const TEX = 640;
const WAX_RGB: [number, number, number] = [239, 233, 220];

export const createSlimeEngine: EngineFactory = (canvas, ctx0) => {
  const c = createCanvas2D(canvas);
  const { ctx } = c;
  let hex = ctx0.color;
  const wax = ctx0.scene.params?.wax === true;
  const clay = ctx0.scene.params?.clay === true;
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
  /** 왁스 섞임 0~1 — 문지른 거리로 오른다. 1 이면 왁스가 없다 */
  let mix = 0;
  let knead = 0;

  const waxCanvas = document.createElement("canvas");
  waxCanvas.width = TEX; waxCanvas.height = TEX;
  const wctx = waxCanvas.getContext("2d")!;
  const marble = document.createElement("canvas");
  marble.width = TEX; marble.height = TEX;
  const mctx = marble.getContext("2d")!;

  const recoat = () => {
    wctx.globalCompositeOperation = "source-over";
    wctx.clearRect(0, 0, TEX, TEX);
    wctx.fillStyle = `rgb(${WAX_RGB.join(",")})`;
    wctx.fillRect(0, 0, TEX, TEX);
    for (let i = 0; i < 2600; i++) {
      wctx.fillStyle = Math.random() < 0.5 ? "rgba(255,255,255,0.35)" : "rgba(120,100,80,0.10)";
      wctx.fillRect(Math.random() * TEX, Math.random() * TEX, rand(1, 3), rand(1, 3));
    }
    const edge = wctx.createRadialGradient(TEX / 2, TEX / 2, TEX * 0.25, TEX / 2, TEX / 2, TEX * 0.72);
    edge.addColorStop(0, "rgba(0,0,0,0)");
    edge.addColorStop(1, "rgba(80,60,40,0.22)");
    wctx.fillStyle = edge;
    wctx.fillRect(0, 0, TEX, TEX);
    mctx.globalCompositeOperation = "source-over";
    mctx.clearRect(0, 0, TEX, TEX);
    cracks.length = 0;
    chips.length = 0;
    mix = 0;
    knead = 0;
  };
  if (wax) recoat();

  const center = () => ({ x: c.w / 2, y: c.h / 2 });

  const spawn = () => {
    nodes = [];
    radius = Math.min(c.w, c.h) * 0.38;
    const { x: cx, y: cy } = center();
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU;
      nodes.push({ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius, vx: 0, vy: 0 });
    }
    restArea = area();
    restPerimeter = TAU * radius;
    bubbles.length = 0;
    const nb = clay ? 0 : 34;
    for (let i = 0; i < nb; i++) {
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

  let minX = 0, maxX = 1, minY = 0, maxY = 1, bw = 1, bh = 1;
  const bbox = () => {
    minX = 1e9; maxX = -1e9; minY = 1e9; maxY = -1e9;
    for (const n of nodes) { if (n.x < minX) minX = n.x; if (n.x > maxX) maxX = n.x; if (n.y < minY) minY = n.y; if (n.y > maxY) maxY = n.y; }
    bw = Math.max(1, maxX - minX); bh = Math.max(1, maxY - minY);
  };
  const toUV = (x: number, y: number) => [(x - minX) / bw, (y - minY) / bh] as const;
  const inside = (x: number, y: number) => {
    let ins = false;
    for (let i = 0, j = N - 1; i < N; j = i++) {
      const a = nodes[i], b = nodes[j];
      if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y + 1e-9) + a.x) ins = !ins;
    }
    return ins;
  };

  // ── 왁스 ──
  const startCrack = (x: number, y: number) => {
    const [u, v] = toUV(x, y);
    const rays: Crack["rays"] = [];
    const k = 6 + Math.floor(Math.random() * 4);
    for (let i = 0; i < k; i++) {
      let a = (i / k) * TAU + rand(-0.25, 0.25);
      const len = rand(0.10, 0.26);
      const pts: [number, number][] = [[u, v]];
      let px = u, py = v;
      const segs = 3 + Math.floor(Math.random() * 3);
      for (let s = 1; s <= segs; s++) {
        a += rand(-0.45, 0.45);
        px += Math.cos(a) * (len / segs); py += Math.sin(a) * (len / segs);
        pts.push([px, py]);
      }
      rays.push({ len, pts });
    }
    cracks.push({ u, v, rays, grow: 0, chipped: 0 });
    if (sound) crackle(0.5);
  };
  const drawCracks = () => {
    wctx.globalCompositeOperation = "source-atop"; // 왁스가 남은 곳에만
    wctx.lineCap = "round";
    for (const cr of cracks) {
      for (const r of cr.rays) {
        const total = r.pts.length - 1;
        const upto = cr.grow * total;
        wctx.beginPath();
        wctx.moveTo(r.pts[0][0] * TEX, r.pts[0][1] * TEX);
        for (let i = 1; i <= total; i++) {
          const f = clamp(upto - (i - 1), 0, 1);
          if (f <= 0) break;
          const [ax, ay] = r.pts[i - 1], [bx, by] = r.pts[i];
          wctx.lineTo(lerp(ax, bx, f) * TEX, lerp(ay, by, f) * TEX);
        }
        wctx.strokeStyle = "rgba(70, 48, 32, 0.9)"; wctx.lineWidth = 2.2; wctx.stroke();
        wctx.strokeStyle = "rgba(255, 255, 255, 0.35)"; wctx.lineWidth = 1; wctx.stroke();
      }
    }
    wctx.globalCompositeOperation = "source-over";
  };
  const pointOnRay = (r: Crack["rays"][number], rNorm: number): [number, number] => {
    const total = r.pts.length - 1;
    const f = clamp(rNorm / r.len, 0, 1) * total;
    const i = Math.min(total - 1, Math.floor(f));
    const t = f - i;
    const [ax, ay] = r.pts[i], [bx, by] = r.pts[i + 1];
    return [lerp(ax, bx, t), lerp(ay, by, t)];
  };
  const eraseWax = (poly: [number, number][]) => {
    wctx.globalCompositeOperation = "destination-out";
    wctx.fillStyle = "rgb(0, 0, 0)"; // destination-out 은 소스 알파만큼 지운다 — 불투명이라야 한다
    wctx.beginPath();
    poly.forEach(([px, py], j) => (j === 0 ? wctx.moveTo(px * TEX, py * TEX) : wctx.lineTo(px * TEX, py * TEX)));
    wctx.closePath();
    wctx.fill();
    wctx.globalCompositeOperation = "source-over";
  };
  const chipOff = (cr: Crack, rNorm: number, skip = 0.25) => {
    const k = cr.rays.length;
    let any = false;
    for (let i = 0; i < k; i++) {
      if (Math.random() < skip) continue;
      const a = cr.rays[i], b = cr.rays[(i + 1) % k];
      const pa = pointOnRay(a, rNorm), pb = pointOnRay(b, rNorm);
      const pm = pointOnRay(a, rNorm * rand(1.05, 1.35)), pn = pointOnRay(b, rNorm * rand(1.05, 1.35));
      const poly: [number, number][] = [[cr.u, cr.v], pa, pm, pn, pb];
      eraseWax(poly);
      // 떨어져 나간 조각은 날아가지 않고 **그 자리에 얹힌다** — 조금 밀리고 돌아간 채로. 문지르면 점토에 갈려 섞인다
      const mid = pointOnRay(a, rNorm * 0.6);
      const dir = Math.atan2(mid[1] - cr.v, mid[0] - cr.u);
      const shift = rNorm * rand(0.15, 0.45);
      mctx.save();
      mctx.globalCompositeOperation = "source-over";
      mctx.translate((cr.u + Math.cos(dir) * shift) * TEX, (cr.v + Math.sin(dir) * shift) * TEX);
      mctx.rotate(rand(-0.5, 0.5));
      mctx.fillStyle = `rgba(${WAX_RGB.join(",")}, 0.96)`;
      mctx.beginPath();
      poly.forEach(([px, py], j) => (j === 0 ? mctx.moveTo((px - cr.u) * TEX, (py - cr.v) * TEX) : mctx.lineTo((px - cr.u) * TEX, (py - cr.v) * TEX)));
      mctx.closePath();
      mctx.fill();
      mctx.strokeStyle = "rgba(70,48,32,0.5)"; mctx.lineWidth = 1.5; mctx.stroke();
      mctx.restore();
      any = true;
    }
    if (any && sound) crackle(0.9);
  };
  /** 문지르기 — 손가락 아래 왁스가 잔조각으로 부서져 속살에 섞인다 */
  const kneadAt = (x: number, y: number, dx: number, dy: number) => {
    const [u, v] = toUV(x, y);
    knead += Math.hypot(dx, dy);
    const before = mix;
    mix = clamp(knead / (radius * 28), 0, 1);
    const r = (FINGER_R * 1.15) / bw;
    for (let i = 0; i < 4; i++) {
      const ox = u + rand(-r, r) * 0.7, oy = v + rand(-r, r) * 0.7 * (bw / bh);
      const rr = r * rand(0.35, 0.7);
      wctx.globalCompositeOperation = "destination-out";
      wctx.fillStyle = "rgba(0,0,0,0.5)";
      wctx.beginPath(); wctx.ellipse(ox * TEX, oy * TEX, rr * TEX, rr * TEX * (bw / bh), 0, 0, TAU); wctx.fill();
      wctx.globalCompositeOperation = "source-over";
    }
    const ang = Math.atan2(dy, dx);
    // 손가락 아래 놓인 조각을 갈아 낸다 — 국소적으로 옅어지며 결로 번진다
    mctx.globalCompositeOperation = "destination-out";
    mctx.fillStyle = "rgba(0,0,0,0.22)";
    mctx.beginPath(); mctx.ellipse(u * TEX, v * TEX, r * TEX * 1.5, r * TEX * 1.5 * (bw / bh), 0, 0, TAU); mctx.fill();
    mctx.globalCompositeOperation = "source-over";
    mctx.fillStyle = `rgba(${WAX_RGB.join(",")}, ${0.35 * (1 - mix)})`;
    mctx.save();
    mctx.translate(u * TEX, v * TEX); mctx.rotate(ang);
    mctx.beginPath(); mctx.ellipse(0, 0, r * TEX * 1.4, r * TEX * 0.45, 0, 0, TAU); mctx.fill();
    mctx.restore();
    mctx.globalCompositeOperation = "destination-out";
    mctx.fillStyle = `rgba(0,0,0,${clamp((mix - before) * 6, 0, 0.08)})`;
    mctx.fillRect(0, 0, TEX, TEX);
    mctx.globalCompositeOperation = "source-over";
    if (sound && Math.random() < 0.06) crackle(0.25);
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

    // 자국 — 슬라임은 놓으면 1.5초에 메워지고, 점토는 그대로 남는다(아주 천천히만 무뎌진다)
    for (let i = dents.length - 1; i >= 0; i--) {
      const d = dents[i];
      if (d.held) {
        d.depth = Math.min(1, d.depth + dt / 0.35);
        // 다 잠긴 뒤에도 누르고 있으면 바닥에 닿아 구멍이 난다
        if (d.depth >= 1) d.through = Math.min(1, d.through + dt / 0.55);
      } else if (!clay) {
        d.depth -= dt / 2.5; d.through = Math.max(0, d.through - dt / 1.6);
        if (d.depth <= 0 && d.through <= 0) { dents.splice(i, 1); continue; }
      }
    }
    if (clay && dents.length > 40) dents.splice(0, dents.length - 40);

    if (wax) {
      bbox();
      for (const f of fingers.values()) {
        if (!f.pressed) continue;
        const cr = cracks[cracks.length - 1];
        if (!cr) continue;
        const d = f.dent.depth;
        if (d > cr.grow) cr.grow = d;
        if (d > 0.45 && cr.chipped < 1) { cr.chipped = 1; chipOff(cr, 0.09); }
        if (d > 0.9 && cr.chipped < 2) { cr.chipped = 2; chipOff(cr, 0.17, 0); }
      }
      drawCracks();
      for (let i = chips.length - 1; i >= 0; i--) {
        const ch = chips[i];
        ch.life -= dt / 1.4;
        if (ch.life <= 0) { chips.splice(i, 1); continue; }
        ch.vy += 260 * dt; ch.vx *= damp(1.5, dt);
        ch.x += ch.vx * dt; ch.y += ch.vy * dt; ch.rot += ch.vr * dt;
      }
    }

    // 점토는 손이 닿아 있을 때만 움직인다. 떼면 그 모양 그대로 굳는다 — 흐느적거림이 없다
    const touching = [...fingers.values()].some((f) => f.pressed);
    const simSteps = clay && !touching ? 0 : sub;
    if (clay && !touching) for (const n of nodes) { n.vx = 0; n.vy = 0; }

    for (let s = 0; s < simSteps; s++) {
      let cx = 0, cy = 0;
      for (const n of nodes) { cx += n.x; cy += n.y; }
      cx /= N; cy /= N;
      const A = area();
      const pressureK = clamp((restArea - A) / restArea, -0.6, 0.6) * (clay ? 3000 : 9000);
      const restLen = restPerimeter / N;
      const wobbleAmp = clay ? 0 : wax ? 0.025 : 0.04;

      for (let i = 0; i < N; i++) {
        const n = nodes[i];
        const l = nodes[(i + N - 1) % N], r = nodes[(i + 1) % N];
        let ax = 0, ay = 0;
        const springK = clay ? 6 : 18, bendK = clay ? 14 : 70;
        for (const o of [l, r]) {
          const dx = o.x - n.x, dy = o.y - n.y;
          const d = Math.hypot(dx, dy) || 0.001;
          ax += (dx / d) * (d - restLen) * springK; ay += (dy / d) * (d - restLen) * springK;
        }
        ax += ((l.x + r.x) / 2 - n.x) * bendK;
        ay += ((l.y + r.y) / 2 - n.y) * bendK;
        const nx = (r.y - l.y), ny = -(r.x - l.x);
        const nl = Math.hypot(nx, ny) || 0.001;
        ax += (nx / nl) * pressureK; ay += (ny / nl) * pressureK;
        if (clay) {
          // 점토 — 모양 기억이 없다. 무게중심만 화면 가운데로 아주 약하게
          void restX; void restY; void cx; void cy;
        } else {
          const ang = Math.atan2(n.y - cy, n.x - cx);
          const wobble = 1 + noise2(Math.cos(ang) * 1.3 + t * 0.35, Math.sin(ang) * 1.3 - t * 0.27) * wobbleAmp;
          const tx = restX + Math.cos(ang) * radius * wobble;
          const ty = restY + Math.sin(ang) * radius * wobble;
          n.vx += (tx - n.x) * 0.7 * hs; n.vy += (ty - n.y) * 0.7 * hs;
        }
        for (const d of dents) {
          const dx = n.x - d.x, dy = n.y - d.y;
          const dist = Math.hypot(dx, dy) || 0.001;
          const w = Math.exp(-((dist / (radius * 0.55)) ** 2));
          ax += (dx / dist) * d.depth * 2600 * w; ay += (dy / dist) * d.depth * 2600 * w;
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
          if (f.pressed) { const k = w * w * 0.85; n.vx = lerp(n.vx, f.vx, k); n.vy = lerp(n.vy, f.vy, k); }
          else { n.vx += f.vx * w * 0.15; n.vy += f.vy * w * 0.15; }
          if (d < FINGER_R) { const push = FINGER_R - d; n.x += (dx / d) * push; n.y += (dy / d) * push; n.vx *= 0.5; n.vy *= 0.5; }
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
        vxs[i] = n.vx * 0.2 + (l.vx + r.vx) * 0.4; vys[i] = n.vy * 0.2 + (l.vy + r.vy) * 0.4;
      }
      const dampK = Math.exp(-(clay ? 26 : 10) * hs); // 슬라임 점도 ↑ (2026-09-11 사용자: 너무 흐느적)
      for (let i = 0; i < N; i++) {
        const n = nodes[i];
        n.vx = vxs[i] * dampK; n.vy = vys[i] * dampK;
        n.x = clamp(n.x + n.vx * hs, 6, c.w - 6); n.y = clamp(n.y + n.vy * hs, 6, c.h - 6);
      }
    }

    if (simSteps > 0) {
      resample();
      const passes = clay ? 1 : 2, amt = clay ? 0.12 : 0.25;
      for (let k = 0; k < passes; k++) {
        const sx = new Float32Array(N), sy = new Float32Array(N);
        for (let i = 0; i < N; i++) {
          const l = nodes[(i + N - 1) % N], r = nodes[(i + 1) % N], n = nodes[i];
          sx[i] = lerp(n.x, (l.x + r.x) / 2, amt); sy[i] = lerp(n.y, (l.y + r.y) / 2, amt);
        }
        for (let i = 0; i < N; i++) { nodes[i].x = sx[i]; nodes[i].y = sy[i]; }
      }
    }

    // ── 그리기 ──
    const base = hexToRgb255(hex);
    // 왁스가 섞이면 속살 색이 왁스 쪽으로 옅어진다
    const [R, G, B] = wax ? (base.map((v, i) => Math.round(lerp(v, WAX_RGB[i], 0.5 * mix))) as [number, number, number]) : base;
    const bg = ctx.createRadialGradient(c.w / 2, c.h / 2, 0, c.w / 2, c.h / 2, Math.max(c.w, c.h) * 0.75);
    bg.addColorStop(0, "#0b262e");
    bg.addColorStop(1, DEEP_BG);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, c.w, c.h);
    bbox();
    const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;
    const big = Math.max(bw, bh);

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

    // 접촉 그림자 — 덩어리 바로 밑에 부드럽게. shadowBlur 는 큰 도형에서 매 프레임 가우시안 블러라
    // 폰·소프트웨어 렌더러에서 너무 느리다 → 같은 모양을 조금씩 키워 옅게 여러 겹 겹친다
    for (let k = 6; k >= 1; k--) {
      const sc = 1 + k * 0.014;
      ctx.save();
      ctx.translate(midX + big * 0.012, midY + big * 0.03);
      ctx.scale(sc, sc);
      ctx.translate(-midX, -midY);
      tracePath();
      ctx.fillStyle = `rgba(0, 10, 14, ${0.09})`;
      ctx.fill();
      ctx.restore();
    }

    // 몸 — 가운데는 두꺼워 진하고 밝게, 가장자리는 얇아 어둡고 살짝 비친다(돔)
    tracePath();
    const bodyG = ctx.createRadialGradient(midX - bw * 0.08, midY - bh * 0.10, big * 0.05, midX, midY, big * 0.58);
    if (clay) {
      bodyG.addColorStop(0, `rgba(${Math.min(255, R + 28)},${Math.min(255, G + 28)},${Math.min(255, B + 28)},1)`);
      bodyG.addColorStop(0.7, `rgba(${R},${G},${B},1)`);
      bodyG.addColorStop(1, `rgba(${R * 0.62 | 0},${G * 0.64 | 0},${B * 0.64 | 0},1)`);
    } else {
      bodyG.addColorStop(0, `rgba(${Math.min(255, R + 40)},${Math.min(255, G + 40)},${Math.min(255, B + 40)},0.98)`);
      bodyG.addColorStop(0.55, `rgba(${R},${G},${B},0.94)`);
      bodyG.addColorStop(0.86, `rgba(${R * 0.78 | 0},${G * 0.82 | 0},${B * 0.82 | 0},0.86)`);
      bodyG.addColorStop(1, `rgba(${R * 0.5 | 0},${G * 0.56 | 0},${B * 0.56 | 0},0.72)`);
    }
    ctx.fillStyle = bodyG;
    ctx.fill();

    ctx.save();
    ctx.clip();
    // 메니스커스 — 가장자리 안쪽으로 서서히 어두워지는 띠. 선 하나로 그리면 접시 테두리처럼 보여서
    // 폭이 다른 옅은 선을 여러 겹 얹어 가장자리로 갈수록 짙어지게 한다 (두께가 얇아지는 곳)
    tracePath();
    const layers = 7;
    for (let k = 0; k < layers; k++) {
      const f = k / (layers - 1);
      ctx.lineWidth = big * (clay ? 0.09 : 0.14) * (1 - f) + 2;
      ctx.strokeStyle = `rgba(${R * 0.3 | 0},${G * 0.35 | 0},${B * 0.35 | 0},${(clay ? 0.05 : 0.075) + f * 0.03})`;
      ctx.stroke();
    }
    // 기포 (슬라임만) — 눌린 자리에서 밀려난다
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
    // 섞인 왁스 결 (왁뿌)
    if (wax) {
      ctx.globalAlpha = 1 - mix * 0.65;
      ctx.drawImage(marble, minX, minY, bw, bh);
      ctx.globalAlpha = 1;
    }
    // 넓고 부드러운 광택 — 왼쫌 위 (점토는 무광에 가깝게)
    const hl = ctx.createRadialGradient(minX + bw * 0.34, minY + bh * 0.28, 0, minX + bw * 0.36, minY + bh * 0.32, big * 0.34);
    hl.addColorStop(0, `rgba(255,255,255,${clay ? 0.16 : 0.5})`);
    hl.addColorStop(0.55, `rgba(255,255,255,${clay ? 0.05 : 0.1})`);
    hl.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = hl;
    ctx.fillRect(minX, minY, bw, bh);
    // 왁스 껍질 — 섞일수록 사라진다
    if (wax && mix < 0.999) {
      ctx.globalAlpha = clamp(1 - mix, 0, 1) * 0.98;
      ctx.drawImage(waxCanvas, minX, minY, bw, bh);
      ctx.globalAlpha = 1;
    }
    // 자국 — 손가락이 잠긴 우물. 빛은 왼쪽 위에서 오므로 왼쪽 위 벽은 그늘, 오른쪽 아래 벽은 밝다
    for (const d of dents) {
      const rr = FINGER_R * (1 + d.depth * 0.6);
      const k = d.depth;
      const dark = wax ? 0.22 : 0.3;
      const g1 = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, rr * 1.7);
      g1.addColorStop(0, `rgba(0, 12, 16, ${dark * k})`);
      g1.addColorStop(0.35, `rgba(0, 12, 16, ${dark * 0.55 * k})`);
      g1.addColorStop(0.62, "rgba(0, 12, 16, 0)");
      g1.addColorStop(1, "rgba(0, 12, 16, 0)");
      ctx.fillStyle = g1;
      ctx.fillRect(d.x - rr * 2, d.y - rr * 2, rr * 4, rr * 4);
      const g2 = ctx.createRadialGradient(d.x - rr * 0.35, d.y - rr * 0.35, rr * 0.2, d.x - rr * 0.2, d.y - rr * 0.2, rr * 1.1);
      g2.addColorStop(0, `rgba(0, 12, 16, ${0.28 * k})`);
      g2.addColorStop(1, "rgba(0, 12, 16, 0)");
      ctx.fillStyle = g2;
      ctx.fillRect(d.x - rr * 2, d.y - rr * 2, rr * 4, rr * 4);
      const g3 = ctx.createRadialGradient(d.x + rr * 0.45, d.y + rr * 0.45, rr * 0.15, d.x + rr * 0.25, d.y + rr * 0.25, rr * 1.15);
      g3.addColorStop(0, `rgba(255, 255, 255, ${(clay ? 0.18 : 0.32) * k})`);
      g3.addColorStop(0.6, `rgba(255, 255, 255, ${(clay ? 0.06 : 0.1) * k})`);
      g3.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = g3;
      ctx.fillRect(d.x - rr * 2, d.y - rr * 2, rr * 4, rr * 4);
      const ring = ctx.createRadialGradient(d.x, d.y, rr * 0.95, d.x, d.y, rr * 1.75);
      ring.addColorStop(0, `rgba(255,255,255,${(clay ? 0.08 : 0.18) * k})`);
      ring.addColorStop(0.4, `rgba(255,255,255,${(clay ? 0.03 : 0.06) * k})`);
      ring.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = ring;
      ctx.fillRect(d.x - rr * 2, d.y - rr * 2, rr * 4, rr * 4);
    }
    // 바닥까지 뚫린 구멍 — 바닥이 보이고, 둘레는 슬라임 벽(위쪽 벽은 그늘 · 아래쪽 벽은 빛을 받는다)
    for (const d of dents) {
      if (d.through <= 0) continue;
      const e = d.through * d.through * (3 - 2 * d.through);
      const hr = FINGER_R * 0.78 * e;
      // 벽·입술은 먼저 (방사 그라데이션은 안쪽 원을 첫 색으로 채우므로 바닥이 덮이지 않게 바닥을 나중에 그린다)
      const wall = ctx.createRadialGradient(d.x, d.y, hr, d.x, d.y, hr * 1.45);
      wall.addColorStop(0, `rgba(0, 12, 16, ${0.32 * e})`); wall.addColorStop(1, "rgba(0,12,16,0)");
      ctx.fillStyle = wall; ctx.fillRect(d.x - hr * 2, d.y - hr * 2, hr * 4, hr * 4);
      const lip = ctx.createRadialGradient(d.x + hr * 0.2, d.y + hr * 0.2, hr * 0.98, d.x + hr * 0.2, d.y + hr * 0.2, hr * 1.22);
      lip.addColorStop(0, `rgba(255,255,255,${(clay ? 0.2 : 0.45) * e})`); lip.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = lip; ctx.fillRect(d.x - hr * 2, d.y - hr * 2, hr * 4, hr * 4);
      ctx.save();
      ctx.beginPath(); ctx.arc(d.x, d.y, hr, 0, TAU); ctx.clip();
      ctx.fillStyle = bg; ctx.fillRect(d.x - hr, d.y - hr, hr * 2, hr * 2);
      const floor = ctx.createRadialGradient(d.x - hr * 0.25, d.y - hr * 0.25, hr * 0.3, d.x, d.y, hr);
      floor.addColorStop(0, "rgba(0,0,0,0)"); floor.addColorStop(1, "rgba(0,4,6,0.55)");
      ctx.fillStyle = floor; ctx.fillRect(d.x - hr, d.y - hr, hr * 2, hr * 2);
      ctx.restore();
    }
    ctx.restore();

    for (const ch of chips) {
      ctx.save();
      ctx.translate(ch.x, ch.y); ctx.rotate(ch.rot);
      ctx.globalAlpha = clamp(ch.life, 0, 1);
      ctx.beginPath();
      ch.pts.forEach(([px, py], j) => (j === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
      ctx.closePath();
      ctx.fillStyle = `rgb(${WAX_RGB.join(",")})`; ctx.fill();
      ctx.strokeStyle = "rgba(70,48,32,0.6)"; ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
    }

    tracePath();
    ctx.lineWidth = clay ? 1.5 : 2;
    const rim = ctx.createLinearGradient(minX, minY, maxX, maxY);
    rim.addColorStop(0, `rgba(255,255,255,${clay ? 0.35 : 0.65})`);
    rim.addColorStop(0.5, "rgba(255,255,255,0.08)");
    rim.addColorStop(1, `rgba(${R * 0.3 | 0},${G * 0.3 | 0},${B * 0.3 | 0},0.7)`);
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
    const dent: Dent = { x, y, depth: 0, held: pressed, through: 0 };
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
        f.dent = { x, y, depth: 0, held: true, through: 0 };
        dents.push(f.dent);
        f.pressed = true; f.x = x; f.y = y; f.vx = 0; f.vy = 0; f.at = performance.now();
        f.lastCrackX = x; f.lastCrackY = y;
      } else setFinger(id, x, y, 0, 0, true);
      if (wax && mix < 0.85 && inside(x, y)) startCrack(x, y);
    },
    pointerMove(x, y, dx, dy, id, pressed) {
      const sp = Math.hypot(dx, dy);
      const k = sp > 18 ? 18 / sp : 1;
      const f = setFinger(id, x, y, dx * k, dy * k, pressed);
      if (!wax || !pressed || sp < 0.5) return;
      bbox();
      if (!inside(x, y)) return;
      if (cracks.length === 0 && mix === 0) {
        // 아직 한 번도 부수지 않았으면 끌어도 균열부터 — 굳은 껍질은 문질러서는 안 부서진다
        if (Math.hypot(x - f.lastCrackX, y - f.lastCrackY) > 40) { f.lastCrackX = x; f.lastCrackY = y; startCrack(x, y); cracks[cracks.length - 1].grow = 0.6; }
        return;
      }
      kneadAt(x, y, dx, dy);
      if (mix < 0.6 && Math.hypot(x - f.lastCrackX, y - f.lastCrackY) > 70) {
        f.lastCrackX = x; f.lastCrackY = y;
        startCrack(x, y);
        const cr = cracks[cracks.length - 1];
        cr.grow = 0.7; cr.chipped = 1; chipOff(cr, 0.07);
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
      if (clay) return;
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
