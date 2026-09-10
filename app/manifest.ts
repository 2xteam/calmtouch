import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CalmTouch",
    short_name: "CalmTouch",
    description: "손끝이 닿는 곳마다 잔잔하게 번지는 화면. 잠깐 만지며 쉬어요.",
    start_url: "/home",
    display: "standalone",
    /* 라이트 전용이므로 첫 페인트 색을 palette.css 의 :root 와 같게 둔다 */
    background_color: "#f7fbfb",
    theme_color: "#116271",
    /* 플레이어는 가로로 돌려도 좋다 — 고정하지 않는다 */
    orientation: "any",
    icons: [{ src: "/icon.png", sizes: "192x192", type: "image/png" }],
  };
}
