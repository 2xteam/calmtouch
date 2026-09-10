import { createCanvas2D, createLoop, DEEP_BG } from "@/lib/canvas/tools";
import { clamp, damp, hexToRgb255, lerp, rgba, smoothstep, TAU } from "@/lib/util/math";
import type { EngineFactory } from "./types";

/**
 * 호흡 원 — 커지고 작아지는 원에 숨을 맞춘다.
 *
 * 가만히 두면 4초 들이쉬고 · 2초 멈추고 · 6초 내쉬는 주기로 돈다.
 * **누르고 있는 동안은 들이쉬는 쪽으로**, 놓으면 내쉬는 쪽으로 간다 — 사람의 손이 박자를 잡는다.
 * 원 둘레의 작은 점들이 숨과 함께 벌어지고 모여, 글자를 읽지 않아도 방향이 보인다.
 */
export const createBreathEngine: EngineFactory = (canvas, ctx0) => {
  const c = createCanvas2D(canvas);
  const { ctx } = c;
  let hex = ctx0.color;

  const IN = 4, HOLD = 2, OUT = 6;
  const CYCLE = IN + HOLD + OUT;
  let phase = 0; // 0~CYCLE
  let level = 0.2; // 0(내쉼)~1(들이쉼) — 실제 그리는 값, 부드럽게 따라간다
  let target = 0.2;
  let holding = false;
  let label = "";
  let labelAlpha = 0;
  let touchX = 0, touchY = 0, touchGlow = 0;
  let cycles = 0;
  let lastLabel = "";

  const loop = createLoop((dt, t) => {
    c.resize();

    if (holding) {
      target = Math.min(1, target + dt / IN);
      label = target >= 1 ? "멈춰요" : "들이쉬어요";
    } else {
      phase = (phase + dt) % CYCLE;
      if (phase < IN) { target = 0.15 + 0.85 * smoothstep(0, IN, phase); label = "들이쉬어요"; }
      else if (phase < IN + HOLD) { target = 1; label = "멈춰요"; }
      else { target = 1 - 0.85 * smoothstep(IN + HOLD, CYCLE, phase); label = "내쉬어요"; }
    }
    if (label !== lastLabel) { labelAlpha = 0; lastLabel = label; if (label === "들이쉬어요") cycles++; }
    labelAlpha = Math.min(1, labelAlpha + dt * 2);
    level += (target - level) * (1 - damp(3, dt));
    touchGlow *= damp(3, dt);

    ctx.fillStyle = DEEP_BG;
    ctx.fillRect(0, 0, c.w, c.h);

    const cx = c.w / 2;
    const cy = c.h / 2 - 10;
    const base = Math.min(c.w, c.h) * 0.16;
    const r = base * lerp(0.75, 1.9, level);
    const [R, G, B] = hexToRgb255(hex);

    // 바깥 후광
    const halo = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 2.2);
    halo.addColorStop(0, `rgba(${R},${G},${B},${0.22 + level * 0.12})`);
    halo.addColorStop(1, `rgba(${R},${G},${B},0)`);
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, c.w, c.h);

    // 본 원 — 안쪽이 밝다
    const g = ctx.createRadialGradient(cx - r * 0.25, cy - r * 0.3, r * 0.1, cx, cy, r);
    g.addColorStop(0, `rgba(${R},${G},${B},0.95)`);
    g.addColorStop(0.7, `rgba(${R},${G},${B},0.55)`);
    g.addColorStop(1, `rgba(${R},${G},${B},0.25)`);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = rgba(hex, 0.9);
    ctx.stroke();

    // 둘레의 점 12개 — 들이쉴 때 멀어지고 내쉴 때 붙는다
    const orbit = r + 22 + level * 26;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + t * 0.08;
      const px = cx + Math.cos(a) * orbit;
      const py = cy + Math.sin(a) * orbit;
      ctx.beginPath();
      ctx.arc(px, py, 2.2 + level * 1.4, 0, TAU);
      ctx.fillStyle = rgba(hex, 0.5 + 0.4 * level);
      ctx.fill();
    }

    // 손 닿은 자리
    if (touchGlow > 0.01) {
      const tg = ctx.createRadialGradient(touchX, touchY, 0, touchX, touchY, 60);
      tg.addColorStop(0, `rgba(238,247,248,${0.35 * touchGlow})`);
      tg.addColorStop(1, "rgba(238,247,248,0)");
      ctx.fillStyle = tg;
      ctx.fillRect(touchX - 60, touchY - 60, 120, 120);
    }

    // 글자
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${Math.round(clamp(c.w * 0.05, 18, 26))}px "Gowun Batang", serif`;
    ctx.fillStyle = `rgba(238,247,248,${0.85 * labelAlpha})`;
    ctx.fillText(label, cx, cy + r * 1 + 78 + level * 26);
    ctx.font = `500 12px Pretendard, "Noto Sans KR", sans-serif`;
    ctx.fillStyle = "rgba(230,244,246,0.5)";
    ctx.fillText(holding ? "누르고 있는 동안 들이쉬어요 · 놓으면 내쉬어요" : `${cycles}번째 숨 · 누르면 손이 박자를 잡아요`, cx, c.h - 96);
  });

  return {
    start: () => loop.start(),
    stop: () => loop.stop(),
    dispose: () => loop.stop(),
    pointerDown(x, y) {
      holding = true;
      touchX = x; touchY = y; touchGlow = 1;
      // 누르기 시작하면 지금 크기에서 이어서 들이쉰다
      target = level;
    },
    pointerMove(x, y, _dx, _dy, _id, pressed) {
      if (pressed) { touchX = x; touchY = y; touchGlow = Math.max(touchGlow, 0.6); }
    },
    pointerUp() {
      if (!holding) return;
      holding = false;
      // 놓은 순간부터 내쉬기 구간으로 이어 붙인다
      phase = IN + HOLD + (1 - (level - 0.15) / 0.85) * OUT;
      phase = clamp(phase, IN + HOLD, CYCLE - 0.01);
    },
    wheel() {},
    tilt() {},
    idle() {},
    clear() {
      cycles = 0;
      phase = 0;
    },
    setColor(h) {
      hex = h;
    },
  };
};
