"use client";

import { useEffect, useState } from "react";
import { loginUrl, usesPortal } from "@/lib/portal";
import { useSession } from "@/lib/useSession";

/**
 * 소개 페이지 헤더에서 **로그인 상태에 따라 갈리는 조각**만 떼어 둔 것.
 *
 * 이 앱은 로그인 없이 쓴다. 그래서 본문 CTA 는 세션과 무관하게 "장면 고르기"이고,
 * 헤더 우측만 갈린다 — 로그인한 사람은 앱으로, 운영 도메인의 익명 사용자는 포털
 * 로그인으로. localhost 에서는 포털 세션이 돌아오지 않으니 로그인 버튼을 감춘다.
 * → lib/portal.ts
 */
export function LandingHeaderAuth() {
  const session = useSession();
  const [portal, setPortal] = useState(false);
  useEffect(() => setPortal(usesPortal()), []);

  if (session.status === "loading") return <div style={{ height: 34 }} />;

  if (session.status === "signed-in") {
    return (
      <a className="btn btn--ghost btn--sm" href="/home">
        내 화면
      </a>
    );
  }

  if (!portal) {
    return (
      <a className="btn btn--ghost btn--sm" href="/home">
        들어가기
      </a>
    );
  }

  return (
    <a className="btn btn--ghost btn--sm" href={loginUrl("/home")}>
      로그인
    </a>
  );
}
