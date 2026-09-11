"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * 목록의 스크롤 자리를 기억한다.
 *
 * 장면에서 돌아올 때 목록이 맨 위로 튀었다(2026-09-11 사용자 지적). Next 의 뒤로가기 복원은
 * 첫 로드 뒤 프로그램으로 스크롤한 경우 등에서 믿을 수 없어서, 경로별로 `sessionStorage` 에
 * 직접 적어 두고 다시 들어오면 그 자리로 옮긴다. 새 탭·새 세션에서는 비어 있으니 맨 위다.
 */
export function ScrollKeeper() {
  const pathname = usePathname();

  useEffect(() => {
    const key = `calmtouch:scroll:${pathname}`;
    let raf = 0;
    try {
      const saved = Number(window.sessionStorage.getItem(key) ?? "0");
      if (saved > 0) {
        // 레이아웃이 잡힌 다음 프레임에 — 첫 프레임에 옮기면 높이가 모자라 덜 내려간다
        raf = requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, saved)));
      }
    } catch {
      /* 시크릿 모드 등 */
    }
    let pending = 0;
    const onScroll = () => {
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        try {
          window.sessionStorage.setItem(key, String(Math.round(window.scrollY)));
        } catch {
          /* ignore */
        }
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
      if (pending) cancelAnimationFrame(pending);
    };
  }, [pathname]);

  return null;
}
