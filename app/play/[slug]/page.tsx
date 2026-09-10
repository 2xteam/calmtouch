import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PlayScreen } from "@/components/play/PlayScreen";
import { READY_SCENES, getScene } from "@/lib/scenes";

/**
 * 장면 플레이어. 상단 내비와 푸터가 없는 **전체 화면**이라 `(app)` 그룹 밖에 둔다.
 * 돌아가는 길은 화면 위 왼쪽 버튼 하나다.
 */

type Params = { slug: string };

export function generateStaticParams(): Params[] {
  return READY_SCENES.map((s) => ({ slug: s.slug }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const scene = getScene(slug);
  if (!scene) return { title: "CalmTouch" };
  return {
    title: `${scene.title} — CalmTouch`,
    description: scene.subtitle,
  };
}

export default async function PlayPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const scene = getScene(slug);
  if (!scene) notFound();
  return <PlayScreen scene={scene} />;
}
