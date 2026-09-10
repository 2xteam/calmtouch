# CalmTouch

손끝이 닿는 곳마다 잔잔하게 번지는 화면. 마음이 바쁠 때 잠깐 만지며 쉬는 앱.

```
운영    https://calmtouch.myjane.co.kr
로컬    http://localhost:3007
DB      없음 (회원 기능 없음 — 브라우저 localStorage 만 쓴다)
```

## 개발

```bash
npm install
cp .env.example .env.local     # 값을 채운다 (필수 값은 없다)
npm run dev                    # http://localhost:3007
npm run dev:verify             # 검증용 서버 3017 · .next-verify
npm run icons                  # public/app-icon.svg → PNG 파생물
```

포트는 앱마다 다르다 — 전체 표는 볼트 `Home.md`.

## 배경 지식

설계 결정은 옵시디언 볼트에 있다. 작업 전에 `CLAUDE.md`를 먼저 본다.

```
C:\Dev\my-obsidian-vault
  10-Projects/CalmTouch.md     스택 · 장면 목록 · 결정 사항 · 현황
```

## 구조

```
app/
  page.tsx            소개 페이지 (로그인 없이)
  (app)/home          첫 화면 — 이어서 하기 · 추천 장면
  (app)/scenes        전체 장면 목록 · 다음에 만들 장면
  play/[slug]         플레이어 (전체 화면, 내비 없음)
components/
  play/PlayScreen.tsx 입력(포인터 · 휠 · 기울기 · 흐름)과 UI
lib/
  scenes.ts           장면 목록 — 콘텐츠 원본. 새 장면은 여기에 추가
  fluid/              WebGL 유체 시뮬레이션 (Stable Fluids)
```
