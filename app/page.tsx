import type { CSSProperties } from "react";
import Link from "next/link";
import { AppIcon } from "@/components/AppIcon";
import { LandingHeaderAuth } from "@/components/LandingAuth";
import { ScrollProgress } from "@/components/ScrollProgress";
import { Sheet } from "@/components/Sheet";

/**
 * 루트는 **로그인 없이 볼 수 있는 소개 페이지**다.
 * 앱 화면은 /home 부터, 장면은 /play/[slug] 다.
 * → my-obsidian-vault / 20-Design/앱 공통 UI와 아이콘.md
 */

/** 시작하는 순서 — 다른 앱은 STEPS 를 파일 위에 둔다. 모양을 맞춘다 */
const STEPS: [string, string, string][] = [
  ["01", "장면을 골라요", "물감 · 물과 유리 · 빛과 무늬 · 살아 있는 것 · 만지는 물건 · 숨. 스물네 장면 중 하나를 골라요."],
  ["02", "손끝으로 만져요", "마우스를 움직이거나 손가락으로 문지르면 그 자리에서 색이 번져요. 스크롤과 기울이기도 돼요."],
  ["03", "가만히 두어요", "손을 떼면 천천히 잔잔해져요. 그대로 바라만 봐도 괜찮아요."],
];

export default function LandingPage() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-primary)" }}>
      <header style={headerStyle}>
        <div className="page" style={{ ...headerInner, paddingTop: 14, paddingBottom: 14 }}>
          <span className="row" style={{ gap: 9 }}>
            <AppIcon size={30} priority />
            <span style={{ fontWeight: 900, letterSpacing: "-0.02em" }}>CalmTouch</span>
          </span>
          <LandingHeaderAuth />
        </div>
        {/* 헤더가 sticky 라서 띠가 스크롤을 따라온다 */}
        <ScrollProgress />
      </header>

      <main className="page">
        <Sheet
          tone="dark"
          point
          eyebrow="CALM TOUCH"
          headline={
            <>
              손끝이 닿는 곳마다
              <br />
              잔잔하게 번져요
            </>
          }
          lead={
            <>
              마음이 바쁠 때 잠깐 화면을 만져요.
              <br />
              색이 번지고, 손을 떼면 천천히 잔잔해져요. 정답도 점수도 없어요.
            </>
          }
        >
          <div style={{ display: "flex", gap: 10, marginTop: 22, flexWrap: "wrap" }}>
            <Link className="btn btn--primary" href="/scenes">
              장면 고르기 →
            </Link>
            <Link className="btn btn--ghost" href="/play/paint">
              바로 만져 보기
            </Link>
          </div>
        </Sheet>

        <Sheet
          tone="tint"
          eyebrow="HOW IT WORKS"
          headline={
            <>
              <span className="mark">세 걸음</span>이면 충분해요
            </>
          }
        >
          {/* 번호 원과 연결선은 app/elements.css 의 .flow 가 그린다 */}
          <ol className="flow">
            {STEPS.map(([no, title, desc]) => (
              <li key={no} className="flow-step">
                <span className="flow-num" aria-hidden="true">
                  {no}
                </span>
                <div>
                  <h3>{title}</h3>
                  <p>{desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </Sheet>

        <Sheet eyebrow="WHAT YOU GET" headline="스물네 가지 장면">
          <p className="lead">
            색이 번지는 <strong>물감</strong>, 탭하면 동심원이 퍼지는 <strong>물결</strong>, 흩뜨리면 제자리로 도는 <strong>은하</strong>,
            손끝을 피하는 <strong>반짝이</strong>, 기울이면 굴러가는 <strong>공</strong>, 눌리고 늘어나는 <strong>슬라임</strong>.
            어느 것이든 만지는 방법은 같아요.
          </p>
          <p className="lead" style={{ marginTop: 8 }}>
            컴퓨터에서는 마우스와 휠로, 폰에서는 손가락과 기울이기로 만져요.
          </p>
        </Sheet>

        <Sheet eyebrow="NO SIGN IN" tone="gold" headline="로그인 없이 바로 써요">
          <p className="lead">
            화면을 만지는 데는 계정이 필요 없어요. 여기서는 아직 아무것도 저장하지 않아요.
            <br />
            myjane 계정은 다른 서비스와 함께 쓰는 하나의 계정이고, 기록은 서비스마다 따로 쌓여요.
          </p>
        </Sheet>

        <Sheet center point eyebrow="START" headline="지금 잠깐 쉬어 볼까요?">
          <div style={{ marginTop: 20 }}>
            <Link className="btn btn--primary" href="/scenes">
              장면 고르기 →
            </Link>
          </div>
        </Sheet>
      </main>

      <footer style={footerStyle}>
        <div className="page" style={{ textAlign: "center", paddingBottom: 28 }}>
          <p style={{ margin: "0 0 14px", fontWeight: 800, letterSpacing: "-0.02em" }}>CalmTouch</p>
          <p style={{ margin: 0 }}>
            <a href="https://www.myjane.co.kr" className="myjane-mark" style={{ color: "var(--on-dark)" }}>
              my<span>jane</span>
            </a>
          </p>
          {/*
            법적 고지 — 세 페이지는 포털(myjane)에 한 벌만 둔다.
            → my-obsidian-vault / 50-Plans/C 법적 페이지.md
          */}
          <p style={footerLegalStyle}>
            <a href="https://www.myjane.co.kr/legal/privacy" style={footerLegalLinkStyle}>
              개인정보처리방침
            </a>
            <span style={footerLegalSepStyle}>·</span>
            <a href="https://www.myjane.co.kr/legal/terms" style={footerLegalLinkStyle}>
              이용약관
            </a>
            <span style={footerLegalSepStyle}>·</span>
            <a href="https://www.myjane.co.kr/legal/cookies" style={footerLegalLinkStyle}>
              쿠키 안내
            </a>
          </p>
          <p style={footerLineStyle}>@2026 myjane All rights reserved</p>
        </div>
      </footer>
    </div>
  );
}

const headerStyle: CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 40,
  background: "var(--bg-primary)",
  borderBottom: "1px solid var(--border-subtle)",
};

const headerInner: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};

const footerStyle: CSSProperties = {
  marginTop: 40,
  paddingTop: 30,
  background: "var(--footer-bg)",
  color: "var(--on-dark)",
};

const footerLineStyle: CSSProperties = {
  margin: "8px 0 0",
  fontSize: "0.78rem",
  lineHeight: 1.8,
  color: "var(--on-dark-faint)",
  wordBreak: "keep-all",
};

const footerLegalStyle: CSSProperties = {
  margin: "12px 0 0",
  fontSize: "0.78rem",
  lineHeight: 1.9,
};

const footerLegalLinkStyle: CSSProperties = {
  color: "var(--on-dark-dim)",
  textDecoration: "none",
  fontWeight: 600,
};

const footerLegalSepStyle: CSSProperties = {
  margin: "0 8px",
  color: "var(--on-dark-faint)",
};
