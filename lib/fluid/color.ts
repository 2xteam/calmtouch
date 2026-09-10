import type { RGB } from "./FluidSim";

/**
 * 염료 밝기. 어두운 바탕 위에 **가산**되므로 0.15 안팎이라야 물감처럼 보인다.
 * 1.0 으로 넣으면 첫 터치부터 화면이 하얗게 타 버린다.
 */
export const DYE_BRIGHTNESS = 0.15;

export function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(n)) return { r: 1, g: 1, b: 1 };
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

export function hsvToRgb(h: number, s: number, v: number): RGB {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: return { r: v, g: t, b: p };
    case 1: return { r: q, g: v, b: p };
    case 2: return { r: p, g: v, b: t };
    case 3: return { r: p, g: q, b: v };
    case 4: return { r: t, g: p, b: v };
    default: return { r: v, g: p, b: q };
  }
}

/** 가장 밝은 채널이 brightness 가 되게 맞춘다 — 어떤 색을 골라도 같은 세기로 번진다 */
export function normalizeDye(c: RGB, brightness = DYE_BRIGHTNESS): RGB {
  const m = Math.max(c.r, c.g, c.b, 0.0001);
  const k = brightness / m;
  return { r: c.r * k, g: c.g * k, b: c.b * k };
}

export function scaleDye(c: RGB, k: number): RGB {
  return { r: c.r * k, g: c.g * k, b: c.b * k };
}

/** 레퍼런스(toukoum.fr)와 같은 무지개 — 색상(hue)만 무작위, 채도·명도는 최대 */
export function randomRainbow(): RGB {
  return normalizeDye(hsvToRgb(Math.random(), 1, 1));
}

export function dyeFromHex(hex: string): RGB {
  return normalizeDye(hexToRgb(hex));
}

/** 팔레트에서 하나 고른다. 바로 전 색과 같으면 한 번 다시 고른다 */
export function randomFromPalette(colors: string[], prev?: string): string {
  if (colors.length === 1) return colors[0];
  let pick = colors[Math.floor(Math.random() * colors.length)];
  if (pick === prev) pick = colors[(colors.indexOf(pick) + 1) % colors.length];
  return pick;
}
