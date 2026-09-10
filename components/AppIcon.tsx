import Image from "next/image";

type Props = {
  size?: number;
  className?: string;
  /** 로고 옆 텍스트와 중복되면 빈 문자열 권장 */
  alt?: string;
  priority?: boolean;
};

/** 사이트 타이틀 옆 마크. 파비콘은 `app/layout.tsx`의 `metadata.icons`(`/favicon.png`)와 별도입니다. */
export function AppIcon({ size = 28, className, alt = "CalmTouch", priority }: Props) {
  return (
    <Image
      src="/site-title-icon.png"
      alt={alt}
      width={size}
      height={size}
      className={className}
      priority={priority}
    />
  );
}
