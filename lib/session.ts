export type SessionUser = {
  id: string;
  name: string;
  /**
   * 2hbk가 같은 쿠키에 덧붙이는 값. 이 앱은 읽지 않지만, 세션을 다시 저장할 때
   * 떨어뜨리면 2hbk 로그인이 조용히 풀리므로 그대로 실어 둔다 → stripSensitive()
   */
  nickname?: string;
  userId?: string;
  /**
   * 이메일이 등록되어 있는가. 주소 자체는 더 이상 쿠키에 넣지 않는다 — 안내 띠 판단에는
   * 있는지 없는지만 필요하다. 주소가 필요한 화면은 `/api/me` 로 받는다.
   */
  hasEmail?: boolean;
  /** 자녀 프로필로 들어온 세션 — 헤더 표시용. 권한 판단은 서버가 토큰의 gid 로 한다 */
  child?: boolean;
};

export const SESSION_KEY = "snap_user";
/** 서버가 내리는 표지 쿠키 — "쓸 수 있는 세션이 있다". 토큰은 HttpOnly `snap_session` 에 → lib/sessionCookie.ts */
const SESSION_MARK_COOKIE = "snap_auth";

const SESSION_TTL_SEC = 30 * 24 * 60 * 60;

type StoredPayload = {
  v: 1;
  user: SessionUser;
  /**
   * 앱 서버가 검증하는 HMAC 서명 토큰. 포털이 로그인 때 발급한다.
   *
   * 이 앱은 토큰을 쓰지 않지만 **지워서도 안 된다.** 세션을 다시 저장할 때
   * 토큰을 빠뜨리면, 같은 쿠키를 공유하는 2hbk가 그 세션을 못 쓰게 된다.
   * → my-obsidian-vault / 30-Patterns/인증과 세션 공유.md
   */
  token?: string;
  expiresAt: number;
};

const ENV_COOKIE_DOMAIN: string | undefined =
  typeof process !== "undefined" && process.env?.NEXT_PUBLIC_COOKIE_DOMAIN
    ? process.env.NEXT_PUBLIC_COOKIE_DOMAIN
    : undefined;

function getEffectiveDomain(): string | undefined {
  if (!ENV_COOKIE_DOMAIN) return undefined;
  if (typeof location === "undefined") return undefined;
  const host = location.hostname;
  const domain = ENV_COOKIE_DOMAIN.startsWith(".")
    ? ENV_COOKIE_DOMAIN.slice(1)
    : ENV_COOKIE_DOMAIN;
  if (host === domain || host.endsWith("." + domain)) return ENV_COOKIE_DOMAIN;
  return undefined;
}

function getCookie(name: string): string | null {
  return getCookieValues(name)[0] ?? null;
}

/**
 * 같은 이름의 쿠키를 **전부** 모은다.
 *
 * `.myjane.co.kr` 도메인 쿠키와 host-only 쿠키가 함께 있으면 브라우저가 둘 다 보내고,
 * 어느 쪽이 먼저 오는지는 기대할 수 없다. 첫 줄만 읽으면 낡은 쪽을 집는다.
 */
function getCookieValues(name: string): string[] {
  if (typeof document === "undefined") return [];
  const prefix = name + "=";
  const out: string[] = [];
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(prefix)) continue;
    try {
      out.push(decodeURIComponent(trimmed.substring(prefix.length)));
    } catch {
      /* 못 읽는 값은 버린다 */
    }
  }
  return out;
}

function setCookie(name: string, value: string, maxAgeSec: number) {
  if (typeof document === "undefined") return;
  const isSecure =
    typeof location !== "undefined" && location.protocol === "https:";
  const cookieDomain = getEffectiveDomain();
  let cookie =
    `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAgeSec}; SameSite=Lax`;
  if (cookieDomain) cookie += `; domain=${cookieDomain}`;
  if (isSecure) cookie += "; Secure";
  document.cookie = cookie;
}

function deleteCookie(name: string) {
  if (typeof document === "undefined") return;
  const cookieDomain = getEffectiveDomain();
  if (cookieDomain) {
    document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax; domain=${cookieDomain}`;
  }
  document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax`;
}

function isSessionUser(x: unknown): x is SessionUser {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return typeof o.id === "string";
}

function readPayload(raw: string): StoredPayload | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const o = parsed as Record<string, unknown>;
    if (o.v === 1 && isSessionUser(o.user) && typeof o.expiresAt === "number") {
      return {
        v: 1,
        user: o.user,
        token: typeof o.token === "string" ? o.token : undefined,
        expiresAt: o.expiresAt,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function migrateOldStorageOnce(): void {
  if (typeof window === "undefined") return;
  try {
    // 이전 쿠키 이름(snapword_user)에서 마이그레이션
    const oldKey = "snapword_user";
    const oldRaw = getCookie(oldKey);
    if (oldRaw) {
      const payload = readPayload(oldRaw);
      if (payload && Date.now() <= payload.expiresAt) {
        deleteCookie(oldKey);
        saveSession(payload.user);
        return;
      }
      deleteCookie(oldKey);
    }

    const ssRaw = window.sessionStorage.getItem(SESSION_KEY);
    if (ssRaw) {
      const parsed = JSON.parse(ssRaw) as unknown;
      if (isSessionUser(parsed)) {
        window.sessionStorage.removeItem(SESSION_KEY);
        saveSession(parsed);
        return;
      }
      window.sessionStorage.removeItem(SESSION_KEY);
    }

    const lsRaw = window.localStorage.getItem(SESSION_KEY);
    if (lsRaw) {
      const payload = readPayload(lsRaw);
      if (payload && Date.now() <= payload.expiresAt) {
        window.localStorage.removeItem(SESSION_KEY);
        saveSession(payload.user);
        return;
      }
      window.localStorage.removeItem(SESSION_KEY);
    }
  } catch {
    /* ignore */
  }
}

/** 살아 있는 쿠키 중 **서명 토큰이 있는 것**을 우선해서 고른다 */
function readBestPayload(): StoredPayload | null {
  const now = Date.now();
  const alive = getCookieValues(SESSION_KEY)
    .map(readPayload)
    .filter((p): p is StoredPayload => p !== null && now <= p.expiresAt);

  if (alive.length === 0) return null;
  return alive.find((p) => p.token) ?? alive[0];
}

/** 세션에 담긴 앱 서버용 서명 토큰 */
/**
 * 이 앱에서 **쓸 수 있는** 세션인가.
 * 새 로그인은 토큰을 HttpOnly 쿠키에만 두므로 JS 는 표지 쿠키 `snap_auth` 로 안다.
 * 옛 세션(쿠키 안에 토큰)도 이행기 동안 인정한다 → 30-Patterns/인증과 세션 공유.md
 */
export function hasUsableSession(): boolean {
  return getCookieValues(SESSION_MARK_COOKIE).includes("1");
}

/** 세션에 담긴 앱 서버용 서명 토큰 (옛 형식). 새 로그인에서는 null 이다 — 서버는 쿠키로 확인한다 */
export function loadSessionToken(): string | null {
  if (typeof window === "undefined") return null;
  return readBestPayload()?.token ?? null;
}

export function loadSession(): SessionUser | null {
  if (typeof window === "undefined") return null;
  try {
    migrateOldStorageOnce();

    const raw = getCookie(SESSION_KEY);
    if (!raw) return null;

    const payload = readPayload(raw);
    if (!payload) {
      deleteCookie(SESSION_KEY);
      return null;
    }

    if (Date.now() > payload.expiresAt) {
      deleteCookie(SESSION_KEY);
      return null;
    }

    /* 옛 형식(전화번호·이메일·토큰이 든 쿠키)이면 즉시 떼어 다시 쓴다. 토큰은 서버가 더 읽지 않는다 */
    if (payload.token || "email" in payload.user || "phone" in payload.user) {
      saveSession(payload.user);
      return stripSensitive(payload.user);
    }
    return payload.user;
  } catch {
    return null;
  }
}

/** 표시용 쿠키에 남으면 안 되는 값을 뗀다 */
function stripSensitive(u: SessionUser): SessionUser {
  const { id, name, nickname, userId, hasEmail, child } = u;
  return { id, name, ...(nickname !== undefined ? { nickname } : {}), ...(userId !== undefined ? { userId } : {}), ...(hasEmail !== undefined ? { hasEmail } : {}), ...(child ? { child } : {}) };
}

export function saveSession(user: SessionUser, token?: string) {
  if (typeof window === "undefined") return;

  /*
    토큰을 넘기지 않았으면 **이미 있는 토큰을 그대로 살린다.**
    이 앱은 토큰을 쓰지 않지만 같은 쿠키를 2hbk가 함께 본다. 여기서 세션을
    다시 저장하며 토큰을 떨어뜨리면 2hbk 로그인이 조용히 풀린다.
    단 사람이 바뀌었으면 남의 토큰을 물려줄 수 없으니 버린다.
  */
  /*
    2026-09-09 부터 토큰은 HttpOnly `snap_session` 에만 있다. 이 쿠키에는 **넣지 않는다.**
    `token` 인자는 옛 호출부 호환용이고 무시한다 — 표시용 쿠키에 전화번호·이메일·토큰이 남지 않게
    받은 객체에서 그 셋을 떼고 저장한다.
  */
  void token;
  const carried: string | undefined = undefined;
  user = stripSensitive(user);

  const expiresAt = Date.now() + SESSION_TTL_SEC * 1000;
  const body: StoredPayload = {
    v: 1,
    user,
    ...(carried ? { token: carried } : {}),
    expiresAt,
  };
  setCookie(SESSION_KEY, JSON.stringify(body), SESSION_TTL_SEC);

  try {
    window.localStorage.removeItem(SESSION_KEY);
    window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export function clearSession() {
  if (typeof window === "undefined") return;
  /*
    `snap_session` 은 HttpOnly 라 JS 가 못 지운다. 서버에 지워 달라고 한다.
    페이지가 곧 이동하므로 keepalive. 실패해도 표지·표시 쿠키는 아래서 지운다.
  */
  try {
    void fetch("/api/auth/logout", { method: "POST", keepalive: true }).catch(() => {});
  } catch {
    /* ignore */
  }
  deleteCookie(SESSION_MARK_COOKIE);
  deleteCookie(SESSION_KEY);
  // 이전 쿠키 이름도 정리
  deleteCookie("snapword_user");
  try {
    window.localStorage.removeItem(SESSION_KEY);
    window.sessionStorage.removeItem(SESSION_KEY);
    window.localStorage.removeItem("snapword_user");
    window.sessionStorage.removeItem("snapword_user");
  } catch {
    /* ignore */
  }
}
