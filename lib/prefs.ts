/**
 * 도구 패널 설정의 기억 — 소리·기울기·흐름 켬/끔과 장면 고유 조정 값(키캡 수·LED·축 …).
 *
 * 한 번 정한 값은 **다른 장면으로 가도 그대로다** (2026-09-13 사용자). 조정 값은 장면이 아니라
 * **키**로 기억한다 — `count` 를 파스텔 키캡에서 6으로 두면 이모티콘 키캡도 6으로 열린다. 비슷한 값은
 * 카테고리를 넘어 공유되는 셈이다. 장면이 그 키를 안 쓰면 그냥 무시된다.
 *
 * 서버에 보내지 않고 이 브라우저에만 남는다(`lib/recent.ts` 와 같은 자리, localStorage). 세션 쿠키(`snap_*`)와
 * 섞이지 않게 한다 — 그쪽은 여섯 앱이 함께 읽는 값이다.
 */
const PREFIX = "calmtouch:pref:";

export type PrefValue = number | boolean | string;

export function loadPref(key: string): PrefValue | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw === null) return null;
    const v = JSON.parse(raw) as unknown;
    return typeof v === "number" || typeof v === "boolean" || typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

export function savePref(key: string, value: PrefValue) {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* 시크릿 모드 등 — 기억만 못 하는 셈이다 */
  }
}
