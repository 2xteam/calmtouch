import { ScrollKeeper } from "@/components/ScrollKeeper";
import { TopNav } from "@/components/TopNav";
import { SiteFooter } from "@/components/SiteFooter";

/**
 * 목록 화면들의 껍데기 — 상단 내비와 푸터.
 *
 * 다른 앱은 여기서 AuthGate 로 세션을 지키지만 이 앱은 **로그인 없이 쓴다.**
 * 저장할 것이 생기면 그때 그 화면만 지킨다.
 * → my-obsidian-vault / 10-Projects/CalmTouch.md
 */
export default function AppShellLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-primary)" }}>
      <TopNav />
      {/* 장면에서 돌아오면 보던 자리로 — 목록 화면 공통 */}
      <ScrollKeeper />
      <div
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: "calc(var(--nav-height) + 1rem) 1rem 2rem",
        }}
      >
        {children}
        <SiteFooter />
      </div>
    </div>
  );
}
