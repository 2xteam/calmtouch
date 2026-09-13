import { createCanvas2D, createLoop, DEEP_BG } from "@/lib/canvas/tools";
import { gameFanfare, gamePop, keySound, type SwitchKind } from "@/lib/audio/tones";
import { clamp, damp, hexToRgb255, lerp, TAU } from "@/lib/util/math";
import type { EngineFactory } from "./types";

/**
 * 키캡 키링 — 기계식 키캡을 톡톡 누르는 장면 (2026-09-12 사용자 사진: 투명 케이스 9구, 흰 케이스 3×3, 검정 1구,
 * 캐릭터 피규어(톰과 제리 흉상이 캡 위에 얹힌) 키캡, 캐릭터 인쇄 키캡, 스위치가 보이는 투명 키캡).
 *
 *   · **살짝 사선(오블리크)** 에서 본다 — 눌리는 깊이가 보인다. 투영이 아핀이라 윗면 무늬·글자·피규어 밑동은
 *     `ctx.transform` 하나로 얹는다. 피규어 머리(구)는 화면 공간에서 그린다 — 구는 어디서 봐도 원이다
 *   · 종류(`params.style`) — pastel(색 랜덤) · emoji(색 + 이모티콘) · figure(색 + 위에 3D 피규어: 곰·고양이·토끼·오리·하트·별·클로버·꽃)
 *     · clear(투명 — 스위치가 보인다) · pudding(윗면만 불투명, 옆은 우유빛 반투명 — LED 가 옆으로 새는 요즘 인기 캡)
 *     · print(윗면 캐릭터 인쇄) · typewriter(둥근 크롬 테 타자기 캡) · mix(키마다 무작위)
 *   · **키캡 수를 늘리면 하나씩 덧붙는다** — 있던 키는 그대로, 새 키만 새로 뽑는다. 줄이면 끝에서 뺀다
 *   · **축(`switch`)**: 적·청·갈·흑·무접점. 소리가 다르고(`keySound`), 캡 아래 틈으로 보이는 스템 색이 바뀐다
 *   · 조정 값 키캡 수 1~9 · LED · 축. 지우기 = 횟수 0 + 전부 새로 섞기. 자판으로도 눌린다
 */
type Style = "pastel" | "emoji" | "figure" | "clear" | "pudding" | "print" | "typewriter";
type Fig = "bear" | "cat" | "rabbit" | "duck" | "heart" | "star" | "clover" | "flower";
type Icon = "face" | "flower" | "cat" | "dino" | "bear";
type Look = { style: Style; color: string; emoji: string; fig: Fig; figColor: string; icon: Icon; ink: string; letter: string };
type Key = { gx: number; gy: number; press: number; target: number; hit: number; flash: number; look: Look; wobble: number; wobPhase: number; drips: number[] };
type Wave = { at: number; idx: number; amt: number };
type Confetti = { x: number; y: number; vx: number; vy: number; rot: number; vr: number; size: number; life: number; color: string; star: boolean };

const PASTELS = ["#f7c6d3", "#f9dcb8", "#f9f1b5", "#c9ecd0", "#bfe0f7", "#d8ccf5", "#fbfbfb", "#ffd6e7", "#cfeef0", "#e9d6c3"];
const INKS = ["#e2637e", "#e58d3b", "#3f9e6b", "#3b7fd6", "#8a63d8", "#d64c4c"];
const EMOJI = ["🍓", "🌸", "⭐", "💖", "🐻", "🍀", "🌙", "☁️", "🍑", "🦋", "🐱", "🍒", "🌈", "🧸", "🎀", "🐥", "🍋", "🫧", "🐸", "🍡"];
const FIGS: Fig[] = ["bear", "cat", "rabbit", "duck", "heart", "star", "clover", "flower"];
const ICONS: Icon[] = ["face", "flower", "cat", "dino", "bear"];
const STYLES: Style[] = ["pastel", "emoji", "figure", "clear", "pudding", "print", "typewriter"];
/** 축 — 스템 색. 무접점은 러버돔의 보라 */
const SWITCH_COLOR: Record<SwitchKind, string> = { red: "#d9463f", blue: "#3b7bd6", brown: "#8b5a3c", black: "#2a2d31", topre: "#8e6bd9" };
const SWITCH_NAME: Record<SwitchKind, string> = { red: "적축", blue: "청축", brown: "갈축", black: "흑축", topre: "무접점" };

// 오블리크 투영 — 카메라가 앞·오른쪽·위에서 본다
const TH = 0.42, CT = Math.cos(TH), ST = Math.sin(TH), FL = 0.6;
// 키 하나의 치수 (키 간격 = 1)
const CAP_B = 0.44, CAP_T = 0.33, CAP_H = 0.4, CAP_Z = 0.2, TRAVEL = 0.15;
const CASE_H = 0.3, CASE_PAD = 0.2;

export const createKeycapEngine: EngineFactory = (canvas, ctx0) => {
  const c = createCanvas2D(canvas);
  const { ctx } = c;
  let sound = ctx0.sound;
  const baseStyle = (ctx0.scene.params?.style as Style | "mix" | undefined) ?? "pastel";
  let count = 4;
  let led = true;
  let sw: SwitchKind = "red";
  let haptic = true;
  const canVibrate = typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
  for (const ctl of ctx0.scene.controls ?? []) {
    if (ctl.key === "count" && ctl.kind === "stepper") count = ctl.default;
    if (ctl.key === "led" && ctl.kind === "switch") led = ctl.default;
    if (ctl.key === "haptic" && ctl.kind === "switch") haptic = ctl.default;
    if (ctl.key === "switch" && ctl.kind === "choice") sw = ctl.default as SwitchKind;
  }
  let keys: Key[] = [];
  let cols = 1, rows = 1, S = 80, cx = 0, cy = 0;
  let caseColor = "#f4f5f7";
  let total = 0;
  let ledMix = led ? 1 : 0;
  const waves: Wave[] = [];
  const pressedBy = new Map<number | string, number>();
  /** 풍선 숫자 — 누를 때마다 통통, 자릿수가 늘면(10·100·1000) 더 크게 부풀고 축하가 커진다 */
  let bounce = 0, levelPop = 0, ringLife = 0, ringLevel = 1;
  const confetti: Confetti[] = [];
  const digitsOf = (n: number) => Math.max(1, String(Math.max(0, n)).length);
  /**
   * 축하 — `level` 은 터지는 크기(2=열 단위, 3=백 단위, 4=천 단위 …), `grow` 는 자릿수가 늘어 글자가 커지는 순간인가.
   * 열 단위는 동전 소리로 가볍게, 백 단위부터는 팡파르로 (2026-09-13 사용자: 모든 단위에서 나게).
   */
  const celebrate = (level: number, x: number, y: number, grow = true) => {
    levelPop = grow ? 1 : 0.45; ringLife = 1; ringLevel = grow ? level : Math.max(1, level - 1);
    if (sound) { if (grow || level >= 3) gameFanfare(level); else gamePop(level); }
    const n = grow ? 14 + level * 10 : 6 + level * 5;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, sp = (160 + Math.random() * 260) * (0.8 + level * 0.25);
      confetti.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120 * level, rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 12, size: 4 + Math.random() * 5 + level, life: 1.1 + Math.random() * 0.5, color: `hsl(${(Math.random() * 360) | 0} 90% 68%)`, star: Math.random() < 0.3 });
    }
  };

  const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
  const makeLook = (): Look => {
    const style: Style = baseStyle === "mix" ? (keys.length === 0 && count === 1 ? "pastel" : pick(STYLES)) : baseStyle;
    return { style, color: pick(PASTELS), emoji: pick(EMOJI), fig: pick(FIGS), figColor: pick(INKS), icon: pick(ICONS), ink: pick(INKS), letter: pick("ABCDEFGHJKLMNPQRSTUVWXYZ&#*!?".split("")) };
  };
  const layout = () => {
    cols = count <= 4 ? Math.ceil(Math.sqrt(count)) : 3;
    if (count === 2 || count === 3) cols = count;
    rows = Math.ceil(count / cols);
    for (let i = 0; i < keys.length; i++) {
      const col = i % cols, row = Math.floor(i / cols);
      const rowCount = row === rows - 1 ? count - row * cols : cols;
      keys[i].gx = col - (rowCount - 1) / 2; keys[i].gy = row - (rows - 1) / 2;
    }
    fit();
  };
  /** 키캡 수 맞추기 — 있던 키는 두고 새 키만 뽑는다 */
  const setCount = (n: number) => {
    count = clamp(Math.round(n), 1, 9);
    while (keys.length < count) keys.push({ gx: 0, gy: 0, press: 0, target: 0, hit: 0, flash: 0, look: makeLook(), wobble: 0, wobPhase: 0, drips: Array.from({ length: 5 }, () => 0.5 + Math.random() * 0.5) });
    if (keys.length > count) keys.length = count;
    layout();
  };
  const shuffle = () => {
    keys = [];
    caseColor = pick(["#f4f5f7", "#f4f5f7", "#22262b", "rgba(230,240,246,0.55)"]);
    setCount(count);
  };
  const fit = () => {
    const wU = (cols + CASE_PAD * 2) * CT + (rows + CASE_PAD * 2) * ST + 0.6;
    const hU = ((cols + CASE_PAD * 2) * ST + (rows + CASE_PAD * 2) * CT) * FL + CAP_H + CASE_H + 1.1;
    S = clamp(Math.min((c.w * 0.86) / wU, (c.h * 0.52) / hU), 34, 170);
    cx = c.w / 2; cy = c.h * 0.57 + (CASE_H * S) / 2;
  };
  const P = (x: number, y: number, z: number): [number, number] => [cx + (x * CT - y * ST) * S, cy + (x * ST + y * CT) * FL * S - z * S];
  const depth = (x: number, y: number) => x * ST + y * CT;
  shuffle();

  // ── 입력 ──
  const pressKey = (i: number) => {
    const k = keys[i];
    if (!k || k.target === 1) return;
    k.target = 1; k.hit = 1;
    const before = digitsOf(total);
    total++;
    bounce = 1;
    // 0 이 몇 개로 끝나는지가 곧 축하의 크기 — 10·20·110 은 열 단위, 100·200·1300 은 백 단위, 1000·2000 은 천 단위
    const digits = digitsOf(total);
    let tier = 0;
    for (let pow = 10; pow <= 1e12 && total % pow === 0; pow *= 10) tier++;
    if (tier > 0) celebrate(tier + 1, c.w / 2, counterY, digits > before);
    if (haptic && canVibrate) navigator.vibrate(sw === "topre" ? 14 : sw === "blue" ? [6, 10, 6] : 9);
    if (sound) keySound(sw, "down", 0.92 + (i % 5) * 0.04);
    if (led) {
      const now = performance.now();
      for (let j = 0; j < keys.length; j++) {
        const d = Math.hypot(keys[j].gx - k.gx, keys[j].gy - k.gy);
        waves.push({ at: now + d * 70, idx: j, amt: Math.exp(-d * 0.6) });
      }
    }
  };
  const releaseKey = (i: number) => { const k = keys[i]; if (!k || k.target === 0) return; k.target = 0; k.wobble = 1; k.wobPhase = 0; if (sound) keySound(sw, "up", 0.92 + (i % 5) * 0.04); };
  const topQuad = (k: Key) => {
    const z = CAP_Z + CAP_H - k.press * TRAVEL;
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
    const order = keys.map((k, i) => i).sort((a, b) => depth(keys[b].gx, keys[b].gy) - depth(keys[a].gx, keys[a].gy));
    for (const i of order) {
      const q = topQuad(keys[i]);
      const ext: [number, number][] = [q[0], q[1], [q[1][0], q[1][1] + CAP_H * S * 0.9], [q[3][0], q[3][1] + CAP_H * S * 0.9], q[3]];
      // 피규어 머리까지 눌리는 영역으로
      const up: [number, number][] = [[q[0][0], q[0][1] - S * 0.55], [q[1][0], q[1][1] - S * 0.55], q[2], q[3]];
      if (inPoly(q, x, y) || inPoly(ext, x, y) || (keys[i].look.style === "figure" && inPoly(up, x, y))) return i;
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
  const rgbOf = (col: string): [number, number, number] =>
    col.startsWith("rgb") ? (col.match(/[\d.]+/g)!.slice(0, 3).map(Number) as [number, number, number]) : hexToRgb255(col);
  const shade = (col: string, k: number, a = 1) => {
    const [r, g, b] = rgbOf(col);
    return `rgba(${clamp(r * k, 0, 255) | 0},${clamp(g * k, 0, 255) | 0},${clamp(b * k, 0, 255) | 0},${a})`;
  };
  const path = (pts: [number, number][]) => { ctx.beginPath(); pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1]))); ctx.closePath(); };
  const quad = (pts: [number, number][], fill: string | CanvasGradient) => { path(pts); ctx.fillStyle = fill; ctx.fill(); };
  /** 위→아래로 옅게 어두워지는 옆면 — 평면 한 색보다 둥글게 읽힌다 */
  const sideGrad = (top: [number, number][], bottom: [number, number][], col: string, k: number) => {
    const g = ctx.createLinearGradient((top[0][0] + top[1][0]) / 2, (top[0][1] + top[1][1]) / 2, (bottom[0][0] + bottom[1][0]) / 2, (bottom[0][1] + bottom[1][1]) / 2);
    g.addColorStop(0, shade(col, k + 0.08)); g.addColorStop(1, shade(col, k - 0.1));
    return g;
  };
  /** 윗면(z 평면)의 로컬 좌표 → 화면. 로컬 1 = 키 간격 1 */
  const withTop = (x: number, y: number, z: number, draw: () => void) => {
    const o = P(x, y, z), ex = P(x + 1, y, z), ey = P(x, y + 1, z);
    ctx.save(); ctx.transform(ex[0] - o[0], ex[1] - o[1], ey[0] - o[0], ey[1] - o[1], o[0], o[1]); draw(); ctx.restore();
  };
  /** 같은 평면인데 로컬 1 = 1px — 글자·이모티콘은 px 크기로 그려야 또렷하다 */
  const withTopPx = (x: number, y: number, z: number, draw: () => void) => {
    const o = P(x, y, z), ex = P(x + 1, y, z), ey = P(x, y + 1, z);
    ctx.save(); ctx.transform((ex[0] - o[0]) / S, (ex[1] - o[1]) / S, (ey[0] - o[0]) / S, (ey[1] - o[1]) / S, o[0], o[1]); draw(); ctx.restore();
  };
  /** 위가 좁은 사각뿔대(키캡) — 옆면 넷 + 윗면. alpha 로 투명 캡, sideAlpha 로 푸딩 */
  const frustum = (x: number, y: number, z0: number, b: number, t: number, h: number, col: string, alpha = 1, sideCol = col, sideAlpha = alpha, jelly?: { dx: number; dy: number; sq: number }) => {
    const B = [P(x - b, y - b, z0), P(x + b, y - b, z0), P(x + b, y + b, z0), P(x - b, y + b, z0)];
    // 흐물흐물 — 윗면만 옆으로 밀리고 납작해진다 (밑은 스위치에 붙어 있다)
    const jx = jelly?.dx ?? 0, jy = jelly?.dy ?? 0, sq = jelly?.sq ?? 1, tw = t * (2 - sq) ** 0.5, hz = h * sq;
    const T = [P(x - tw + jx, y - tw + jy, z0 + hz), P(x + tw + jx, y - tw + jy, z0 + hz), P(x + tw + jx, y + tw + jy, z0 + hz), P(x - tw + jx, y + tw + jy, z0 + hz)];
    ctx.globalAlpha = sideAlpha;
    quad([B[0], B[1], T[1], T[0]], sideGrad([T[0], T[1]], [B[0], B[1]], sideCol, 0.95)); // 뒤
    quad([B[0], B[3], T[3], T[0]], sideGrad([T[0], T[3]], [B[0], B[3]], sideCol, 0.9)); // 왼쪽
    quad([B[1], B[2], T[2], T[1]], sideGrad([T[1], T[2]], [B[1], B[2]], sideCol, 0.72)); // 오른쪽
    quad([B[3], B[2], T[2], T[3]], sideGrad([T[3], T[2]], [B[3], B[2]], sideCol, 0.86)); // 앞
    ctx.globalAlpha = alpha;
    quad(T, shade(col, 1.04));
    ctx.globalAlpha = 1;
    return { T, B };
  };
  const roundRectPath = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
    g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h); g.lineTo(x + r, y + h);
    g.quadraticCurveTo(x, y + h, x, y + h - r); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
  };
  /** 윗면 마감 — 오목한 접시 · 빛 받는 두 모서리 */
  const topFinish = () => {
    const dish = ctx.createRadialGradient(0.02, 0.03, 0.02, 0, 0, CAP_T * 1.15);
    dish.addColorStop(0, "rgba(0,0,0,0.07)"); dish.addColorStop(0.8, "rgba(0,0,0,0)"); dish.addColorStop(1, "rgba(0,0,0,0)");
    roundRectPath(ctx, -CAP_T, -CAP_T, CAP_T * 2, CAP_T * 2, 0.06); ctx.fillStyle = dish; ctx.fill();
    const sheen = ctx.createLinearGradient(-CAP_T, -CAP_T, CAP_T * 0.4, CAP_T * 0.4);
    sheen.addColorStop(0, "rgba(255,255,255,0.22)"); sheen.addColorStop(0.5, "rgba(255,255,255,0)");
    ctx.fillStyle = sheen; ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.45)"; ctx.lineWidth = 0.018;
    ctx.beginPath(); ctx.moveTo(-CAP_T + 0.04, CAP_T - 0.02); ctx.lineTo(-CAP_T + 0.02, -CAP_T + 0.04); ctx.lineTo(CAP_T - 0.02, -CAP_T + 0.02); ctx.stroke();
  };
  const flatFig = (g: CanvasRenderingContext2D, fig: Fig, r: number) => {
    g.beginPath();
    if (fig === "heart") { g.moveTo(0, r * 0.9); g.bezierCurveTo(-r * 1.3, -r * 0.1, -r * 0.7, -r * 1.05, 0, -r * 0.4); g.bezierCurveTo(r * 0.7, -r * 1.05, r * 1.3, -r * 0.1, 0, r * 0.9); }
    else if (fig === "star") { for (let i = 0; i < 10; i++) { const rr = i % 2 === 0 ? r : r * 0.48; const a = (i / 10) * TAU - Math.PI / 2; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } }
    else if (fig === "clover") { for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU; g.moveTo(0, 0); g.arc(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, r * 0.5, 0, TAU); } }
    else { for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU - Math.PI / 2; g.moveTo(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55); g.arc(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55, r * 0.42, 0, TAU); } g.moveTo(r * 0.3, 0); g.arc(0, 0, r * 0.3, 0, TAU); }
    g.closePath();
  };
  /** 구 — 화면 공간. 왼쪽 위에서 빛 */
  const sphere = (x: number, y: number, r: number, col: string) => {
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, shade(col, 1.25)); g.addColorStop(0.55, shade(col, 1)); g.addColorStop(1, shade(col, 0.62));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  };
  /** 캐릭터 머리 피규어 — 캡 위에 얹힌 흉상 (톰과 제리 피규어 키캡처럼) */
  const headFig = (k: Key, zTop: number, fig: Fig, col: string) => {
    const r = S * 0.2;
    const [hx, hy] = P(k.gx, k.gy + 0.02, zTop);
    const cyy = hy - r * 0.95;
    withTop(k.gx, k.gy, zTop, () => { ctx.fillStyle = "rgba(0,0,0,0.22)"; ctx.beginPath(); ctx.ellipse(0.02, 0.05, 0.19, 0.17, 0, 0, TAU); ctx.fill(); });
    if (fig === "rabbit") {
      for (const sgn of [-1, 1]) {
        ctx.fillStyle = shade(col, 0.96); ctx.beginPath(); ctx.ellipse(hx + sgn * r * 0.42, cyy - r * 1.15, r * 0.24, r * 0.62, sgn * 0.15, 0, TAU); ctx.fill();
        ctx.fillStyle = "rgba(255,170,190,0.6)"; ctx.beginPath(); ctx.ellipse(hx + sgn * r * 0.42, cyy - r * 1.15, r * 0.11, r * 0.42, sgn * 0.15, 0, TAU); ctx.fill();
      }
    }
    if (fig === "bear") { sphere(hx - r * 0.72, cyy - r * 0.62, r * 0.32, col); sphere(hx + r * 0.72, cyy - r * 0.62, r * 0.32, col); }
    if (fig === "cat") { ctx.fillStyle = shade(col, 0.95); for (const sgn of [-1, 1]) { ctx.beginPath(); ctx.moveTo(hx + sgn * r * 0.35, cyy - r * 0.7); ctx.lineTo(hx + sgn * r * 0.95, cyy - r * 1.35); ctx.lineTo(hx + sgn * r * 0.95, cyy - r * 0.3); ctx.closePath(); ctx.fill(); } }
    sphere(hx, cyy, r, col);
    ctx.fillStyle = "#2b2326";
    ctx.beginPath(); ctx.arc(hx - r * 0.3, cyy - r * 0.05, r * 0.08, 0, TAU); ctx.arc(hx + r * 0.3, cyy - r * 0.05, r * 0.08, 0, TAU); ctx.fill();
    if (fig === "duck") {
      ctx.fillStyle = "#f08a2c"; ctx.beginPath(); ctx.ellipse(hx, cyy + r * 0.3, r * 0.42, r * 0.2, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.15)"; ctx.beginPath(); ctx.ellipse(hx, cyy + r * 0.34, r * 0.4, r * 0.07, 0, 0, TAU); ctx.fill();
    } else {
      ctx.fillStyle = fig === "bear" ? "#f6e7d8" : "rgba(255,255,255,0.75)"; ctx.beginPath(); ctx.ellipse(hx, cyy + r * 0.3, r * 0.3, r * 0.22, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = "#2b2326"; ctx.beginPath(); ctx.arc(hx, cyy + r * 0.22, r * 0.07, 0, TAU); ctx.fill();
      ctx.strokeStyle = "#2b2326"; ctx.lineWidth = Math.max(1, r * 0.05); ctx.beginPath(); ctx.arc(hx, cyy + r * 0.28, r * 0.12, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke();
    }
    ctx.fillStyle = "rgba(240,120,140,0.4)"; ctx.beginPath(); ctx.arc(hx - r * 0.55, cyy + r * 0.2, r * 0.13, 0, TAU); ctx.arc(hx + r * 0.55, cyy + r * 0.2, r * 0.13, 0, TAU); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.beginPath(); ctx.arc(hx - r * 0.42, cyy - r * 0.45, r * 0.13, 0, TAU); ctx.fill();
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
  /** 스위치 — 하우징(우유빛 상자) + 축 색 스템 (+ 스프링). 캡 아래 틈으로 보인다 */
  const drawSwitch = (k: Key, press: number, full: boolean) => {
    const stemCol = SWITCH_COLOR[sw];
    if (full) {
      frustum(k.gx, k.gy, 0.02, 0.3, 0.28, 0.12, sw === "topre" ? "#f1eef8" : "#e9eef1", 0.9);
      const [sx, sy] = P(k.gx, k.gy, 0.14);
      for (let j = 0; j < 3; j++) { ctx.strokeStyle = "rgba(120,130,140,0.55)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(sx, sy - j * S * 0.03 - S * 0.02, S * 0.1, S * 0.035, 0, 0, TAU); ctx.stroke(); }
    }
    // 불투명 캡 아래에서는 하우징 자체를 축 색으로 — 캡과 케이스 사이 틈으로 색이 보인다 (2026-09-12 사용자: 축 색이 보여야)
    if (!full) frustum(k.gx, k.gy, 0.02, 0.31, 0.29, 0.12, sw === "topre" ? "#efe8fb" : shade(stemCol, 1.12), 1);
    const zt = CAP_Z + 0.06 - press * TRAVEL;
    if (sw === "topre") {
      const [dx, dy] = P(k.gx, k.gy, 0.1);
      ctx.fillStyle = stemCol; ctx.beginPath(); ctx.ellipse(dx, dy - S * 0.05, S * 0.2, S * 0.16, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.beginPath(); ctx.ellipse(dx - S * 0.06, dy - S * 0.1, S * 0.07, S * 0.04, 0, 0, TAU); ctx.fill();
    } else frustum(k.gx, k.gy, 0.1, 0.13, 0.12, zt - 0.1, stemCol, 1);
  };

  const hueOf = (i: number, t: number) => (t * 40 + i * 30) % 360;
  let counterY = 0;

  /** 풍선 글자 — 글자마다 그림자·짙은 테·위에서 아래로 짙어지는 파스텔·작은 빛점. 살짝씩 따로 흔들린다 */
  const drawBalloonNumber = (text: string, x: number, y: number, size: number, hue: number, t: number) => {
    ctx.font = `900 ${size}px Pretendard, system-ui, sans-serif`;
    ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.lineJoin = "round"; ctx.lineCap = "round";
    const chars = [...text];
    const widths = chars.map((ch) => ctx.measureText(ch).width);
    const gap = size * 0.05;
    const totalW = widths.reduce((a, b) => a + b, 0) + gap * (chars.length - 1);
    let px = x - totalW / 2;
    chars.forEach((ch, i) => {
      const wob = Math.sin(t * 2.4 + i * 0.9) * size * 0.035;
      const cyy = y + wob;
      const h = (hue + i * 14) % 360;
      ctx.fillStyle = "rgba(0, 10, 14, 0.35)"; ctx.fillText(ch, px + size * 0.03, cyy + size * 0.08);
      ctx.lineWidth = size * 0.16; ctx.strokeStyle = `hsl(${h} 55% 28%)`; ctx.strokeText(ch, px, cyy);
      const g = ctx.createLinearGradient(0, cyy - size * 0.5, 0, cyy + size * 0.5);
      g.addColorStop(0, `hsl(${h} 95% 90%)`); g.addColorStop(0.55, `hsl(${h} 90% 72%)`); g.addColorStop(1, `hsl(${h} 85% 58%)`);
      ctx.fillStyle = g; ctx.fillText(ch, px, cyy);
      if (ch !== "," && ch !== ".") {
        ctx.fillStyle = "rgba(255,255,255,0.75)";
        ctx.beginPath(); ctx.ellipse(px + widths[i] * 0.3, cyy - size * 0.24, size * 0.09, size * 0.055, -0.5, 0, TAU); ctx.fill();
      }
      px += widths[i] + gap;
    });
  };

  const loop = createLoop((dt, t) => {
    if (c.resize()) fit();
    ledMix = lerp(ledMix, led ? 1 : 0, 1 - damp(6, dt));
    const now = performance.now();
    for (let i = waves.length - 1; i >= 0; i--) { const w = waves[i]; if (now >= w.at) { const k = keys[w.idx]; if (k) k.flash = Math.max(k.flash, w.amt); waves.splice(i, 1); } }
    for (const k of keys) {
      k.press = k.target === 1 ? lerp(k.press, 1, 1 - damp(32, dt)) : lerp(k.press, 0, 1 - damp(15, dt));
      k.hit *= damp(6, dt); k.flash *= damp(3.2, dt);
      k.wobble *= damp(3.2, dt); k.wobPhase += dt * 20;
    }

    const bg = ctx.createRadialGradient(c.w / 2, c.h * 0.55, 0, c.w / 2, c.h * 0.55, Math.max(c.w, c.h) * 0.8);
    bg.addColorStop(0, "#10303a"); bg.addColorStop(1, DEEP_BG);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, c.w, c.h);

    // 횟수 — 풍선 숫자. 자릿수만큼 크고, 누르면 통통, 자릿수가 늘면 크게 부풀며 축하
    bounce *= damp(7, dt); levelPop *= damp(3.5, dt); ringLife = Math.max(0, ringLife - dt * 0.9);
    const level = digitsOf(total);
    const topY = P(0, -rows / 2 - CASE_PAD, CAP_Z + CAP_H)[1] - clamp(c.h * 0.13, 64, 120);
    counterY = topY;
    const baseSize = clamp(c.w * 0.1, 36, 68) * Math.min(1.9, 1 + 0.16 * (level - 1));
    const scale = 1 + bounce * 0.22 + levelPop * 0.5;
    const hue = (196 + level * 42) % 360;
    if (ringLife > 0) {
      const e = 1 - ringLife;
      for (let r = 0; r < ringLevel; r++) {
        const rad = (baseSize * 0.9 + e * baseSize * (1.6 + r * 0.9)) * (0.8 + ringLevel * 0.15);
        ctx.strokeStyle = `hsla(${(hue + r * 50) % 360} 90% 72% / ${ringLife * 0.6})`; ctx.lineWidth = Math.max(1, (1 - e) * 6);
        ctx.beginPath(); ctx.arc(c.w / 2, topY, rad, 0, TAU); ctx.stroke();
      }
    }
    ctx.save(); ctx.translate(c.w / 2, topY); ctx.scale(scale, scale); ctx.translate(-c.w / 2, -topY);
    drawBalloonNumber(total.toLocaleString("ko-KR"), c.w / 2, topY, baseSize, hue, t);
    ctx.restore();
    // 축하 종이 조각
    for (let i = confetti.length - 1; i >= 0; i--) {
      const p = confetti[i];
      p.life -= dt; if (p.life <= 0) { confetti.splice(i, 1); continue; }
      p.vy += 520 * dt; p.vx *= damp(1.2, dt); p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.globalAlpha = clamp(p.life, 0, 1);
      ctx.fillStyle = p.color;
      if (p.star) { ctx.beginPath(); for (let j = 0; j < 10; j++) { const rr = j % 2 === 0 ? p.size : p.size * 0.45; const a = (j / 10) * TAU; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } ctx.closePath(); ctx.fill(); }
      else ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
      ctx.restore();
    }
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = `600 ${clamp(c.w * 0.03, 12, 15)}px Pretendard, system-ui, sans-serif`;
    ctx.fillStyle = "rgba(238, 247, 248, 0.55)";
    // 숫자 아래에는 축 이름만 — "번 눌렀어요" 는 숫자와 떨어져 있어 어색했다 (2026-09-13 사용자)
    ctx.fillText(total === 0 ? `${SWITCH_NAME[sw]} · 키캡을 톡톡 눌러요 · 자판으로도 쳐 봐요` : SWITCH_NAME[sw], c.w / 2, topY + baseSize * 0.72 + 14);

    // 케이스
    const hx = cols / 2 + CASE_PAD, hy = rows / 2 + CASE_PAD;
    const clearCase = caseColor.startsWith("rgba");
    for (let k = 6; k >= 1; k--) {
      const g = k * 0.05;
      quad([P(-hx - g, -hy - g, -CASE_H), P(hx + g * 2.4, -hy - g, -CASE_H), P(hx + g * 2.4, hy + g * 2.2, -CASE_H), P(-hx - g, hy + g * 2.2, -CASE_H)], "rgba(0, 8, 12, 0.07)");
    }
    ctx.globalAlpha = clearCase ? 0.55 : 1;
    quad([P(hx, -hy, -CASE_H), P(hx, hy, -CASE_H), P(hx, hy, 0), P(hx, -hy, 0)], sideGrad([P(hx, -hy, 0), P(hx, hy, 0)], [P(hx, -hy, -CASE_H), P(hx, hy, -CASE_H)], caseColor, clearCase ? 0.9 : 0.74));
    quad([P(-hx, hy, -CASE_H), P(hx, hy, -CASE_H), P(hx, hy, 0), P(-hx, hy, 0)], sideGrad([P(-hx, hy, 0), P(hx, hy, 0)], [P(-hx, hy, -CASE_H), P(hx, hy, -CASE_H)], caseColor, clearCase ? 0.95 : 0.86));
    withTop(0, 0, 0, () => {
      roundRectPath(ctx, -hx, -hy, hx * 2, hy * 2, 0.14); ctx.fillStyle = shade(caseColor, 1); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 0.015; ctx.stroke();
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        roundRectPath(ctx, k.gx - 0.42, k.gy - 0.42, 0.84, 0.84, 0.08); ctx.fillStyle = clearCase ? "rgba(20,30,36,0.35)" : shade(caseColor, 0.6); ctx.fill();
        const ao = ctx.createRadialGradient(k.gx, k.gy, 0.2, k.gx, k.gy, 0.62);
        ao.addColorStop(0, `rgba(0,0,0,${0.22 + k.press * 0.18})`); ao.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = ao; ctx.fillRect(k.gx - 0.7, k.gy - 0.7, 1.4, 1.4);
        const glow = ledMix * (0.5 + 0.5 * Math.sin(t * 1.4 + i)) + k.flash * 1.5;
        if (glow > 0.02) {
          const g = ctx.createRadialGradient(k.gx, k.gy, 0.05, k.gx, k.gy, 0.8);
          g.addColorStop(0, `hsla(${hueOf(i, t)} 100% 62% / ${clamp(glow * 0.95, 0, 1)})`); g.addColorStop(1, `hsla(${hueOf(i, t)} 100% 62% / 0)`);
          ctx.fillStyle = g; ctx.fillRect(k.gx - 0.85, k.gy - 0.85, 1.7, 1.7);
        }
      }
    });
    ctx.globalAlpha = 1;
    // 키링
    {
      const [rx, ry] = P(-hx - 0.05, -hy - 0.05, -CASE_H * 0.4);
      ctx.strokeStyle = "#c9ced4"; ctx.lineWidth = Math.max(2, S * 0.05);
      ctx.beginPath(); ctx.ellipse(rx - S * 0.32, ry - S * 0.1, S * 0.24, S * 0.18, -0.5, 0, TAU); ctx.stroke();
      ctx.strokeStyle = "#eef1f4"; ctx.lineWidth = Math.max(1, S * 0.02);
      ctx.beginPath(); ctx.ellipse(rx - S * 0.32, ry - S * 0.1, S * 0.24, S * 0.18, -0.5, 3.6, 5.2); ctx.stroke();
      for (let j = 0; j < 3; j++) { ctx.strokeStyle = "#b8bec6"; ctx.lineWidth = Math.max(2, S * 0.045); ctx.beginPath(); ctx.ellipse(rx - S * 0.1 + j * S * 0.05, ry + j * S * 0.02 - S * 0.02, S * 0.05, S * 0.035, 0.6, 0, TAU); ctx.stroke(); }
    }

    // 키 — 먼 것부터
    const order = keys.map((k, i) => i).sort((a, b) => depth(keys[a].gx, keys[a].gy) - depth(keys[b].gx, keys[b].gy));
    for (const i of order) {
      const k = keys[i]; const L = k.look;
      const z0 = CAP_Z - k.press * TRAVEL;
      const hh = hueOf(i, t);
      const glow = ledMix * (0.5 + 0.5 * Math.sin(t * 1.4 + i)) + k.flash * 1.5;
      const seeThrough = L.style === "clear" || L.style === "pudding";

      drawSwitch(k, k.press, seeThrough);
      if (seeThrough && glow > 0.02) {
        const [sx, sy] = P(k.gx, k.gy, 0.16);
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, S * 0.55);
        g.addColorStop(0, `hsla(${hh} 100% 70% / ${clamp(glow * 0.9, 0, 1)})`); g.addColorStop(1, `hsla(${hh} 100% 70% / 0)`);
        ctx.fillStyle = g; ctx.fillRect(sx - S * 0.6, sy - S * 0.6, S * 1.2, S * 1.2);
      }

      if (L.style === "clear") {
        const { T, B } = frustum(k.gx, k.gy, z0, CAP_B, CAP_T, CAP_H, L.color, 0.4);
        ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 1; path(T); ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.beginPath();
        for (const j of [1, 2, 3]) { ctx.moveTo(B[j][0], B[j][1]); ctx.lineTo(T[j][0], T[j][1]); } ctx.stroke();
      } else if (L.style === "pudding") {
        /*
         * 푸딩 — 우유빛 젤리 몸통 **위에 두툼한 소스 한 겹**이 얹혀 가장자리로 흘러내린다 (2026-09-13 사용자: 더 두텁게).
         * LED 는 몸통까지만 스민다 — 소스까지 물들이면 캡 전체가 유리처럼 보여 소스가 사라진다.
         * 손을 떼면 젤리처럼 흐물흐물(윗면이 옆으로 밀리고 납작해졌다 돌아온다).
         */
        const jelly = { dx: Math.sin(k.wobPhase) * k.wobble * 0.05, dy: Math.cos(k.wobPhase * 0.8) * k.wobble * 0.03, sq: 1 - Math.cos(k.wobPhase) * k.wobble * 0.09 };
        const SAUCE = 0.24, bodyH = CAP_H - SAUCE, f = bodyH / CAP_H;
        const midT = lerp(CAP_B, CAP_T, f);
        const bodyJelly = { dx: jelly.dx * f, dy: jelly.dy * f, sq: jelly.sq };
        frustum(k.gx, k.gy, z0, CAP_B, midT, bodyH, "#f7f8fb", 0.92, "#f6f7fa", 0.6, bodyJelly);
        if (glow > 0.02) frustum(k.gx, k.gy, z0, CAP_B, midT, bodyH, `hsl(${hh} 100% 65%)`, 0, `hsl(${hh} 100% 65%)`, clamp(glow * 0.5, 0, 0.85), bodyJelly);
        // 소스 — 몸통보다 살짝 넓게 얹혀 턱이 진다
        const zs = z0 + bodyH * jelly.sq;
        const jt = (2 - jelly.sq) ** 0.5;
        const baseW = midT * jt * 1.09;
        const ox = k.gx + jelly.dx * f, oy = k.gy + jelly.dy * f;
        // 흘러내린 방울 — 소스 아래턱에서 몸통을 타고 (앞·오른쪽 가장자리만 보인다)
        for (let d = 0; d < 5; d++) {
          const along = -0.72 + d * 0.36, len = k.drips[d] * 0.17;
          const onFront = d % 2 === 0;
          const px = onFront ? ox + along * baseW : ox + baseW;
          const py = onFront ? oy + baseW : oy + along * baseW;
          const [ax, ay] = P(px, py, zs), [bx, by] = P(px, py, zs - len);
          const w = S * 0.055;
          ctx.fillStyle = shade(L.color, onFront ? 0.88 : 0.74);
          ctx.beginPath();
          ctx.moveTo(ax - w, ay - w * 0.4); ctx.lineTo(ax + w, ay - w * 0.4);
          ctx.lineTo(bx + w * 0.78, by); ctx.arc(bx, by, w * 0.78, 0, Math.PI); ctx.closePath(); ctx.fill();
          ctx.fillStyle = "rgba(255,255,255,0.42)";
          ctx.beginPath(); ctx.arc(bx - w * 0.28, by - w * 0.2, w * 0.28, 0, TAU); ctx.fill();
        }
        frustum(ox, oy, zs, baseW, CAP_T * 1.03, SAUCE * jelly.sq, L.color, 1, shade(L.color, 0.94), 1, { dx: jelly.dx * (1 - f), dy: jelly.dy * (1 - f), sq: 1 });
        // 소스 윗면 — 볼록하게 반짝
        withTop(k.gx + jelly.dx, k.gy + jelly.dy, zs + SAUCE * jelly.sq, () => {
          const t2 = CAP_T * 1.03;
          const g = ctx.createRadialGradient(-0.08, -0.1, 0.02, 0, 0, t2 * 1.2);
          g.addColorStop(0, "rgba(255,255,255,0.4)"); g.addColorStop(0.45, "rgba(255,255,255,0.06)"); g.addColorStop(1, "rgba(0,0,0,0.1)");
          roundRectPath(ctx, -t2, -t2, t2 * 2, t2 * 2, 0.09); ctx.fillStyle = g; ctx.fill();
          ctx.fillStyle = "rgba(255,255,255,0.75)";
          ctx.beginPath(); ctx.ellipse(-t2 * 0.42, -t2 * 0.44, 0.07, 0.04, -0.6, 0, TAU); ctx.fill();
        });
      } else if (L.style === "typewriter") {
        const R0 = 0.4, R1 = 0.36, zT = z0 + CAP_H * 0.85;
        const segs = 28;
        for (let s2 = 0; s2 < segs; s2++) {
          const a0 = (s2 / segs) * TAU, a1 = ((s2 + 1) / segs) * TAU;
          const nx = Math.cos((a0 + a1) / 2), ny = Math.sin((a0 + a1) / 2);
          if (nx * ST + ny * CT < -0.05) continue;
          const lit = 0.7 + 0.3 * clamp(-(nx * 0.7 + ny * -0.7), 0, 1);
          quad([P(k.gx + Math.cos(a0) * R0, k.gy + Math.sin(a0) * R0, z0), P(k.gx + Math.cos(a1) * R0, k.gy + Math.sin(a1) * R0, z0), P(k.gx + Math.cos(a1) * R1, k.gy + Math.sin(a1) * R1, zT), P(k.gx + Math.cos(a0) * R1, k.gy + Math.sin(a0) * R1, zT)], shade(L.color, lit));
        }
        withTop(k.gx, k.gy, zT, () => {
          ctx.beginPath(); ctx.arc(0, 0, R1, 0, TAU); ctx.fillStyle = shade(L.color, 1.02); ctx.fill();
          const ring = ctx.createLinearGradient(-R1, -R1, R1, R1); ring.addColorStop(0, "#ffffff"); ring.addColorStop(0.45, "#9aa3ab"); ring.addColorStop(0.55, "#e6eaee"); ring.addColorStop(1, "#6f777e");
          ctx.strokeStyle = ring; ctx.lineWidth = 0.06; ctx.beginPath(); ctx.arc(0, 0, R1 - 0.03, 0, TAU); ctx.stroke();
          ctx.beginPath(); ctx.arc(0, 0, R1 - 0.07, 0, TAU); ctx.fillStyle = "#1a1c20"; ctx.fill();
          const gl = ctx.createRadialGradient(-0.1, -0.12, 0.02, 0, 0, R1); gl.addColorStop(0, "rgba(255,255,255,0.35)"); gl.addColorStop(0.5, "rgba(255,255,255,0.05)"); gl.addColorStop(1, "rgba(255,255,255,0)");
          ctx.fillStyle = gl; ctx.fill();
        });
        withTopPx(k.gx, k.gy, zT + 0.002, () => {
          ctx.font = `700 ${S * 0.3}px "Gowun Batang", Georgia, serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillStyle = "#f3efe6"; ctx.fillText(L.letter, 0, S * 0.02);
        });
      } else {
        const col = L.style === "print" ? (L.letter < "M" ? "#fbfbf6" : L.color) : L.color;
        frustum(k.gx, k.gy, z0, CAP_B, CAP_T, CAP_H, col);
        withTop(k.gx, k.gy, z0 + CAP_H, () => {
          topFinish();
          if (L.style === "print") drawIcon(ctx, L.icon, L.ink, CAP_T * 1.7);
        });
        if (L.style === "emoji") {
          withTopPx(k.gx, k.gy, z0 + CAP_H + 0.002, () => {
            ctx.font = `${S * 0.4}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
            ctx.fillText(L.emoji, 0, S * 0.03);
          });
        }
        if (L.style === "figure") {
          if (["heart", "star", "clover", "flower"].includes(L.fig)) {
            const figH = 0.16, steps = 6;
            for (let s2 = 0; s2 <= steps; s2++) {
              const z = z0 + CAP_H + (figH * s2) / steps;
              withTop(k.gx, k.gy, z, () => { flatFig(ctx, L.fig, CAP_T * 0.62); ctx.fillStyle = s2 === steps ? shade(L.figColor, 1.08) : shade(L.figColor, 0.72 + (s2 / steps) * 0.1); ctx.fill(); });
            }
            withTop(k.gx, k.gy, z0 + CAP_H + figH, () => {
              flatFig(ctx, L.fig, CAP_T * 0.62); ctx.save(); ctx.clip();
              const hl = ctx.createRadialGradient(-0.06, -0.08, 0, -0.04, -0.05, 0.22); hl.addColorStop(0, "rgba(255,255,255,0.6)"); hl.addColorStop(1, "rgba(255,255,255,0)");
              ctx.fillStyle = hl; ctx.fillRect(-0.4, -0.4, 0.8, 0.8); ctx.restore();
            });
          } else {
            const headCol = L.fig === "duck" ? "#f7d64a" : L.fig === "bear" ? "#c98b5a" : L.fig === "cat" ? (L.letter < "M" ? "#9aa3ab" : "#f1d9b8") : "#f4f1ee";
            headFig(k, z0 + CAP_H, L.fig, headCol);
          }
        }
      }
      if (glow > 0.02 && !seeThrough) {
        const [gx, gy] = P(k.gx, k.gy + CAP_B, z0);
        const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, S * 0.55);
        g.addColorStop(0, `hsla(${hh} 100% 65% / ${clamp(glow * 0.35, 0, 1)})`); g.addColorStop(1, `hsla(${hh} 100% 65% / 0)`);
        ctx.fillStyle = g; ctx.fillRect(gx - S * 0.6, gy - S * 0.3, S * 1.2, S * 0.5);
      }
    }
  });

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
    clear() { total = 0; bounce = 0; levelPop = 0; ringLife = 0; confetti.length = 0; shuffle(); },
    setSound(on) { sound = on; },
    setParam(key, value) {
      if (key === "count" && typeof value === "number") setCount(value);
      if (key === "led" && typeof value === "boolean") led = value;
      if (key === "haptic" && typeof value === "boolean") haptic = value;
      if (key === "switch" && typeof value === "string" && value in SWITCH_COLOR) sw = value as SwitchKind;
    },
  };
};
