/** 여러 엔진이 같이 쓰는 작은 수학 도구. 의존성을 두지 않기 위해 직접 쓴다 */

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const rand = (lo = 0, hi = 1) => lo + Math.random() * (hi - lo);
export const TAU = Math.PI * 2;

/** 프레임 독립 감쇠 — dt 가 커져도 같은 비율로 준다 */
export const damp = (k: number, dt: number) => Math.exp(-k * dt);

/** 0~1 을 부드럽게 */
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

export function hexToRgb255(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const f = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(f.slice(0, 6), 16);
  if (Number.isNaN(n)) return [255, 255, 255];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb255(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/**
 * 2D 심플렉스 노이즈 (Stefan Gustavson 공개 구현을 축약). -1~1.
 * 배회 · 바람 · 흔들림에 쓴다. 3D 가 필요하면 z 대신 시간을 두 번째 표본의 오프셋으로 준다.
 */
const GRAD = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];
const PERM = new Uint8Array(512);
{
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let seed = 1337;
  for (let i = 255; i > 0; i--) {
    seed = (seed * 16807) % 2147483647;
    const j = seed % (i + 1);
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}
export function noise2(x: number, y: number): number {
  const F2 = 0.5 * (Math.sqrt(3) - 1);
  const G2 = (3 - Math.sqrt(3)) / 6;
  const s = (x + y) * F2;
  const i = Math.floor(x + s);
  const j = Math.floor(y + s);
  const t = (i + j) * G2;
  const x0 = x - (i - t);
  const y0 = y - (j - t);
  const i1 = x0 > y0 ? 1 : 0;
  const j1 = x0 > y0 ? 0 : 1;
  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2;
  const y2 = y0 - 1 + 2 * G2;
  const ii = i & 255;
  const jj = j & 255;
  let n = 0;
  const corner = (gx: number, gy: number, gi: number) => {
    let tt = 0.5 - gx * gx - gy * gy;
    if (tt < 0) return 0;
    tt *= tt;
    const g = GRAD[gi & 7];
    return tt * tt * (g[0] * gx + g[1] * gy);
  };
  n += corner(x0, y0, PERM[ii + PERM[jj]]);
  n += corner(x1, y1, PERM[ii + i1 + PERM[jj + j1]]);
  n += corner(x2, y2, PERM[ii + 1 + PERM[jj + 1]]);
  return 70 * n;
}

/** 시간이 흐르는 노이즈 — 2D 노이즈 두 장을 시간축으로 섞는다 */
export function noise3(x: number, y: number, t: number): number {
  const a = noise2(x + t * 0.37, y - t * 0.21);
  const b = noise2(x - 13.7 + t * 0.11, y + 29.3 + t * 0.29);
  return (a + b) * 0.5;
}
