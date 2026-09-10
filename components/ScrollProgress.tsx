"use client";

import { useEffect, useRef } from "react";

/**
 * 헤더 아래에 차오르는 스크롤 진행 띠.
 *
 * **sticky 헤더 안에** 두면 `position: absolute` 로 그 아래 변에 붙는다.
 * 헤더가 sticky 가 아니면 스크롤과 함께 화면 밖으로 나간다.
 *
 * 모양은 `.scroll-progress` 가 갖고 여기서는 `--scroll-progress`(0~1)만 넣는다.
 * 그 CSS 의 원본은 **`myjane/design/elements.css`** 다 — 앱의 `app/elements.css`
 * 는 생성 파일이니 고치지 말고 `npm run elements -- --write` 를 쓴다.
 *
 * ⚠️ 이 파일도 여섯 앱에 복사본이다. 고치면 여섯 개를 함께 고친다.
 *
 * 구현 주의 세 가지 —
 *
 * ① **0 으로 나누지 않는다.** 스크롤이 없는 짧은 페이지에서 분모가 0 이 된다.
 *    typelog 처럼 실제로 짧은 랜딩이 있다. 그때는 띠를 그리지 않는다(0 으로 둔다).
 * ② `scroll` 이벤트를 그대로 쓰면 프레임마다 계산한다. `requestAnimationFrame`
 *    으로 묶어 한 프레임에 한 번만 쓴다.
 * ③ CSS 변수를 문서 루트가 아니라 **자기 요소에** 쓴다. 다른 컴포넌트가
 *    같은 이름을 쓰더라도 서로 간섭하지 않는다.
 *
 * 근거: my-obsidian-vault → 50-Plans/A 디자인 요소 추가.md
 */
export function ScrollProgress() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let frame = 0;

    const update = () => {
      frame = 0;
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - doc.clientHeight;
      // 스크롤할 게 없으면 진행률이 정의되지 않는다 — 띠를 비워 둔다
      const ratio = scrollable > 0 ? doc.scrollTop / scrollable : 0;
      el.style.setProperty("--scroll-progress", String(Math.min(1, Math.max(0, ratio))));
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return <div ref={ref} className="scroll-progress" aria-hidden="true" />;
}
