import type { Scene } from "@/lib/scenes";

/**
 * 장면 엔진 인터페이스 — 플레이어(PlayScreen)는 이것만 안다.
 *
 * 입력 네 가지(포인터 · 휠 · 기울기 · 흐름)와 도구(지우기 · 색)가 전부 여기로 들어온다.
 * 좌표는 **CSS 픽셀**이고 원점은 캔버스 왼쪽 위다. 엔진이 알아서 자기 좌표계로 바꾼다.
 * 새 엔진을 만들 때는 이 인터페이스를 구현하고 `lib/engines/index.ts` 에 등록한다.
 */
export interface SceneEngine {
  start(): void;
  stop(): void;
  dispose(): void;

  /** 손가락·마우스가 닿았다 */
  pointerDown(x: number, y: number, id: number): void;
  /** 움직였다. 마우스는 누르지 않아도 온다(`pressed` 로 구분) */
  pointerMove(x: number, y: number, dx: number, dy: number, id: number, pressed: boolean): void;
  pointerUp(id: number): void;
  /** 휠. delta 는 -80~80 으로 잘려서 온다(아래로 양수) */
  wheel(x: number, y: number, delta: number): void;
  /** 기울기. -1~1. 켜져 있을 때만 온다 */
  tilt(fx: number, fy: number): void;
  /** 가만히 둔 지 오래됐다 — 스스로 조금 움직일 차례 (흐름이 켜져 있을 때만) */
  idle(): void;
  /** 도구 바의 "지우기" */
  clear(): void;
  /** 한 가지 색 장면에서 색을 바꿨다 */
  setColor?(hex: string): void;
  /** 소리 켬/끔 (scene.sound 인 장면만) */
  setSound?(on: boolean): void;
  /** 장면 고유 조정 값(scene.controls)이 바뀌었다 — 키캡 수, LED 켬/끔 같은 것 */
  setParam?(key: string, value: number | boolean | string): void;
}

/**
 * 장면 고유 조정 값 — 도구 패널에 그려진다. 값은 엔진의 `setParam` 으로 간다.
 *   stepper  −/+ 로 정수를 고른다 (키캡 수 1~9)
 *   switch   켬/끔 (LED)
 */
export type SceneControl =
  | { key: string; label: string; kind: "stepper"; min: number; max: number; default: number }
  | { key: string; label: string; kind: "switch"; default: boolean }
  /** 여럿 중 하나 — 축 종류처럼. color 가 있으면 칩 앞에 색 점이 붙는다 */
  | { key: string; label: string; kind: "choice"; options: { value: string; label: string; color?: string }[]; default: string };

export type EngineContext = {
  scene: Scene;
  /** 한 가지 색 장면의 현재 색. 그 외에는 scene 기본값 */
  color: string;
  /** 처음부터 소리를 켠 상태인가 */
  sound: boolean;
};

export type EngineFactory = (canvas: HTMLCanvasElement, ctx: EngineContext) => SceneEngine;

export class EngineUnsupportedError extends Error {
  constructor(message = "이 브라우저에서는 이 장면을 그릴 수 없어요") {
    super(message);
    this.name = "EngineUnsupportedError";
  }
}
