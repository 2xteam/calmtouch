import { createCanvas2D, createLoop, DEEP_BG } from "@/lib/canvas/tools";
import { chime, PENTATONIC } from "@/lib/audio/tones";
import { clamp, damp, noise3, TAU } from "@/lib/util/math";
import type { EngineFactory } from "./types";

/**
 * 윈드차임 — 나무 갓 아래 금속 관 다섯 개와 가운데 타봉, 그 아래 바람을 받는 돛(추).
 * 바람(노이즈 · 기울기 · 스치는 손)이 돛을 밀어 타봉이 흔들리고, 관에 닿으면 그 관이 울린다.
 *
 * 두 번째 판(2026-09-11). 첫 판은 평평한 금색 막대와 큰 고리라 장난감처럼 보였다. 지금은 —
 *   · 살짝 내려다본 시점 — 갓은 나무 타원, 관은 앞뒤로도 조금 흔들려 굵기가 변한다(깊이)
 *   · 관은 광택 있는 금속(놋쇠 그라디언트 + 세로 하이라이트 + 끝 마감)
 *   · 돛(나무 원판)이 바람을 받는 것이 보이고, 울리는 관은 잠깐 빛난다
 *   · 뒤는 저녁 창가 빛
 */
type Pend = { ang: number; vel: number; z: number; zv: number; len: number; x: number; freq: number; ring: number; w: number };

export const createChimesEngine: EngineFactory = (canvas, ctx0) => {
  const c = createCanvas2D(canvas);
  const { ctx } = c;
  let sound = ctx0.sound;

  const tubes: Pend[] = [];
  let striker!: Pend;
  let top = 0;
  let wind = 0, windTarget = 0;
  let tiltWind = 0;
  let hoodR = 120;

  const spawn = () => {
    tubes.length = 0;
    top = c.h * 0.17;
    hoodR = Math.min(c.w * 0.26, 170);
    const n = 5;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      // 원둘레에 매달린 것처럼 — 갓 타원 위의 x 자리
      const a = -Math.PI * 0.85 + t * Math.PI * 0.7;
      tubes.push({
        ang: 0, vel: 0, z: 0, zv: 0,
        len: c.h * 0.46 * (1.15 - t * 0.38),
        x: c.w / 2 + Math.cos(a) * hoodR * 0.86,
        freq: PENTATONIC[i], ring: 0, w: 13,
      });
    }
    striker = { ang: 0, vel: 0, z: 0, zv: 0, len: c.h * 0.52, x: c.w / 2, freq: 0, ring: 0, w: 24 };
  };
  spawn();

  const loop = createLoop((dt, t) => {
    if (c.resize()) spawn();
    wind += (windTarget - wind) * (1 - damp(1.2, dt));
    windTarget *= damp(0.7, dt);
    const breeze = noise3(t * 0.3, 0, 0) * 0.6 + wind + tiltWind;

    const g = 980;
    const step = (p: Pend, sail: number) => {
      const acc = -(g / p.len) * Math.sin(p.ang) + ((breeze * sail) * 0.9) / (p.len / 200);
      p.vel = (p.vel + acc * dt) * damp(0.35, dt);
      p.ang += p.vel * dt;
      const LIMIT = 1.1;
      if (p.ang > LIMIT) { p.ang = LIMIT; p.vel = Math.min(p.vel, 0) * 0.5; }
      if (p.ang < -LIMIT) { p.ang = -LIMIT; p.vel = Math.max(p.vel, 0) * 0.5; }
      // 앞뒤 흔들림 — 바람의 잔결
      const zacc = -(g / p.len) * Math.sin(p.z) + noise3(p.x * 0.01, t * 0.5, 3) * 0.6 / (p.len / 200);
      p.zv = (p.zv + zacc * dt) * damp(0.5, dt);
      p.z = clamp(p.z + p.zv * dt, -0.5, 0.5);
      p.ring *= damp(2.5, dt);
    };
    for (const p of tubes) step(p, 0.35);
    step(striker, 1.6); // 돛이 달려 바람을 제일 많이 받는다

    // 타봉(끝의 원판)과 관의 충돌
    const sx = striker.x + Math.sin(striker.ang) * striker.len * 0.62;
    const sy = top + Math.cos(striker.ang) * striker.len * 0.62;
    for (const p of tubes) {
      const hang = p.len * 0.3;
      const tubeX = (yy: number) => p.x + Math.sin(p.ang) * (yy - top);
      const tubeTop = top + Math.cos(p.ang) * hang, tubeBot = top + Math.cos(p.ang) * (hang + p.len * 0.7);
      if (sy < tubeTop || sy > tubeBot) continue;
      const dx = sx - tubeX(sy);
      if (Math.abs(dx) < striker.w / 2 + p.w / 2) {
        const rel = striker.vel * striker.len - p.vel * p.len;
        if (Math.abs(rel) > 15) {
          const dir = Math.sign(dx) || 1;
          p.vel += (-dir * Math.abs(rel) * 0.8) / p.len;
          striker.vel += (dir * Math.abs(rel) * 0.35) / striker.len;
          const strength = clamp(Math.abs(rel) / 400, 0.1, 1);
          p.ring = Math.max(p.ring, strength);
          if (sound) chime(p.freq, strength, 3.2);
        }
        const push = (striker.w / 2 + p.w / 2 - Math.abs(dx)) * (Math.sign(dx) || 1);
        striker.ang += (push / striker.len) * 0.5;
        p.ang -= (push / p.len) * 0.5;
      }
    }

    // ── 그리기 ──
    const bg = ctx.createLinearGradient(0, 0, 0, c.h);
    bg.addColorStop(0, "#0e3037");
    bg.addColorStop(1, DEEP_BG);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, c.w, c.h);
    // 저녁 창가 빛
    const win = ctx.createRadialGradient(c.w * 0.62, c.h * 0.42, 0, c.w * 0.62, c.h * 0.42, c.h * 0.8);
    win.addColorStop(0, "rgba(232,209,138,0.26)");
    win.addColorStop(0.55, "rgba(232,209,138,0.07)");
    win.addColorStop(1, "rgba(232,209,138,0)");
    ctx.fillStyle = win;
    ctx.fillRect(0, 0, c.w, c.h);
    // 바람 — 옅은 선들
    ctx.strokeStyle = `rgba(238,247,248,${clamp(Math.abs(breeze) * 0.07, 0, 0.2)})`;
    ctx.lineWidth = 1;
    for (let i = 0; i < 7; i++) {
      const y = c.h * (0.28 + i * 0.09);
      const x0 = ((t * 110 * Math.sign(breeze || 1) + i * 173) % (c.w + 240)) - 120;
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.quadraticCurveTo(x0 + 40 * breeze, y - 6, x0 + 90 * breeze, y + 3); ctx.stroke();
    }

    // 줄 걸이 — 갓 위로 모이는 실
    ctx.strokeStyle = "rgba(238,247,248,0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(c.w / 2, 0); ctx.lineTo(c.w / 2, top - 22); ctx.stroke();

    // 실 — 갓에서 관·타봉으로
    const hangPt = (p: Pend, k: number) => ({ x: p.x + Math.sin(p.ang) * p.len * k, y: top + Math.cos(p.ang) * p.len * k });
    for (const p of [...tubes, striker]) {
      const k = p === striker ? 0.62 : 0.3;
      const e = hangPt(p, k);
      ctx.strokeStyle = "rgba(238,247,248,0.3)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(p.x, top); ctx.lineTo(e.x, e.y); ctx.stroke();
    }

    // 관 — 뒤에 있는 것부터 (z 가 클수록 뒤)
    const sorted = [...tubes].sort((a, b) => b.z - a.z);
    for (const p of sorted) {
      const h0 = hangPt(p, 0.3);
      const L = p.len * 0.7;
      const depth = 1 - p.z * 0.35; // 앞으로 오면 굵고 밝게
      const W = p.w * depth;
      ctx.save();
      ctx.translate(h0.x, h0.y);
      ctx.rotate(-p.ang);
      // 그림자 (뒤 벽에)
      ctx.fillStyle = "rgba(0,10,14,0.25)";
      ctx.fillRect(-W / 2 + 6, 8, W, L);
      // 놋쇠 관
      const grad = ctx.createLinearGradient(-W / 2, 0, W / 2, 0);
      grad.addColorStop(0, "#6f5820");
      grad.addColorStop(0.18, "#b8963d");
      grad.addColorStop(0.42, "#f6e7ad");
      grad.addColorStop(0.55, "#e8d18a");
      grad.addColorStop(0.8, "#a8842f");
      grad.addColorStop(1, "#5a4516");
      ctx.fillStyle = grad;
      roundRect(ctx, -W / 2, 0, W, L, W * 0.18);
      ctx.fill();
      // 세로 하이라이트
      ctx.fillStyle = "rgba(255,255,255,0.22)";
      ctx.fillRect(-W * 0.18, 4, W * 0.14, L - 8);
      // 끝 마감 — 살짝 어두운 타원
      ctx.fillStyle = "rgba(90,69,22,0.9)";
      ctx.beginPath(); ctx.ellipse(0, L, W / 2, W * 0.22, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = "rgba(246,231,173,0.9)";
      ctx.beginPath(); ctx.ellipse(0, 0, W / 2, W * 0.22, 0, 0, TAU); ctx.fill();
      // 매단 구멍
      ctx.fillStyle = "rgba(60,45,15,0.9)";
      ctx.beginPath(); ctx.arc(0, W * 0.5, W * 0.12, 0, TAU); ctx.fill();
      // 울림
      if (p.ring > 0.02) {
        ctx.globalAlpha = p.ring * 0.7;
        ctx.strokeStyle = "#fff3c4";
        ctx.lineWidth = 2 + p.ring * 5;
        roundRect(ctx, -W / 2 - 4, -4, W + 8, L + 8, W * 0.3);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }

    // 타봉 — 나무 원판, 그 아래 돛
    {
      const e = hangPt(striker, 0.62);
      const rr = striker.w / 2;
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.fillStyle = "rgba(0,10,14,0.25)";
      ctx.beginPath(); ctx.ellipse(6, 8, rr, rr * 0.7, 0, 0, TAU); ctx.fill();
      const wood = ctx.createRadialGradient(-rr * 0.3, -rr * 0.3, 2, 0, 0, rr);
      wood.addColorStop(0, "#c89b63"); wood.addColorStop(1, "#5e3d1f");
      ctx.fillStyle = wood;
      ctx.beginPath(); ctx.ellipse(0, 0, rr, rr * 0.72, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = "rgba(255,230,190,0.35)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(0, 0, rr * 0.6, rr * 0.42, 0, 0, TAU); ctx.stroke();
      ctx.restore();
      // 돛 — 실로 이어진 얇은 나무 판. 바람에 살짝 기운다
      const sail = { x: e.x + Math.sin(striker.ang) * 70 + breeze * 6, y: e.y + Math.cos(striker.ang) * 70 };
      ctx.strokeStyle = "rgba(238,247,248,0.3)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(sail.x, sail.y - 26); ctx.stroke();
      ctx.save();
      ctx.translate(sail.x, sail.y);
      ctx.rotate(-striker.ang * 0.6 + breeze * 0.08);
      const sw = 44 * (1 - Math.abs(breeze) * 0.06), sh = 54;
      const sg = ctx.createLinearGradient(-sw / 2, 0, sw / 2, 0);
      sg.addColorStop(0, "#7a5230"); sg.addColorStop(0.5, "#c89b63"); sg.addColorStop(1, "#6b4526");
      ctx.fillStyle = sg;
      roundRect(ctx, -sw / 2, -sh / 2, sw, sh, 10);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,230,190,0.25)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-sw * 0.3, -sh * 0.3); ctx.lineTo(sw * 0.2, sh * 0.35); ctx.stroke();
      ctx.restore();
    }

    // 갓 — 나무 타원판 (맨 위에 그려 실이 그 아래서 나오는 것처럼)
    const hoodH = hoodR * 0.13;
    ctx.save();
    ctx.translate(c.w / 2, top);
    ctx.fillStyle = "rgba(0,10,14,0.35)";
    ctx.beginPath(); ctx.ellipse(6, 10, hoodR, hoodH, 0, 0, TAU); ctx.fill();
    // 두께(옆면)
    ctx.fillStyle = "#4a2f18";
    ctx.beginPath(); ctx.ellipse(0, 6, hoodR, hoodH, 0, 0, Math.PI); ctx.lineTo(-hoodR, 0); ctx.ellipse(0, 0, hoodR, hoodH, 0, Math.PI, 0, true); ctx.closePath(); ctx.fill();
    const hg = ctx.createLinearGradient(-hoodR, 0, hoodR, 0);
    hg.addColorStop(0, "#6b4526"); hg.addColorStop(0.35, "#c89b63"); hg.addColorStop(0.6, "#a87445"); hg.addColorStop(1, "#5e3d1f");
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.ellipse(0, 0, hoodR, hoodH, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = "rgba(255,230,190,0.3)"; ctx.lineWidth = 1.2;
    for (let k = 1; k <= 3; k++) { ctx.beginPath(); ctx.ellipse(0, 0, hoodR * (k / 3.6), hoodH * (k / 3.6), 0, 0, TAU); ctx.stroke(); }
    ctx.restore();
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
    let best: Pend | null = null, bd = 70;
    for (const p of [...tubes, striker]) {
      const k = p === striker ? 0.62 : 0.6;
      const px = p.x + Math.sin(p.ang) * p.len * k, py = top + Math.cos(p.ang) * p.len * k;
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
    pointerMove(_x, _y, dx, _dy, _id, pressed) {
      windTarget = clamp(windTarget + dx * (pressed ? 0.03 : 0.012), -2.2, 2.2);
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
