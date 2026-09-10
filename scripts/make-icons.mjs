/**
 * public/app-icon.svg 에서 PNG 파생물을 만든다.
 *
 *   node scripts/make-icons.mjs
 *
 * sharp 는 Next 의 전이 의존성이라 따로 설치하지 않는다.
 * density 를 높여 렌더한 뒤 축소해야 작은 크기에서 선이 뭉개지지 않는다.
 * → my-obsidian-vault / 20-Design/앱 공통 UI와 아이콘.md
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const SRC = path.join(process.cwd(), "public", "app-icon.svg");
/** 16px 은 **다른 그림**을 쓴다 → public/app-icon-16.svg 주석 */
const SRC_16 = path.join(process.cwd(), "public", "app-icon-16.svg");

/** 이름 → [크기, 원본]. 쓰임은 볼트의 표와 같다 */
const TARGETS = [
  ["icon.png", 192, SRC], // PWA · 일반
  ["favicon.png", 32, SRC], // 탭 (HiDPI)
  ["favicon-16.png", 16, SRC_16], // 탭 (일반 DPI) — 단순화 변형
  ["site-title-icon.png", 64, SRC], // TopNav 로고
  ["calmtouch-link-icon.png", 56, SRC], // 다른 앱 스위처
  ["calmtouch-icon-512.png", 512, SRC], // 원본 보관
];

for (const [name, size, src] of TARGETS) {
  const out = path.join(process.cwd(), "public", name);
  await sharp(await readFile(src), { density: 900 }).resize(size, size).png().toFile(out);
  console.log(`${name.padEnd(26)} ${size}×${size}  ${path.basename(src)}`);
}
