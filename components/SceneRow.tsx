"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * 옆으로 미는 카드 줄.
 *
 * 폰에서는 손으로 밀면 되지만 PC 에는 스크롤바를 숨겨 두어 옆으로 갈 방법이 없었다(2026-09-12 사용자 지적).
 * 마우스 기기에서는 **양 끝 화살표**가 뜨고, 카드 사이 빈 곳이나 카드를 **잡아 끌어도** 움직인다.
 * 끌었을 때는 손을 뗀 자리의 카드가 열리지 않게 클릭을 막는다. 휠은 건드리지 않는다 — 세로 스크롤은 페이지 것이다
 * (Shift+휠은 브라우저가 알아서 옆으로 민다).
 */
export function SceneRow({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el) return;
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, [measure]);

  const page = (dir: -1 | 1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    const el = ref.current;
    if (!el) return;
    drag.current = { x: e.clientX, left: el.scrollLeft, moved: false };
    el.dataset.drag = "yes";
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = ref.current;
    if (!d || !el) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 6) d.moved = true;
    el.scrollLeft = d.left - dx;
  };
  const endDrag = () => {
    const el = ref.current;
    if (el) delete el.dataset.drag;
    // 끌었다면 곧 올 click 을 막을 수 있게 한 틱 뒤에 지운다
    window.setTimeout(() => {
      drag.current = null;
    }, 0);
  };
  const onClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (drag.current?.moved) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  return (
    <div className="scene-row-wrap">
      <button type="button" className="scene-row-arrow scene-row-arrow--left" aria-label={`${label} 이전 카드`} disabled={!canLeft} onClick={() => page(-1)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div
        ref={ref}
        className="scene-row"
        role="list"
        aria-label={`${label} 장면`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={onClickCapture}
      >
        {children}
      </div>
      <button type="button" className="scene-row-arrow scene-row-arrow--right" aria-label={`${label} 다음 카드`} disabled={!canRight} onClick={() => page(1)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
