import { createCanvas2D, createLoop, glowSprite } from "@/lib/canvas/tools";
import { clamp, damp, rand, TAU } from "@/lib/util/math";
import type { EngineFactory } from "./types";

/**
 * 별자리 잇기 — 밤하늘의 별을 손끝으로 이으면 선이 남고 서서히 사라진다.
 *
 * 손가락을 끌고 가다 별 가까이(28px) 지나면 그 별이 "잡히고", 앞 별과 선으로 이어진다.
 * 선은 20초쯤 남았다가 사라진다. 기울이면 하늘이 살짝 따라 움직인다(시차).
 */
type Star = { x: number; y: number; r: number; tw: number; depth: number };
type Line = { a: Star; b: Star; born: number };

export const createConstellationEngine: EngineFactory = (canvas) => {
  const c = createCanvas2D(canvas);
  const { ctx } = c;
  const starSprite = glowSprite(64, 238, 247, 248, 1);
  const goldSprite = glowSprite(96, 232, 209, 138, 1);

  const stars: Star[] = [];
  const lines: Line[] = [];
  const LINE_LIFE = 22;
  let offset = { x: 0, y: 0 };
  let offsetTarget = { x: 0, y: 0 };

  const spawn = () => {
    stars.length = 0;
    lines.length = 0;
    const n = clamp(Math.round((c.w * c.h) / 9000), 60, 220);
    for (let i = 0; i < n; i++) {
      const depth = Math.random();
      stars.push({ x: rand(0, c.w), y: rand(0, c.h), r: 0.8 + depth * 2.4, tw: rand(0, TAU), depth });
    }
  };
  spawn();

  // 포인터별로 마지막에 잡은 별
  const chains = new Map<number, Star | null>();
  let hover: { x: number; y: number } | null = null;

  const nearest = (x: number, y: number, maxD: number): Star | null => {
    let best: Star | null = null;
    let bd = maxD * maxD;
    for (const s of stars) {
      const sx = s.x + offset.x * s.depth;
      const sy = s.y + offset.y * s.depth;
      const d2 = (sx - x) * (sx - x) + (sy - y) * (sy - y);
      if (d2 < bd) { bd = d2; best = s; }
    }
    return best;
  };

  const loop = createLoop((dt, t) => {
    if (c.resize()) spawn();
    offset.x += (offsetTarget.x - offset.x) * (1 - damp(2, dt));
    offset.y += (offsetTarget.y - offset.y) * (1 - damp(2, dt));
    const now = t;

    const g = ctx.createLinearGradient(0, 0, 0, c.h);
    g.addColorStop(0, "#030a18");
    g.addColorStop(1, "#0b1a33");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.w, c.h);

    // 선 — 오래된 것부터 흐려진다
    ctx.lineCap = "round";
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i];
      const age = now - l.born;
      if (age > LINE_LIFE) { lines.splice(i, 1); continue; }
      const a = age < 1 ? age : 1 - (age - 1) / (LINE_LIFE - 1);
      ctx.strokeStyle = `rgba(232, 209, 138, ${0.7 * a})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(l.a.x + offset.x * l.a.depth, l.a.y + offset.y * l.a.depth);
      ctx.lineTo(l.b.x + offset.x * l.b.depth, l.b.y + offset.y * l.b.depth);
      ctx.stroke();
    }

    // 지금 잇고 있는 선 — 마지막 별에서 손끝까지
    for (const [id, s] of chains) {
      if (!s || !hover || id !== 0) continue;
    }

    ctx.globalCompositeOperation = "lighter";
    const linked = new Set<Star>();
    for (const l of lines) { linked.add(l.a); linked.add(l.b); }
    for (const s of stars) {
      const sx = s.x + offset.x * s.depth;
      const sy = s.y + offset.y * s.depth;
      const tw = 0.6 + 0.4 * Math.sin(t * (0.8 + s.depth) + s.tw);
      let r = s.r * 2.6 * tw;
      let near = 0;
      if (hover) near = 1 - clamp(Math.hypot(sx - hover.x, sy - hover.y) / 120, 0, 1);
      r += near * 4;
      const isLinked = linked.has(s);
      ctx.globalAlpha = 0.55 + 0.45 * tw;
      ctx.drawImage(isLinked ? goldSprite : starSprite, sx - r * 2, sy - r * 2, r * 4, r * 4);
      if (near > 0.85) {
        ctx.globalAlpha = (near - 0.85) / 0.15 * 0.6;
        ctx.drawImage(goldSprite, sx - 14, sy - 14, 28, 28);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    // 손끝에서 마지막 별까지 이어지는 임시 선
    const last = chains.get(0) ?? [...chains.values()].find(Boolean) ?? null;
    if (last && hover) {
      ctx.strokeStyle = "rgba(232, 209, 138, 0.35)";
      ctx.setLineDash([3, 6]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(last.x + offset.x * last.depth, last.y + offset.y * last.depth);
      ctx.lineTo(hover.x, hover.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  });

  const tryLink = (x: number, y: number, id: number) => {
    const s = nearest(x, y, 28);
    if (!s) return;
    const prev = chains.get(id) ?? null;
    if (prev && prev !== s) {
      const dup = lines.find((l) => (l.a === prev && l.b === s) || (l.a === s && l.b === prev));
      if (dup) dup.born = performance.now() / 1000; // 다시 밝아진다
      else lines.push({ a: prev, b: s, born: elapsed() });
    }
    chains.set(id, s);
  };
  let elapsedTime = 0;
  const elapsed = () => elapsedTime;
  const tick = createLoop((dt) => { elapsedTime += dt; });

  return {
    start: () => { loop.start(); tick.start(); },
    stop: () => { loop.stop(); tick.stop(); },
    dispose: () => { loop.stop(); tick.stop(); },
    pointerDown(x, y, id) {
      chains.set(id, null);
      hover = { x, y };
      tryLink(x, y, id);
    },
    pointerMove(x, y, _dx, _dy, id, pressed) {
      hover = { x, y };
      if (pressed) tryLink(x, y, id);
    },
    pointerUp(id) {
      chains.delete(id);
      if (id !== 0) hover = null;
    },
    wheel(_x, _y, delta) {
      offsetTarget.y = clamp(offsetTarget.y - delta * 0.6, -60, 60);
    },
    tilt(fx, fy) {
      offsetTarget = { x: fx * 40, y: fy * 40 };
    },
    idle() {},
    clear() {
      lines.length = 0;
      chains.clear();
    },
  };
};
