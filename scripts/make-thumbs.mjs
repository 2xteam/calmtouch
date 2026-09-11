/**
 * 장면 카드용 썸네일 — 실제 플레이 화면을 헤드리스 브라우저로 캡처한다.
 *
 *   npm run dev  (또는 npm run start)      # 3007 이 떠 있어야 한다
 *   npm run thumbs                          # public/thumbs/<slug>.webp 24장
 *
 * 그라디언트로 "분위기만" 보여 주던 카드가 실제 장면과 달라 보여서(2026-09-10 사용자 지적)
 * 실제 화면을 찍어 쓴다. 카드는 4:3 이므로 640×480 으로 찍고 webp 로 줄인다.
 *
 * Playwright 는 이 저장소에 설치하지 않는다(브라우저 다운로드가 크다). 옆 프로젝트(klead)에 있는
 * 것을 빌려 쓴다 — 다른 자리에 있으면 PLAYWRIGHT_DIR 로 알려 준다.
 * WebGL 은 GPU 없이 swiftshader 로 켠다. 느리지만 그림은 같다.
 */
import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";

const PW = process.env.PLAYWRIGHT_DIR ?? "C:/Dev/klead/node_modules/playwright";
const { chromium } = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
const BASE = process.env.THUMB_BASE ?? "http://localhost:3007";
const OUT = path.join(process.cwd(), "public", "thumbs");
mkdirSync(OUT, { recursive: true });

// 장면 목록은 TS 라 직접 import 못 한다 — slug 만 정규식으로 읽는다
const scenesSrc = readFileSync(path.join(process.cwd(), "lib", "scenes.ts"), "utf8");
const all = [...scenesSrc.matchAll(/slug: "([a-z0-9-]+)"/g)].map((m) => m[1]);
const slugs = process.argv.slice(2).length ? process.argv.slice(2) : all;

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});

/** 장면마다 손짓이 조금 다르다 — 물결은 탭 몇 번, 천은 살짝 젖히기, 나머지는 한 번 쓸기 */
async function gesture(page, slug) {
  const m = page.mouse;
  const W = 640, H = 480;
  if (slug === "ripple") {
    for (const [x, y] of [[200, 180], [420, 300], [330, 130]]) { await m.click(x, y); await page.waitForTimeout(500); }
    return;
  }
  if (slug === "constellation") {
    await m.move(120, 160); await m.down();
    for (let i = 0; i < 30; i++) await m.move(120 + i * 15, 160 + Math.sin(i / 3) * 110, { steps: 3 });
    await m.up();
    return;
  }
  if (slug === "slime") {
    // 색 하나를 골라 옆에 덩어리가 생긴 채, 윗면을 살짝 눌러 잠긴 자국이 보이게 (끌지 않는다 — 끌면 아치가 생긴다)
    await page.getByRole("button", { name: "도구 열기" }).click().catch(() => {});
    await page.locator(".play-chip").nth(3).click().catch(() => {});
    await page.getByRole("button", { name: "도구 닫기" }).click().catch(() => {});
    await page.waitForTimeout(400);
    await m.move(W * 0.5, H * 0.5); await m.down();
    await page.waitForTimeout(450);
    return;
  }
  if (slug === "wax") {
    // 도넛 고리(가운데는 구멍) 세 군데를 꾹 눌러 껍질이 조각조각 갈라진 모습
    const S = Math.min(W, H) * 0.37 * 0.67;
    for (const a of [-2.2, -0.6, 1.1]) {
      await m.move(W / 2 + Math.cos(a) * S, H / 2 + Math.sin(a) * S); await m.down(); await page.waitForTimeout(700); await m.up(); await page.waitForTimeout(150);
    }
    // 한 군데는 조금 문질러 섞이기 시작한 모습
    await m.move(W / 2 + Math.cos(2.6) * S, H / 2 + Math.sin(2.6) * S); await m.down();
    for (let i = 0; i < 10; i++) await m.move(W / 2 + Math.cos(2.6 + i * 0.05) * S, H / 2 + Math.sin(2.6 + i * 0.05) * S + Math.sin(i) * 8, { steps: 2 });
    await m.up();
    return;
  }
  if (slug === "rainbow") {
    // 줄 하나를 눌러 휘게
    await m.move(W * 0.3, H * 0.62); await m.down();
    for (let i = 0; i < 12; i++) await m.move(W * 0.3 + i * 6, H * 0.62 - i * 5, { steps: 2 });
    await page.waitForTimeout(120);
    return;
  }
  if (slug === "blocks") {
    // 공을 몰아 블록 더미를 뚫고 지나간 직후
    await m.move(W * 0.5, H * 0.9); await m.down();
    for (let i = 0; i < 26; i++) await m.move(W * 0.5 + Math.sin(i / 4) * 30, H * 0.9 - i * 22, { steps: 2 });
    await m.up();
    await page.waitForTimeout(500);
    return;
  }
  if (slug === "breath") {
    await page.waitForTimeout(2600); // 들이쉬는 중간
    return;
  }
  if (slug === "balls") {
    // 바닥에 모여 있으면 카드 아래만 찬다 — 휠로 한 번 튀어 오르게 한 뒤 찍는다
    await m.move(W / 2, H / 2);
    await m.wheel(0, -400);
    await page.waitForTimeout(420);
    return;
  }
  if (slug === "cloth") {
    // 잡아끌지 않고 손으로 스치듯 — 바람처럼 흔들린 모습
    await m.move(W * 0.2, H * 0.5);
    for (let i = 0; i < 24; i++) await m.move(W * 0.2 + i * 18, H * 0.5 + Math.sin(i / 4) * 40, { steps: 2 });
    await page.waitForTimeout(700);
    return;
  }
  if (slug === "chimes" || slug === "breath" || slug === "lava" || slug === "flock") {
    await m.move(W * 0.3, H * 0.5); await m.down();
    await m.move(W * 0.55, H * 0.45, { steps: 20 });
    await m.up();
    return;
  }
  if (slug === "zen") {
    await m.move(90, 330); await m.down();
    for (let i = 0; i < 40; i++) await m.move(90 + i * 12, 330 - Math.sin(i / 6) * 120, { steps: 2 });
    await m.up();
    return;
  }
  // 기본 — S 자로 한 번 쓸고, 마우스는 가운데 근처에 둔다
  await m.move(90, 220); await m.down();
  for (let i = 0; i < 34; i++) await m.move(90 + i * 14, 220 + Math.sin(i / 5) * 120, { steps: 2 });
  await m.up();
  await m.move(W * 0.62, H * 0.42);
}

/** 손짓 뒤에 얼마나 기다리나 — 잔잔해지는 장면은 조금 더 */
const SETTLE = { paint: 1400, cloud: 2600, marbling: 1200, galaxy: 1800, fireflies: 1200, physarum: 4500, reaction: 6000, rain: 2600, fog: 700 };

for (const slug of slugs) {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 480 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/play/${slug}`, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: ".play-ui { display: none !important; }" });
  await page.waitForTimeout(600);
  await gesture(page, slug);
  await page.waitForTimeout(SETTLE[slug] ?? 900);
  const png = path.join(OUT, `${slug}.png`);
  try {
    await page.screenshot({ path: png, timeout: 15000 });
  } catch {
    // 헤드리스에서 스크린샷이 컴포지터를 기다리다 멈추는 일이 있다 — 캔버스를 직접 뽑는다
    const data = await page.evaluate(() => document.querySelector("canvas.play-canvas").toDataURL("image/png"));
    writeFileSync(png, Buffer.from(data.split(",")[1], "base64"));
    console.log(`  (${slug}: screenshot 대신 canvas 덤프)`);
  }
  const webp = path.join(OUT, `${slug}.webp`);
  await sharp(png).webp({ quality: 78 }).toFile(webp);
  unlinkSync(png);
  console.log(`${slug.padEnd(14)} → public/thumbs/${slug}.webp`);
  await ctx.close();
}
await browser.close();
writeFileSync(path.join(OUT, ".gitkeep"), "");
