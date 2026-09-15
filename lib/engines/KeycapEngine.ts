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

/**
 * 축측 투영 — z 는 언제나 화면 위, x·y 는 yaw 로 돌고 pitch(세로 눌림)로 눕는다.
 * 빈 곳을 끌면 이 둘이 바뀌어 다른 각도에서 볼 수 있다 (2026-09-13 사용자).
 *   pitch 1 에 가까울수록 위에서, 0 에 가까울수록 옆에서 본 모습
 */
const YAW0 = 0.42, PITCH0 = 0.6;
// 키 하나의 치수 (키 간격 = 1)
const CAP_B = 0.44, CAP_T = 0.33, CAP_H = 0.4, CAP_Z = 0.24, TRAVEL = 0.12;
const CASE_H = 0.3, CASE_PAD = 0.2;
/** 케이스 벽이 바닥판 위로 솟은 높이 — 이만큼 키캡을 감싼다 (2026-09-13 사용자 사진) */
const RIM = 0.3;
/** 투명 아크릴 — 축이 비쳐 보이라고 케이스를 통째로 이 재질로 (2026-09-13 사용자) */
const ACRYL = "#dfe9f0";

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
  /** 키링 줄의 구슬 — 선언이 layout() 보다 뒤면 초기화 때 TDZ 로 터진다 */
  let cols = 1, rows = 1, S = 80, cx = 0, cy = 0;
  let yaw = YAW0, pitch = PITCH0;
  let CT = Math.cos(yaw), ST = Math.sin(yaw);
  const setView = () => { CT = Math.cos(yaw); ST = Math.sin(yaw); };
  let total = 0;
  let ledMix = led ? 1 : 0;
  const waves: Wave[] = [];
  const pressedBy = new Map<number | string, number>();
  /** 빈 곳을 끄는 중인 손가락 — 키를 누르는 손가락과 섞이지 않게 따로 센다 */
  const orbiting = new Set<number>();
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
    setCount(count);
  };
  /** 돌려도 화면을 벗어나지 않게 — 바깥 반지름으로 잡아 yaw 와 무관한 크기를 쓴다 */
  const fit = () => {
    const rad = Math.hypot(cols / 2 + CASE_PAD, rows / 2 + CASE_PAD);
    const wU = rad * 2 + 1.5; // 키링 줄이 들어갈 자리
    const hU = rad * 2 * pitch + CAP_H + CASE_H + RIM + 1.2;
    // 1.5 배 — 화면을 조금 벗어나도 크게 보이는 쪽이 낫다 (2026-09-13 사용자)
    S = clamp(Math.min((c.w * 0.86) / wU, (c.h * 0.52) / hU) * 1.5, 34, 260);
    cx = c.w / 2; cy = c.h * 0.57 + (CASE_H * S) / 2;
  };
  const P = (x: number, y: number, z: number): [number, number] => [cx + (x * CT - y * ST) * S, cy + (x * ST + y * CT) * pitch * S - z * S];
  /** 카메라 쪽으로 얼마나 가까운가 — 클수록 앞 */
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
  /** 키캡의 밑면·윗면 네 점 — 맞히기는 이 여덟 점이 만드는 실루엣으로 본다(어느 각도에서든 맞다) */
  const capBox = (k: Key) => {
    const z0 = CAP_Z - k.press * TRAVEL;
    const zt = z0 + CAP_H + (k.look.style === "figure" ? 0.3 : 0);
    const c4 = (w: number, z: number) => [P(k.gx - w, k.gy - w, z), P(k.gx + w, k.gy - w, z), P(k.gx + w, k.gy + w, z), P(k.gx - w, k.gy + w, z)] as [number, number][];
    return { B: c4(CAP_B, z0), T: c4(CAP_T, zt) };
  };
  const inPoly = (pts: [number, number][], x: number, y: number) => {
    let ins = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1] + 1e-9) + a[0]) ins = !ins;
    }
    return ins;
  };
  /** 가까운 키부터 본다 — 앞 키에 가려진 자리는 앞 키가 눌린다(보이는 것만 눌린다) */
  const keyAt = (x: number, y: number) => {
    const order = keys.map((k, i) => i).sort((a, b) => depth(keys[b].gx, keys[b].gy) - depth(keys[a].gx, keys[a].gy));
    for (const i of order) {
      const { B, T } = capBox(keys[i]);
      if (inPoly(T, x, y)) return i;
      for (const f of SIDE_FACES) {
        const [i0, i1] = f.i;
        if (inPoly([B[i0], B[i1], T[i1], T[i0]], x, y)) return i;
      }
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
  /** 축 색을 우유빛에 섞는다 — 받침처럼 "무슨 축인지" 만 알려 주면 되는 자리 */
  const milky = (col: string, t: number) => {
    const A = rgbOf(col), B = rgbOf("#f7fafc");
    return `rgb(${lerp(A[0], B[0], t) | 0},${lerp(A[1], B[1], t) | 0},${lerp(A[2], B[2], t) | 0})`;
  };
  const path = (pts: [number, number][]) => { ctx.beginPath(); pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1]))); ctx.closePath(); };
  const quad = (pts: [number, number][], fill: string | CanvasGradient) => { path(pts); ctx.fillStyle = fill; ctx.fill(); };
  /** 상자의 옆면 넷 — 바깥 법선과 밑·윗면 모서리 짝 */
  const SIDE_FACES: { n: [number, number]; i: [number, number] }[] = [
    { n: [0, -1], i: [0, 1] }, { n: [1, 0], i: [1, 2] }, { n: [0, 1], i: [2, 3] }, { n: [-1, 0], i: [3, 0] },
  ];
  /** 면이 화면에서 어느 쪽을 보는지로 밝기를 정한다 — 돌려도 빛이 왼쪽 위에 그대로 있다 */
  const faceLit = (n: [number, number]) => {
    const sxc = n[0] * CT - n[1] * ST, dep = n[0] * ST + n[1] * CT;
    return clamp(0.76 - sxc * 0.18 + dep * 0.1, 0.55, 1.02);
  };
  /** 먼 면부터 그리도록 정렬 */
  const facesBackToFront = () => SIDE_FACES.slice().sort((a, b) => a.n[0] * ST + a.n[1] * CT - (b.n[0] * ST + b.n[1] * CT));

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
    for (const f of facesBackToFront()) {
      const [i0, i1] = f.i;
      quad([B[i0], B[i1], T[i1], T[i0]], sideGrad([T[i0], T[i1]], [B[i0], B[i1]], sideCol, faceLit(f.n)));
    }
    ctx.globalAlpha = alpha;
    quad(T, shade(col, 1.04));
    ctx.globalAlpha = 1;
    return { T, B };
  };
  /** 직사각 기둥 — 위아래 같은 굵기. 십자 스템의 두 막대에 쓴다 */
  const boxPrism = (x: number, y: number, z0: number, wx: number, wy: number, h: number, col: string, alpha = 1) => {
    const B = [P(x - wx, y - wy, z0), P(x + wx, y - wy, z0), P(x + wx, y + wy, z0), P(x - wx, y + wy, z0)];
    const T = [P(x - wx, y - wy, z0 + h), P(x + wx, y - wy, z0 + h), P(x + wx, y + wy, z0 + h), P(x - wx, y + wy, z0 + h)];
    ctx.globalAlpha = alpha;
    for (const f of facesBackToFront()) {
      const [i0, i1] = f.i;
      quad([B[i0], B[i1], T[i1], T[i0]], shade(col, faceLit(f.n)));
    }
    quad(T, shade(col, 1.06));
    ctx.globalAlpha = 1;
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
  /**
   * 캐릭터 머리 피규어 — 캡 위에 얹힌 흉상 (톰과 제리 피규어 키캡처럼).
   *
   * 이목구비를 화면 좌표에 찍으면 **돌려도 늘 정면을 본다** (2026-09-13 사용자 지적). 그래서 눈·코·귀를 구면 위의
   * **모델 방향**으로 두고, 그 방향을 투영해 자리와 보임 정도를 구한다. 얼굴은 캡의 앞쪽(+y)을 보므로 뒤로 돌리면
   * 뒤통수가 보인다. 구 자체는 어느 각도에서도 원이라 화면 공간에 그려도 된다.
   */
  const headFig = (k: Key, zTop: number, fig: Fig, col: string) => {
    const r = S * 0.2;
    const [hcx, hby] = P(k.gx, k.gy + 0.02, zTop);
    const hcy = hby - r * 0.95;
    const cosE = Math.sqrt(Math.max(0, 1 - pitch * pitch)); // 카메라 높이 — pitch 가 sin(고도)
    /** 구면 방향 n → [화면 x, 화면 y, 보임(>0 이면 이쪽을 향한다)] */
    const on = (nx2: number, ny2: number, nz: number, dist = 1) => {
      const ox = r * dist * (nx2 * CT - ny2 * ST);
      const oy = r * dist * ((nx2 * ST + ny2 * CT) * pitch - nz);
      const vis = nx2 * ST * cosE + ny2 * CT * cosE + nz * pitch;
      return [hcx + ox, hcy + oy, vis] as const;
    };
    // 캡 윗면에 지는 그림자
    withTop(k.gx, k.gy, zTop, () => { ctx.fillStyle = "rgba(0,0,0,0.22)"; ctx.beginPath(); ctx.ellipse(0.02, 0.05, 0.19, 0.17, 0, 0, TAU); ctx.fill(); });
    // 귀 — 머리보다 먼저 (머리가 밑동을 덮는다)
    if (fig === "rabbit") {
      for (const sgn of [-1, 1]) {
        const [ex, ey, vis] = on(sgn * 0.5, 0.1, 0.95, 1.05);
        const w = r * 0.24 * (0.45 + 0.55 * clamp(Math.abs(CT), 0, 1));
        ctx.fillStyle = shade(col, vis > 0 ? 0.98 : 0.82);
        ctx.beginPath(); ctx.ellipse(ex, ey, w, r * 0.62, sgn * 0.15, 0, TAU); ctx.fill();
        if (vis > 0.05) {
          ctx.fillStyle = "rgba(255,170,190,0.6)";
          ctx.beginPath(); ctx.ellipse(ex, ey, w * 0.45, r * 0.42, sgn * 0.15, 0, TAU); ctx.fill();
        }
      }
    }
    if (fig === "bear") for (const sgn of [-1, 1]) { const [ex, ey] = on(sgn * 0.8, 0.1, 0.6, 1.02); sphere(ex, ey, r * 0.32, col); }
    if (fig === "cat") for (const sgn of [-1, 1]) {
      const [ex, ey, vis] = on(sgn * 0.62, 0.15, 0.78, 1.0);
      ctx.fillStyle = shade(col, vis > 0 ? 0.95 : 0.8);
      ctx.beginPath(); ctx.moveTo(ex - r * 0.3, ey + r * 0.3); ctx.lineTo(ex, ey - r * 0.45); ctx.lineTo(ex + r * 0.3, ey + r * 0.3); ctx.closePath(); ctx.fill();
    }
    sphere(hcx, hcy, r, col);
    // 이목구비 — 앞(+y)을 본다. 옆으로 돌면 한쪽으로 몰리고 뒤로 돌면 사라진다
    const eyeCol = "#2b2326";
    for (const sgn of [-1, 1]) {
      const [ex, ey, vis] = on(sgn * 0.42, 0.82, 0.16, 0.99);
      if (vis <= 0.08) continue;
      ctx.fillStyle = eyeCol;
      ctx.beginPath(); ctx.ellipse(ex, ey, r * 0.085 * clamp(vis * 1.6, 0.3, 1), r * 0.085, 0, 0, TAU); ctx.fill();
    }
    const [mx2, my2, mvis] = on(0, 0.95, -0.12, 0.99);
    if (mvis > 0.08) {
      const k2 = clamp(mvis * 1.5, 0.3, 1);
      if (fig === "duck") {
        ctx.fillStyle = "#f08a2c";
        ctx.beginPath(); ctx.ellipse(mx2, my2, r * 0.42 * k2, r * 0.2, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = "rgba(0,0,0,0.15)";
        ctx.beginPath(); ctx.ellipse(mx2, my2 + r * 0.05, r * 0.4 * k2, r * 0.07, 0, 0, TAU); ctx.fill();
      } else {
        ctx.fillStyle = fig === "bear" ? "#f6e7d8" : "rgba(255,255,255,0.75)";
        ctx.beginPath(); ctx.ellipse(mx2, my2, r * 0.3 * k2, r * 0.22, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = eyeCol;
        ctx.beginPath(); ctx.arc(mx2, my2 - r * 0.08, r * 0.07 * k2, 0, TAU); ctx.fill();
        ctx.strokeStyle = eyeCol; ctx.lineWidth = Math.max(1, r * 0.05);
        ctx.beginPath(); ctx.arc(mx2, my2 - r * 0.02, r * 0.12 * k2, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke();
      }
    }
    for (const sgn of [-1, 1]) {
      const [ex, ey, vis] = on(sgn * 0.72, 0.6, -0.08, 0.99);
      if (vis <= 0.08) continue;
      ctx.fillStyle = `rgba(240,120,140,${0.4 * clamp(vis * 1.6, 0, 1)})`;
      ctx.beginPath(); ctx.ellipse(ex, ey, r * 0.13 * clamp(vis * 1.6, 0.3, 1), r * 0.13, 0, 0, TAU); ctx.fill();
    }
    // 광택은 빛을 따르므로 화면 고정
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.beginPath(); ctx.arc(hcx - r * 0.42, hcy - r * 0.45, r * 0.13, 0, TAU); ctx.fill();
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
  /**
   * 스위치 — 사용자 사진(체리 MX 계열)을 따른다.
   *   · 아랫집: 우유빛 불투명 받침 + 금속 접점 한 조각
   *   · **십자 스템**: 축 색 막대 둘을 겹쳐 + 모양. 캡 밑까지 길게 올라간다
   *   · 윗집: **맑은 덮개**를 스템 위에 반투명으로 덮는다 — 그래야 색이 비쳐 어떤 축인지 보인다 (2026-09-13 사용자)
   */
  const drawSwitch = (k: Key, press: number) => {
    const stemCol = SWITCH_COLOR[sw];
    const zt = CAP_Z + 0.08 - press * TRAVEL;
    // 받침 — 축 색을 섞은 우유빛. 캡 아래로 이 띠가 보여 어떤 축인지 알 수 있다 (2026-09-13 사용자)
    boxPrism(k.gx, k.gy, 0.005, 0.3, 0.3, 0.14, milky(stemCol, 0.04), 1);
    // 금속 접점 — 받침 안에서 반짝
    const [mx, my] = P(k.gx - 0.1, k.gy + 0.04, 0.145);
    ctx.fillStyle = "rgba(196, 204, 212, 0.9)";
    ctx.fillRect(mx - S * 0.03, my - S * 0.05, S * 0.06, S * 0.05);
    if (sw === "topre") {
      const [dx, dy] = P(k.gx, k.gy, 0.2);
      ctx.fillStyle = stemCol; ctx.beginPath(); ctx.ellipse(dx, dy - S * 0.05, S * 0.2, S * 0.16, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.beginPath(); ctx.ellipse(dx - S * 0.06, dy - S * 0.1, S * 0.07, S * 0.04, 0, 0, TAU); ctx.fill();
    } else {
      const h = Math.max(0.04, zt - 0.145);
      boxPrism(k.gx, k.gy, 0.145, 0.17, 0.055, h, stemCol, 1);
      boxPrism(k.gx, k.gy, 0.145, 0.055, 0.17, h, stemCol, 1);
    }
    // 맑은 덮개 — 스템 색이 비친다. 너무 짙으면 축 색이 사라지니 아주 옅게
    boxPrism(k.gx, k.gy, 0.14, 0.29, 0.29, 0.1, "#eaf1f5", 0.28);
    const [ex, ey] = P(k.gx - 0.29, k.gy - 0.29, 0.185);
    const [ex2] = P(k.gx + 0.29, k.gy - 0.29, 0.185);
    ctx.strokeStyle = "rgba(255,255,255,0.65)"; ctx.lineWidth = Math.max(1, S * 0.012);
    ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex2, ey); ctx.stroke();
  };

  /*
   * 키링 — 케이스 모서리에 매달려 **탁자 위에 놓인** 줄. 구슬을 화면 좌표(yaw 를 이미 먹인 rx·ry 평면)에 두고
   * 베를레로 푼다. 케이스가 돌면 매단 자리가 원을 그리며 움직이고 줄이 뒤따라 끌린다 —
   * 카메라 방향으로 모서리를 골라 매달면 각도가 바뀔 때마다 자리가 튄다 (2026-09-13 사용자 지적).
   */
  /*
   * 키링 — **탁자 위에 놓인 채 케이스와 함께 돈다**.
   *
   * 처음엔 줄을 물리로 흔들었다. 화면 평면에서 끌면 돌릴 때마다 사방으로 휘둘리고(2026-09-15 사용자: "정신없다"),
   * 아래로 늘어뜨리면 공중에 매달린 꼴이라 탁자 위에 놓인 이 장면과 맞지 않는다. 실제로 책상에 둔 키링은
   * 그냥 **가만히 놓여 있다.** 그래서 줄을 모델 좌표(탁자면 z=0)에 한 번 깔아 두고, 케이스와 같이 돌기만 한다 —
   * 흔들림이 아예 없고 자리도 튀지 않으며 각도가 바뀌어도 케이스 옆에 그대로 보인다.
   */
  const CHAIN_N = 9;
  /** 줄이 시작하는 모서리와 뻗어 나가는 방향 (모델 좌표) */
  const chainPath = (): [number, number][] => {
    const hx0 = cols / 2 + CASE_PAD, hy0 = rows / 2 + CASE_PAD;
    const ax = hx0, ay = hy0; // 앞오른쪽 모서리 — 처음 각도에서 화면 아래 빈자리로 뻗는다
    const d = Math.hypot(ax, ay) || 1;
    const dx = ax / d, dy = ay / d;
    const px = -dy, py = dx; // 옆으로
    const len = 0.72;
    return Array.from({ length: CHAIN_N }, (_, i) => {
      const t = i / (CHAIN_N - 1);
      const bend = Math.sin(t * Math.PI) * len * 0.22; // 살짝 휘어 놓인 곡선
      return [ax + dx * t * len + px * bend, ay + dy * t * len + py * bend] as [number, number];
    });
  };
  const metalGrad = (x: number, y: number, r: number) => {
    const g = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
    g.addColorStop(0, "#ffffff"); g.addColorStop(0.34, "#b7bec6"); g.addColorStop(0.62, "#eef2f5"); g.addColorStop(1, "#79818b");
    return g;
  };
  /** 줄이 케이스보다 뒤에 놓였는가 — 그러면 케이스보다 먼저 그려 가려지게 둔다 */
  const chainBehindCase = () => {
    const pts = chainPath();
    const mid = pts[Math.floor(CHAIN_N / 2)];
    return depth(mid[0], mid[1]) < 0;
  };
  const drawChain = () => {
    const pts = chainPath();
    const scr = pts.map(([mx, my], i) => P(mx, my, i === 0 ? RIM * 0.5 : 0.03));
    // 탁자에 지는 그림자
    ctx.strokeStyle = "rgba(0, 8, 12, 0.22)"; ctx.lineWidth = Math.max(2, S * 0.07); ctx.lineCap = "round";
    ctx.beginPath();
    scr.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x + S * 0.02, y + S * 0.03) : ctx.lineTo(x + S * 0.02, y + S * 0.03)));
    ctx.stroke();
    // 케이스에 박힌 고리
    ctx.lineWidth = Math.max(1.8, S * 0.032); ctx.strokeStyle = metalGrad(scr[0][0], scr[0][1], S * 0.1);
    ctx.beginPath(); ctx.ellipse(scr[0][0], scr[0][1], S * 0.085, S * 0.06, -0.7, 0, TAU); ctx.stroke();
    // 볼 체인
    for (let i = 1; i < CHAIN_N; i++) {
      const a = scr[i - 1], b = scr[i];
      ctx.strokeStyle = "#98a0a8"; ctx.lineWidth = Math.max(1, S * 0.011);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      const rr = S * 0.036;
      ctx.fillStyle = metalGrad(b[0], b[1], rr);
      ctx.beginPath(); ctx.arc(b[0], b[1], rr, 0, TAU); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath(); ctx.arc(b[0] - rr * 0.32, b[1] - rr * 0.36, rr * 0.27, 0, TAU); ctx.fill();
    }
    // 랍스터 클래스프 — 줄 끝 방향으로 눕는다
    const a = scr[CHAIN_N - 2], b = scr[CHAIN_N - 1];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    ctx.save();
    ctx.translate(b[0] + Math.cos(ang) * S * 0.15, b[1] + Math.sin(ang) * S * 0.15);
    ctx.rotate(ang + Math.PI / 2);
    const LL = S * 0.3, WW = S * 0.17;
    ctx.lineWidth = Math.max(2, S * 0.048); ctx.strokeStyle = metalGrad(0, 0, LL * 0.6);
    ctx.beginPath(); ctx.ellipse(0, 0, WW * 0.5, LL * 0.5, 0, 0, TAU); ctx.stroke();
    ctx.lineWidth = Math.max(1, S * 0.016); ctx.strokeStyle = "rgba(118,126,134,0.9)";
    ctx.beginPath(); ctx.moveTo(-WW * 0.3, -LL * 0.08); ctx.lineTo(-WW * 0.3, LL * 0.24); ctx.stroke();
    ctx.fillStyle = metalGrad(0, -LL * 0.5, S * 0.05);
    ctx.beginPath(); ctx.arc(0, -LL * 0.5, S * 0.037, 0, TAU); ctx.fill();
    ctx.restore();
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
    // 숫자 자리 — 모델의 한 점에 매달면 돌릴 때 케이스와 겹친다. 물체의 화면 윗끝에서 잰다
    const radU = Math.hypot(cols / 2 + CASE_PAD, rows / 2 + CASE_PAD);
    const topY = clamp(cy - (radU * pitch + RIM + CAP_H + 0.3) * S - clamp(c.h * 0.07, 34, 64), c.h * 0.1, c.h * 0.45);
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
    ctx.fillText(total === 0 ? `${SWITCH_NAME[sw]} · 키캡을 톡톡 눌러요 · 빈 곳을 끌면 돌아가요` : SWITCH_NAME[sw], c.w / 2, topY + baseSize * 0.72 + 14);

    /*
     * 케이스 — **투명 아크릴**. 바닥판(z 0) 위로 벽이 RIM 만큼 솟아 키캡의 아랫부분을 감싼다.
     * 뒤·왼쪽 껍데기는 키캡보다 먼저, 앞·오른쪽 껍데기는 **키캡보다 나중에** 그린다 — 그래야 캡이 케이스 안에
     * 들어앉은 것으로 보이고, 반투명이라 그 너머로 스위치와 캡 밑동이 비친다 (2026-09-13 사용자).
     */
    const hx = cols / 2 + CASE_PAD, hy = rows / 2 + CASE_PAD;
    const ihx = cols / 2 + 0.04, ihy = rows / 2 + 0.04;
    const wallY = (y: number, x0: number, x1: number, za: number, zb: number, fill: string) => quad([P(x0, y, za), P(x1, y, za), P(x1, y, zb), P(x0, y, zb)], fill);
    const wallX = (x: number, y0: number, y1: number, za: number, zb: number, fill: string) => quad([P(x, y0, za), P(x, y1, za), P(x, y1, zb), P(x, y0, zb)], fill);
    const flat = (x0: number, y0: number, x1: number, y1: number, z: number, fill: string) => quad([P(x0, y0, z), P(x1, y0, z), P(x1, y1, z), P(x0, y1, z)], fill);

    for (let k = 6; k >= 1; k--) {
      const g = k * 0.05;
      quad([P(-hx - g, -hy - g, -CASE_H), P(hx + g, -hy - g, -CASE_H), P(hx + g, hy + g, -CASE_H), P(-hx - g, hy + g, -CASE_H)], "rgba(0, 8, 12, 0.07)");
    }
    // 어느 쪽이 카메라에 가까운지 — 돌리면 앞뒤가 뒤바뀐다
    const ny = CT >= 0 ? 1 : -1, nx = ST >= 0 ? 1 : -1;
    const chainBehind = chainBehindCase();
    if (chainBehind) drawChain(); // 뒤에 놓였으면 케이스가 가리도록 먼저
    // 먼 쪽 껍데기 + 윗테 (키캡보다 먼저)
    ctx.globalAlpha = 0.5;
    wallY(-ny * hy, -hx, hx, -CASE_H, RIM, shade(ACRYL, faceLit([0, -ny])));
    wallX(-nx * hx, -hy, hy, -CASE_H, RIM, shade(ACRYL, faceLit([-nx, 0])));
    ctx.globalAlpha = 0.3;
    flat(-hx, -ny * hy, hx, -ny * ihy, RIM, shade(ACRYL, 1.02));
    flat(-nx * ihx, -ihy, -nx * hx, ihy, RIM, shade(ACRYL, 0.98));
    ctx.globalAlpha = 0.6;
    wallY(-ny * ihy, -ihx, ihx, 0, RIM, shade(ACRYL, 0.9));
    wallX(-nx * ihx, -ihy, ihy, 0, RIM, shade(ACRYL, 0.93));
    ctx.globalAlpha = 1;
    // 먼 쪽 모서리 — 키캡보다 먼저 그려야 캡 위에 선이 얹히지 않는다
    ctx.lineWidth = Math.max(1, S * 0.012); ctx.strokeStyle = "rgba(255,255,255,0.5)";
    for (const [ex, ey] of [[hx, hy], [ihx, ihy]] as const) {
      const far = P(-nx * ex, -ny * ey, RIM), a1 = P(nx * ex, -ny * ey, RIM), a2 = P(-nx * ex, ny * ey, RIM);
      ctx.beginPath(); ctx.moveTo(a2[0], a2[1]); ctx.lineTo(far[0], far[1]); ctx.lineTo(a1[0], a1[1]); ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    {
      const a = P(-nx * hx, -ny * hy, RIM), b2 = P(-nx * hx, -ny * hy, -CASE_H);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b2[0], b2[1]); ctx.stroke();
    }
    // 바닥판 — 스위치 소켓·핀·LED
    withTop(0, 0, 0, () => {
      roundRectPath(ctx, -ihx, -ihy, ihx * 2, ihy * 2, 0.07);
      ctx.fillStyle = "rgba(226, 235, 242, 0.6)"; ctx.fill();
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        roundRectPath(ctx, k.gx - 0.33, k.gy - 0.33, 0.66, 0.66, 0.05);
        ctx.fillStyle = shade(SWITCH_COLOR[sw], 0.55, 0.5); ctx.fill();
        ctx.fillStyle = "rgba(206, 178, 108, 0.85)";
        ctx.fillRect(k.gx - 0.14, k.gy + 0.08, 0.07, 0.05);
        ctx.fillRect(k.gx + 0.08, k.gy - 0.03, 0.06, 0.05);
        const ao = ctx.createRadialGradient(k.gx, k.gy, 0.2, k.gx, k.gy, 0.62);
        ao.addColorStop(0, `rgba(0,0,0,${0.2 + k.press * 0.18})`); ao.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = ao; ctx.fillRect(k.gx - 0.7, k.gy - 0.7, 1.4, 1.4);
        const glow = ledMix * (0.5 + 0.5 * Math.sin(t * 1.4 + i)) + k.flash * 1.5;
        if (glow > 0.02) {
          const g = ctx.createRadialGradient(k.gx, k.gy, 0.05, k.gx, k.gy, 0.8);
          g.addColorStop(0, `hsla(${hueOf(i, t)} 100% 62% / ${clamp(glow * 0.95, 0, 1)})`); g.addColorStop(1, `hsla(${hueOf(i, t)} 100% 62% / 0)`);
          ctx.fillStyle = g; ctx.fillRect(k.gx - 0.85, k.gy - 0.85, 1.7, 1.7);
        }
      }
    });

    // 키 — 먼 것부터
    const order = keys.map((k, i) => i).sort((a, b) => depth(keys[a].gx, keys[a].gy) - depth(keys[b].gx, keys[b].gy));
    for (const i of order) {
      const k = keys[i]; const L = k.look;
      const z0 = CAP_Z - k.press * TRAVEL;
      const hh = hueOf(i, t);
      const glow = ledMix * (0.5 + 0.5 * Math.sin(t * 1.4 + i)) + k.flash * 1.5;
      const seeThrough = L.style === "clear" || L.style === "pudding";

      drawSwitch(k, k.press);
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

    // 앞·오른쪽 껍데기 — 키캡 **위에** 덮어 감싸고, 반투명이라 캡 밑동과 스위치가 비친다
    ctx.globalAlpha = 0.16;
    wallY(ny * ihy, -ihx, ihx, 0, RIM, shade(ACRYL, 1));
    wallX(nx * ihx, -ihy, ihy, 0, RIM, shade(ACRYL, 0.92));
    ctx.globalAlpha = 0.3;
    flat(-hx, ny * ihy, hx, ny * hy, RIM, shade(ACRYL, 1.05));
    flat(nx * ihx, -ihy, nx * hx, ihy, RIM, shade(ACRYL, 1));
    ctx.globalAlpha = 0.2;
    wallY(ny * hy, -hx, hx, -CASE_H, RIM, shade(ACRYL, faceLit([0, ny])));
    wallX(nx * hx, -hy, hy, -CASE_H, RIM, shade(ACRYL, faceLit([nx, 0])));
    ctx.globalAlpha = 1;
    // 가까운 쪽 모서리만 캡 위에 — 먼 쪽은 이미 캡보다 먼저 그렸다
    ctx.lineWidth = Math.max(1, S * 0.012); ctx.strokeStyle = "rgba(255,255,255,0.55)";
    for (const [ex, ey] of [[hx, hy], [ihx, ihy]] as const) {
      const a1 = P(nx * ex, -ny * ey, RIM), near = P(nx * ex, ny * ey, RIM), a2 = P(-nx * ex, ny * ey, RIM);
      ctx.beginPath(); ctx.moveTo(a1[0], a1[1]); ctx.lineTo(near[0], near[1]); ctx.lineTo(a2[0], a2[1]); ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    for (const [ex, ey] of [[nx * hx, ny * hy], [-nx * hx, ny * hy]] as const) {
      const a = P(ex, ey, RIM), b = P(ex, ey, -CASE_H);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }

    if (!chainBehind) drawChain();
  });

  return {
    start: () => loop.start(),
    stop: () => loop.stop(),
    dispose: () => { loop.stop(); window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); },
    pointerDown(x, y, id) {
      const i = keyAt(x, y);
      if (i >= 0) { pressedBy.set(id, i); pressKey(i); return; }
      orbiting.add(id); // 키캡이 아닌 곳 → 돌려 보기
    },
    pointerMove(x, y, _dx, _dy, id, pressed) {
      if (orbiting.has(id)) {
        if (!pressed) { orbiting.delete(id); return; }
        yaw -= _dx * 0.009;
        pitch = clamp(pitch + _dy * 0.0035, 0.12, 0.95);
        setView(); fit();
        return;
      }
      if (!pressed) return;
      const cur = pressedBy.get(id); const i = keyAt(x, y);
      if (cur !== undefined && i !== cur) { releaseKey(cur); pressedBy.delete(id); }
      if (i >= 0 && i !== cur) { pressedBy.set(id, i); pressKey(i); }
    },
    pointerUp(id) {
      orbiting.delete(id);
      const i = pressedBy.get(id);
      if (i !== undefined) { releaseKey(i); pressedBy.delete(id); }
    },
    wheel() {},
    tilt() {},
    idle() {},
    clear() {
      total = 0; bounce = 0; levelPop = 0; ringLife = 0; confetti.length = 0;
      yaw = YAW0; pitch = PITCH0; setView(); // 각도도 처음으로
      shuffle();
    },
    setSound(on) { sound = on; },
    setParam(key, value) {
      if (key === "count" && typeof value === "number") setCount(value);
      if (key === "led" && typeof value === "boolean") led = value;
      if (key === "haptic" && typeof value === "boolean") haptic = value;
      if (key === "switch" && typeof value === "string" && value in SWITCH_COLOR) sw = value as SwitchKind;
    },
  };
};
