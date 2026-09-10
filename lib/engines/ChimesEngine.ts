import { createCanvas2D, createLoop, DEEP_BG } from "@/lib/canvas/tools";
import { chime, PENTATONIC } from "@/lib/audio/tones";
import { clamp, damp, noise3, TAU } from "@/lib/util/math";
import type { EngineFactory } from "./types";

/**
 * 윈드차임 — 관 다섯 개와 가운데 타봉이 각각 진자로 매달려 있다.
 * 바람(노이즈 · 기울기 · 스치는 손)이 흔들고, 타봉이 관에 닿으면 그 관이 울린다(소리는 기본 꺼짐).
 *
 * 진자는 각도 하나로 푼다(단진자 + 감쇠). 관마다 길이가 달라 주기가 다르고, 소리는 펜타토닉.
 */
type Pend = { ang: number; vel: number; len: number; x: number; freq: number; ring: number; w: number };

export const createChimesEngine: EngineFactory = (canvas, ctx0) => {
  const c = createCanvas2D(canvas);
  const { ctx } = c;
  let sound = ctx0.sound;

  const tubes: Pend[] = [];
  let striker!: Pend;
  let top = 0;
  let wind = 0, windTarget = 0;
  let tiltWind = 0;

  const spawn = () => {
    tubes.length = 0;
    top = c.h * 0.16;
    const spread = Math.min(c.w * 0.7, 420);
    const n = 5;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      tubes.push({
        ang: 0, vel: 0,
        len: c.h * 0.36 * (1.25 - t * 0.5), // 왼쪽이 길다(낮은 음)
        x: c.w / 2 - spread / 2 + spread * t,
        freq: PENTATONIC[i], ring: 0, w: 12,
      });
    }
    striker = { ang: 0, vel: 0, len: c.h * 0.42, x: c.w / 2, freq: 0, ring: 0, w: 22 };
  };
  spawn();

  const loop = createLoop((dt, t) => {
    if (c.resize()) spawn();
    wind += (windTarget - wind) * (1 - damp(1.2, dt));
    windTarget *= damp(0.7, dt);
    const breeze = noise3(t * 0.3, 0, 0) * 0.6 + wind + tiltWind;

    const g = 980;
    const step = (p: Pend, extra: number) => {
      // 바람은 중력을 이기지 못하게 — 관이 뒤집히면 안 된다
      const acc = -(g / p.len) * Math.sin(p.ang) + (breeze + extra) * 0.9 / (p.len / 200);
      p.vel = (p.vel + acc * dt) * damp(0.35, dt);
      p.ang += p.vel * dt;
      const LIMIT = 1.1;
      if (p.ang > LIMIT) { p.ang = LIMIT; p.vel = Math.min(p.vel, 0) * 0.5; }
      if (p.ang < -LIMIT) { p.ang = -LIMIT; p.vel = Math.max(p.vel, 0) * 0.5; }
      p.ring *= damp(2.5, dt);
    };
    for (const p of tubes) step(p, 0);
    step(striker, 0);

    // 타봉과 관의 충돌 — 타봉 끝 원(반경 w/2)과 관(사각)이 겹치면
    const sx = striker.x + Math.sin(striker.ang) * striker.len;
    const sy = top + Math.cos(striker.ang) * striker.len;
    for (const p of tubes) {
      const tx = p.x + Math.sin(p.ang) * (p.len * 0.55);
      const ty = top + Math.cos(p.ang) * (p.len * 0.55);
      // 타봉 높이가 관 범위 안이고 가로로 닿았는가
      const withinY = sy > ty - p.len * 0.55 && sy < ty + p.len * 0.55;
      const dx = sx - (p.x + Math.sin(p.ang) * (sy - top));
      if (withinY && Math.abs(dx) < striker.w / 2 + p.w / 2) {
        const rel = striker.vel * striker.len - p.vel * p.len;
        if (Math.abs(rel) > 15) {
          const dir = Math.sign(dx) || 1;
          p.vel += (-dir * Math.abs(rel) * 0.8) / p.len;
          striker.vel += (dir * Math.abs(rel) * 0.35) / striker.len;
          const strength = clamp(Math.abs(rel) / 400, 0.1, 1);
          p.ring = Math.max(p.ring, strength);
          if (sound) chime(p.freq, strength, 3.2);
        }
        // 겹침 풀기
        const push = (striker.w / 2 + p.w / 2 - Math.abs(dx)) * (Math.sign(dx) || 1);
        striker.ang += push / striker.len * 0.5;
        p.ang -= push / p.len * 0.5;
      }
    }

    // 그리기
    const bg = ctx.createLinearGradient(0, 0, 0, c.h);
    bg.addColorStop(0, "#0e3037");
    bg.addColorStop(1, DEEP_BG);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, c.w, c.h);
    // 위 걸이
    ctx.strokeStyle = "rgba(201,168,76,0.9)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.ellipse(c.w / 2, top - 2, Math.min(c.w * 0.36, 220), 14, 0, 0, TAU);
    ctx.stroke();
    // 실
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(238,247,248,0.35)";
    for (const p of [...tubes, striker]) {
      ctx.beginPath();
      ctx.moveTo(p.x, top);
      ctx.lineTo(p.x + Math.sin(p.ang) * (p.len * (p === striker ? 1 : 0.28)), top + Math.cos(p.ang) * (p.len * (p === striker ? 1 : 0.28)));
      ctx.stroke();
    }
    // 관
    for (const p of tubes) {
      ctx.save();
      const hx = p.x + Math.sin(p.ang) * (p.len * 0.28);
      const hy = top + Math.cos(p.ang) * (p.len * 0.28);
      ctx.translate(hx, hy);
      ctx.rotate(-p.ang);
      const L = p.len * 0.55, W = p.w;
      const grad = ctx.createLinearGradient(-W / 2, 0, W / 2, 0);
      grad.addColorStop(0, "#8a6f2a");
      grad.addColorStop(0.35, "#e8d18a");
      grad.addColorStop(0.55, "#fff3c4");
      grad.addColorStop(1, "#6f5820");
      ctx.fillStyle = grad;
      roundRect(ctx, -W / 2, 0, W, L, W / 2);
      ctx.fill();
      if (p.ring > 0.02) {
        ctx.strokeStyle = `rgba(232,209,138,${p.ring * 0.7})`;
        ctx.lineWidth = 2 + p.ring * 6;
        roundRect(ctx, -W / 2 - 3, -3, W + 6, L + 6, W / 2 + 3);
        ctx.stroke();
      }
      ctx.restore();
    }
    // 타봉
    ctx.beginPath();
    ctx.arc(sx, sy, striker.w / 2, 0, TAU);
    const sg = ctx.createRadialGradient(sx - 5, sy - 5, 2, sx, sy, striker.w / 2);
    sg.addColorStop(0, "#c9dfe6");
    sg.addColorStop(1, "#33555e");
    ctx.fillStyle = sg;
    ctx.fill();
    // 바람 표시 — 아주 옅은 선들
    ctx.strokeStyle = `rgba(238,247,248,${clamp(Math.abs(breeze) * 0.08, 0, 0.25)})`;
    ctx.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const y = c.h * (0.3 + i * 0.1);
      const x0 = ((t * 120 * Math.sign(breeze || 1) + i * 173) % (c.w + 200)) - 100;
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + 60 * breeze, y + 4); ctx.stroke();
    }
  });

  function roundRect(x: CanvasRenderingContext2D, px: number, py: number, w: number, h: number, r: number) {
    x.beginPath();
    x.moveTo(px + r, py);
    x.lineTo(px + w - r, py); x.quadraticCurveTo(px + w, py, px + w, py + r);
    x.lineTo(px + w, py + h - r); x.quadraticCurveTo(px + w, py + h, px + w - r, py + h);
    x.lineTo(px + r, py + h); x.quadraticCurveTo(px, py + h, px, py + h - r);
    x.lineTo(px, py + r); x.quadraticCurveTo(px, py, px + r, py);
    x.closePath();
  }

  const nearestPend = (x: number, y: number): Pend | null => {
    let best: Pend | null = null, bd = 60;
    for (const p of [...tubes, striker]) {
      const px = p.x + Math.sin(p.ang) * p.len * 0.6, py = top + Math.cos(p.ang) * p.len * 0.6;
      const d = Math.hypot(px - x, py - y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  };

  return {
    start: () => loop.start(),
    stop: () => loop.stop(),
    dispose: () => loop.stop(),
    pointerDown(x, y) {
      const p = nearestPend(x, y);
      if (p) p.vel += (x < p.x ? 1 : -1) * 0.6;
      else windTarget = clamp(windTarget + (x < c.w / 2 ? 1 : -1) * 1.2, -2.2, 2.2);
    },
    pointerMove(x, _y, dx, _dy, _id, pressed) {
      // 손을 쓸면 그 방향으로 바람
      windTarget = clamp(windTarget + dx * (pressed ? 0.03 : 0.012), -2.2, 2.2);
      void x;
    },
    pointerUp() {},
    wheel(_x, _y, delta) {
      windTarget = clamp(windTarget - delta * 0.03, -2.2, 2.2);
    },
    tilt(fx) {
      tiltWind = fx * 2.5;
    },
    idle() {
      windTarget = clamp(windTarget + (Math.random() - 0.5) * 2.4, -2.2, 2.2);
    },
    clear() {
      spawn();
      wind = windTarget = 0;
    },
    setSound(on) {
      sound = on;
    },
  };
};
