import { FluidSim, type RGB } from "@/lib/fluid/FluidSim";
import { dyeFromHex, randomFromPalette, randomRainbow, scaleDye } from "@/lib/fluid/color";
import type { EngineFactory, SceneEngine } from "./types";
import { EngineUnsupportedError } from "./types";

/**
 * 물감 계열 장면 — FluidSim 을 SceneEngine 인터페이스로 감싼다.
 * 색 규칙(무지개 · 한 가지 색 · 팔레트)과 포인터별 색 갈아 뽑기가 여기 있다.
 *
 * `scene.fluid` 에 시뮬레이션 매개변수, `scene.params` 에 이 엔진만의 값 —
 *   pointerDye   포인터가 넣는 염료 비율 (구름은 0.08 — 힘만 주고 색은 거의 안 넣는다)
 *   tapRings     탭 한 번에 동심원 몇 겹 (먹 마블링)
 *   replenish    가만히 둘 때 화면 가운데 아래에서 보충하는 염료 (구름)
 */
type Pointer = { x: number; y: number; color: RGB; colorAt: number; hex?: string };

export const createFluidEngine: EngineFactory = (canvas, ctx) => {
  let sim: FluidSim;
  try {
    sim = new FluidSim(canvas, ctx.scene.fluid ?? {});
  } catch (e) {
    throw new EngineUnsupportedError(e instanceof Error ? e.message : undefined);
  }
  const scene = ctx.scene;
  const p = scene.params ?? {};
  const pointerDye = typeof p.pointerDye === "number" ? p.pointerDye : 1;
  const tapRings = typeof p.tapRings === "number" ? p.tapRings : 0;
  const replenish = typeof p.replenish === "number" ? p.replenish : 0;
  let currentHex = ctx.color;

  const pointers = new Map<number, Pointer>();
  const w = () => canvas.clientWidth || 1;
  const h = () => canvas.clientHeight || 1;

  const colorFor = (pt: Pointer, now: number): RGB => {
    const mode = scene.color;
    if (mode.kind === "single") return dyeFromHex(currentHex);
    const every = mode.kind === "rainbow" ? 100 : 380;
    if (now - pt.colorAt > every) {
      if (mode.kind === "rainbow") pt.color = randomRainbow();
      else {
        pt.hex = randomFromPalette(mode.colors, pt.hex);
        pt.color = dyeFromHex(pt.hex);
      }
      pt.colorAt = now;
    }
    return pt.color;
  };
  const fresh = (x: number, y: number): Pointer => {
    const pt: Pointer = { x, y, color: randomRainbow(), colorAt: -Infinity };
    colorFor(pt, performance.now());
    return pt;
  };
  const util = fresh(0, 0);

  const burst = (n: number) => {
    for (let i = 0; i < n; i++) {
      util.colorAt = -Infinity;
      const c = colorFor(util, performance.now());
      sim.splat(Math.random(), Math.random(), (Math.random() - 0.5) * 600, (Math.random() - 0.5) * 600, scaleDye(c, pointerDye), 1.2);
    }
  };

  const engine: SceneEngine = {
    start() {
      burst(replenish > 0 ? 3 : 5);
      sim.start();
    },
    stop: () => sim.stop(),
    dispose: () => sim.dispose(),
    pointerDown(x, y, id) {
      const pt = fresh(x, y);
      pointers.set(id, pt);
      const c = colorFor(pt, performance.now());
      if (tapRings > 0) {
        // 먹 마블링 — 색이 번갈아 드는 동심원. 큰 것부터 찍어야 안쪽이 위에 남는다
        for (let i = tapRings; i >= 1; i--) {
          const alt = i % 2 === 0 ? { r: 0.015, g: 0.045, b: 0.055 } : c;
          sim.splat(x / w(), 1 - y / h(), 0, 0, alt, 0.9 * i * i);
        }
      } else {
        sim.splat(x / w(), 1 - y / h(), 0, 0, scaleDye(c, pointerDye), 1.6);
      }
    },
    pointerMove(x, y, dx, dy, id) {
      let pt = pointers.get(id);
      if (!pt) {
        pointers.set(id, fresh(x, y));
        return;
      }
      pt.x = x;
      pt.y = y;
      if (dx === 0 && dy === 0) return;
      const c = colorFor(pt, performance.now());
      sim.splatPointer(x, y, dx, dy, scaleDye(c, pointerDye));
    },
    pointerUp(id) {
      const pt = pointers.get(id);
      if (pt) pt.colorAt = -Infinity;
      if (id !== 0) pointers.delete(id);
    },
    wheel(x, y, delta) {
      const c = colorFor(util, performance.now());
      sim.splatPointer(x, y, 0, delta * 0.6, scaleDye(c, pointerDye));
    },
    tilt(fx, fy) {
      // 기울인 쪽으로 화면 전체가 흐른다 — 기울기에 수직인 선 위 다섯 점에서 넓은 힘을 준다.
      // 한 점에 작은 splat 을 넣던 첫 판은 눈에 띄지 않아 "안 된다" 고 보였다 (2026-09-10)
      util.colorAt = -Infinity;
      const c = colorFor(util, performance.now());
      const len = Math.hypot(fx, fy) || 1;
      const nx = -fy / len, ny = fx / len; // 수직 방향
      for (let i = 0; i < 5; i++) {
        const t = (i / 4 - 0.5) * 1.4;
        const px = 0.5 + nx * t - fx * 0.25, py = 0.5 + ny * t - fy * 0.25;
        sim.splat(px, py, fx * 420, fy * 420, scaleDye(c, 0.12 * pointerDye), 3.2);
      }
    },
    idle() {
      util.colorAt = -Infinity;
      const c = colorFor(util, performance.now());
      if (replenish > 0) {
        // 구름 — 아래 가운데에서 천천히 올라오는 보충
        sim.splat(0.3 + Math.random() * 0.4, 0.05 + Math.random() * 0.15, (Math.random() - 0.5) * 60, 120 + Math.random() * 80, scaleDye(c, replenish), 2.4);
        return;
      }
      sim.splat(0.1 + Math.random() * 0.8, 0.1 + Math.random() * 0.8, (Math.random() - 0.5) * 240, (Math.random() - 0.5) * 240, scaleDye(c, 0.8 * pointerDye), 1.5);
    },
    clear: () => sim.clearDye(),
    setColor(hex) {
      currentHex = hex;
    },
  };
  return engine;
};
