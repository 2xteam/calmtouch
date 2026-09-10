import type { NextResponse } from "next/server";
import { SESSION_KEY } from "@/lib/session";

/**
 * 서버가 내리는 세션 쿠키.
 *
 * 예전에는 `snap_user` 하나에 회원 정보(이름·전화번호·이메일)와 서명 토큰을
 * **평문 JSON** 으로 담아 `document.cookie` 로 썼다. JS 가 쓰는 쿠키에는 `HttpOnly`
 * 를 걸 수 없어 `.myjane.co.kr` 어느 앱의 스크립트든 읽을 수 있었다.
 *
 * 지금은 셋으로 나눈다.
 *
 *   snap_session   서명 토큰만. **HttpOnly** — JS 가 못 읽는다. 서버 API 가 신뢰하는 유일한 값
 *   snap_auth      "1". JS 가 읽는 표지 — "쓸 수 있는 세션이 있다" 만 알린다 (개인정보 없음)
 *   snap_user      화면 표시용 (id · 이름 · 닉네임). 여전히 JS 쿠키지만 전화번호·이메일·토큰은 빠졌다
 *
 * 세 쿠키는 같은 도메인(`NEXT_PUBLIC_COOKIE_DOMAIN`)·같은 수명(30일)이다.
 * 옛 형식(`snap_user` 안의 토큰)은 읽지 않는다 → readSessionTokenFromRequest()
 *
 * 여섯 저장소에 같은 파일이 있다. 고치면 함께 고친다.
 * → my-obsidian-vault / 50-Plans/E 개인정보 보호 보강.md 5번
 */

export const SESSION_COOKIE = "snap_session";
export const SESSION_MARK_COOKIE = "snap_auth";
export const SESSION_COOKIE_TTL_SEC = 30 * 24 * 60 * 60;

function requestHost(req: Request): string {
  const raw = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  return raw.split(",")[0].trim().replace(/:\d+$/, "").toLowerCase();
}

/** 호스트가 쿠키 도메인에 속할 때만 `Domain` 을 붙인다 — lib/session.ts 의 getEffectiveDomain 과 같은 규칙 */
export function cookieDomainFor(req: Request): string | undefined {
  const env = process.env.NEXT_PUBLIC_COOKIE_DOMAIN?.trim();
  if (!env) return undefined;
  const host = requestHost(req);
  const domain = env.replace(/^\./, "");
  if (host === domain || host.endsWith("." + domain)) return env;
  return undefined;
}

function isSecureRequest(req: Request): boolean {
  const proto = req.headers.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0].trim() === "https";
  const host = requestHost(req);
  return !(host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost"));
}

function serialize(
  name: string,
  value: string,
  req: Request,
  opts: { maxAge: number; httpOnly: boolean; domain?: string | undefined },
): string {
  let c = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${opts.maxAge}; SameSite=Lax`;
  if (opts.domain) c += `; Domain=${opts.domain}`;
  if (opts.httpOnly) c += "; HttpOnly";
  if (isSecureRequest(req)) c += "; Secure";
  return c;
}

/** 로그인·가입 응답에 붙이는 Set-Cookie 들 */
export function sessionCookieHeaders(req: Request, token: string): string[] {
  const domain = cookieDomainFor(req);
  return [
    serialize(SESSION_COOKIE, token, req, { maxAge: SESSION_COOKIE_TTL_SEC, httpOnly: true, domain }),
    serialize(SESSION_MARK_COOKIE, "1", req, { maxAge: SESSION_COOKIE_TTL_SEC, httpOnly: false, domain }),
  ];
}

/**
 * 로그아웃 — 도메인 쿠키와 host-only 쿠키를 **둘 다** 지운다.
 * 옛 `snap_user` 도 함께 지운다 (JS 쪽 clearSession 이 못 지운 도메인 변형까지).
 */
export function clearSessionCookieHeaders(req: Request): string[] {
  const domain = cookieDomainFor(req);
  const out: string[] = [];
  for (const name of [SESSION_COOKIE, SESSION_MARK_COOKIE, SESSION_KEY]) {
    const httpOnly = name === SESSION_COOKIE;
    if (domain) out.push(serialize(name, "", req, { maxAge: 0, httpOnly, domain }));
    out.push(serialize(name, "", req, { maxAge: 0, httpOnly }));
  }
  return out;
}

export function withSetCookies<T extends NextResponse>(res: T, headers: string[]): T {
  for (const h of headers) res.headers.append("set-cookie", h);
  return res;
}

/** 같은 이름의 쿠키를 전부 모은다 — 도메인 쿠키와 host-only 쿠키가 함께 올 수 있다 */
export function readCookieValues(req: Request, name: string): string[] {
  const header = req.headers.get("cookie");
  if (!header) return [];
  const prefix = name + "=";
  const out: string[] = [];
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(prefix)) continue;
    try {
      out.push(decodeURIComponent(trimmed.slice(prefix.length)));
    } catch {
      /* 못 읽는 값은 버린다 */
    }
  }
  return out;
}

/**
 * 요청에서 서명 토큰을 꺼낸다.
 *
 *   1. `Authorization: Bearer …`
 *   2. `snap_session` (HttpOnly)
 *
 * 옛 `snap_user` 안의 `token` 은 **읽지 않는다** (2026-09-09 이행기 없이 바로 끊었다 — 사용자 결정).
 * 그 형식의 세션은 로그인 화면으로 돌아가 한 번 다시 로그인한다.
 */
export function readSessionTokenFromRequest(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    /*
      typelog 은 `Authorization: Bearer` 에 ADMIN_API_SECRET 을 싣는다. 그 값은 서명 토큰이
      아니라(점이 없다) 세션으로 보지 않고 쿠키로 넘어간다 → typelog/lib/auth.ts
    */
    const bearer = auth.slice(7).trim();
    if (bearer.includes(".")) return bearer;
  }

  for (const v of readCookieValues(req, SESSION_COOKIE)) {
    if (v) return v;
  }

  return null;
}
