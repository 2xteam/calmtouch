import { createCanvas2D, createLoop, DEEP_BG } from "@/lib/canvas/tools";
import { crackle } from "@/lib/audio/tones";
import { clamp, damp, lerp, rand, TAU } from "@/lib/util/math";
import type { EngineFactory } from "./types";

/**
 * 왁뿌 — 파스텔 왁스를 입힌 도넛 모양 점토 (참고: 팔레트슬라임 "왕도넛 왁뿌", 2026-09-11 사용자 사진).
 *
 *   · 도넛: 바깥 고리 96점 + 구멍 고리 48점. 속살은 **점토** — 손이 닿아 있을 때만 움직이고 떼면 굳는다
 *   · 껍질: 분홍·하늘·노랑 세 구역이 부드럽게 이어지는 광택 왁스. 별 스프링클이 박혀 있다
 *   · 꾹 누르면 그 자리 껍질이 **조각조각 갈라진다** — 손가락 가까운 조각은 떨어져 조금 밀리고 뒤집힌 채 얹히고,
 *     바깥 조각은 금만 가서 다음에 누르면 떨어진다. 떨어진 자리에는 보슬한 속살(무광 · 알갱이 결)이 드러난다
 *   · 문지르면 조각이 갈려 속살에 섞인다. 섞임이 다 되면 껍질은 없다. "지우기" 는 다시 입히기
 *
 * 껍질과 조각은 도넛 경계 상자 (u,v) 캔버스 두 장(wax · flakes)이라 도넛이 눌리면 함께 늘어난다.
 */
type Node = { x: number; y: number; vx: number; vy: number };
type Finger = { x: number; y: number; vx: number; vy: number; pressed: boolean; at: number; dent: Dent; lastCrackX: number; lastCrackY: number };
type Dent = { x: number; y: number; depth: number; held: boolean };
type Cell = { poly: [number, number][]; cx: number; cy: number; ang: number; d: number; state: "cracked" | "off" };
type Shatter = { u: number; v: number; cells: Cell[]; grow: number; stage: number };

const TEX = 768;
/** 분홍 · 하늘 · 노랑 — 사진의 파스텔 셋 */
const SECTIONS: [number, number, number][] = [[246, 183, 207], [185, 215, 242], [247, 236, 176]];
const SPRINKLES = ["#ff8fb8", "#8fd0ff", "#ffe27a", "#b9f0c8", "#ffffff", "#c9b6ff"];

export const createWaxEngine: EngineFactory = (canvas, ctx0) => {
  const c = createCanvas2D(canvas);
  const { ctx } = c;
  let sound = ctx0.sound;

  const N = 96, M = 48;
  let outer: Node[] = [];
  let inner: Node[] = [];
  let R = 100, hole = 34;
  let restArea = 0;
  let tilt = { x: 0, y: 0 };
  const dents: Dent[] = [];
  const shatters: Shatter[] = [];
  let mix = 0;
  let knead = 0;

  const wax = document.createElement("canvas"); wax.width = TEX; wax.height = TEX;
  const wctx = wax.getContext("2d")!;
  const flakes = document.createElement("canvas"); flakes.width = TEX; flakes.height = TEX;
  const fctx = flakes.getContext("2d")!;
  const grain = document.createElement("canvas"); grain.width = 256; grain.height = 256;
  {
    const g = grain.getContext("2d")!;
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = Math.random() < 0.65 ? `rgba(255,255,255,${rand(0.06, 0.24)})` : `rgba(90,60,90,${rand(0.03, 0.1)})`;
      g.fillRect(Math.random() * 256, Math.random() * 256, rand(1, 2.4), rand(1, 2.4));
    }
  }

  /** (u,v) → 도넛 중심 기준 각도 → 파스텔 색 (세 구역 사이는 부드럽게) */
  const sectionColor = (u: number, v: number, pale = 0): [number, number, number] => {
    const a = Math.atan2(v - 0.5, u - 0.5) / TAU + 0.5; // 0~1
    const p = (a * 3 + 0.15) % 3;
    const i = Math.floor(p), f = p - i;
    const blend = clamp((f - 0.7) / 0.3, 0, 1); // 구역의 마지막 30% 에서 다음 색으로
    const A = SECTIONS[i % 3], B = SECTIONS[(i + 1) % 3];
    return [0, 1, 2].map((k) => Math.round(lerp(lerp(A[k], B[k], blend), 255, pale))) as [number, number, number];
  };

  const recoat = () => {
    wctx.globalCompositeOperation = "source-over";
    wctx.clearRect(0, 0, TEX, TEX);
    // 광택 왁스 — 부채꼴로 세 색을 칠한다
    const seg = 96;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * TAU, a1 = ((i + 1.02) / seg) * TAU;
      const [r, g, b] = sectionColor(0.5 + Math.cos((a0 + a1) / 2) * 0.3, 0.5 + Math.sin((a0 + a1) / 2) * 0.3, 0.12);
      wctx.fillStyle = `rgb(${r},${g},${b})`;
      wctx.beginPath(); wctx.moveTo(TEX / 2, TEX / 2); wctx.arc(TEX / 2, TEX / 2, TEX, a0, a1); wctx.closePath(); wctx.fill();
    }
    // 왁스 두께의 옅은 결
    for (let i = 0; i < 1400; i++) {
      wctx.fillStyle = `rgba(255,255,255,${rand(0.05, 0.16)})`;
      wctx.fillRect(Math.random() * TEX, Math.random() * TEX, rand(1, 3), rand(1, 3));
    }
    // 별 스프링클 — 고리 위에만
    for (let i = 0; i < 46; i++) {
      const a = rand(0, TAU), rr = rand(0.21, 0.46);
      const x = (0.5 + Math.cos(a) * rr) * TEX, y = (0.5 + Math.sin(a) * rr) * TEX;
      star(wctx, x, y, rand(7, 11), rand(0, TAU), SPRINKLES[Math.floor(Math.random() * SPRINKLES.length)]);
    }
    fctx.globalCompositeOperation = "source-over";
    fctx.clearRect(0, 0, TEX, TEX);
    shatters.length = 0;
    mix = 0; knead = 0;
  };
  function star(g: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number, color: string) {
    g.save(); g.translate(x, y); g.rotate(rot);
    g.beginPath();
    for (let i = 0; i < 10; i++) { const rr = i % 2 === 0 ? r : r * 0.48; const a = (i / 10) * TAU - Math.PI / 2; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    g.closePath();
    g.fillStyle = "rgba(0,0,0,0.18)"; g.save(); g.translate(1.5, 2); g.fill(); g.restore();
    g.fillStyle = color; g.fill();
    g.restore();
  }

  const center = () => ({ x: c.w / 2, y: c.h / 2 });
  const spawn = () => {
    R = Math.min(c.w, c.h) * 0.37;
    hole = R * 0.34;
    const { x: cx, y: cy } = center();
    outer = []; inner = [];
    for (let i = 0; i < N; i++) { const a = (i / N) * TAU; outer.push({ x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R, vx: 0, vy: 0 }); }
    for (let i = 0; i < M; i++) { const a = (i / M) * TAU; inner.push({ x: cx + Math.cos(a) * hole, y: cy + Math.sin(a) * hole, vx: 0, vy: 0 }); }
    restArea = area(outer) - area(inner);
    dents.length = 0;
    recoat();
  };
  const area = (loop: Node[]) => {
    let s = 0;
    for (let i = 0; i < loop.length; i++) { const a = loop[i], b = loop[(i + 1) % loop.length]; s += a.x * b.y - b.x * a.y; }
    return Math.abs(s) / 2;
  };
  spawn();

  const fingers = new Map<number, Finger>();
  const FINGER_R = 30;

  let minX = 0, maxX = 1, minY = 0, maxY = 1, bw = 1, bh = 1;
  const bbox = () => {
    minX = 1e9; maxX = -1e9; minY = 1e9; maxY = -1e9;
    for (const n of outer) { if (n.x < minX) minX = n.x; if (n.x > maxX) maxX = n.x; if (n.y < minY) minY = n.y; if (n.y > maxY) maxY = n.y; }
    bw = Math.max(1, maxX - minX); bh = Math.max(1, maxY - minY);
  };
  const toUV = (x: number, y: number) => [(x - minX) / bw, (y - minY) / bh] as const;
  const insideLoop = (loop: Node[], x: number, y: number) => {
    let ins = false;
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const a = loop[i], b = loop[j];
      if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y + 1e-9) + a.x) ins = !ins;
    }
    return ins;
  };
  const onDonut = (x: number, y: number) => insideLoop(outer, x, y) && !insideLoop(inner, x, y);

  const resample = (loop: Node[]) => {
    const n = loop.length;
    const segs: number[] = []; let total = 0;
    for (let i = 0; i < n; i++) { const a = loop[i], b = loop[(i + 1) % n]; const d = Math.hypot(b.x - a.x, b.y - a.y); segs.push(d); total += d; }
    if (total < 1) return loop;
    const step = total / n; const out: Node[] = []; let seg = 0, along = 0;
    for (let k = 0; k < n; k++) {
      const target = k * step;
      while (along + segs[seg] < target && seg < n - 1) { along += segs[seg]; seg++; }
      const a = loop[seg], b = loop[(seg + 1) % n]; const t = segs[seg] > 0 ? (target - along) / segs[seg] : 0;
      out.push({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), vx: lerp(a.vx, b.vx, t), vy: lerp(a.vy, b.vy, t) });
    }
    return out;
  };

  // ── 껍질 깨기 ──
  /**
   * 누른 자리를 조각으로 나눈다 — 흔들어 놓은 삼각 격자(반은 둘씩 합쳐 사각)로 불규칙한 파편을 만든다.
   * 가운데 조각은 떨어지고, 가장자리 조각은 실금만 간다 (다음에 근처를 누르면 떨어진다).
   */
  const shatter = (x: number, y: number, big = false) => {
    const [u, v] = toUV(x, y);
    const asp = bw / bh; // v 는 화면에서 세로라 같은 길이가 되게 늘린다
    const rad = big ? 0.2 : 0.13;
    const sp = 0.046;
    const rows = Math.ceil(rad / (sp * 0.866)) + 1;
    const verts = new Map<string, [number, number]>();
    const vert = (i: number, j: number): [number, number] => {
      const key = `${i},${j}`;
      let p = verts.get(key);
      if (!p) {
        const ox = (i + 0.5 * (j & 1)) * sp + rand(-0.3, 0.3) * sp;
        const oy = j * sp * 0.866 + rand(-0.3, 0.3) * sp;
        p = [u + ox, v + oy * asp]; verts.set(key, p);
      }
      return p;
    };
    const tris: [number, number][][] = [];
    for (let j = -rows; j < rows; j++) for (let i = -rows - 1; i <= rows; i++) {
      const odd = j & 1;
      const A = odd ? [vert(i, j), vert(i + 1, j), vert(i + 1, j + 1)] : [vert(i, j), vert(i + 1, j), vert(i, j + 1)];
      const B = odd ? [vert(i, j), vert(i + 1, j + 1), vert(i, j + 1)] : [vert(i + 1, j), vert(i + 1, j + 1), vert(i, j + 1)];
      // 절반은 둘을 합쳐 사각 조각으로
      if (Math.random() < 0.5) { const q = odd ? [A[0], A[1], A[2], B[2]] : [A[0], A[1], B[1], B[2]]; tris.push(q); }
      else { tris.push(A); tris.push(B); }
    }
    const cells: Cell[] = [];
    const edge = rad * rand(0.85, 1.05);
    for (const poly of tris) {
      const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length, cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
      const dist = Math.hypot(cx - u, (cy - v) / asp);
      const wob = 1 + Math.sin(Math.atan2(cy - v, cx - u) * 3 + u * 40) * 0.12;
      if (dist > edge * wob) continue;
      const d = dist / rad;
      const state: Cell["state"] = d < 0.5 ? "off" : d < 0.78 ? (Math.random() < 0.6 ? "off" : "cracked") : "cracked";
      cells.push({ poly, cx, cy, ang: Math.atan2(cy - v, cx - u), d, state });
    }
    const sh: Shatter = { u, v, cells, grow: 0, stage: 0 };
    shatters.push(sh);
    // 이 자리 근처에 금만 가 있던 옛 조각은 이제 떨어진다
    for (const old of shatters) {
      if (old === sh) continue;
      for (const cell of old.cells) {
        if (cell.state === "cracked" && Math.hypot(cell.cx - u, (cell.cy - v) / asp) < rad * 0.9) { cell.state = "off"; detach(cell); }
      }
    }
    if (sound) crackle(0.6);
  };
  const drawCrackLines = (sh: Shatter) => {
    wctx.globalCompositeOperation = "source-atop";
    wctx.lineCap = "round"; wctx.lineJoin = "round";
    const seen = new Set<string>();
    for (const cell of sh.cells) {
      const n = cell.poly.length;
      for (let j = 0; j < n; j++) {
        const a = cell.poly[j], b = cell.poly[(j + 1) % n];
        const key = a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? `${a}|${b}` : `${b}|${a}`;
        if (seen.has(key)) continue; seen.add(key);
        // 바깥 실금은 군데군데 끊긴다
        if (cell.d > 0.6 && Math.random() < 0.55) continue;
        const k = clamp(1.3 - cell.d, 0.35, 1);
        wctx.beginPath(); wctx.moveTo(a[0] * TEX, a[1] * TEX); wctx.lineTo(b[0] * TEX, b[1] * TEX);
        wctx.strokeStyle = `rgba(70, 50, 65, ${0.7 * k})`; wctx.lineWidth = 0.9 + k * 1.1; wctx.stroke();
        if (cell.d > 0.6) continue; // 바깥 실금은 어두운 선만
        wctx.strokeStyle = `rgba(255,255,255,${0.45 * k})`; wctx.lineWidth = 0.7;
        wctx.beginPath(); wctx.moveTo(a[0] * TEX + 1.2, a[1] * TEX + 1.2); wctx.lineTo(b[0] * TEX + 1.2, b[1] * TEX + 1.2); wctx.stroke();
      }
    }
    wctx.globalCompositeOperation = "source-over";
  };
  /** 조각을 껍질에서 떼어 flakes 캔버스에 얹는다 — 조금 밀리고, 돌아가고, 두께가 보이게 들리고, 몇은 뒤집힌다 */
  const detach = (cell: Cell) => {
    wctx.globalCompositeOperation = "destination-out";
    wctx.fillStyle = "rgb(0,0,0)";
    wctx.beginPath();
    cell.poly.forEach(([px, py], j) => (j === 0 ? wctx.moveTo(px * TEX, py * TEX) : wctx.lineTo(px * TEX, py * TEX)));
    wctx.closePath(); wctx.fill();
    wctx.globalCompositeOperation = "source-over";

    const [r, g, b] = sectionColor(cell.cx, cell.cy, 0.12);
    const flipped = Math.random() < 0.3;
    const shift = rand(0.004, 0.022) * (0.4 + cell.d);
    fctx.save();
    fctx.translate((cell.cx + Math.cos(cell.ang) * shift) * TEX, (cell.cy + Math.sin(cell.ang) * shift * (bw / bh)) * TEX);
    fctx.rotate(rand(-0.55, 0.55));
    const scale = rand(0.9, 1.05);
    const trace = (ox: number, oy: number) => {
      fctx.beginPath();
      cell.poly.forEach(([px, py], j) => {
        const X = (px - cell.cx) * TEX * scale + ox, Y = (py - cell.cy) * TEX * scale + oy;
        if (j === 0) fctx.moveTo(X, Y); else fctx.lineTo(X, Y);
      });
      fctx.closePath();
    };
    // 바닥 그림자
    trace(3, 5); fctx.fillStyle = "rgba(50,30,50,0.26)"; fctx.fill();
    // 옆면 두께 — 아래로 밀린 어두운 층
    trace(1.5, 3); fctx.fillStyle = `rgb(${(r * 0.62) | 0},${(g * 0.6) | 0},${(b * 0.62) | 0})`; fctx.fill();
    // 윗면
    trace(0, 0);
    fctx.fillStyle = flipped ? `rgb(${(r * 0.82) | 0},${(g * 0.8) | 0},${(b * 0.82) | 0})` : `rgb(${r},${g},${b})`;
    fctx.fill();
    fctx.strokeStyle = flipped ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.7)"; fctx.lineWidth = 1.2; fctx.stroke();
    if (!flipped) {
      // 윗면 광택 한 점
      const gl = fctx.createRadialGradient(-2, -3, 0, -2, -3, 10);
      gl.addColorStop(0, "rgba(255,255,255,0.55)"); gl.addColorStop(1, "rgba(255,255,255,0)");
      fctx.fillStyle = gl; trace(0, 0); fctx.fill();
    }
    fctx.restore();
  };
  /** 문지르기 — 조각을 갈아 속살에 섞는다 */
  const kneadAt = (x: number, y: number, dx: number, dy: number) => {
    const [u, v] = toUV(x, y);
    knead += Math.hypot(dx, dy);
    mix = clamp(knead / (R * 30), 0, 1);
    const r = (FINGER_R * 1.2) / bw;
    // 껍질도 손가락 아래에서 조금씩 부서진다
    wctx.globalCompositeOperation = "destination-out";
    wctx.fillStyle = "rgba(0,0,0,0.35)";
    for (let i = 0; i < 3; i++) {
      wctx.beginPath(); wctx.ellipse((u + rand(-r, r) * 0.6) * TEX, (v + rand(-r, r) * 0.6 * (bw / bh)) * TEX, r * TEX * rand(0.3, 0.6), r * TEX * rand(0.3, 0.6) * (bw / bh), 0, 0, TAU); wctx.fill();
    }
    wctx.globalCompositeOperation = "source-over";
    // 조각은 갈려 옅어지고, 갈린 가루가 결로 번진다
    fctx.globalCompositeOperation = "destination-out";
    fctx.fillStyle = "rgba(0,0,0,0.2)";
    fctx.beginPath(); fctx.ellipse(u * TEX, v * TEX, r * TEX * 1.4, r * TEX * 1.4 * (bw / bh), 0, 0, TAU); fctx.fill();
    fctx.globalCompositeOperation = "source-over";
    const [pr, pg, pb] = sectionColor(u, v, 0.2);
    fctx.fillStyle = `rgba(${pr},${pg},${pb},${0.22 * (1 - mix)})`;
    fctx.save(); fctx.translate(u * TEX, v * TEX); fctx.rotate(Math.atan2(dy, dx));
    fctx.beginPath(); fctx.ellipse(0, 0, r * TEX * 1.6, r * TEX * 0.5, 0, 0, TAU); fctx.fill(); fctx.restore();
    if (sound && Math.random() < 0.05) crackle(0.2);
  };

  const loop = createLoop((dt, t) => {
    if (c.resize()) spawn();
    const h = Math.min(dt, 1 / 45);
    const sub = 5, hs = h / sub;
    tilt.x *= damp(1.2, dt); tilt.y *= damp(1.2, dt);
    const now = performance.now();
    for (const [id, f] of fingers) if (id === 0 && !f.pressed && now - f.at > 600) fingers.delete(id);

    for (const d of dents) if (d.held) d.depth = Math.min(1, d.depth + dt / 0.35);
    if (dents.length > 40) dents.splice(0, dents.length - 40);

    bbox();
    // 금이 자국 깊이를 따라 자라고, 문턱을 넘으면 안쪽 조각이 떨어진다
    for (const f of fingers.values()) {
      if (!f.pressed) continue;
      const sh = shatters[shatters.length - 1];
      if (!sh) continue;
      const d = f.dent.depth;
      if (d > sh.grow) sh.grow = d;
      if (d > 0.3 && sh.stage < 1) { sh.stage = 1; drawCrackLines(sh); }
      if (d > 0.6 && sh.stage < 2) { sh.stage = 2; for (const cell of sh.cells) if (cell.state === "off" && cell.d < 0.5) detach(cell); if (sound) crackle(0.9); }
      if (d > 0.95 && sh.stage < 3) { sh.stage = 3; for (const cell of sh.cells) if (cell.state === "off" && cell.d >= 0.5) detach(cell); if (sound) crackle(1); }
    }

    // 점토 — 손이 닿아 있을 때만
    const touching = [...fingers.values()].some((f) => f.pressed);
    if (!touching) { for (const n of outer) { n.vx = 0; n.vy = 0; } for (const n of inner) { n.vx = 0; n.vy = 0; } }
    else {
      for (let s = 0; s < sub; s++) {
        const A = area(outer) - area(inner);
        const pressureK = clamp((restArea - A) / restArea, -0.6, 0.6) * 1200;
        const REACH = R * 0.42;
        const near = (p: Node) => { let m = 1e9; for (const f of fingers.values()) if (f.pressed) m = Math.min(m, Math.hypot(p.x - f.x, p.y - f.y)); return m; };
        const step = (loop: Node[], sign: number) => {
          const n = loop.length; const restLen = (sign > 0 ? TAU * R : TAU * hole) / n;
          for (let i = 0; i < n; i++) {
            const p = loop[i], l = loop[(i + n - 1) % n], r = loop[(i + 1) % n];
            // 손에서 먼 점토는 굳어 있다 — 손 근처만 움직인다
            if (near(p) > REACH) { p.vx = 0; p.vy = 0; continue; }
            let ax = 0, ay = 0;
            for (const o of [l, r]) { const dx = o.x - p.x, dy = o.y - p.y; const d = Math.hypot(dx, dy) || 0.001; ax += (dx / d) * (d - restLen) * 6; ay += (dy / d) * (d - restLen) * 6; }
            ax += ((l.x + r.x) / 2 - p.x) * 14; ay += ((l.y + r.y) / 2 - p.y) * 14;
            const nx = (r.y - l.y) * sign, ny = -(r.x - l.x) * sign; const nl = Math.hypot(nx, ny) || 0.001;
            ax += (nx / nl) * pressureK; ay += (ny / nl) * pressureK;
            for (const d of dents) { const dx = p.x - d.x, dy = p.y - d.y; const dist = Math.hypot(dx, dy) || 0.001; const w = Math.exp(-((dist / (R * 0.2)) ** 2)); ax += (dx / dist) * d.depth * 900 * w; ay += (dy / dist) * d.depth * 900 * w; }
            p.vx += ax * hs; p.vy += ay * hs;
          }
        };
        step(outer, 1); step(inner, -1);
        for (const f of fingers.values()) {
          const reach = R * 0.36;
          for (const p of [...outer, ...inner]) {
            const dx = p.x - f.x, dy = p.y - f.y; const d = Math.hypot(dx, dy) || 0.001;
            if (d > reach) continue;
            const w = 1 - d / reach;
            if (f.pressed) { const k = w * w * 0.7; p.vx = lerp(p.vx, f.vx, k); p.vy = lerp(p.vy, f.vy, k); }
            if (d < FINGER_R) { const push = FINGER_R - d; p.x += (dx / d) * push; p.y += (dy / d) * push; p.vx *= 0.5; p.vy *= 0.5; }
          }
        }
        // 고리 두께 — 구멍이 바깥에 붙지 않게
        const minThick = R * 0.22;
        for (const q of inner) for (const p of outer) {
          const dx = p.x - q.x, dy = p.y - q.y;
          if (Math.abs(dx) > minThick || Math.abs(dy) > minThick) continue;
          const d = Math.hypot(dx, dy) || 0.001;
          if (d < minThick) { const push = (minThick - d) * 0.5; p.x += (dx / d) * push; p.y += (dy / d) * push; q.x -= (dx / d) * push; q.y -= (dy / d) * push; }
        }
        const dampK = Math.exp(-26 * hs);
        for (const loop of [outer, inner]) {
          const n = loop.length; const vxs = new Float32Array(n), vys = new Float32Array(n);
          for (let i = 0; i < n; i++) { const l = loop[(i + n - 1) % n], r = loop[(i + 1) % n], p = loop[i]; vxs[i] = p.vx * 0.2 + (l.vx + r.vx) * 0.4; vys[i] = p.vy * 0.2 + (l.vy + r.vy) * 0.4; }
          for (let i = 0; i < n; i++) { const p = loop[i]; p.vx = vxs[i] * dampK; p.vy = vys[i] * dampK; p.x = clamp(p.x + p.vx * hs, 6, c.w - 6); p.y = clamp(p.y + p.vy * hs, 6, c.h - 6); }
        }
      }
      outer = resample(outer); inner = resample(inner);
      for (const loop of [outer, inner]) {
        const n = loop.length; const sx = new Float32Array(n), sy = new Float32Array(n);
        for (let i = 0; i < n; i++) { const l = loop[(i + n - 1) % n], r = loop[(i + 1) % n], p = loop[i]; sx[i] = lerp(p.x, (l.x + r.x) / 2, 0.12); sy[i] = lerp(p.y, (l.y + r.y) / 2, 0.12); }
        for (let i = 0; i < n; i++) { loop[i].x = sx[i]; loop[i].y = sy[i]; }
      }
      bbox();
    }

    // ── 그리기 ──
    const bg = ctx.createRadialGradient(c.w / 2, c.h / 2, 0, c.w / 2, c.h / 2, Math.max(c.w, c.h) * 0.75);
    bg.addColorStop(0, "#0e2f38"); bg.addColorStop(1, DEEP_BG);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, c.w, c.h);
    const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2, big = Math.max(bw, bh);

    const traceLoop = (loop: Node[]) => {
      const n = loop.length;
      for (let i = 0; i < n; i++) {
        const a = loop[i], b = loop[(i + 1) % n]; const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        if (i === 0) ctx.moveTo(mx, my); else ctx.quadraticCurveTo(a.x, a.y, mx, my);
      }
      const a0 = loop[0], b0 = loop[1];
      ctx.quadraticCurveTo(a0.x, a0.y, (a0.x + b0.x) / 2, (a0.y + b0.y) / 2);
      ctx.closePath();
    };
    const traceDonut = () => { ctx.beginPath(); traceLoop(outer); traceLoop(inner); };

    // 접촉 그림자
    for (let k = 6; k >= 1; k--) {
      ctx.save(); ctx.translate(midX + big * 0.012, midY + big * 0.03); ctx.scale(1 + k * 0.014, 1 + k * 0.014); ctx.translate(-midX, -midY);
      traceDonut(); ctx.fillStyle = "rgba(0, 10, 14, 0.09)"; ctx.fill("evenodd"); ctx.restore();
    }

    // 속살 — 파스텔을 조금 어둡고 탁하게, 보슬한 알갱이
    traceDonut();
    ctx.save();
    ctx.clip("evenodd");
    const seg = 48;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * TAU, a1 = ((i + 1.04) / seg) * TAU;
      const [r, g, b] = sectionColor(0.5 + Math.cos((a0 + a1) / 2) * 0.3, 0.5 + Math.sin((a0 + a1) / 2) * 0.3, 0);
      // 섞임이 커지면 왁스 색이 스며 조금 밝아진다
      const m = 0.25 * mix;
      ctx.fillStyle = `rgb(${lerp(r * 0.9, 240, m) | 0},${lerp(g * 0.84, 236, m) | 0},${lerp(b * 0.86, 232, m) | 0})`;
      ctx.beginPath(); ctx.moveTo(midX, midY); ctx.arc(midX, midY, big, a0, a1); ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 0.3;
    ctx.drawImage(grain, minX, minY, bw, bh);
    ctx.globalAlpha = 1;
    // 두께 — 바깥 가장자리와 구멍 가장자리 안쪽의 옅은 어둠
    for (let k = 0; k < 6; k++) {
      const f = k / 5;
      ctx.lineWidth = big * 0.08 * (1 - f) + 2;
      ctx.strokeStyle = `rgba(60, 40, 60, ${0.05 + f * 0.03})`;
      ctx.beginPath(); traceLoop(outer); ctx.stroke();
      ctx.beginPath(); traceLoop(inner); ctx.stroke();
    }
    // 떨어진 조각과 갈린 가루
    ctx.globalAlpha = clamp(1 - mix * 0.8, 0, 1);
    ctx.drawImage(flakes, minX, minY, bw, bh);
    ctx.globalAlpha = 1;
    // 껍질 — 섞일수록 사라진다
    if (mix < 0.999) {
      ctx.globalAlpha = clamp(1 - mix, 0, 1);
      ctx.drawImage(wax, minX, minY, bw, bh);
      // 광택 — 왼쪽 위 넓은 하이라이트 + 고리를 따라 도는 밝은 띠
      const hl = ctx.createRadialGradient(minX + bw * 0.33, minY + bh * 0.28, 0, minX + bw * 0.36, minY + bh * 0.32, big * 0.32);
      hl.addColorStop(0, "rgba(255,255,255,0.5)"); hl.addColorStop(0.55, "rgba(255,255,255,0.12)"); hl.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = hl; ctx.fillRect(minX, minY, bw, bh);
      for (const [lw, al] of [[0.09, 0.05], [0.055, 0.08], [0.025, 0.14]] as const) {
        ctx.strokeStyle = `rgba(255,255,255,${al})`; ctx.lineWidth = big * lw;
        ctx.beginPath(); ctx.ellipse(midX, midY, ((bw / 2 + hole) / 2) * 0.98, ((bh / 2 + hole) / 2) * 0.98, 0, Math.PI * 1.08, Math.PI * 1.5); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    // 자국
    for (const d of dents) {
      const rr = FINGER_R * (1 + d.depth * 0.6), k = d.depth;
      const g1 = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, rr * 1.7);
      g1.addColorStop(0, `rgba(60, 30, 60, ${0.11 * k})`); g1.addColorStop(0.35, `rgba(60, 30, 60, ${0.06 * k})`); g1.addColorStop(0.62, "rgba(40,20,40,0)"); g1.addColorStop(1, "rgba(40,20,40,0)");
      ctx.fillStyle = g1; ctx.fillRect(d.x - rr * 2, d.y - rr * 2, rr * 4, rr * 4);
      const g3 = ctx.createRadialGradient(d.x + rr * 0.45, d.y + rr * 0.45, rr * 0.15, d.x + rr * 0.25, d.y + rr * 0.25, rr * 1.15);
      g3.addColorStop(0, `rgba(255, 255, 255, ${0.2 * k})`); g3.addColorStop(0.6, `rgba(255, 255, 255, ${0.06 * k})`); g3.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g3; ctx.fillRect(d.x - rr * 2, d.y - rr * 2, rr * 4, rr * 4);
    }
    ctx.restore();

    // 가장자리
    traceDonut();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.stroke();
    void t;
  });

  const setFinger = (id: number, x: number, y: number, dx: number, dy: number, pressed: boolean, dt = 1 / 60) => {
    const f = fingers.get(id);
    const vx = dx / dt, vy = dy / dt;
    if (f) { f.x = x; f.y = y; f.vx = vx; f.vy = vy; f.pressed = pressed; f.at = performance.now(); if (pressed) { f.dent.x = x; f.dent.y = y; } return f; }
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
      if (f) { f.dent = { x, y, depth: 0, held: true }; dents.push(f.dent); f.pressed = true; f.x = x; f.y = y; f.vx = 0; f.vy = 0; f.at = performance.now(); f.lastCrackX = x; f.lastCrackY = y; }
      else setFinger(id, x, y, 0, 0, true);
      if (mix < 0.85 && onDonut(x, y)) shatter(x, y, shatters.length === 0);
    },
    pointerMove(x, y, dx, dy, id, pressed) {
      const sp = Math.hypot(dx, dy);
      const k = sp > 18 ? 18 / sp : 1;
      const f = setFinger(id, x, y, dx * k, dy * k, pressed);
      if (!pressed || sp < 0.5) return;
      bbox();
      if (!onDonut(x, y)) return;
      if (shatters.length === 0) return; // 굳은 껍질은 문질러서는 안 부서진다 — 먼저 꾹
      kneadAt(x, y, dx, dy);
      if (mix < 0.6 && Math.hypot(x - f.lastCrackX, y - f.lastCrackY) > 70) {
        f.lastCrackX = x; f.lastCrackY = y;
        shatter(x, y);
        const sh = shatters[shatters.length - 1]; sh.grow = 0.7; sh.stage = 2; drawCrackLines(sh);
        for (const cell of sh.cells) if (cell.state === "off" && cell.d < 0.5) detach(cell);
      }
    },
    pointerUp(id) {
      const f = fingers.get(id);
      if (f) { f.pressed = false; f.vx = 0; f.vy = 0; f.dent.held = false; }
      if (id !== 0) fingers.delete(id);
    },
    wheel() {},
    tilt(fx, fy) { tilt = { x: fx, y: fy }; },
    idle() {},
    clear() { spawn(); },
    setSound(on) { sound = on; },
  };
};
