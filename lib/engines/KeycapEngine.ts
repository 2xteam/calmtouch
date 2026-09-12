import { createCanvas2D, createLoop, DEEP_BG } from "@/lib/canvas/tools";
import { thock } from "@/lib/audio/tones";
import { clamp, damp, hexToRgb255, lerp, rand, TAU } from "@/lib/util/math";
import type { EngineFactory } from "./types";

/**
 * 키캡 키링 — 기계식 키캡을 톡톡 누르는 장면 (2026-09-12 사용자 사진 여섯 장: 투명 케이스 9구, 흰 케이스 3×3,
 * 검정 케이스 1구, 피규어 키캡, 캐릭터 인쇄 키캡, 스위치가 보이는 투명 키캡).
 *
 *   · **살짝 사선(오블리크)** 에서 본다 — 눌리는 깊이가 보인다. 투영은 아핀이라 윗면의 무늬·오목함은
 *     `ctx.transform` 하나로 그대로 얹힌다
 *   · 종류(`params.style`): pastel(파스텔 단색) · clear(투명 — 스위치·LED 가 비친다) · figure(위에 3D 피규어 —
 *     하트·클로버·별·꽃) · print(윗면에 캐릭터 인쇄) · mix(1개면 보통, 2개 이상이면 키마다 무작위)
 *   · 조정 값: 키캡 수 1~9(`count`), LED(`led`). 지우기 = 횟수 0 + 새로 섞기. 자판으로도 눌린다
 */
type Style = "pastel" | "clear" | "figure" | "print";
type Fig = "heart" | "clover" | "star" | "flower";
type Icon = "face" | "flower" | "cat" | "dino" | "bear";
type Look = { style: Style; color: string; fig: Fig; icon: Icon; ink: string; stem: string };
type Key = { gx: number; gy: number; press: number; target: number; hit: number; flash: number; look: Look };
type Wave = { at: number; idx: number; amt: number };

const PASTELS = ["#f7c6d3", "#f9dcb8", "#f9f1b5", "#c9ecd0", "#bfe0f7", "#d8ccf5", "#fbfbfb", "#ffd6e7"];
const INKS = ["#e2637e", "#e58d3b", "#3f9e6b", "#3b7fd6", "#8a63d8", "#d64c4c"];
const STEMS = ["#e39a4a", "#c95b5b", "#5e7fd6", "#7ac2a0"];
const FIGS: Fig[] = ["heart", "clover", "star", "flower"];
const ICONS: Icon[] = ["face", "flower", "cat", "dino", "bear"];

// 오블리크 투영 — 카메라가 앞·오른쪽·위에서 본다
const TH = 0.42, CT = Math.cos(TH), ST = Math.sin(TH), FL = 0.6;
// 키 하나의 치수 (키 간격 = 1)
const CAP_B = 0.44, CAP_T = 0.33, CAP_H = 0.4, CAP_Z = 0.1;
const CASE_H = 0.3, CASE_PAD = 0.2;

export const createKeycapEngine: EngineFactory = (canvas, ctx0) => {
  const c = createCanvas2D(canvas);
  const { ctx } = c;
  let sound = ctx0.sound;
  const baseStyle = (ctx0.scene.params?.style as Style | "mix" | undefined) ?? "pastel";
  let count = 4;
  let led = true;
  for (const ctl of ctx0.scene.controls ?? []) {
    if (ctl.key === "count" && ctl.kind === "stepper") count = ctl.default;
    if (ctl.key === "led" && ctl.kind === "switch") led = ctl.default;
  }
  let keys: Key[] = [];
  let cols = 1, rows = 1, S = 80, cx = 0, cy = 0;
  let caseColor = "#f4f5f7";
  let total = 0;
  let ledMix = led ? 1 : 0;
  const waves: Wave[] = [];
  const pressedBy = new Map<number | string, number>();

  const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
  const makeLook = (i: number, n: number, palette: string[]): Look => {
    const style: Style = baseStyle === "mix" ? (n === 1 ? "pastel" : pick(["pastel", "clear", "figure", "print"] as Style[])) : baseStyle;
    return { style, color: palette[i % palette.length], fig: pick(FIGS), icon: pick(ICONS), ink: pick(INKS), stem: pick(STEMS) };
  };
  const shuffle = () => {
    cols = Math.min(count, count <= 4 ? Math.ceil(Math.sqrt(count)) : 3);
    if (count === 2 || count === 3) cols = count;
    rows = Math.ceil(count / cols);
    caseColor = pick(["#f4f5f7", "#f4f5f7", "#22262b", "rgba(230,240,246,0.55)"]);
    // 팔레트 — 사진처럼 줄마다 번지는 톤이거나 제각각 파스텔
    const graded = Math.random() < 0.5;
    const base = pick(PASTELS.slice(0, 6));
    const palette = graded ? [ "#fbfbfb", lerpHex("#fbfbfb", base, 0.55), base, lerpHex(base, pick(PASTELS), 0.6) ] : [...PASTELS].sort(() => Math.random() - 0.5);
    keys = [];
    for (let i = 0; i < count; i++) {
      const col = i % cols, row = Math.floor(i / cols);
      const rowCount = row === rows - 1 ? count - row * cols : cols;
      const gx = col - (rowCount - 1) / 2, gy = row - (rows - 1) / 2;
      const pi = graded ? row + col : i;
      keys.push({ gx, gy, press: 0, target: 0, hit: 0, flash: 0, look: makeLook(pi, count, palette) });
    }
    fit();
  };
  function lerpHex(a: string, b: string, t: number) {
    const A = hexToRgb255(a), B = hexToRgb255(b);
    return `rgb(${lerp(A[0], B[0], t) | 0},${lerp(A[1], B[1], t) | 0},${lerp(A[2], B[2], t) | 0})`;
  }
  const fit = () => {
    const wU = (cols + CASE_PAD * 2) * CT + (rows + CASE_PAD * 2) * ST + 0.6;
    const hU = ((cols + CASE_PAD * 2) * ST + (rows + CASE_PAD * 2) * CT) * FL + CAP_H + CASE_H + 0.9;
    S = clamp(Math.min((c.w * 0.86) / wU, (c.h * 0.52) / hU), 34, 170);
    cx = c.w / 2; cy = c.h * 0.56 + (CASE_H * S) / 2;
  };
  const P = (x: number, y: number, z: number): [number, number] => [cx + (x * CT - y * ST) * S, cy + (x * ST + y * CT) * FL * S - z * S];
  const depth = (x: number, y: number) => x * ST + y * CT;
  shuffle();

  // ── 입력 ──
  const pressKey = (i: number) => {
    const k = keys[i];
    if (!k || k.target === 1) return;
    k.target = 1; k.hit = 1; total++;
    if (sound) thock(0.94 + (i % 4) * 0.04);
    if (led) {
      const now = performance.now();
      for (let j = 0; j < keys.length; j++) {
        const d = Math.hypot(keys[j].gx - k.gx, keys[j].gy - k.gy);
        waves.push({ at: now + d * 70, idx: j, amt: Math.exp(-d * 0.6) });
      }
    }
  };
  const releaseKey = (i: number) => { const k = keys[i]; if (k) k.target = 0; };
  const topQuad = (k: Key) => {
    const z = CAP_Z + CAP_H - k.press * 0.2;
    return [P(k.gx - CAP_T, k.gy - CAP_T, z), P(k.gx + CAP_T, k.gy - CAP_T, z), P(k.gx + CAP_T, k.gy + CAP_T, z), P(k.gx - CAP_T, k.gy + CAP_T, z)];
  };
  const inPoly = (pts: [number, number][], x: number, y: number) => {
    let ins = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1] + 1e-9) + a[0]) ins = !ins;
    }
    return ins;
  };
  const keyAt = (x: number, y: number) => {
    // 앞쪽(가까운) 키부터 — 겹치면 앞 키가 이긴다
    const order = keys.map((k, i) => i).sort((a, b) => depth(keys[b].gx, keys[b].gy) - depth(keys[a].gx, keys[a].gy));
    for (const i of order) {
      const k = keys[i];
      // 윗면 + 앞면까지 눌리는 영역으로 (앞면은 윗면을 아래로 CAP_H 만큼 늘인 것)
      const q = topQuad(k);
      const ext: [number, number][] = [q[0], q[1], [q[1][0], q[1][1] + CAP_H * S * 0.9], [q[3][0], q[3][1] + CAP_H * S * 0.9], q[3]];
      if (inPoly(q, x, y) || inPoly(ext, x, y)) return i;
    }
    return -1;
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "BUTTON" || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (e.key === "Escape" || e.key === "Tab" || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    const code = e.key.length === 1 ? e.key.toUpperCase().charCodeAt(0) : e.key.charCodeAt(0);
    const i = code % keys.length;
    pressedBy.set("k" + e.code, i); pressKey(i);
    if (e.key === " ") e.preventDefault();
  };
  const onKeyUp = (e: KeyboardEvent) => { const i = pressedBy.get("k" + e.code); if (i === undefined) return; pressedBy.delete("k" + e.code); releaseKey(i); };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  // ── 그리기 도구 ──
  const shade = (col: string, k: number, a = 1) => {
    const [r, g, b] = col.startsWith("rgb") ? (col.match(/[\d.]+/g)!.slice(0, 3).map(Number) as [number, number, number]) : hexToRgb255(col);
    return `rgba(${clamp(r * k, 0, 255) | 0},${clamp(g * k, 0, 255) | 0},${clamp(b * k, 0, 255) | 0},${a})`;
  };
  const quad = (pts: [number, number][], fill: string) => {
    ctx.beginPath(); pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1]))); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
  };
  /** 윗면(z 평면)의 로컬 좌표 (u,v) → 화면. 로컬 1 = 키 간격 1 */
  const withTop = (x: number, y: number, z: number, draw: () => void) => {
    const o = P(x, y, z), ex = P(x + 1, y, z), ey = P(x, y + 1, z);
    ctx.save();
    ctx.transform(ex[0] - o[0], ex[1] - o[1], ey[0] - o[0], ey[1] - o[1], o[0], o[1]);
    draw();
    ctx.restore();
  };
  /** 위가 좁은 사각뿔대(키캡) — 앞·오른쪽 면 + 윗면 */
  const frustum = (x: number, y: number, z0: number, b: number, t: number, h: number, col: string, alpha = 1) => {
    const B = [P(x - b, y - b, z0), P(x + b, y - b, z0), P(x + b, y + b, z0), P(x - b, y + b, z0)];
    const T = [P(x - t, y - t, z0 + h), P(x + t, y - t, z0 + h), P(x + t, y + t, z0 + h), P(x - t, y + t, z0 + h)];
    ctx.globalAlpha = alpha;
    quad([B[1], B[2], T[2], T[1]], shade(col, 0.72)); // 오른쪽
    quad([B[3], B[2], T[2], T[3]], shade(col, 0.86)); // 앞
    quad([B[0], B[1], T[1], T[0]], shade(col, 0.95)); // 뒤 (살짝 보인다)
    quad([B[0], B[3], T[3], T[0]], shade(col, 0.9)); // 왼쪽
    quad(T, shade(col, 1.04));
    ctx.globalAlpha = 1;
    return T;
  };
  const roundRectPath = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
    g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h); g.lineTo(x + r, y + h);
    g.quadraticCurveTo(x, y + h, x, y + h - r); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
  };
  const figPath = (g: CanvasRenderingContext2D, fig: Fig, r: number) => {
    g.beginPath();
    if (fig === "heart") {
      g.moveTo(0, r * 0.9); g.bezierCurveTo(-r * 1.3, -r * 0.1, -r * 0.7, -r * 1.05, 0, -r * 0.4); g.bezierCurveTo(r * 0.7, -r * 1.05, r * 1.3, -r * 0.1, 0, r * 0.9);
    } else if (fig === "star") {
      for (let i = 0; i < 10; i++) { const rr = i % 2 === 0 ? r : r * 0.48; const a = (i / 10) * TAU - Math.PI / 2; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    } else if (fig === "clover") {
      for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU; g.moveTo(0, 0); g.arc(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, r * 0.5, 0, TAU); }
    } else {
      for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU - Math.PI / 2; g.moveTo(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55); g.arc(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55, r * 0.42, 0, TAU); }
      g.moveTo(r * 0.3, 0); g.arc(0, 0, r * 0.3, 0, TAU);
    }
    g.closePath();
  };
  const drawIcon = (g: CanvasRenderingContext2D, icon: Icon, ink: string, s: number) => {
    g.lineCap = "round"; g.lineJoin = "round"; g.strokeStyle = ink; g.fillStyle = ink; g.lineWidth = s * 0.09;
    if (icon === "face") {
      g.beginPath(); g.arc(0, 0, s * 0.42, 0, TAU); g.stroke();
      g.beginPath(); g.arc(-s * 0.15, -s * 0.08, s * 0.045, 0, TAU); g.arc(s * 0.15, -s * 0.08, s * 0.045, 0, TAU); g.fill();
      g.beginPath(); g.arc(0, s * 0.05, s * 0.2, 0.25 * Math.PI, 0.75 * Math.PI); g.stroke();
      g.fillStyle = "rgba(240,120,140,0.45)"; g.beginPath(); g.arc(-s * 0.27, s * 0.08, s * 0.07, 0, TAU); g.arc(s * 0.27, s * 0.08, s * 0.07, 0, TAU); g.fill();
    } else if (icon === "flower") {
      for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; g.beginPath(); g.ellipse(Math.cos(a) * s * 0.25, Math.sin(a) * s * 0.25, s * 0.16, s * 0.11, a, 0, TAU); g.fill(); }
      g.fillStyle = "#f9e27a"; g.beginPath(); g.arc(0, 0, s * 0.12, 0, TAU); g.fill();
    } else if (icon === "cat") {
      g.beginPath(); g.arc(0, s * 0.05, s * 0.36, 0, TAU); g.stroke();
      g.beginPath(); g.moveTo(-s * 0.3, -s * 0.15); g.lineTo(-s * 0.32, -s * 0.48); g.lineTo(-s * 0.06, -s * 0.3); g.moveTo(s * 0.3, -s * 0.15); g.lineTo(s * 0.32, -s * 0.48); g.lineTo(s * 0.06, -s * 0.3); g.stroke();
      g.beginPath(); g.arc(-s * 0.13, 0, s * 0.04, 0, TAU); g.arc(s * 0.13, 0, s * 0.04, 0, TAU); g.fill();
      g.beginPath(); g.moveTo(-s * 0.08, s * 0.14); g.lineTo(0, s * 0.2); g.lineTo(s * 0.08, s * 0.14); g.stroke();
    } else if (icon === "dino") {
      g.beginPath(); g.ellipse(s * 0.02, s * 0.1, s * 0.3, s * 0.22, 0, 0, TAU); g.fill();
      g.beginPath(); g.arc(-s * 0.22, -s * 0.2, s * 0.15, 0, TAU); g.fill();
      g.beginPath(); g.moveTo(s * 0.28, s * 0.1); g.lineTo(s * 0.5, -s * 0.05); g.lineTo(s * 0.32, s * 0.22); g.closePath(); g.fill();
      g.fillStyle = "#fff"; g.beginPath(); g.arc(-s * 0.26, -s * 0.22, s * 0.04, 0, TAU); g.fill();
      g.strokeStyle = "#fff"; g.lineWidth = s * 0.05; g.beginPath(); for (let i = -1; i <= 1; i++) { g.moveTo(-s * 0.05 + i * s * 0.12, -s * 0.12); g.lineTo(-s * 0.05 + i * s * 0.12, -s * 0.24); } g.stroke();
    } else {
      g.beginPath(); g.arc(0, s * 0.04, s * 0.34, 0, TAU); g.fill();
      g.beginPath(); g.arc(-s * 0.26, -s * 0.24, s * 0.12, 0, TAU); g.arc(s * 0.26, -s * 0.24, s * 0.12, 0, TAU); g.fill();
      g.fillStyle = "#fff8ef"; g.beginPath(); g.ellipse(0, s * 0.14, s * 0.15, s * 0.11, 0, 0, TAU); g.fill();
      g.fillStyle = "#3a2a24"; g.beginPath(); g.arc(-s * 0.12, -s * 0.02, s * 0.04, 0, TAU); g.arc(s * 0.12, -s * 0.02, s * 0.04, 0, TAU); g.arc(0, s * 0.1, s * 0.045, 0, TAU); g.fill();
    }
  };

  const hueOf = (i: number, t: number) => (t * 40 + i * 30) % 360;

  const loop = createLoop((dt, t) => {
    if (c.resize()) fit();
    ledMix = lerp(ledMix, led ? 1 : 0, 1 - damp(6, dt));
    const now = performance.now();
    for (let i = waves.length - 1; i >= 0; i--) { const w = waves[i]; if (now >= w.at) { const k = keys[w.idx]; if (k) k.flash = Math.max(k.flash, w.amt); waves.splice(i, 1); } }
    for (const k of keys) {
      k.press = k.target === 1 ? lerp(k.press, 1, 1 - damp(30, dt)) : lerp(k.press, 0, 1 - damp(15, dt));
      k.hit *= damp(6, dt); k.flash *= damp(3.2, dt);
    }

    // 바탕
    const bg = ctx.createRadialGradient(c.w / 2, c.h * 0.55, 0, c.w / 2, c.h * 0.55, Math.max(c.w, c.h) * 0.8);
    bg.addColorStop(0, "#10303a"); bg.addColorStop(1, DEEP_BG);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, c.w, c.h);

    // 횟수
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const topY = P(0, -rows / 2 - CASE_PAD, CAP_Z + CAP_H)[1] - clamp(c.h * 0.11, 56, 96);
    ctx.font = `700 ${clamp(c.w * 0.09, 34, 64)}px Pretendard, system-ui, sans-serif`;
    ctx.fillStyle = "rgba(238, 247, 248, 0.92)";
    ctx.fillText(total.toLocaleString("ko-KR"), c.w / 2, topY);
    ctx.font = `600 ${clamp(c.w * 0.03, 12, 15)}px Pretendard, system-ui, sans-serif`;
    ctx.fillStyle = "rgba(238, 247, 248, 0.5)";
    ctx.fillText(total === 0 ? "키캡을 톡톡 눌러요 · 자판으로도 쳐 봐요" : "번 눌렀어요", c.w / 2, topY + clamp(c.w * 0.06, 28, 44));

    // 케이스 — 그림자 · 옆면 · 윗면(둥근 모서리)
    const hx = cols / 2 + CASE_PAD, hy = rows / 2 + CASE_PAD;
    const clear = caseColor.startsWith("rgba");
    for (let k = 5; k >= 1; k--) {
      const g = k * 0.06;
      ctx.fillStyle = "rgba(0, 8, 12, 0.08)";
      quad([P(-hx - g, -hy - g, -CASE_H), P(hx + g * 2.2, -hy - g, -CASE_H), P(hx + g * 2.2, hy + g * 2, -CASE_H), P(-hx - g, hy + g * 2, -CASE_H)], "rgba(0, 8, 12, 0.08)");
    }
    const caseAlpha = clear ? 0.55 : 1;
    ctx.globalAlpha = caseAlpha;
    quad([P(hx, -hy, -CASE_H), P(hx, hy, -CASE_H), P(hx, hy, 0), P(hx, -hy, 0)], shade(caseColor, clear ? 0.9 : 0.74));
    quad([P(-hx, hy, -CASE_H), P(hx, hy, -CASE_H), P(hx, hy, 0), P(-hx, hy, 0)], shade(caseColor, clear ? 0.95 : 0.86));
    withTop(0, 0, 0, () => {
      roundRectPath(ctx, -hx, -hy, hx * 2, hy * 2, 0.14); ctx.fillStyle = shade(caseColor, 1); ctx.fill();
      // 키 자리 — 스위치 구멍(어둡게) + LED 비침
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        roundRectPath(ctx, k.gx - 0.42, k.gy - 0.42, 0.84, 0.84, 0.08); ctx.fillStyle = clear ? "rgba(20,30,36,0.35)" : shade(caseColor, 0.6); ctx.fill();
        const glow = ledMix * (0.5 + 0.5 * Math.sin(t * 1.4 + i)) + k.flash * 1.5;
        if (glow > 0.02) {
          const g = ctx.createRadialGradient(k.gx, k.gy, 0.05, k.gx, k.gy, 0.75);
          g.addColorStop(0, `hsla(${hueOf(i, t)} 100% 62% / ${clamp(glow * 0.9, 0, 1)})`); g.addColorStop(1, `hsla(${hueOf(i, t)} 100% 62% / 0)`);
          ctx.fillStyle = g; ctx.fillRect(k.gx - 0.8, k.gy - 0.8, 1.6, 1.6);
        }
      }
    });
    ctx.globalAlpha = 1;
    // 키링 — 왼쪽 위 모서리
    {
      const [rx, ry] = P(-hx - 0.05, -hy - 0.05, -CASE_H * 0.4);
      ctx.strokeStyle = "#c9ced4"; ctx.lineWidth = Math.max(2, S * 0.05);
      ctx.beginPath(); ctx.ellipse(rx - S * 0.32, ry - S * 0.1, S * 0.24, S * 0.18, -0.5, 0, TAU); ctx.stroke();
      ctx.strokeStyle = "#e8ecf0"; ctx.lineWidth = Math.max(1, S * 0.02);
      ctx.beginPath(); ctx.ellipse(rx - S * 0.32, ry - S * 0.1, S * 0.24, S * 0.18, -0.5, 3.6, 5.2); ctx.stroke();
      for (let j = 0; j < 3; j++) { ctx.strokeStyle = "#b8bec6"; ctx.lineWidth = Math.max(2, S * 0.045); ctx.beginPath(); ctx.ellipse(rx - S * 0.1 + j * S * 0.05, ry + j * S * 0.02 - S * 0.02, S * 0.05, S * 0.035, 0.6, 0, TAU); ctx.stroke(); }
    }

    // 키 — 먼 것부터
    const order = keys.map((k, i) => i).sort((a, b) => depth(keys[a].gx, keys[a].gy) - depth(keys[b].gx, keys[b].gy));
    for (const i of order) {
      const k = keys[i]; const L = k.look;
      const z0 = CAP_Z - k.press * 0.2;
      const hh = hueOf(i, t);
      const glow = ledMix * (0.5 + 0.5 * Math.sin(t * 1.4 + i)) + k.flash * 1.5;

      if (L.style === "clear") {
        // 스위치 — 하우징(반투명 흰 상자) + 스템(색 있는 십자) + 스프링 선
        frustum(k.gx, k.gy, 0.02, 0.3, 0.28, 0.2, "#e6ecef", 0.85);
        withTop(k.gx, k.gy, 0.22 - k.press * 0.16, () => {
          ctx.fillStyle = L.stem; ctx.fillRect(-0.045, -0.13, 0.09, 0.26); ctx.fillRect(-0.13, -0.045, 0.26, 0.09);
        });
        const [sx, sy] = P(k.gx, k.gy, 0.12);
        for (let j = 0; j < 4; j++) { ctx.strokeStyle = "rgba(120,130,140,0.6)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(sx, sy - j * S * 0.03, S * 0.1, S * 0.035, 0, 0, TAU); ctx.stroke(); }
        if (glow > 0.02) {
          const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, S * 0.5);
          g.addColorStop(0, `hsla(${hh} 100% 70% / ${clamp(glow * 0.9, 0, 1)})`); g.addColorStop(1, `hsla(${hh} 100% 70% / 0)`);
          ctx.fillStyle = g; ctx.fillRect(sx - S * 0.5, sy - S * 0.5, S, S);
        }
        const T = frustum(k.gx, k.gy, z0, CAP_B, CAP_T, CAP_H, L.color, 0.42);
        ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 1;
        ctx.beginPath(); T.forEach((p, j) => (j === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1]))); ctx.closePath(); ctx.stroke();
        const B0 = P(k.gx + CAP_B, k.gy - CAP_B, z0), B1 = P(k.gx + CAP_B, k.gy + CAP_B, z0), B2 = P(k.gx - CAP_B, k.gy + CAP_B, z0);
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.beginPath(); ctx.moveTo(B0[0], B0[1]); ctx.lineTo(T[1][0], T[1][1]); ctx.moveTo(B1[0], B1[1]); ctx.lineTo(T[2][0], T[2][1]); ctx.moveTo(B2[0], B2[1]); ctx.lineTo(T[3][0], T[3][1]); ctx.stroke();
      } else {
        const col = L.style === "print" ? pick2(L, "#fbfbf6", L.color) : L.color;
        frustum(k.gx, k.gy, z0, CAP_B, CAP_T, CAP_H, col);
        // 윗면 — 오목한 접시 + 빛
        withTop(k.gx, k.gy, z0 + CAP_H, () => {
          // 오목한 접시 — 가운데만 아주 옅게 어둡다. 가장자리에 흰 고리를 두면 얼룩처럼 보인다
          const dish = ctx.createRadialGradient(0.02, 0.03, 0.02, 0, 0, CAP_T * 1.15);
          dish.addColorStop(0, "rgba(0,0,0,0.07)"); dish.addColorStop(0.8, "rgba(0,0,0,0)"); dish.addColorStop(1, "rgba(0,0,0,0)");
          roundRectPath(ctx, -CAP_T, -CAP_T, CAP_T * 2, CAP_T * 2, 0.06); ctx.fillStyle = dish; ctx.fill();
          // 빛 받는 두 모서리(뒤·왼쪽)만 얇게 밝게
          ctx.strokeStyle = "rgba(255,255,255,0.45)"; ctx.lineWidth = 0.018;
          ctx.beginPath(); ctx.moveTo(-CAP_T + 0.04, CAP_T - 0.02); ctx.lineTo(-CAP_T + 0.02, -CAP_T + 0.04); ctx.lineTo(CAP_T - 0.02, -CAP_T + 0.02); ctx.stroke();
          if (L.style === "print") { ctx.save(); ctx.scale(1, 1); drawIcon(ctx, L.icon, L.ink, CAP_T * 1.7); ctx.restore(); }
        });
        if (L.style === "figure") {
          // 3D 피규어 — 어두운 밑동을 z 방향으로 쌓아 올리고 맨 위에 밝은 면
          const figH = 0.16, steps = 6;
          const figCol = L.ink;
          for (let s2 = 0; s2 <= steps; s2++) {
            const z = z0 + CAP_H + (figH * s2) / steps;
            withTop(k.gx, k.gy, z, () => {
              figPath(ctx, L.fig, CAP_T * 0.62); ctx.fillStyle = s2 === steps ? shade(figCol, 1.08) : shade(figCol, 0.72 + (s2 / steps) * 0.1); ctx.fill();
            });
          }
          withTop(k.gx, k.gy, z0 + CAP_H + figH, () => {
            figPath(ctx, L.fig, CAP_T * 0.62); ctx.save(); ctx.clip();
            const hl = ctx.createRadialGradient(-0.06, -0.08, 0, -0.04, -0.05, 0.22); hl.addColorStop(0, "rgba(255,255,255,0.6)"); hl.addColorStop(1, "rgba(255,255,255,0)");
            ctx.fillStyle = hl; ctx.fillRect(-0.4, -0.4, 0.8, 0.8); ctx.restore();
          });
        }
      }
      // 각인 없이도 LED 가 켜지면 캡 아래 가장자리로 빛이 새어 나온다
      if (glow > 0.02 && L.style !== "clear") {
        const [gx, gy] = P(k.gx, k.gy + CAP_B, z0);
        const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, S * 0.55);
        g.addColorStop(0, `hsla(${hh} 100% 65% / ${clamp(glow * 0.35, 0, 1)})`); g.addColorStop(1, `hsla(${hh} 100% 65% / 0)`);
        ctx.fillStyle = g; ctx.fillRect(gx - S * 0.6, gy - S * 0.3, S * 1.2, S * 0.5);
      }
    }
  });
  const pick2 = (L: Look, a: string, b: string) => (L.fig === "heart" || L.fig === "star" ? a : b); // 인쇄 키캡 바탕: 흰색 또는 파스텔

  return {
    start: () => loop.start(),
    stop: () => loop.stop(),
    dispose: () => { loop.stop(); window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); },
    pointerDown(x, y, id) { const i = keyAt(x, y); if (i >= 0) { pressedBy.set(id, i); pressKey(i); } },
    pointerMove(x, y, _dx, _dy, id, pressed) {
      if (!pressed) return;
      const cur = pressedBy.get(id); const i = keyAt(x, y);
      if (cur !== undefined && i !== cur) { releaseKey(cur); pressedBy.delete(id); }
      if (i >= 0 && i !== cur) { pressedBy.set(id, i); pressKey(i); }
    },
    pointerUp(id) { const i = pressedBy.get(id); if (i !== undefined) { releaseKey(i); pressedBy.delete(id); } },
    wheel() {},
    tilt() {},
    idle() {},
    clear() { total = 0; shuffle(); },
    setSound(on) { sound = on; },
    setParam(key, value) {
      if (key === "count" && typeof value === "number") { count = clamp(Math.round(value), 1, 9); shuffle(); }
      if (key === "led" && typeof value === "boolean") led = value;
    },
  };
};
