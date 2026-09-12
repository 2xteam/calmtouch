import { createCanvas2D, createLoop, DEEP_BG } from "@/lib/canvas/tools";
import { thock } from "@/lib/audio/tones";
import { clamp, damp, lerp, TAU } from "@/lib/util/math";
import type { EngineFactory } from "./types";

/**
 * 키캡 — 기계식 키보드 키캡을 톡톡 누르는 장면 (2026-09-12 사용자 요청. 요즘 흔한 "키캡 클리커").
 *
 *   · 키캡 1~9개(도구 패널의 조정 값 `count`). 누르면 캡이 내려앉고 옆면이 줄어들며 "톡" 소리(소리 켰을 때)
 *   · LED(`led`): 켜면 캡 아래에서 RGB 가 부드럽게 돌며 비치고, 누른 키는 환하게 번쩍여 옆 키로 파도처럼 퍼진다
 *   · 키보드로 쳐도 눌린다 — 자판 글자 코드로 어느 키캡인지 정한다. 위에 누른 횟수가 쌓인다. 지우기 = 0
 */
type Key = { x: number; y: number; press: number; target: number; hit: number; flash: number; legend: string };
type Wave = { at: number; idx: number; amt: number };

const LEGENDS = "CALMTOUCH";

export const createKeycapEngine: EngineFactory = (canvas, ctx0) => {
  const c = createCanvas2D(canvas);
  const { ctx } = c;
  let sound = ctx0.sound;
  let count = 3;
  let led = true;
  for (const ctl of ctx0.scene.controls ?? []) {
    if (ctl.key === "count" && ctl.kind === "stepper") count = ctl.default;
    if (ctl.key === "led" && ctl.kind === "switch") led = ctl.default;
  }
  let keys: Key[] = [];
  let size = 90;
  let total = 0;
  let ledMix = led ? 1 : 0; // LED 켜고 끌 때 부드럽게
  const waves: Wave[] = [];
  const pressedBy = new Map<number | string, number>(); // 포인터/자판 → 키 번호

  const layout = () => {
    const portrait = c.h > c.w;
    const cols = Math.min(count, portrait ? 3 : 5);
    const rows = Math.ceil(count / cols);
    size = clamp(Math.min((c.w * 0.86) / cols - 14, (c.h * 0.6) / rows - 14), 54, 150);
    const gap = size * 0.16;
    const totalW = cols * size + (cols - 1) * gap, totalH = rows * size + (rows - 1) * gap;
    const ox = (c.w - totalW) / 2, oy = c.h * 0.52 - totalH / 2;
    const next: Key[] = [];
    for (let i = 0; i < count; i++) {
      const col = i % cols, row = Math.floor(i / cols);
      const rowCount = row === rows - 1 ? count - row * cols : cols;
      const rowOx = ox + ((cols - rowCount) * (size + gap)) / 2; // 마지막 줄은 가운데 맞춤
      const old = keys[i];
      next.push({ x: rowOx + col * (size + gap) + size / 2, y: oy + row * (size + gap) + size / 2, press: old?.press ?? 0, target: old?.target ?? 0, hit: old?.hit ?? 0, flash: old?.flash ?? 0, legend: LEGENDS[i % LEGENDS.length] });
    }
    keys = next;
  };
  layout();

  const pressKey = (i: number) => {
    const k = keys[i];
    if (!k || k.target === 1) return;
    k.target = 1; k.hit = 1;
    total++;
    if (sound) thock(1 - i * 0.03);
    if (led) {
      const now = performance.now();
      for (let j = 0; j < keys.length; j++) {
        const d = Math.hypot(keys[j].x - k.x, keys[j].y - k.y) / size;
        waves.push({ at: now + d * 70, idx: j, amt: Math.exp(-d * 0.55) });
      }
    }
  };
  const releaseKey = (i: number) => { const k = keys[i]; if (k) k.target = 0; };
  const keyAt = (x: number, y: number) => {
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (Math.abs(x - k.x) <= size * 0.55 && Math.abs(y - k.y) <= size * 0.55) return i;
    }
    return -1;
  };

  // 자판 — 글자마다 키캡 하나. 버튼·입력칸 위에서는 건드리지 않는다
  const onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "BUTTON" || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (e.key === "Escape" || e.key === "Tab" || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.repeat) return;
    const code = e.key.length === 1 ? e.key.toUpperCase().charCodeAt(0) : e.key.charCodeAt(0);
    const i = code % keys.length;
    pressedBy.set("k" + e.code, i);
    pressKey(i);
    if (e.key === " ") e.preventDefault();
  };
  const onKeyUp = (e: KeyboardEvent) => {
    const i = pressedBy.get("k" + e.code);
    if (i === undefined) return;
    pressedBy.delete("k" + e.code);
    releaseKey(i);
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  const hue = (i: number, t: number) => (t * 40 + i * 28) % 360;

  const loop = createLoop((dt, t) => {
    if (c.resize()) layout();
    ledMix = lerp(ledMix, led ? 1 : 0, 1 - damp(6, dt));
    const now = performance.now();
    for (let i = waves.length - 1; i >= 0; i--) {
      const w = waves[i];
      if (now >= w.at) { const k = keys[w.idx]; if (k) k.flash = Math.max(k.flash, w.amt); waves.splice(i, 1); }
    }
    for (const k of keys) {
      // 내려갈 때는 빠르고(스위치가 걸리는 느낌), 올라올 때는 살짝 튕긴다
      k.press = k.target === 1 ? lerp(k.press, 1, 1 - damp(28, dt)) : lerp(k.press, 0, 1 - damp(16, dt));
      k.hit *= damp(6, dt);
      k.flash *= damp(3.2, dt);
    }

    // ── 그리기 ──
    const bg = ctx.createRadialGradient(c.w / 2, c.h * 0.5, 0, c.w / 2, c.h * 0.5, Math.max(c.w, c.h) * 0.8);
    bg.addColorStop(0, "#132a33"); bg.addColorStop(1, DEEP_BG);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, c.w, c.h);

    // 누른 횟수
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = `700 ${clamp(c.w * 0.09, 34, 64)}px Pretendard, system-ui, sans-serif`;
    ctx.fillStyle = "rgba(238, 247, 248, 0.92)";
    const topY = keys.length ? Math.min(...keys.map((k) => k.y)) - size * 0.5 - clamp(c.h * 0.1, 50, 90) : c.h * 0.25;
    ctx.fillText(total.toLocaleString("ko-KR"), c.w / 2, topY);
    ctx.font = `600 ${clamp(c.w * 0.03, 12, 15)}px Pretendard, system-ui, sans-serif`;
    ctx.fillStyle = "rgba(238, 247, 248, 0.5)";
    ctx.fillText(total === 0 ? "키캡을 톡톡 눌러요 · 자판으로도 쳐 봐요" : "번 눌렀어요", c.w / 2, topY + clamp(c.w * 0.06, 28, 44));

    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const s = size;
      const travel = s * 0.14 * k.press; // 캡이 내려간 거리
      const wall = s * 0.16 * (1 - k.press * 0.75); // 보이는 옆면 높이
      const hh = hue(i, t);
      const glow = ledMix * (0.55 + 0.45 * Math.sin(t * 1.4 + i)) + k.flash * 1.4;

      // 스위치 하우징 (캡 아래 어두운 판) + LED 비침
      ctx.fillStyle = "rgba(0, 8, 12, 0.55)";
      roundRect(ctx, k.x - s * 0.5, k.y - s * 0.5 + s * 0.05, s, s, s * 0.14); ctx.fill();
      if (glow > 0.02) {
        const g = ctx.createRadialGradient(k.x, k.y + s * 0.1, s * 0.2, k.x, k.y + s * 0.1, s * 0.95);
        g.addColorStop(0, `hsla(${hh} 100% 60% / ${clamp(glow * 0.75, 0, 1)})`);
        g.addColorStop(0.5, `hsla(${hh} 100% 60% / ${clamp(glow * 0.28, 0, 1)})`);
        g.addColorStop(1, `hsla(${hh} 100% 60% / 0)`);
        ctx.fillStyle = g; ctx.fillRect(k.x - s, k.y - s, s * 2, s * 2.2);
      }

      // 캡 옆면 — 아래로 늘인 어두운 몸통 (누르면 짧아진다)
      const capTop = k.y - s * 0.5 + travel - s * 0.04;
      const capW = s * 0.94, capH = s * 0.94;
      const capX = k.x - capW / 2;
      ctx.fillStyle = "#1c2a31";
      roundRect(ctx, capX, capTop + wall, capW, capH, s * 0.13); ctx.fill();
      // 윗면 — 살짝 안으로 들어간 접시(오목) 느낌: 위쪽 밝고 아래쪽 어둡다
      const topG = ctx.createLinearGradient(0, capTop, 0, capTop + capH);
      const lit = 1 - k.press * 0.12;
      topG.addColorStop(0, `rgb(${(74 * lit) | 0},${(94 * lit) | 0},${(102 * lit) | 0})`);
      topG.addColorStop(0.5, `rgb(${(58 * lit) | 0},${(76 * lit) | 0},${(84 * lit) | 0})`);
      topG.addColorStop(1, `rgb(${(64 * lit) | 0},${(82 * lit) | 0},${(90 * lit) | 0})`);
      ctx.fillStyle = topG;
      roundRect(ctx, capX, capTop, capW, capH, s * 0.13); ctx.fill();
      // 윗면 오목한 면 (안쪽 사각)
      const inset = s * 0.1;
      const dishG = ctx.createRadialGradient(k.x, capTop + capH * 0.42, s * 0.05, k.x, capTop + capH * 0.5, s * 0.6);
      dishG.addColorStop(0, "rgba(0,0,0,0.12)"); dishG.addColorStop(1, "rgba(255,255,255,0.05)");
      ctx.fillStyle = dishG;
      roundRect(ctx, capX + inset, capTop + inset * 0.9, capW - inset * 2, capH - inset * 1.9, s * 0.09); ctx.fill();
      // 모서리 빛
      ctx.strokeStyle = `rgba(255,255,255,${0.18 - k.press * 0.08})`; ctx.lineWidth = 1.2;
      roundRect(ctx, capX + 0.6, capTop + 0.6, capW - 1.2, capH - 1.2, s * 0.13); ctx.stroke();

      // 각인 — LED 가 켜지면 빛이 새어 나온다
      ctx.font = `800 ${s * 0.38}px Pretendard, system-ui, sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const legendY = capTop + capH * 0.5;
      if (glow > 0.02) {
        ctx.shadowColor = `hsla(${hh} 100% 70% / ${clamp(glow, 0, 1)})`; ctx.shadowBlur = s * 0.16;
        ctx.fillStyle = `hsla(${hh} 100% ${lerp(78, 92, clamp(k.flash, 0, 1))}% / ${clamp(0.35 + glow * 0.65, 0, 1)})`;
      } else {
        ctx.fillStyle = "rgba(200, 216, 220, 0.55)";
      }
      ctx.fillText(k.legend, k.x, legendY);
      ctx.shadowBlur = 0; ctx.shadowColor = "transparent";
      // 눌린 순간 옅은 링
      if (k.hit > 0.02) {
        ctx.strokeStyle = `rgba(255,255,255,${0.35 * k.hit})`; ctx.lineWidth = 2;
        const r = s * (0.55 + (1 - k.hit) * 0.35);
        roundRect(ctx, k.x - r, k.y - r + s * 0.05, r * 2, r * 2, s * 0.2); ctx.stroke();
      }
    }
  });

  function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    g.beginPath();
    g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
  }

  return {
    start: () => loop.start(),
    stop: () => loop.stop(),
    dispose: () => { loop.stop(); window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); },
    pointerDown(x, y, id) { const i = keyAt(x, y); if (i >= 0) { pressedBy.set(id, i); pressKey(i); } },
    pointerMove(x, y, _dx, _dy, id, pressed) {
      if (!pressed) return;
      const cur = pressedBy.get(id);
      const i = keyAt(x, y);
      if (cur !== undefined && i !== cur) { releaseKey(cur); pressedBy.delete(id); }
      if (i >= 0 && i !== cur) { pressedBy.set(id, i); pressKey(i); } // 손가락을 미끄러뜨리면 차례로 눌린다
    },
    pointerUp(id) { const i = pressedBy.get(id); if (i !== undefined) { releaseKey(i); pressedBy.delete(id); } },
    wheel() {},
    tilt() {},
    idle() {},
    clear() { total = 0; for (const k of keys) { k.flash = 0; k.hit = 0; } },
    setSound(on) { sound = on; },
    setParam(key, value) {
      if (key === "count" && typeof value === "number") { count = clamp(Math.round(value), 1, 9); layout(); }
      if (key === "led" && typeof value === "boolean") led = value;
    },
  };
};
