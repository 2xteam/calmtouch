import type { CSSProperties } from "react";

/**
 * 앱 하단 공통 푸터 — myjane 워드마크, 법적 고지 링크, 저작권 한 줄.
 *
 * ⚠️ 이 파일은 **형제 앱에 같은 내용으로 복사돼 있다**
 * (fitlog · 2hbk · SnapWord · SnapNote · typelog · calmtouch).
 * 한 앱만 고치면 갈라진다 — 고칠 때는 함께 고친다.
 * → my-obsidian-vault / 20-Design/여섯 앱 디자인 시스템.md
 *
 * 법적 고지 세 페이지는 포털(myjane)에 한 벌만 둔다. 여섯 앱이 회원과 세션을
 * 공유하므로 방침도 한 곳이어야 한다. 그래서 여기서는 절대 주소로 건다.
 * → my-obsidian-vault / 50-Plans/C 법적 페이지.md
 */

const PORTAL = "https://www.myjane.co.kr";

const LEGAL_LINKS = [
  { href: `${PORTAL}/legal/privacy`, label: "개인정보처리방침" },
  { href: `${PORTAL}/legal/terms`, label: "이용약관" },
  { href: `${PORTAL}/legal/cookies`, label: "쿠키 안내" },
];

export function SiteFooter() {
  return (
    <footer style={wrapStyle}>
      <p style={lineStyle}>
        <a href={PORTAL} target="_blank" rel="noopener noreferrer" className="myjane-mark">
          my<span>jane</span>
        </a>
      </p>
      <p style={legalStyle}>
        {LEGAL_LINKS.map((l, i) => (
          <span key={l.href}>
            {i > 0 ? <span style={sepStyle}>·</span> : null}
            <a href={l.href} target="_blank" rel="noopener noreferrer" style={legalLinkStyle}>
              {l.label}
            </a>
          </span>
        ))}
      </p>
      <p style={copyStyle}>@2026 myjane All rights reserved</p>
    </footer>
  );
}

const wrapStyle: CSSProperties = {
  marginTop: "3rem",
  paddingTop: "1.5rem",
  paddingBottom: "0.5rem",
  borderTop: "1px solid var(--border-subtle)",
  textAlign: "left",
};

const lineStyle: CSSProperties = {
  margin: 0,
};

const legalStyle: CSSProperties = {
  margin: "0.5rem 0 0",
  fontSize: "0.75rem",
  lineHeight: 1.9,
};

const legalLinkStyle: CSSProperties = {
  color: "var(--accent)",
  textDecoration: "none",
  fontWeight: 600,
};

const sepStyle: CSSProperties = {
  margin: "0 0.5rem",
  color: "var(--text-muted)",
};

const copyStyle: CSSProperties = {
  margin: "0.4rem 0 0",
  fontSize: "0.75rem",
  color: "var(--text-muted)",
};
