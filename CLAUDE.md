# 작업 전에 읽을 것

이 프로젝트의 배경 지식은 별도의 옵시디언 볼트에 정리되어 있다.

```
로컬:   C:\Dev\my-obsidian-vault
저장소: https://github.com/2xteam/my-obsidian-vault
```

## 먼저 읽기

1. `10-Projects/CalmTouch.md` — 이 프로젝트의 스택·장면 목록·결정 사항·현황
2. `00-Meta/AI 협업 규칙.md` — 볼트를 읽고 갱신하는 방법

작업 성격에 따라 추가로:

| 작업 | 노트 |
|---|---|
| 페이지 디자인 | `20-Design/` 전체 (특히 여섯 앱 디자인 시스템·앱 공통 UI와 아이콘) |
| 로그인·세션 | `30-Patterns/인증과 세션 공유.md` |
| 배포·환경 변수·도메인 | `30-Patterns/Vercel 배포 패턴.md`, `40-Infra/도메인과 DNS.md` |
| 개발 서버 | `30-Patterns/개발 서버와 검증 환경.md` |

## 이 프로젝트 메모

- 로컬 포트 **3007** (검증 3017). 전체 포트 표는 볼트 `Home.md`
- **DB 가 없다.** 회원 기능이 없고 로그인 없이 쓴다. 브라우저 `localStorage` 에
  마지막 장면과 고른 색만 남긴다 (`lib/recent.ts`)
- 로그인·로그아웃 자리는 형제 앱과 같은 곳에 두되, **로컬 로그인 화면(`/login`)은 없다.**
  로그인은 언제나 포털이고 localhost 에서는 버튼을 감춘다 → `lib/portal.ts`
- **콘텐츠 원본은 `lib/scenes.ts`** 다. 새 장면은 이 배열에 한 항목을 추가한다.
  엔진이 다른 장면(은하·공·모래·슬라임·구름·반짝이)은 `engine` 값을 늘려 붙인다
- 유체 엔진은 `lib/fluid/` — Stable Fluids 를 WebGL 로. 셰이더와 시뮬레이터가 나뉘어 있다
- 플레이어(`/play/[slug]`)는 `(app)` 그룹 밖이다 — 상단 내비·푸터 없이 전체 화면
- 화면 문장은 전부 **해요체**. "치료·명상·효과" 라고 하지 않는다. "잠깐 쉬어요" 정도로 쓴다
- 상단 메뉴는 `Home` `Scenes`

## 디자인을 만질 때

**먼저 검사부터 돌린다.**

```bash
cd C:/Dev/myjane && npm run design:check
```

규칙 · 이유 · 현재 기준선 → my-obsidian-vault / 20-Design/여섯 앱 디자인 시스템.md

- 시트의 **원형 장식은 쓰지 않는다**
- `components/Sheet.tsx` 는 형제 앱에 **복사본**이다. 고치면 함께 고친다
- 아이콘은 한 가족이다. 하나만 바꾸지 않는다. 원본 `public/app-icon.svg`, `npm run icons`
- 플레이어의 짙은 바탕은 **테마가 아니라 콘텐츠**다. 물감은 어두운 바탕 위에 가산돼야
  보인다. 라이트 전용 원칙은 목록 화면에 그대로 적용된다

### `app/elements.css` · `app/palette.css` 는 생성 파일이다

고치지 말 것. 원본은 포털에 하나뿐이다.

```
myjane/design/elements.css   ← cd C:/Dev/myjane && npm run elements -- --write
myjane/design/palette.json   ← cd C:/Dev/myjane && npm run palette -- --write
```

⚠️ `elements.css` 는 `layout.tsx` 에서 **globals.css 다음 줄**이라야 한다.

새 색을 쓸 때는 리터럴 대신 토큰을 쓴다. 밝은 색을 글자로 쓰지 말 것 —
`--accent` / `--accent-ink`, `--point` / `--point-ink`, `--danger` / `--danger-ink`.
짙은 면 위 글자는 `--on-dark` 계열이다.

## 작업이 끝나면

바뀐 사실(도메인·진행 상황·새로 발견한 함정)을 볼트의 해당 노트에 반영하고
`updated` 날짜를 올린다. 볼트 수정은 코드와 **별도 커밋**으로 남긴다.

비밀값을 볼트에 쓰지 않는다. 공개 저장소다.
