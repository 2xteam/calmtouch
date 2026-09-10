/**
 * 통합 로그인 포털로 보내는 규칙.
 *
 * 이 앱은 **로그인 없이 쓴다.** 화면을 만지는 데 계정이 필요 없고, 아직 아무것도
 * 저장하지 않는다. 그래도 형제 앱과 같은 자리(헤더 우측 · More 메뉴)에 로그인·
 * 로그아웃을 두어 myjane 계정으로 오갈 수 있게 한다.
 *
 * 다른 앱과 달리 **로컬 로그인 화면(`/login`)이 없다** — DB 에 붙지 않기 때문이다.
 * 로그인은 언제나 포털이고, 포털은 운영 도메인(`*.myjane.co.kr`)으로만 되돌려
 * 보내므로 localhost 에서는 로그인 버튼 자체를 보이지 않는다(`usesPortal()`).
 * → my-obsidian-vault / 30-Patterns/인증과 세션 공유.md
 */

export const APP_KEY = "calmtouch";

const PORTAL_ORIGIN =
  process.env.NEXT_PUBLIC_PORTAL_ORIGIN?.replace(/\/+$/, "") ?? "https://www.myjane.co.kr";

/** 지금 이 브라우저가 포털과 세션을 나눠 쓸 수 있는 곳에 있는가 */
export function usesPortal(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.hostname.endsWith(".myjane.co.kr");
}

/** 이 앱 안의 경로만 통과시킨다. 오픈 리다이렉트 방지 */
function safePath(next: string): string {
  return next.startsWith("/") && !next.startsWith("//") ? next : "/home";
}

export function loginUrl(next = "/home"): string {
  return `${PORTAL_ORIGIN}/login?from=${APP_KEY}&next=${encodeURIComponent(safePath(next))}`;
}

export function signupUrl(next = "/home"): string {
  return `${PORTAL_ORIGIN}/signup?from=${APP_KEY}&next=${encodeURIComponent(safePath(next))}`;
}
