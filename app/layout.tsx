import type { Metadata, Viewport } from "next";
import "./globals.css";
// globals.css **다음 줄**이라야 한다 — .sheet--point 가 특이도 같은
// .sheet { border-radius: var(--radius-lg) } 를 이겨야 한다.
// 생성 파일이다: myjane/design/elements.css → npm run elements -- --write
import "./elements.css";

export const metadata: Metadata = {
  title: "CalmTouch",
  description: "손끝이 닿는 곳마다 잔잔하게 번지는 화면. 마음이 바쁠 때 잠깐 만지며 쉬어요.",
  icons: {
    /**
     * 16px 은 단순화한 별도 그림이다. 브라우저가 크기별로 골라 쓴다 —
     * 목록에 sizes 를 안 적으면 큰 쪽을 줄여 쓰면서 회색 덩어리가 된다.
     * → public/app-icon-16.svg
     */
    icon: [
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/icon.png",
  },
  manifest: "/manifest.webmanifest",
  openGraph: {
    type: "website",
    siteName: "CalmTouch",
    title: "CalmTouch — 만지면 잔잔해져요",
    description: "손끝이 닿는 곳마다 색이 번지고, 손을 떼면 천천히 잔잔해져요.",
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
  },
};

/**
 * 플레이어가 전체 화면을 쓰므로 노치·홈 바 뒤까지 그린다(viewport-fit=cover).
 * 첫 페인트 색은 라이트 팔레트의 강조색이다.
 */
export const viewport: Viewport = {
  themeColor: "#116271",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <head>
        {/*
          결쩜사와 동일한 서체 조합.
          본문·라벨은 Pretendard, 큰 헤드라인은 Gowun Batang(명조) 700.
          시스템 폰트 스택으로 대체하면 색을 맞춰도 다른 사이트처럼 보인다.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Gowun+Batang:wght@400;700&display=swap"
        />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard-dynamic-subset.min.css"
        />
        <meta name="apple-mobile-web-app-title" content="CalmTouch" />
      </head>
      <body>{children}</body>
    </html>
  );
}
