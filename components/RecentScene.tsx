"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { loadRecent } from "@/lib/recent";
import { getScene, type Scene } from "@/lib/scenes";

/**
 * 마지막으로 열었던 장면 — 브라우저에만 남는 기억이라 클라이언트에서 읽는다.
 * 없으면 아무것도 그리지 않는다.
 */
export function RecentScene() {
  const [scene, setScene] = useState<Scene | null>(null);

  useEffect(() => {
    const r = loadRecent();
    if (!r) return;
    setScene(getScene(r.slug) ?? null);
  }, []);

  if (!scene) return null;

  return (
    <section className="sheet sheet--tint">
      <p className="eyebrow">CONTINUE</p>
      <Link href={`/play/${scene.slug}`} className="recent">
        <span className="recent-thumb" style={{ backgroundImage: scene.thumb }} aria-hidden="true">
          {scene.emoji}
        </span>
        <span className="recent-body">
          <span className="recent-title">{scene.title}</span>
          <span className="recent-sub">지난번에 열었던 장면이에요. 이어서 쉬어요.</span>
        </span>
        <span className="btn btn--primary btn--sm">이어서 →</span>
      </Link>
    </section>
  );
}
