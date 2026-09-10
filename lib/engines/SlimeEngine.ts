import { createCanvas2D, createLoop, DEEP_BG } from "@/lib/canvas/tools";
import { clamp, damp, hexToRgb255, TAU } from "@/lib/util/math";
import type { EngineFactory } from "./types";

/**
 * 슬라임 — 둘레의 점 48개를 스프링으로 이은 소프트바디. 안에는 "부피"가 있어 눌리면 옆으로 불룩해진다.
 * 누르면 눌리고, 당기면 늘어나고, 놓으면 두 번쯤 출렁이다 멈춘다(과감쇠에 가깝게).
 *
 * 겉면은 둘레 점을 지나는 부드러운 곡선(quadratic)으로 채우고, 반투명 그라디언트 +
 * 안쪽 하이라이트 + 두꺼운 가장자리로 젤리 느낌을 낸다. 소리는 없다.
 */
type Node = { x: number; y: number; px: number; py: number; ax: number; ay: number; rx: number; ry: number };

export const createSlimeEngine: EngineFactory = (canvas, ctx0) => {
  const c = createCanvas2D(canvas);
  const { ctx } = c;
  let hex = ctx0.color;

  const N = 48;
  const nodes: Node[] = [];
  let center = { x: 0, y: 0, px: 0, py: 0 };
  let radius = 100;
  let gravity = { x: 0, y: 0 };
  let restArea = 0;

  const spawn = () => {
    nodes.length = 0;
    radius = Math.min(c.w, c.h) * 0.22;
    center = { x: c.w / 2, y: c.h / 2, px: c.w / 2, py: c.h / 2 };
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU;
      const x = c.w / 2 + Math.cos(a) * radius;
      const y = c.h / 2 + Math.sin(a) * radius;
      nodes.push({ x, y, px: x, py: y, ax: 0, ay: 0, rx: Math.cos(a) * radius, ry: Math.sin(a) * radius });
    }
    restArea = Math.PI * radius * radius;
  };
  spawn();

  const grabs = new Map<number, { idx: number[]; x: number; y: number; offs: [number, number][] }>();
  let pressure = 0; // 눌림 깊이 표시용
  const area = () => {
    let s = 0;
    for (let i = 0; i < N; i++) {
      const a = nodes[i], b = nodes[(i + 1) % N];
      s += a.x * b.y - b.x * a.y;
    }
    return Math.abs(s) / 2;
  };

  const loop = createLoop((dt, t) => {
    if (c.resize()) spawn();
    const h = Math.min(dt, 1 / 50);
    const sub = 4;
    const hs = h / sub;
    gravity.x *= damp(1.5, dt);
    gravity.y *= damp(1.5, dt);

    for (let s = 0; s < sub; s++) {
      // 중심 — 둘레의 평균 (살짝 아래로 늘어지는 무게)
      let cx = 0, cy = 0;
      for (const n of nodes) { cx += n.x; cy += n.y; }
      cx /= N; cy /= N;
      center.x = cx; center.y = cy;

      const A = area();
      const pressureK = clamp((restArea - A) / restArea, -0.5, 0.8) * 2600;
      const wobble = Math.sin(t * 1.3) * 0.6;

      for (let i = 0; i < N; i++) {
        const n = nodes[i];
        // 기준 모양으로 돌아가려는 힘 (형태 스프링)
        // 화면 가운데(살짝 아래)로 아주 약하게 당긴다 — 자기 무게중심 기준으로 더하면 끝없이 흘러내린다
        const ax0 = c.w / 2 + gravity.x * 120, ay0 = c.h / 2 + 30 + gravity.y * 120;
        const tx = cx + n.rx * (1 + wobble * 0.01) + (ax0 - cx) * 0.12;
        const ty = cy + n.ry * (1 + wobble * 0.01) + (ay0 - cy) * 0.12;
        n.ax = (tx - n.x) * 26;
        n.ay = (ty - n.y) * 26;
        // 이웃 스프링
        const l = nodes[(i + N - 1) % N], r = nodes[(i + 1) % N];
        const rest = (TAU * radius) / N;
        for (const o of [l, r]) {
          const dx = o.x - n.x, dy = o.y - n.y;
          const d = Math.hypot(dx, dy) || 0.001;
          const f = (d - rest) * 40;
          n.ax += (dx / d) * f; n.ay += (dy / d) * f;
        }
        // 부피 압력 — 바깥 법선 방향
        const nx = (r.y - l.y), ny = -(r.x - l.x);
        const nl = Math.hypot(nx, ny) || 0.001;
        n.ax += (nx / nl) * pressureK; n.ay += (ny / nl) * pressureK;
        // 중력(기울기) · 바닥 느낌
      }
      // Verlet 적분 + 감쇠
      const dampK = Math.exp(-4.5 * hs);
      for (const n of nodes) {
        const vx = (n.x - n.px) * dampK, vy = (n.y - n.py) * dampK;
        n.px = n.x; n.py = n.y;
        n.x += vx + n.ax * hs * hs;
        n.y += vy + n.ay * hs * hs;
        // 화면 안
        n.x = clamp(n.x, 8, c.w - 8); n.y = clamp(n.y, 8, c.h - 8);
      }
      // 잡은 점들은 손을 따라간다
      for (const g of grabs.values()) {
        g.idx.forEach((i, k) => {
          const n = nodes[i];
          const [ox, oy] = g.offs[k];
          n.px = n.x = g.x + ox;
          n.py = n.y = g.y + oy;
        });
      }
    }
    pressure = clamp((restArea - area()) / restArea, 0, 1);

    // 그리기
    ctx.fillStyle = DEEP_BG;
    ctx.fillRect(0, 0, c.w, c.h);
    const [R, G, B] = hexToRgb255(hex);
    // 바닥 그림자
    const sg = ctx.createRadialGradient(center.x, center.y + radius * 0.95, 0, center.x, center.y + radius * 0.95, radius * 1.1);
    sg.addColorStop(0, "rgba(0,10,14,0.5)");
    sg.addColorStop(1, "rgba(0,10,14,0)");
    ctx.save();
    ctx.translate(center.x, center.y + radius * 0.95);
    ctx.scale(1, 0.25);
    ctx.translate(-center.x, -(center.y + radius * 0.95));
    ctx.fillStyle = sg;
    ctx.fillRect(center.x - radius * 1.2, center.y + radius * 0.95 - radius * 1.2, radius * 2.4, radius * 2.4);
    ctx.restore();

    // 몸 — 부드러운 폐곡선
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const a = nodes[i], b = nodes[(i + 1) % N];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (i === 0) ctx.moveTo(mx, my);
      else ctx.quadraticCurveTo(a.x, a.y, mx, my);
    }
    const a0 = nodes[0], b0 = nodes[1];
    ctx.quadraticCurveTo(a0.x, a0.y, (a0.x + b0.x) / 2, (a0.y + b0.y) / 2);
    ctx.closePath();
    const bodyG = ctx.createRadialGradient(center.x - radius * 0.3, center.y - radius * 0.35, radius * 0.1, center.x, center.y, radius * 1.15);
    const deepen = 1 - pressure * 0.35;
    bodyG.addColorStop(0, `rgba(${R},${G},${B},${0.95 * deepen + 0.05})`);
    bodyG.addColorStop(0.7, `rgba(${R * 0.8 | 0},${G * 0.8 | 0},${B * 0.8 | 0},0.9)`);
    bodyG.addColorStop(1, `rgba(${R * 0.45 | 0},${G * 0.45 | 0},${B * 0.45 | 0},0.95)`);
    ctx.fillStyle = bodyG;
    ctx.fill();
    // 두꺼운 가장자리
    ctx.lineWidth = 6;
    ctx.strokeStyle = `rgba(${R * 0.35 | 0},${G * 0.35 | 0},${B * 0.35 | 0},0.7)`;
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(238,247,248,0.35)";
    ctx.stroke();
    // 안쪽 하이라이트 — 몸을 클립해서
    ctx.save();
    ctx.clip();
    const hl = ctx.createRadialGradient(center.x - radius * 0.35, center.y - radius * 0.45, 0, center.x - radius * 0.35, center.y - radius * 0.45, radius * 0.7);
    hl.addColorStop(0, "rgba(255,255,255,0.45)");
    hl.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = hl;
    ctx.fillRect(0, 0, c.w, c.h);
    // 작은 반짝 점
    ctx.beginPath();
    ctx.ellipse(center.x - radius * 0.42, center.y - radius * 0.5, radius * 0.12, radius * 0.06, -0.6, 0, TAU);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fill();
    ctx.restore();
  });

  const nearest = (x: number, y: number, k: number) => {
    return nodes
      .map((n, i) => ({ i, d: Math.hypot(n.x - x, n.y - y) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, k)
      .filter((e) => e.d < radius * 0.75)
      .map((e) => e.i);
  };
  const inside = (x: number, y: number) => Math.hypot(x - center.x, y - center.y) < radius * 1.05;

  return {
    start: () => loop.start(),
    stop: () => loop.stop(),
    dispose: () => loop.stop(),
    pointerDown(x, y, id) {
      if (inside(x, y) && Math.hypot(x - center.x, y - center.y) < radius * 0.55) {
        // 가운데를 누르면 눌린다 — 둘레를 바깥으로 밀어낸다
        for (const n of nodes) {
          const dx = n.x - x, dy = n.y - y;
          const d = Math.hypot(dx, dy) || 0.001;
          n.x += (dx / d) * 22; n.y += (dy / d) * 22;
        }
        grabs.set(id, { idx: [], x, y, offs: [] });
        return;
      }
      const idx = nearest(x, y, 5);
      if (idx.length) grabs.set(id, { idx, x, y, offs: idx.map((i) => [nodes[i].x - x, nodes[i].y - y] as [number, number]) });
    },
    pointerMove(x, y, dx, dy, id, pressed) {
      if (!pressed) return;
      const g = grabs.get(id);
      if (g) {
        g.x = x; g.y = y;
        if (g.idx.length === 0) {
          // 누른 채로 문지르면 그 자리가 계속 눌린다
          for (const n of nodes) {
            const ddx = n.x - x, ddy = n.y - y;
            const d = Math.hypot(ddx, ddy) || 0.001;
            if (d < radius * 0.7) { n.x += (ddx / d) * 6; n.y += (ddy / d) * 6; }
          }
        }
      }
    },
    pointerUp(id) {
      grabs.delete(id);
    },
    wheel(_x, _y, delta) {
      for (const n of nodes) n.y -= delta * 0.4;
    },
    tilt(fx, fy) {
      gravity = { x: fx, y: fy };
    },
    idle() {
      // 살짝 찌르고 지나간 듯 한 번 출렁
      const i = Math.floor(Math.random() * N);
      nodes[i].x += nodes[i].rx * 0.15; nodes[i].y += nodes[i].ry * 0.15;
    },
    clear() {
      spawn();
    },
    setColor(h) {
      hex = h;
    },
  };
};
