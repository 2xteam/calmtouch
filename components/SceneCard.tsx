import Link from "next/link";
import type { Scene } from "@/lib/scenes";

/**
 * 장면 카드 — 누르면 바로 플레이어로 간다.
 *
 * 미리보기는 **실제 플레이 화면을 찍은 이미지**(`public/thumbs/<slug>.webp`, `npm run thumbs`)다.
 * 카드마다 WebGL 을 띄우지는 않는다 — 목록에서 이미 폰이 뜨거워지고 컨텍스트 수 제한에 걸린다.
 * 이미지가 없으면 CSS 가 뒤의 그라디언트를 그대로 보여 준다(깨진 이미지 아이콘이 나오지 않는다).
 */
export function SceneCard({ scene }: { scene: Scene }) {
  return (
    <Link href={`/play/${scene.slug}`} className="scene-card">
      <div className="scene-thumb" style={{ backgroundImage: `url(/thumbs/${scene.slug}.webp), ${scene.thumb}` }} aria-hidden="true">
        <span className="scene-emoji">{scene.emoji}</span>
      </div>
      <div className="scene-body">
        <p className="scene-title">{scene.title}</p>
        <p className="scene-sub">{scene.subtitle}</p>
        {scene.color.kind === "single" ? <span className="pill">색 고르기</span> : null}
      </div>
    </Link>
  );
}
