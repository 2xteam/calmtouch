import { SceneCard } from "@/components/SceneCard";
import { Sheet } from "@/components/Sheet";
import { CATEGORIES, CATEGORY_ORDER, scenesIn } from "@/lib/scenes";

/**
 * 전체 장면 목록 — 카테고리마다 시트 하나, 그 안은 **옆으로 미는 카드 줄**이다.
 * 아래로 내리면 카테고리가 바뀌고, 옆으로 밀면 그 카테고리의 장면을 본다 (2026-09-11 사용자 요청).
 * 시트 배경은 흰색 / 연청록을 번갈아 쓴다. 카드를 담은 시트라 전부 `point` 다(구조 신호 — 개수로 막지 않는다)
 * → my-obsidian-vault / 20-Design/여섯 앱 디자인 시스템.md
 */
export default function ScenesPage() {
  return (
    <>
      {CATEGORY_ORDER.map((key, i) => {
        const cat = CATEGORIES[key];
        const list = scenesIn(key);
        if (list.length === 0) return null;
        return (
          <Sheet key={key} point tone={i % 2 === 1 ? "tint" : "plain"} eyebrow={cat.eyebrow} headline={cat.label} lead={cat.lead}>
            <div className="scene-row-head">
              <span className="scene-row-count">{list.length}개</span>
              {list.length > 1 ? <span className="scene-row-hint">옆으로 밀어 보기 →</span> : null}
            </div>
            <div className="scene-row" role="list" aria-label={`${cat.label} 장면`}>
              {list.map((s) => (
                <div key={s.slug} role="listitem" className="scene-row-item">
                  <SceneCard scene={s} />
                </div>
              ))}
            </div>
          </Sheet>
        );
      })}
    </>
  );
}
