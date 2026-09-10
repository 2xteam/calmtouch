import { SceneCard } from "@/components/SceneCard";
import { Sheet } from "@/components/Sheet";
import { CATEGORIES, CATEGORY_ORDER, scenesIn } from "@/lib/scenes";

/**
 * 전체 장면 목록 — 카테고리마다 시트 하나. 시트 배경은 흰색 / 연청록을 번갈아 쓴다.
 * 카드를 담은 시트라 전부 `point` 다(구조 신호 — 개수로 막지 않는다)
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
            <div className="scene-grid">
              {list.map((s) => (
                <SceneCard key={s.slug} scene={s} />
              ))}
            </div>
          </Sheet>
        );
      })}
    </>
  );
}
