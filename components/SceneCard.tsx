import Link from "next/link";
import type { Scene } from "@/lib/scenes";

/**
 * 장면 카드 — 누르면 바로 플레이어로 간다.
 *
 * 미리보기는 실제 렌더가 아니라 그라디언트다. 카드마다 WebGL 컨텍스트를 띄우면
 * 목록에서 이미 폰이 뜨거워지고, 브라우저는 컨텍스트 수를 제한한다.
 */
export function SceneCard({ scene }: { scene: Scene }) {
  return (
    <Link href={`/play/${scene.slug}`} className="scene-card">
      <div className="scene-thumb" style={{ backgroundImage: scene.thumb }} aria-hidden="true">
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
