import type { FluidConfig } from "@/lib/fluid/FluidSim";
import { isEngineReady, type EngineKey } from "@/lib/engines/index";
import type { SceneControl } from "@/lib/engines/types";

/**
 * 장면(scene) 목록 — 이 앱의 콘텐츠 원본.
 *
 * 화면은 여기 항목을 읽어 목록을 그리고, `/play/[slug]` 가 `engine` 에 해당하는 엔진을
 * 지연 로드해 띄운다(`lib/engines/index.ts`). 새 장면을 넣을 때는 이 배열에 한 항목을
 * 추가하고, 엔진이 새것이면 등록표에도 한 줄 넣는다.
 * → my-obsidian-vault / 10-Projects/CalmTouch.md · CalmTouch 장면 레퍼런스.md
 */

export type SceneCategory = "paint" | "surface" | "light" | "living" | "things" | "breath";

export const CATEGORY_ORDER: SceneCategory[] = ["paint", "surface", "light", "living", "things", "breath"];

export const CATEGORIES: Record<SceneCategory, { label: string; eyebrow: string; lead: string }> = {
  paint: { label: "물감", eyebrow: "PAINT", lead: "손이 닿는 자리에서 색이 번지고, 손을 떼면 천천히 잔잔해져요." },
  surface: { label: "물과 유리", eyebrow: "WATER & GLASS", lead: "수면과 유리창. 만진 자리가 잠깐 바뀌고 다시 돌아와요." },
  light: { label: "빛과 무늬", eyebrow: "LIGHT & PATTERN", lead: "별과 무늬. 흩뜨리면 제자리로, 건드리면 새 무늬로." },
  living: { label: "살아 있는 것", eyebrow: "LIVING THINGS", lead: "손끝을 피하고, 따라오고, 저희끼리 무리를 지어요." },
  things: { label: "만지는 물건", eyebrow: "THINGS TO TOUCH", lead: "공, 슬라임, 천, 블록, 키캡. 손에 잡히는 감촉을 화면으로." },
  breath: { label: "숨", eyebrow: "BREATH", lead: "색 구름이 숨에 맞춰 퍼지고 모여요. 누르고 있는 동안 들이쉬어요." },
};

export type ColorMode =
  /** 레퍼런스처럼 색이 계속 바뀐다 */
  | { kind: "rainbow" }
  /** 한 가지 색. 사용자가 고르고, 고른 값은 브라우저에 남는다 */
  | { kind: "single"; defaultColor: string; presets: string[] }
  /** 정해진 몇 가지 색만 번갈아 쓴다 */
  | { kind: "palette"; colors: string[] };

export type Scene = {
  slug: string;
  title: string;
  subtitle: string;
  emoji: string;
  category: SceneCategory;
  engine: EngineKey;
  color: ColorMode;
  /** 유체 계열 — 시뮬레이션 매개변수. 기본값(DEFAULT_FLUID_CONFIG)에 덧씌운다 */
  fluid?: Partial<FluidConfig>;
  /** 엔진마다 다른 값. 뜻은 각 엔진 파일 머리에 있다 */
  params?: Record<string, number | string | boolean>;
  /** 가만히 두면 스스로 조금씩 움직이게 하는지 (화면에서 끄고 켤 수 있다) */
  idleDrift: boolean;
  /** 소리가 있는 장면 — 도구 바에 소리 버튼이 생긴다. 기본은 무음 */
  sound?: boolean;
  /** 기울기 입력이 뜻이 있는 장면인가 (없으면 기울기 버튼을 숨긴다) */
  tilt?: boolean;
  /** 목록 카드의 배경 그라디언트 */
  thumb: string;
  /** 목록 첫 화면에 먼저 보여 줄 장면 */
  featured?: boolean;
  /** 장면 고유 조정 값 — 도구 패널에 −/+ 나 스위치로 뜬다 → lib/engines/types.ts */
  controls?: SceneControl[];
};

/** 한 가지 색 장면에서 고를 수 있는 색. 짙은 바탕 위에서 잘 보이는 밝은 값들 */
export const SINGLE_PRESETS = [
  "#5fb8c9", "#e8d18a", "#b9a6f0", "#f08ca4", "#7fd8b0", "#7fb8ff", "#ff9b7a", "#eef7f8",
];

const DEEP = "linear-gradient(150deg, #04161b, #0e3037)";
const glow = (x: number, y: number, rgba: string, stop = 45) =>
  `radial-gradient(circle at ${x}% ${y}%, ${rgba}, transparent ${stop}%)`;

export const SCENES: Scene[] = [
  // ── 물감 ─────────────────────────────────────────────
  {
    slug: "paint", title: "물감 번짐", subtitle: "손이 가는 대로 색이 번져요. 색은 계속 바뀌어요.",
    emoji: "🎨", category: "paint", engine: "fluid", color: { kind: "rainbow" }, idleDrift: true, tilt: true, featured: true,
    thumb: `${glow(30, 35, "rgba(255,120,90,0.75)")},${glow(70, 60, "rgba(95,184,201,0.8)", 50)},${glow(50, 85, "rgba(185,166,240,0.7)")},${DEEP}`,
  },
  {
    slug: "one-color", title: "한 가지 색", subtitle: "마음에 드는 색 하나만 골라서 번져요.",
    emoji: "🫧", category: "paint", engine: "fluid", color: { kind: "single", defaultColor: "#5fb8c9", presets: SINGLE_PRESETS }, idleDrift: true, tilt: true, featured: true,
    thumb: `${glow(35, 40, "rgba(95,184,201,0.9)", 50)},${glow(70, 70, "rgba(95,184,201,0.5)")},${DEEP}`,
  },
  {
    slug: "ink", title: "먹물", subtitle: "물에 떨어진 먹처럼 천천히 말려 들어가요.",
    emoji: "🖌️", category: "paint", engine: "fluid", color: { kind: "palette", colors: ["#dfe9ec", "#9fb6bc", "#eef7f8"] }, idleDrift: true, tilt: true,
    fluid: { densityDissipation: 0.35, velocityDissipation: 0.8, pressure: 0.6, curl: 22, splatRadius: 0.16, splatForce: 5200 },
    thumb: `${glow(40, 45, "rgba(223,233,236,0.75)", 42)},${glow(65, 65, "rgba(159,182,188,0.5)", 40)},linear-gradient(150deg, #04161b, #0b262e)`,
  },
  {
    slug: "marbling", title: "먹 마블링", subtitle: "물 위에 먹 한 방울. 바람 불듯 저으면 무늬가 돼요.",
    emoji: "🌀", category: "paint", engine: "fluid", color: { kind: "palette", colors: ["#eef7f8", "#c9a84c", "#5fb8c9"] }, idleDrift: false, tilt: true,
    fluid: { densityDissipation: 0.02, velocityDissipation: 1.4, pressure: 0.9, curl: 0, splatRadius: 0.12, splatForce: 3800, shading: false },
    params: { tapRings: 4, pointerDye: 0.15 },
    thumb: `${glow(45, 50, "rgba(238,247,248,0.8)", 30)},${glow(45, 50, "rgba(201,168,76,0.55)", 55)},linear-gradient(150deg, #04161b, #0b262e)`,
  },
  {
    slug: "cloud", title: "구름", subtitle: "떠 있는 구름을 만지면 흩어지고, 두면 다시 뭉쳐요.",
    emoji: "☁️", category: "paint", engine: "fluid", color: { kind: "palette", colors: ["#eef7f8", "#c9dfe6"] }, idleDrift: true, tilt: true, featured: true,
    fluid: { densityDissipation: 0.12, velocityDissipation: 0.9, pressure: 0.7, curl: 6, splatRadius: 0.5, splatForce: 3000, buoyancy: 0.6, background: { r: 0.02, g: 0.06, b: 0.14 } },
    params: { pointerDye: 0.06, replenish: 0.5 },
    thumb: `${glow(40, 60, "rgba(238,247,248,0.7)", 55)},${glow(70, 40, "rgba(201,223,230,0.45)", 45)},linear-gradient(150deg, #051029, #0e2a4a)`,
  },
  {
    slug: "aurora", title: "오로라", subtitle: "초록과 보라가 하늘처럼 느리게 흘러요.",
    emoji: "🌌", category: "paint", engine: "fluid", color: { kind: "palette", colors: ["#3ddc97", "#5fb8c9", "#7c5cff", "#b9a6f0"] }, idleDrift: true, tilt: true,
    fluid: { densityDissipation: 0.4, velocityDissipation: 1.2, pressure: 0.5, curl: 14, splatRadius: 0.34, splatForce: 4800 },
    thumb: `${glow(30, 60, "rgba(61,220,151,0.7)")},${glow(70, 35, "rgba(124,92,255,0.75)", 50)},${DEEP}`,
  },
  {
    slug: "ember", title: "잉걸", subtitle: "불씨가 살아나듯 따뜻한 색이 번져요.",
    emoji: "🔥", category: "paint", engine: "fluid", color: { kind: "palette", colors: ["#ff6b3d", "#ffb347", "#ff3d6e", "#ffd166"] }, idleDrift: true, tilt: true,
    fluid: { densityDissipation: 0.7, velocityDissipation: 2.2, pressure: 0.3, curl: 8, splatRadius: 0.22, splatForce: 6500 },
    thumb: `${glow(35, 65, "rgba(255,107,61,0.8)", 48)},${glow(70, 35, "rgba(255,179,71,0.65)")},linear-gradient(150deg, #120c0e, #2a1218)`,
  },
  {
    slug: "deep", title: "심해", subtitle: "깊은 물속 빛처럼 파란색이 천천히 퍼져요.",
    emoji: "🌊", category: "paint", engine: "fluid", color: { kind: "palette", colors: ["#1b4fd8", "#2ec4ff", "#0f9bb0", "#6dd5ff"] }, idleDrift: true, tilt: true,
    fluid: { densityDissipation: 0.3, velocityDissipation: 1.6, pressure: 0.5, curl: 6, splatRadius: 0.3, splatForce: 4200, background: { r: 0.008, g: 0.03, b: 0.07 } },
    thumb: `${glow(40, 40, "rgba(46,196,255,0.7)")},${glow(65, 75, "rgba(27,79,216,0.75)", 50)},linear-gradient(150deg, #020812, #061a3a)`,
  },

  // ── 물과 유리 ─────────────────────────────────────────
  {
    slug: "ripple", title: "물결", subtitle: "잔잔한 수면. 탭하면 동심원, 끌면 잔물결이 일어요.",
    emoji: "💧", category: "surface", engine: "ripple", color: { kind: "palette", colors: ["#5fb8c9"] }, idleDrift: true, tilt: true, featured: true,
    thumb: `${glow(50, 50, "rgba(95,184,201,0.35)", 30)},${glow(50, 50, "rgba(95,184,201,0.25)", 60)},linear-gradient(170deg, #04161b, #0a3040)`,
  },
  {
    slug: "fog", title: "김 서린 유리", subtitle: "흐린 유리를 손가락으로 닦으면 뒤 불빛이 보이고, 다시 서려요.",
    emoji: "🪟", category: "surface", engine: "fog", color: { kind: "palette", colors: ["#eef7f8"] }, idleDrift: false, featured: true,
    thumb: `${glow(30, 40, "rgba(232,209,138,0.5)", 20)},${glow(70, 55, "rgba(95,184,201,0.45)", 25)},linear-gradient(160deg, #6f8a92, #3d5660)`,
  },
  {
    slug: "rain", title: "비 오는 창", subtitle: "유리에 맺힌 빗방울이 흘러내려요. 닦으면 잠깐 맑아져요.",
    emoji: "🌧️", category: "surface", engine: "rain", color: { kind: "palette", colors: ["#eef7f8"] }, idleDrift: true,
    thumb: `${glow(25, 30, "rgba(232,209,138,0.35)", 18)},${glow(75, 45, "rgba(95,184,201,0.35)", 22)},linear-gradient(170deg, #0a1b22, #142f38)`,
  },
  {
    slug: "lava", title: "라바 램프", subtitle: "방울이 천천히 오르고 합쳐져요. 만지면 갈라져요.",
    emoji: "🫙", category: "surface", engine: "lava", color: { kind: "single", defaultColor: "#ff9b7a", presets: SINGLE_PRESETS }, idleDrift: true, tilt: true,
    thumb: `${glow(35, 70, "rgba(255,155,122,0.9)", 28)},${glow(65, 30, "rgba(255,155,122,0.7)", 22)},linear-gradient(170deg, #1a0d10, #3a1a22)`,
  },

  // ── 빛과 무늬 ────────────────────────────────────────
  {
    slug: "galaxy", title: "은하", subtitle: "천천히 도는 별들을 흩뜨리면 다시 제자리로 돌아와요.",
    emoji: "✨", category: "light", engine: "galaxy", color: { kind: "palette", colors: ["#e8d18a", "#5fb8c9"] }, idleDrift: true, tilt: true, featured: true,
    thumb: `${glow(50, 50, "rgba(232,209,138,0.8)", 18)},${glow(50, 50, "rgba(95,184,201,0.5)", 55)},linear-gradient(170deg, #030812, #0a1030)`,
  },
  {
    slug: "constellation", title: "별자리 잇기", subtitle: "밤하늘의 별을 손끝으로 이으면 선이 남고 서서히 사라져요.",
    emoji: "🌠", category: "light", engine: "constellation", color: { kind: "palette", colors: ["#eef7f8"] }, idleDrift: false, tilt: true,
    thumb: `${glow(25, 30, "rgba(238,247,248,0.9)", 6)},${glow(60, 60, "rgba(238,247,248,0.8)", 5)},${glow(80, 25, "rgba(238,247,248,0.8)", 5)},linear-gradient(170deg, #040a18, #0b1a33)`,
  },
  {
    slug: "reaction", title: "무늬", subtitle: "얼룩무늬가 천천히 자라요. 만지면 그 자리에서 새 무늬가 나요.",
    emoji: "🐚", category: "light", engine: "reaction", color: { kind: "single", defaultColor: "#5fb8c9", presets: SINGLE_PRESETS }, idleDrift: true,
    thumb: `repeating-radial-gradient(circle at 40% 50%, rgba(95,184,201,0.6) 0 6px, transparent 6px 16px),linear-gradient(170deg, #04161b, #0e3037)`,
  },
  {
    slug: "rainbow", title: "무지개", subtitle: "밤 언덕 위 점선 무지개. 손이 닿으면 줄이 휘고, 놓으면 튕겨 돌아와요. 휠로 줄을 늘려요.",
    emoji: "🌈", category: "light", engine: "rainbow", color: { kind: "rainbow" }, idleDrift: true, tilt: true,
    thumb: `${glow(50, 70, "rgba(255,80,120,0.7)", 40)},${glow(50, 60, "rgba(120,140,255,0.7)", 44)},linear-gradient(180deg, #04161b, #0b1a2e)`,
  },

  // ── 살아 있는 것 ─────────────────────────────────────
  {
    slug: "fireflies", title: "반짝이", subtitle: "손끝을 피해 도망 다니는 작은 빛들이에요. 몇 마리는 손에 앉아요.",
    emoji: "🌟", category: "living", engine: "fireflies", color: { kind: "single", defaultColor: "#e8d18a", presets: SINGLE_PRESETS }, idleDrift: true, featured: true,
    thumb: `${glow(30, 40, "rgba(232,209,138,0.9)", 5)},${glow(65, 65, "rgba(232,209,138,0.9)", 6)},${glow(80, 30, "rgba(232,209,138,0.7)", 4)},${glow(45, 80, "rgba(232,209,138,0.7)", 4)},linear-gradient(170deg, #061a12, #0b2a20)`,
  },
  {
    slug: "flock", title: "물고기떼", subtitle: "손을 피하면서도 무리를 지켜요. 가만히 두면 다시 모여요.",
    emoji: "🐟", category: "living", engine: "flock", color: { kind: "palette", colors: ["#5fb8c9", "#eef7f8"] }, idleDrift: true,
    thumb: `${glow(40, 50, "rgba(95,184,201,0.5)", 40)},linear-gradient(170deg, #03141c, #0a3040)`,
  },
  {
    slug: "physarum", title: "점균", subtitle: "수만 개의 점이 실 같은 그물을 짜요. 손끝이 먹이예요.",
    emoji: "🕸️", category: "living", engine: "physarum", color: { kind: "single", defaultColor: "#e8d18a", presets: SINGLE_PRESETS }, idleDrift: true,
    thumb: `repeating-linear-gradient(35deg, rgba(232,209,138,0.35) 0 1px, transparent 1px 9px),repeating-linear-gradient(-50deg, rgba(232,209,138,0.25) 0 1px, transparent 1px 13px),linear-gradient(170deg, #04161b, #0e3037)`,
  },

  // ── 만지는 물건 ──────────────────────────────────────
  {
    slug: "balls", title: "공", subtitle: "공을 튕기고 던져요. 폰을 기울이면 그쪽으로 굴러가요.",
    emoji: "🏐", category: "things", engine: "balls", color: { kind: "palette", colors: ["#5fb8c9", "#e8d18a", "#b9a6f0", "#f08ca4", "#7fd8b0"] }, idleDrift: false, tilt: true, sound: true, featured: true,
    thumb: `${glow(30, 65, "rgba(95,184,201,0.9)", 14)},${glow(60, 70, "rgba(232,209,138,0.9)", 11)},${glow(78, 60, "rgba(185,166,240,0.9)", 9)},linear-gradient(170deg, #0b262e, #04161b)`,
  },
  {
    slug: "slime", title: "슬라임", subtitle: "꾹 누르면 잠기고, 끌면 붙어서 늘어나요. 놓으면 천천히 흘러 돌아와요.",
    emoji: "🫠", category: "things", engine: "slime", color: { kind: "single", defaultColor: "#7fd8b0", presets: SINGLE_PRESETS }, idleDrift: true, tilt: true,
    thumb: `${glow(50, 55, "rgba(127,216,176,0.95)", 32)},linear-gradient(170deg, #04161b, #0b262e)`,
  },
  {
    slug: "wax", title: "왁뿌", subtitle: "파스텔 왁스를 입힌 도넛. 꾹 누르면 껍질이 조각조각 갈라지고, 문지르면 속 점토와 섞여요.",
    emoji: "🍩", category: "things", engine: "wax", color: { kind: "palette", colors: ["#f6b7cf", "#b9d7f2", "#f7ecb0"] }, idleDrift: false, tilt: true, sound: true,
    thumb: `${glow(50, 50, "rgba(246,183,207,0.9)", 34)},${glow(70, 40, "rgba(185,215,242,0.8)", 30)},linear-gradient(170deg, #04161b, #0b262e)`,
  },
  {
    slug: "keycap", title: "키캡", subtitle: "기계식 키캡을 톡톡. 자판으로 쳐도 눌려요. LED 를 켜면 색이 돌며 번쩍여요.",
    emoji: "⌨️", category: "things", engine: "keycap", color: { kind: "palette", colors: ["#5fb8c9", "#b9a6f0", "#f08ca4"] }, idleDrift: false, tilt: false, sound: true,
    controls: [
      { key: "count", label: "키캡", kind: "stepper", min: 1, max: 9, default: 3 },
      { key: "led", label: "LED", kind: "switch", default: true },
    ],
    thumb: `${glow(50, 55, "rgba(95,184,201,0.7)", 30)},${glow(30, 55, "rgba(240,140,164,0.6)", 26)},linear-gradient(170deg, #04161b, #132a33)`,
  },
  {
    slug: "blocks", title: "블록 놀이", subtitle: "공을 몰아 쌓인 나무 블록을 밀어요. 미끄러지고 돌아가고, 기울이면 다 쏟아져요.",
    emoji: "🧱", category: "things", engine: "blocks", color: { kind: "palette", colors: ["#f6b7cf", "#b9d7f2", "#f7ecb0", "#c7ecd2"] }, idleDrift: false, tilt: true, sound: true,
    thumb: `${glow(45, 45, "rgba(246,183,207,0.8)", 26)},${glow(60, 55, "rgba(185,215,242,0.8)", 26)},linear-gradient(170deg, #04161b, #0f3038)`,
  },
  {
    slug: "cloth", title: "천 커튼", subtitle: "바람에 흔들리는 얇은 천. 손으로 젖히면 되돌아와요.",
    emoji: "🪡", category: "things", engine: "cloth", color: { kind: "single", defaultColor: "#5fb8c9", presets: SINGLE_PRESETS }, idleDrift: true, tilt: true,
    thumb: `repeating-linear-gradient(100deg, rgba(95,184,201,0.55) 0 14px, rgba(95,184,201,0.3) 14px 28px),linear-gradient(170deg, #04161b, #0b262e)`,
  },
  {
    slug: "zen", title: "젠 가든", subtitle: "모래에 갈퀴 자국을 내요. 손을 떼면 아주 천천히 평평해져요.",
    emoji: "🏖️", category: "things", engine: "zen", color: { kind: "palette", colors: ["#d9cbb0"] }, idleDrift: false, tilt: false,
    thumb: `repeating-radial-gradient(circle at 70% 60%, rgba(60,45,30,0.35) 0 3px, transparent 3px 12px),linear-gradient(170deg, #cbbb9c, #a8956f)`,
  },
  {
    slug: "chimes", title: "윈드차임", subtitle: "기울이거나 쓸면 바람이 불고, 관이 부딪혀 울려요.",
    emoji: "🎐", category: "things", engine: "chimes", color: { kind: "palette", colors: ["#e8d18a"] }, idleDrift: true, tilt: true, sound: true,
    thumb: `repeating-linear-gradient(90deg, transparent 0 22px, rgba(232,209,138,0.7) 22px 28px),linear-gradient(170deg, #04161b, #0e3037)`,
  },

  // ── 숨 ──────────────────────────────────────────────
  {
    slug: "breath", title: "호흡", subtitle: "숨에 맞춰 색이 퍼지고 모여요. 누르고 있는 동안 들이쉬어요.",
    emoji: "🫧", category: "breath", engine: "breath", color: { kind: "single", defaultColor: "#5fb8c9", presets: SINGLE_PRESETS }, idleDrift: false,
    thumb: `${glow(50, 50, "rgba(95,184,201,0.5)", 28)},${glow(50, 50, "rgba(95,184,201,0.3)", 45)},${DEEP}`,
  },
];

/** 엔진이 준비된 장면만 — 목록 · 라우트 · 홈 추천이 모두 이 목록을 본다 */
export const READY_SCENES: Scene[] = SCENES.filter((s) => isEngineReady(s.engine));

export function getScene(slug: string): Scene | undefined {
  return READY_SCENES.find((s) => s.slug === slug);
}

export function scenesIn(category: SceneCategory): Scene[] {
  return READY_SCENES.filter((s) => s.category === category);
}
