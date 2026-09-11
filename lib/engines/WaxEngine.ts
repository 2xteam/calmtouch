import { createCanvas2D, createLoop, DEEP_BG } from "@/lib/canvas/tools";
import { crackle } from "@/lib/audio/tones";
import { clamp, lerp, rand, TAU } from "@/lib/util/math";
import type { EngineFactory } from "./types";

/**
 * 왁뿌 — 파스텔 왁스를 입힌 도넛 모양 점토 (참고: 팔레트슬라임 "왕도넛 왁뿌", 2026-09-11 사용자 사진).
 *
 *   · 몸은 바깥 고리 96점의 점토 — 손 근처만, 손이 닿아 있을 때만 움직이고 떼면 굳는다
 *   · 속살 색은 도넛 경계 상자 (u,v) 의 **clay 캔버스**다. 가운데 구멍도 그 캔버스의 빈자리일 뿐이라
 *     문지르면 색이 서로 끌려 섞이고 구멍도 메워진다 (2026-09-11 정정: 구멍·색을 억지로 지키지 않는다)
 *   · 껍질(wax 캔버스): 분홍·하늘·노랑 세 구역 + 별 스프링클. 꾹 누르면 **조각조각** 갈라져 가운데 조각은
 *     떨어져 그 자리에 얹히고(flakes 캔버스) 바깥은 실금만. 문지르면 조각이 갈려 속살에 섞이고 껍질은 사라진다
 *   · 다 잠긴 뒤에도 누르고 있으면 **바닥까지 닿아 구멍이 뚫린다** — 껍질·조각·속살이 함께 뚫려 바닥이 보인다.
 *     문지르면 주변 점토가 끌려와 메워진다
 */
type Node = { x: number; y: number; vx: number; vy: number };
type Dent = { x: number; y: number; depth: number; held: boolean; through: number; punched: number };
type Finger = { x: number; y: number; vx: number; vy: number; pressed: boolean; at: number; dent: Dent; lastCrackX: number; lastCrackY: number };
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

  const N = 96;
  let outer: Node[] = [];
  let R = 100, hole = 34;
  let restArea = 0;
  const dents: Dent[] = [];
  const shatters: Shatter[] = [];

  const mk = (w: number, h: number) => { const cv = document.createElement("canvas"); cv.width = w; cv.height = h; return cv; };
  const clay = mk(TEX, TEX); const cctx = clay.getContext("2d")!;
  const wax = mk(TEX, TEX); const wctx = wax.getContext("2d")!;
  const flakes = mk(TEX, TEX); const fctx = flakes.getContext("2d")!;
  const body = mk(1, 1); const bctx = body.getContext("2d")!; // 화면 크기 — 속살·조각·껍질을 한 번 합친다
  const grain = mk(256, 256);
  {
    const g = grain.getContext("2d")!;
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = Math.random() < 0.65 ? `rgba(255,255,255,${rand(0.06, 0.24)})` : `rgba(90,60,90,${rand(0.03, 0.1)})`;
      g.fillRect(Math.random() * 256, Math.random() * 256, rand(1, 2.4), rand(1, 2.4));
    }
  }

  let minX = 0, maxX = 1, minY = 0, maxY = 1, bw = 1, bh = 1;

  /** (u,v) → 도넛 중심 기준 각도 → 파스텔 색 (세 구역 사이는 부드럽게). 처음 칠할 때만 쓴다 */
  const sectionColor = (u: number, v: number, pale = 0): [number, number, number] => {
    const a = Math.atan2(v - 0.5, u - 0.5) / TAU + 0.5;
    const p = (a * 3 + 0.15) % 3;
    const i = Math.floor(p), f = p - i;
    const blend = clamp((f - 0.7) / 0.3, 0, 1);
    const A = SECTIONS[i % 3], B = SECTIONS[(i + 1) % 3];
    return [0, 1, 2].map((k) => Math.round(lerp(lerp(A[k], B[k], blend), 255, pale))) as [number, number, number];
  };
  const paintSections = (g: CanvasRenderingContext2D, pale: number, mul: [number, number, number]) => {
    const seg = 96;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * TAU, a1 = ((i + 1.02) / seg) * TAU;
      const [r, gg, b] = sectionColor(0.5 + Math.cos((a0 + a1) / 2) * 0.3, 0.5 + Math.sin((a0 + a1) / 2) * 0.3, pale);
      g.fillStyle = `rgb(${(r * mul[0]) | 0},${(gg * mul[1]) | 0},${(b * mul[2]) | 0})`;
      g.beginPath(); g.moveTo(TEX / 2, TEX / 2); g.arc(TEX / 2, TEX / 2, TEX, a0, a1); g.closePath(); g.fill();
    }
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

  /** 속살·조각·껍질을 함께 뚫는다. rim 이면 구멍 둘레 속살에 어두운 벽을 그린다 */
  const punch = (u: number, v: number, ru: number, rim: boolean) => {
    const rv = ru * (bw / bh);
    for (const g of [cctx, wctx, fctx]) {
      g.globalCompositeOperation = "destination-out"; g.fillStyle = "rgb(0,0,0)";
      g.beginPath(); g.ellipse(u * TEX, v * TEX, ru * TEX, rv * TEX, 0, 0, TAU); g.fill();
      g.globalCompositeOperation = "source-over";
    }
    if (rim) {
      cctx.globalCompositeOperation = "source-atop";
      const gr = cctx.createRadialGradient(u * TEX, v * TEX, ru * TEX, u * TEX, v * TEX, ru * TEX * 1.6);
      gr.addColorStop(0, "rgba(70,35,70,0.5)"); gr.addColorStop(1, "rgba(70,35,70,0)");
      cctx.fillStyle = gr; cctx.fillRect((u - ru * 2) * TEX, (v - rv * 2) * TEX, ru * 4 * TEX, rv * 4 * TEX);
      cctx.globalCompositeOperation = "source-over";
    }
  };

  const recoat = () => {
    cctx.globalCompositeOperation = "source-over"; cctx.clearRect(0, 0, TEX, TEX);
    paintSections(cctx, 0, [0.9, 0.84, 0.86]);
    wctx.globalCompositeOperation = "source-over"; wctx.clearRect(0, 0, TEX, TEX);
    paintSections(wctx, 0.12, [1, 1, 1]);
    for (let i = 0; i < 1400; i++) {
      wctx.fillStyle = `rgba(255,255,255,${rand(0.05, 0.16)})`;
      wctx.fillRect(Math.random() * TEX, Math.random() * TEX, rand(1, 3), rand(1, 3));
    }
    for (let i = 0; i < 46; i++) {
      const a = rand(0, TAU), rr = rand(0.21, 0.46);
      star(wctx, (0.5 + Math.cos(a) * rr) * TEX, (0.5 + Math.sin(a) * rr) * TEX, rand(7, 11), rand(0, TAU), SPRINKLES[Math.floor(Math.random() * SPRINKLES.length)]);
    }
    fctx.globalCompositeOperation = "source-over"; fctx.clearRect(0, 0, TEX, TEX);
    shatters.length = 0;
    // 가운데 구멍 — 처음엔 뚫려 있지만 문지르면 메워질 수 있다
    bw = bh = 2 * R;
    punch(0.5, 0.5, hole / (2 * R), true);
  };

  const center = () => ({ x: c.w / 2, y: c.h / 2 });
  const spawn = () => {
    R = Math.min(c.w, c.h) * 0.37;
    hole = R * 0.34;
    const { x: cx, y: cy } = center();
    outer = [];
    for (let i = 0; i < N; i++) { const a = (i / N) * TAU; outer.push({ x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R, vx: 0, vy: 0 }); }
    restArea = area(outer);
    dents.length = 0;
    body.width = Math.max(1, Math.floor(c.w * c.dpr)); body.height = Math.max(1, Math.floor(c.h * c.dpr));
    bctx.setTransform(c.dpr, 0, 0, c.dpr, 0, 0);
    recoat();
  };
  const area = (loop: Node[]) => {
    let s = 0;
    for (let i = 0; i < loop.length; i++) { const a = loop[i], b = loop[(i + 1) % loop.length]; s += a.x * b.y - b.x * a.y; }
    return Math.abs(s) / 2;
  };

  const fingers = new Map<number, Finger>();
  const FINGER_R = 30;

  const bbox = () => {
    minX = 1e9; maxX = -1e9; minY = 1e9; maxY = -1e9;
    for (const n of outer) { if (n.x < minX) minX = n.x; if (n.x > maxX) maxX = n.x; if (n.y < minY) minY = n.y; if (n.y > maxY) maxY = n.y; }
    bw = Math.max(1, maxX - minX); bh = Math.max(1, maxY - minY);
  };
  spawn();
  const toUV = (x: number, y: number) => [(x - minX) / bw, (y - minY) / bh] as const;
  const insideLoop = (loop: Node[], x: number, y: number) => {
    let ins = false;
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const a = loop[i], b = loop[j];
      if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y + 1e-9) + a.x) ins = !ins;
    }
    return ins;
  };
  /** 그 자리에 속살이 있는가 (구멍이 아닌가) */
  const clayAt = (u: number, v: number) => {
    if (u < 0 || v < 0 || u >= 1 || v >= 1) return 0;
    return cctx.getImageData(Math.floor(u * TEX), Math.floor(v * TEX), 1, 1).data[3] / 255;
  };
  /** 그 자리에 껍질이 남아 있는가 — 없으면 더는 갈라질 것이 없다 */
  const waxAt = (u: number, v: number) => {
    if (u < 0 || v < 0 || u >= 1 || v >= 1) return 0;
    return wctx.getImageData(Math.floor(u * TEX), Math.floor(v * TEX), 1, 1).data[3] / 255;
  };
  const shellAt = (x: number, y: number) => { const [u, v] = toUV(x, y); return waxAt(u, v); };
  const onBody = (x: number, y: number) => { if (!insideLoop(outer, x, y)) return false; const [u, v] = toUV(x, y); return clayAt(u, v) > 0.15; };

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
    const asp = bw / bh;
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
      if (clayAt(cx, cy) < 0.15) continue; // 구멍 위에는 껍질이 없다
      if (waxAt(cx, cy) < 0.25) continue; // 이미 부서진 자리는 조각이 될 껍질이 없다
      const d = dist / rad;
      const state: Cell["state"] = d < 0.5 ? "off" : d < 0.78 ? (Math.random() < 0.6 ? "off" : "cracked") : "cracked";
      cells.push({ poly, cx, cy, ang: Math.atan2(cy - v, cx - u), d, state });
    }
    if (cells.length === 0) return;
    const sh: Shatter = { u, v, cells, grow: 0, stage: 0 };
    shatters.push(sh);
    for (const old of shatters) {
      if (old === sh) continue;
      for (const cell of old.cells) {
        if (cell.state === "cracked" && Math.hypot(cell.cx - u, (cell.cy - v) / asp) < rad * 0.9) { cell.state = "off"; detach(cell); }
      }
    }
    if (shatters.length > 30) shatters.shift();
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
        if (cell.d > 0.6 && Math.random() < 0.55) continue; // 바깥 실금은 군데군데 끊긴다
        const k = clamp(1.3 - cell.d, 0.35, 1);
        wctx.beginPath(); wctx.moveTo(a[0] * TEX, a[1] * TEX); wctx.lineTo(b[0] * TEX, b[1] * TEX);
        wctx.strokeStyle = `rgba(70, 50, 65, ${0.7 * k})`; wctx.lineWidth = 0.9 + k * 1.1; wctx.stroke();
        if (cell.d > 0.6) continue;
        wctx.strokeStyle = `rgba(255,255,255,${0.45 * k})`; wctx.lineWidth = 0.7;
        wctx.beginPath(); wctx.moveTo(a[0] * TEX + 1.2, a[1] * TEX + 1.2); wctx.lineTo(b[0] * TEX + 1.2, b[1] * TEX + 1.2); wctx.stroke();
      }
    }
    wctx.globalCompositeOperation = "source-over";
  };
  /** 조각을 껍질에서 떼어 flakes 캔버스에 얹는다 — 조금 밀리고, 돌아가고, 두께가 보이게 들리고, 몇은 뒤집힌다 */
  const detach = (cell: Cell) => {
    // 조각 색은 그 자리 껍질 색
    const px = Math.floor(clamp(cell.cx, 0, 0.999) * TEX), py = Math.floor(clamp(cell.cy, 0, 0.999) * TEX);
    const wp = wctx.getImageData(px, py, 1, 1).data;
    const cp = cctx.getImageData(px, py, 1, 1).data;
    const [r, g, b] = wp[3] > 40 ? [wp[0], wp[1], wp[2]] : [lerp(cp[0], 255, 0.12), lerp(cp[1], 255, 0.12), lerp(cp[2], 255, 0.12)];
    wctx.globalCompositeOperation = "destination-out";
    wctx.fillStyle = "rgb(0,0,0)";
    wctx.beginPath();
    cell.poly.forEach(([qx, qy], j) => (j === 0 ? wctx.moveTo(qx * TEX, qy * TEX) : wctx.lineTo(qx * TEX, qy * TEX)));
    wctx.closePath(); wctx.fill();
    wctx.globalCompositeOperation = "source-over";

    const flipped = Math.random() < 0.3;
    const shift = rand(0.004, 0.022) * (0.4 + cell.d);
    fctx.save();
    fctx.translate((cell.cx + Math.cos(cell.ang) * shift) * TEX, (cell.cy + Math.sin(cell.ang) * shift * (bw / bh)) * TEX);
    fctx.rotate(rand(-0.55, 0.55));
    const scale = rand(0.9, 1.05);
    const trace = (ox: number, oy: number) => {
      fctx.beginPath();
      cell.poly.forEach(([qx, qy], j) => {
        const X = (qx - cell.cx) * TEX * scale + ox, Y = (qy - cell.cy) * TEX * scale + oy;
        if (j === 0) fctx.moveTo(X, Y); else fctx.lineTo(X, Y);
      });
      fctx.closePath();
    };
    trace(3, 5); fctx.fillStyle = "rgba(50,30,50,0.26)"; fctx.fill();
    trace(1.5, 3); fctx.fillStyle = `rgb(${(r * 0.62) | 0},${(g * 0.6) | 0},${(b * 0.62) | 0})`; fctx.fill();
    trace(0, 0);
    fctx.fillStyle = flipped ? `rgb(${(r * 0.82) | 0},${(g * 0.8) | 0},${(b * 0.82) | 0})` : `rgb(${r | 0},${g | 0},${b | 0})`;
    fctx.fill();
    fctx.strokeStyle = flipped ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.7)"; fctx.lineWidth = 1.2; fctx.stroke();
    if (!flipped) {
      const gl = fctx.createRadialGradient(-2, -3, 0, -2, -3, 10);
      gl.addColorStop(0, "rgba(255,255,255,0.55)"); gl.addColorStop(1, "rgba(255,255,255,0)");
      fctx.fillStyle = gl; trace(0, 0); fctx.fill();
    }
    fctx.restore();
  };

  /**
   * 문지르기 — 손가락 아래 속살을 움직인 방향으로 끌어 색이 섞이고 구멍이 메워진다.
   * 껍질은 부서져 옅어지고, 조각과 껍질 색은 속살에 스며든다.
   */
  const kneadAt = (x: number, y: number, dx: number, dy: number) => {
    const [u, v] = toUV(x, y);
    const ru = (FINGER_R * 1.25) / bw, rv = ru * (bw / bh);
    const sx = (dx / bw) * TEX * 0.75, sy = (dy / bh) * TEX * 0.75;
    const clipTo = (g: CanvasRenderingContext2D) => { g.beginPath(); g.ellipse(u * TEX, v * TEX, ru * TEX, rv * TEX, 0, 0, TAU); g.clip(); };
    // 속살 끌기 + 껍질·조각 색 스며들기
    cctx.save(); clipTo(cctx);
    cctx.globalAlpha = 0.6; cctx.drawImage(clay, sx, sy);
    cctx.globalAlpha = 0.5; cctx.drawImage(clay, 0, 0); // 끌려온 얇은 살을 다시 뭉쳐 불투명하게
    cctx.globalAlpha = 0.14; cctx.drawImage(wax, sx * 0.5, sy * 0.5);
    cctx.globalAlpha = 0.2; cctx.drawImage(flakes, sx * 0.5, sy * 0.5);
    cctx.restore();
    // 조각도 함께 끌리며 갈려 옅어진다
    fctx.save(); clipTo(fctx);
    fctx.globalAlpha = 0.5; fctx.drawImage(flakes, sx, sy);
    fctx.globalCompositeOperation = "destination-out"; fctx.globalAlpha = 1; fctx.fillStyle = "rgba(0,0,0,0.16)";
    fctx.fillRect(0, 0, TEX, TEX);
    fctx.restore();
    // 껍질은 끌리지 않고 부서진다
    wctx.save(); clipTo(wctx);
    wctx.globalCompositeOperation = "destination-out"; wctx.fillStyle = "rgba(0,0,0,0.3)";
    for (let i = 0; i < 3; i++) {
      wctx.beginPath(); wctx.ellipse((u + rand(-ru, ru) * 0.6) * TEX, (v + rand(-rv, rv) * 0.6) * TEX, ru * TEX * rand(0.35, 0.7), rv * TEX * rand(0.35, 0.7), 0, 0, TAU); wctx.fill();
    }
    wctx.restore();
    if (sound && Math.random() < 0.05 && waxAt(u, v) > 0.2) crackle(0.2);
  };

  const loop = createLoop((dt) => {
    if (c.resize()) spawn();
    const h = Math.min(dt, 1 / 45);
    const sub = 5, hs = h / sub;
    const now = performance.now();
    for (const [id, f] of fingers) if (id === 0 && !f.pressed && now - f.at > 600) fingers.delete(id);

    bbox();
    // 자국 — 다 잠긴 뒤에도 누르고 있으면 바닥에 닿아 뚫린다 (점토라 뚫린 채 남는다)
    for (const d of dents) {
      if (!d.held) continue;
      d.depth = Math.min(1, d.depth + dt / 0.35);
      if (d.depth >= 1) d.through = Math.min(1, d.through + dt / 0.8);
      const [u, v] = toUV(d.x, d.y);
      if (d.through > 0.5 && d.punched < 1) { d.punched = 1; punch(u, v, (FINGER_R * 0.45) / bw, false); }
      if (d.through >= 1 && d.punched < 2) { d.punched = 2; punch(u, v, (FINGER_R * 0.8) / bw, true); if (sound) crackle(0.8); }
    }
    if (dents.length > 40) dents.splice(0, dents.length - 40);

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

    // 점토 — 손이 닿아 있을 때, 손 근처만
    const touching = [...fingers.values()].some((f) => f.pressed);
    if (!touching) { for (const n of outer) { n.vx = 0; n.vy = 0; } }
    else {
      for (let s = 0; s < sub; s++) {
        const A = area(outer);
        const pressureK = clamp((restArea - A) / restArea, -0.6, 0.6) * 1200;
        const REACH = R * 0.42;
        const near = (p: Node) => { let m = 1e9; for (const f of fingers.values()) if (f.pressed) m = Math.min(m, Math.hypot(p.x - f.x, p.y - f.y)); return m; };
        const restLen = (TAU * R) / N;
        for (let i = 0; i < N; i++) {
          const p = outer[i], l = outer[(i + N - 1) % N], r = outer[(i + 1) % N];
          if (near(p) > REACH) { p.vx = 0; p.vy = 0; continue; }
          let ax = 0, ay = 0;
          for (const o of [l, r]) { const dx = o.x - p.x, dy = o.y - p.y; const d = Math.hypot(dx, dy) || 0.001; ax += (dx / d) * (d - restLen) * 6; ay += (dy / d) * (d - restLen) * 6; }
          ax += ((l.x + r.x) / 2 - p.x) * 14; ay += ((l.y + r.y) / 2 - p.y) * 14;
          const nx = r.y - l.y, ny = -(r.x - l.x); const nl = Math.hypot(nx, ny) || 0.001;
          ax += (nx / nl) * pressureK; ay += (ny / nl) * pressureK;
          for (const d of dents) { const dx = p.x - d.x, dy = p.y - d.y; const dist = Math.hypot(dx, dy) || 0.001; const w = Math.exp(-((dist / (R * 0.2)) ** 2)); ax += (dx / dist) * d.depth * 900 * w; ay += (dy / dist) * d.depth * 900 * w; }
          p.vx += ax * hs; p.vy += ay * hs;
        }
        for (const f of fingers.values()) {
          const reach = R * 0.36;
          for (const p of outer) {
            const dx = p.x - f.x, dy = p.y - f.y; const d = Math.hypot(dx, dy) || 0.001;
            if (d > reach) continue;
            const w = 1 - d / reach;
            if (f.pressed) { const k = w * w * 0.7; p.vx = lerp(p.vx, f.vx, k); p.vy = lerp(p.vy, f.vy, k); }
            if (d < FINGER_R) { const push = FINGER_R - d; p.x += (dx / d) * push; p.y += (dy / d) * push; p.vx *= 0.5; p.vy *= 0.5; }
          }
        }
        const dampK = Math.exp(-26 * hs);
        const vxs = new Float32Array(N), vys = new Float32Array(N);
        for (let i = 0; i < N; i++) { const l = outer[(i + N - 1) % N], r = outer[(i + 1) % N], p = outer[i]; vxs[i] = p.vx * 0.2 + (l.vx + r.vx) * 0.4; vys[i] = p.vy * 0.2 + (l.vy + r.vy) * 0.4; }
        for (let i = 0; i < N; i++) { const p = outer[i]; p.vx = vxs[i] * dampK; p.vy = vys[i] * dampK; p.x = clamp(p.x + p.vx * hs, 6, c.w - 6); p.y = clamp(p.y + p.vy * hs, 6, c.h - 6); }
      }
      outer = resample(outer);
      const sx = new Float32Array(N), sy = new Float32Array(N);
      for (let i = 0; i < N; i++) { const l = outer[(i + N - 1) % N], r = outer[(i + 1) % N], p = outer[i]; sx[i] = lerp(p.x, (l.x + r.x) / 2, 0.12); sy[i] = lerp(p.y, (l.y + r.y) / 2, 0.12); }
      for (let i = 0; i < N; i++) { outer[i].x = sx[i]; outer[i].y = sy[i]; }
      bbox();
    }

    // ── 그리기 ──
    const bg = ctx.createRadialGradient(c.w / 2, c.h / 2, 0, c.w / 2, c.h / 2, Math.max(c.w, c.h) * 0.75);
    bg.addColorStop(0, "#0e2f38"); bg.addColorStop(1, DEEP_BG);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, c.w, c.h);
    const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2, big = Math.max(bw, bh);

    const traceLoop = (g: CanvasRenderingContext2D) => {
      for (let i = 0; i < N; i++) {
        const a = outer[i], b = outer[(i + 1) % N]; const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        if (i === 0) g.moveTo(mx, my); else g.quadraticCurveTo(a.x, a.y, mx, my);
      }
      const a0 = outer[0], b0 = outer[1];
      g.quadraticCurveTo(a0.x, a0.y, (a0.x + b0.x) / 2, (a0.y + b0.y) / 2);
      g.closePath();
    };

    // 접촉 그림자 (구멍 아래 바닥도 몸 밑이라 함께 어둡다)
    for (let k = 6; k >= 1; k--) {
      ctx.save(); ctx.translate(midX + big * 0.012, midY + big * 0.03); ctx.scale(1 + k * 0.014, 1 + k * 0.014); ctx.translate(-midX, -midY);
      ctx.beginPath(); traceLoop(ctx); ctx.fillStyle = "rgba(0, 10, 14, 0.09)"; ctx.fill(); ctx.restore();
    }

    // 몸 합치기 — 속살 위에만 결·두께·광택이 얹히게 source-atop
    bctx.globalCompositeOperation = "source-over";
    bctx.clearRect(0, 0, c.w, c.h);
    bctx.drawImage(clay, minX, minY, bw, bh);
    bctx.globalCompositeOperation = "source-atop";
    bctx.globalAlpha = 0.3; bctx.drawImage(grain, minX, minY, bw, bh); bctx.globalAlpha = 1;
    for (let k = 0; k < 6; k++) {
      const f = k / 5;
      bctx.lineWidth = big * 0.08 * (1 - f) + 2;
      bctx.strokeStyle = `rgba(60, 40, 60, ${0.05 + f * 0.03})`;
      bctx.beginPath(); traceLoop(bctx); bctx.stroke();
    }
    bctx.globalCompositeOperation = "source-over";
    bctx.drawImage(flakes, minX, minY, bw, bh);
    bctx.drawImage(wax, minX, minY, bw, bh);
    bctx.globalCompositeOperation = "source-atop";
    const hl = bctx.createRadialGradient(minX + bw * 0.33, minY + bh * 0.28, 0, minX + bw * 0.36, minY + bh * 0.32, big * 0.32);
    hl.addColorStop(0, "rgba(255,255,255,0.42)"); hl.addColorStop(0.55, "rgba(255,255,255,0.1)"); hl.addColorStop(1, "rgba(255,255,255,0)");
    bctx.fillStyle = hl; bctx.fillRect(minX, minY, bw, bh);
    for (const [lw, al] of [[0.09, 0.05], [0.055, 0.08], [0.025, 0.14]] as const) {
      bctx.strokeStyle = `rgba(255,255,255,${al})`; bctx.lineWidth = big * lw;
      bctx.beginPath(); bctx.ellipse(midX, midY, (bw / 2) * 0.67, (bh / 2) * 0.67, 0, Math.PI * 1.08, Math.PI * 1.5); bctx.stroke();
    }
    // 자국 — 뚫린 곳은 벌써 비어 있으니 그 둘레만 어둡다
    for (const d of dents) {
      const rr = FINGER_R * (1 + d.depth * 0.6), k = d.depth;
      const g1 = bctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, rr * 1.7);
      g1.addColorStop(0, `rgba(60, 30, 60, ${(0.11 + 0.2 * d.through) * k})`); g1.addColorStop(0.35, `rgba(60, 30, 60, ${(0.06 + 0.1 * d.through) * k})`); g1.addColorStop(0.62, "rgba(60,30,60,0)"); g1.addColorStop(1, "rgba(60,30,60,0)");
      bctx.fillStyle = g1; bctx.fillRect(d.x - rr * 2, d.y - rr * 2, rr * 4, rr * 4);
      const g3 = bctx.createRadialGradient(d.x + rr * 0.45, d.y + rr * 0.45, rr * 0.15, d.x + rr * 0.25, d.y + rr * 0.25, rr * 1.15);
      g3.addColorStop(0, `rgba(255, 255, 255, ${0.2 * k})`); g3.addColorStop(0.6, `rgba(255, 255, 255, ${0.06 * k})`); g3.addColorStop(1, "rgba(255,255,255,0)");
      bctx.fillStyle = g3; bctx.fillRect(d.x - rr * 2, d.y - rr * 2, rr * 4, rr * 4);
    }
    bctx.globalCompositeOperation = "source-over";

    ctx.save();
    ctx.beginPath(); traceLoop(ctx); ctx.clip();
    ctx.drawImage(body, 0, 0, c.w, c.h);
    ctx.restore();
  });

  const setFinger = (id: number, x: number, y: number, dx: number, dy: number, pressed: boolean, dt = 1 / 60) => {
    const f = fingers.get(id);
    const vx = dx / dt, vy = dy / dt;
    if (f) {
      f.x = x; f.y = y; f.vx = vx; f.vy = vy; f.pressed = pressed; f.at = performance.now();
      if (pressed) {
        // 끌면 뚫기는 멈춘다 — 이미 뚫린 자국은 두고 새 자국을 잇는다
        if (f.dent.punched > 0 && Math.hypot(x - f.dent.x, y - f.dent.y) > FINGER_R * 0.6) { f.dent.held = false; f.dent = { x, y, depth: 1, held: true, through: 0, punched: 0 }; dents.push(f.dent); }
        else { f.dent.x = x; f.dent.y = y; if (Math.hypot(dx, dy) > 1.5 && f.dent.punched === 0) f.dent.through = 0; }
      }
      return f;
    }
    const dent: Dent = { x, y, depth: 0, held: pressed, through: 0, punched: 0 };
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
      if (f) { f.dent = { x, y, depth: 0, held: true, through: 0, punched: 0 }; dents.push(f.dent); f.pressed = true; f.x = x; f.y = y; f.vx = 0; f.vy = 0; f.at = performance.now(); f.lastCrackX = x; f.lastCrackY = y; }
      else setFinger(id, x, y, 0, 0, true);
      if (onBody(x, y) && shellAt(x, y) > 0.3) shatter(x, y, shatters.length === 0);
    },
    pointerMove(x, y, dx, dy, id, pressed) {
      const sp = Math.hypot(dx, dy);
      const k = sp > 18 ? 18 / sp : 1;
      const f = setFinger(id, x, y, dx * k, dy * k, pressed);
      if (!pressed || sp < 0.5) return;
      bbox();
      if (!insideLoop(outer, x, y)) return;
      if (shatters.length === 0) return; // 굳은 껍질은 문질러서는 안 부서진다 — 먼저 꾹
      kneadAt(x, y, dx, dy);
      if (Math.hypot(x - f.lastCrackX, y - f.lastCrackY) > 70 && onBody(x, y) && shellAt(x, y) > 0.3) {
        f.lastCrackX = x; f.lastCrackY = y;
        const before = shatters.length;
        shatter(x, y);
        if (shatters.length === before) return;
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
    tilt() {},
    idle() {},
    clear() { spawn(); },
    setSound(on) { sound = on; },
  };
};
