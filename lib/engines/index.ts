import type { EngineFactory } from "./types";

/**
 * 엔진 등록표. 장면(`lib/scenes.ts`)의 `engine` 키 → 팩토리를 **지연 로드**한다.
 * 장면 하나에 들어갈 때 그 엔진의 코드만 내려받는다 — 24개 장면을 한 번에 싣지 않는다.
 */
export type EngineKey =
  | "fluid"
  | "ripple"
  | "fog"
  | "rain"
  | "lava"
  | "galaxy"
  | "fireflies"
  | "constellation"
  | "reaction"
  | "physarum"
  | "flock"
  | "balls"
  | "slime"
  | "cloth"
  | "zen"
  | "chimes"
  | "wax"
  | "rainbow"
  | "blocks"
  | "breath";

/**
 * 아직 만들지 않은 엔진은 여기 없다. 그 장면은 목록에도 뜨지 않고 `/play/<slug>` 도 404 다
 * (`lib/scenes.ts` 의 scenesIn · getScene 이 이 표를 본다). 만들면 한 줄 추가한다.
 */
export const ENGINES: Partial<Record<EngineKey, () => Promise<EngineFactory>>> = {
  fluid: () => import("./FluidEngine").then((m) => m.createFluidEngine),
  ripple: () => import("./RippleEngine").then((m) => m.createRippleEngine),
  fog: () => import("./FogEngine").then((m) => m.createFogEngine),
  lava: () => import("./LavaEngine").then((m) => m.createLavaEngine),
  galaxy: () => import("./GalaxyEngine").then((m) => m.createGalaxyEngine),
  fireflies: () => import("./FirefliesEngine").then((m) => m.createFirefliesEngine),
  constellation: () => import("./ConstellationEngine").then((m) => m.createConstellationEngine),
  reaction: () => import("./ReactionEngine").then((m) => m.createReactionEngine),
  physarum: () => import("./PhysarumEngine").then((m) => m.createPhysarumEngine),
  flock: () => import("./FlockEngine").then((m) => m.createFlockEngine),
  zen: () => import("./ZenEngine").then((m) => m.createZenEngine),
  breath: () => import("./BreathEngine").then((m) => m.createBreathEngine),
  rain: () => import("./RainEngine").then((m) => m.createRainEngine),
  balls: () => import("./BallsEngine").then((m) => m.createBallsEngine),
  slime: () => import("./SlimeEngine").then((m) => m.createSlimeEngine),
  cloth: () => import("./ClothEngine").then((m) => m.createClothEngine),
  chimes: () => import("./ChimesEngine").then((m) => m.createChimesEngine),
  wax: () => import("./WaxEngine").then((m) => m.createWaxEngine),
  rainbow: () => import("./RainbowEngine").then((m) => m.createRainbowEngine),
  blocks: () => import("./BlocksEngine").then((m) => m.createBlocksEngine),
};

export const isEngineReady = (key: EngineKey): boolean => key in ENGINES;

