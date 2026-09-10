"use client";

import { useEffect, useState } from "react";
import { loadSession, type SessionUser } from "@/lib/session";
import { loginUrl } from "@/lib/portal";

export type SessionState =
  | { status: "loading"; user: null }
  | { status: "anonymous"; user: null }
  | { status: "signed-in"; user: SessionUser };

/**
 * 세션은 **클라이언트가 읽는 쿠키**에 있어 서버 컴포넌트에서는 알 수 없다.
 * 그래서 로그인 여부로 갈리는 화면은 이 훅을 쓰는 클라이언트 컴포넌트로 떼어 둔다.
 *
 * 상태가 정해지기 전에는 아무것도 그리지 않는다 — 로그인한 사람에게
 * "로그인" 버튼이 한 번 스쳐 보이는 것보다 낫다.
 */
export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ status: "loading", user: null });

  useEffect(() => {
    const user = loadSession();
    setState(user ? { status: "signed-in", user } : { status: "anonymous", user: null });
  }, []);

  return state;
}

/** 로그인이 필요한 화면에서 쓴다. 세션이 없으면 로그인 화면으로 보낸다 */
export function useRequireSession(next: string): SessionState {
  const state = useSession();

  useEffect(() => {
    if (state.status === "anonymous") window.location.replace(loginUrl(next));
  }, [state.status, next]);

  return state;
}
