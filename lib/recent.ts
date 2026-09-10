/**
 * 브라우저에만 남기는 가벼운 기억 — 마지막으로 연 장면, 한 가지 색 장면에서 고른 색.
 *
 * 계정과 무관하고 서버에 보내지 않는다. 지워져도 잃는 것은 편의뿐이다.
 * 나중에 즐겨찾기를 계정에 붙이게 되면 그때 API 로 옮긴다.
 */

const RECENT_KEY = "calmtouch:recent";
const COLOR_PREFIX = "calmtouch:color:";

export type Recent = { slug: string; at: number };

export function rememberRecent(slug: string) {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify({ slug, at: Date.now() } satisfies Recent));
  } catch {
    /* 시크릿 모드 등 — 기억만 못 하는 셈이다 */
  }
}

export function loadRecent(): Recent | null {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Recent>;
    if (typeof v.slug !== "string" || typeof v.at !== "number") return null;
    return { slug: v.slug, at: v.at };
  } catch {
    return null;
  }
}

export function loadColor(slug: string): string | null {
  try {
    const v = window.localStorage.getItem(COLOR_PREFIX + slug);
    return v && /^#[0-9a-f]{6}$/i.test(v) ? v : null;
  } catch {
    return null;
  }
}

export function saveColor(slug: string, hex: string) {
  try {
    window.localStorage.setItem(COLOR_PREFIX + slug, hex);
  } catch {
    /* ignore */
  }
}
