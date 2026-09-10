import type { ReactNode } from "react";

/**
 * 결쩜사 패턴의 "시트" — 옅은 배경 위에 얹는 둥근 카드.
 * 시트마다 eyebrow → 헤드라인 → 콘텐츠 순서를 지킨다.
 * 근거: my-obsidian-vault → 20-Design/결쩜사 페이지 패턴.md
 *
 * ⚠️ 이 파일은 다섯 앱에 **복사본**이다. 고치면 다섯 개를 함께 고친다.
 * `npm run elements` (myjane) 가 다섯 벌이 같은지 검사한다.
 */
export function Sheet({
  tone = "plain",
  point = false,
  eyebrow,
  headline,
  lead,
  center = false,
  children,
}: {
  tone?: "plain" | "tint" | "dark" | "gold";
  /**
   * 좌상·우하 라운딩을 깎아 대각선 방향성을 만든다.
   *
   * ⚠️ **한 화면에 최대 두 개.** 그 이상이면 방향이 서로 상쇄돼 포인트가
   * 아니라 스타일이 된다. 넣는 자리는 히어로와 마무리 CTA, 그리고 조건부로
   * 뜨는 상태 카드다 — 나란히 놓인 카드나 목록의 반복 항목에는 넣지 않는다.
   *   → my-obsidian-vault / 20-Design/여섯 앱 디자인 시스템.md
   */
  point?: boolean;
  eyebrow?: string;
  headline?: ReactNode;
  lead?: ReactNode;
  center?: boolean;
  children?: ReactNode;
}) {
  const cls = [
    "sheet",
    tone === "tint" ? "sheet--tint" : "",
    tone === "dark" ? "sheet--dark" : "",
    tone === "gold" ? "sheet--gold" : "",
    point ? "sheet--point" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={cls}>
      {eyebrow || headline || lead ? (
        <div style={center ? { textAlign: "center" } : undefined}>
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          {headline ? <h2 className="headline">{headline}</h2> : null}
          {lead ? <p className="lead">{lead}</p> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
