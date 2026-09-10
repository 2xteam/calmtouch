import { NextResponse } from "next/server";
import { clearSessionCookieHeaders, withSetCookies } from "@/lib/sessionCookie";

/**
 * 로그아웃 — HttpOnly `snap_session` 은 JS 가 못 지우므로 서버가 지운다.
 * `lib/session.ts` 의 clearSession() 이 부른다. 여섯 앱이 같은 라우트를 갖는다.
 */
export async function POST(req: Request) {
  return withSetCookies(NextResponse.json({ ok: true }), clearSessionCookieHeaders(req));
}
