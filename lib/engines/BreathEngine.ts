import { FluidSim } from "@/lib/fluid/FluidSim";
import { dyeFromHex, scaleDye } from "@/lib/fluid/color";
import { clamp, damp, smoothstep, TAU } from "@/lib/util/math";
import type { EngineFactory } from "./types";
import { EngineUnsupportedError } from "./types";

/**
 * 호흡 — 물감 번짐과 같은 유체 위에서 숨을 쉰다.
 *
 * 첫 판은 원 도형 + 둘레의 점이었는데 딱딱하고 어색했다(2026-09-10 사용자 지적). 사용자가 좋다고 한
 * "흐트러짐" 은 물감 번짐의 유체다. 그래서 가운데 색 구름을 두고 —
 *   들이쉴 때  바깥으로 흐르는 힘 → 구름이 부드럽게 퍼진다
 *   멈출 때    힘 없음 → 천천히 잔잔해진다
 *   내쉴 때    안으로 모으는 힘 → 구름이 도로 모인다
 * 손은 물감처럼 흐트린다. 누르고 있는 동안은 들이쉬기, 놓으면 내쉬기.
 * 글자(들이쉬어요 · 멈춰요 · 내쉬어요)는 캔버스 위에 얹은 2D 캔버스에 쓴다.
 */
const IN = 4, HOLD = 2, OUT = 6;
const CYCLE = IN + HOLD + OUT;

export const createBreathEngine: EngineFactory = (canvas, ctx0) => {
  let sim: FluidSim;
  try {
    sim = new FluidSim(canvas, {
      densityDissipation: 2.0,
      velocityDissipation: 2.6,
      pressure: 0.6,
      curl: 2,
      dyeClamp: 0.85,
      splatRadius: 0.45,
      splatForce: 4000,
      background: { r: 0.016, g: 0.086, b: 0.106 },
    });
  } catch (e) {
    throw new EngineUnsupportedError(e instanceof Error ? e.message : undefined);
  }
  let hex = ctx0.color;

  // 글자용 오버레이 캔버스 — 플레이어 컨테이너에 얹고 dispose 때 뗀다
  const overlay = document.createElement("canvas");
  overlay.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;";
  overlay.setAttribute("aria-hidden", "true");
  canvas.parentElement?.insertBefore(overlay, canvas.nextSibling);
  const octx = overlay.getContext("2d")!;

  let phase = 0;
  let holding = false;
  let level = 0.25; // 0(내쉼) ~ 1(들이쉼)
  let target = 0.25;
  let label = "";
  let lastLabel = "";
  let labelAlpha = 0;
  let cycles = 0;
  let frame = 0;
  let lastTime = 0;

  const W = () => canvas.clientWidth || 1;
  const H = () => canvas.clientHeight || 1;

  /**
   * 가운데 구름의 숨.
   * 구름의 **모양은 색 주입이 정한다** — 반지름이 level 을 따라 커지고 작아지는 가우시안 원반을 매 프레임
   * 조금씩 넣고, 감쇠를 세게(2.0) 두어 옛 색이 금방 사라진다. 유체 속도장은 살랑거림과 손의 흐트러짐만 맡는다.
   * 처음엔 중심에서 계속 넣고 흐름으로 퍼뜨렸는데, 색이 화면 전체로 흩어져 안개가 됐다.
   */
  const breathe = (rate: number) => {
    const aspect = W() / H();
    const r = 0.06 + level * 0.22;
    const none = { r: 0, g: 0, b: 0 };
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + performance.now() * 0.00005;
      const px = 0.5 + Math.cos(a) * r / aspect;
      const py = 0.5 + Math.sin(a) * r;
      // 매 프레임 더해지는 속도라 감쇠(2.6/60)와 균형이 잡히는 값이 작다 — 160 이면 평형 속도가
      // 수천 단위가 되어 색이 화면 밖까지 쓸려 나갔다(전 판의 "안개"). 8 이면 평형이 ~120
      const f = rate * 8;
      sim.splat(px, py, Math.cos(a) * f, Math.sin(a) * f, none, 3.2); // 넓게 — 좁으면 내쉴 때 동심원 줄무늬가 생긴다
    }
    // 프레임당 상수 — FluidSim 의 감쇠도 프레임당 고정이라 실시간(dt)에 비례시키면 느린 기기에서 넘친다
    // dyeFromHex 는 이미 최대 채널 0.15 로 정규화돼 있다 — 0.14 를 곱해 프레임당 약 0.02 가 들어간다
    // (감쇠 2.0 과 평형을 이루면 중심 밝기 약 0.6). 0.02 를 곱했을 때는 0.003 이라 거의 보이지 않았다
    sim.splat(0.5, 0.5, 0, 0, scaleDye(dyeFromHex(hex), 0.14), 3 + level * 9);
  };

  const tick = () => {
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

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
    const prev = level;
    level += (target - level) * (1 - damp(3, dt));
    const rate = (level - prev) / Math.max(dt, 0.001); // 초당 변화 — 양수면 들이쉬는 중
    breathe(clamp(rate * 1.6, -0.6, 0.6));

    // 글자
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = W(), h = H();
    if (overlay.width !== Math.floor(w * dpr) || overlay.height !== Math.floor(h * dpr)) {
      overlay.width = Math.floor(w * dpr); overlay.height = Math.floor(h * dpr);
    }
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    octx.clearRect(0, 0, w, h);
    octx.textAlign = "center";
    octx.textBaseline = "middle";
    octx.font = `700 ${Math.round(clamp(w * 0.05, 18, 26))}px "Gowun Batang", serif`;
    octx.fillStyle = `rgba(238,247,248,${0.8 * labelAlpha})`;
    octx.shadowColor = "rgba(0,20,26,0.8)"; octx.shadowBlur = 12;
    octx.fillText(label, w / 2, h - 150);
    octx.shadowBlur = 0;
    octx.font = `500 12px Pretendard, "Noto Sans KR", sans-serif`;
    octx.fillStyle = "rgba(230,244,246,0.55)";
    octx.fillText(holding ? "누르고 있는 동안 들이쉬어요 · 놓으면 내쉬어요" : `${cycles}번째 숨 · 누르면 손이 박자를 잡아요`, w / 2, h - 108);

    frame = requestAnimationFrame(tick);
  };

  return {
    start() {
      lastTime = performance.now();
      sim.start();
      if (!frame) frame = requestAnimationFrame(tick);
    },
    stop() {
      sim.stop();
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    },
    dispose() {
      sim.dispose();
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      overlay.remove();
    },
    pointerDown(x, y) {
      holding = true;
      target = level;
      sim.splat(x / W(), 1 - y / H(), 0, 0, scaleDye(dyeFromHex(hex), 0.25), 1.4);
    },
    pointerMove(x, y, dx, dy) {
      // 물감 번짐처럼 흐트린다 — 색은 조금만
      if (dx === 0 && dy === 0) return;
      sim.splatPointer(x, y, dx, dy, scaleDye(dyeFromHex(hex), 0.18));
    },
    pointerUp() {
      if (!holding) return;
      holding = false;
      phase = clamp(IN + HOLD + (1 - (level - 0.15) / 0.85) * OUT, IN + HOLD, CYCLE - 0.01);
    },
    wheel(x, y, delta) {
      sim.splatPointer(x, y, 0, delta * 0.5, scaleDye(dyeFromHex(hex), 0.3));
    },
    tilt() {},
    idle() {},
    clear() {
      sim.clearDye();
      cycles = 0;
      phase = 0;
    },
    setColor(h) {
      hex = h;
    },
  };
};
