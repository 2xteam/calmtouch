"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AppIcon } from "@/components/AppIcon";
import { ScrollProgress } from "@/components/ScrollProgress";
import { loginUrl, usesPortal } from "@/lib/portal";
import { clearSession } from "@/lib/session";
import { useSession } from "@/lib/useSession";

/** 앱의 주된 기능 — 데스크톱 상단에 그대로 노출 */
const nav = [
  { href: "/home", label: "Home" },
  { href: "/scenes", label: "Scenes" },
];

/** 자기 앱은 빼고 나머지를 넣는다 → my-obsidian-vault / 20-Design/앱 공통 UI와 아이콘.md */
const otherApps = [
  { name: "SnapWord", iconUrl: "/snapword-link-icon.png", href: "https://snapword.myjane.co.kr/home" },
  { name: "SnapNote", iconUrl: "/snapnote-link-icon.png", href: "https://snapnote.myjane.co.kr/home" },
  { name: "FitLog", iconUrl: "/fitlog-link-icon.png", href: "https://fitlog.myjane.co.kr/home" },
  { name: "2hbk", iconUrl: "/2hbk-link-icon.png", href: "https://2hbk.myjane.co.kr/home" },
  { name: "TypeLog", iconUrl: "/typelog-link-icon.png", href: "https://typelog.myjane.co.kr/home" },
];

/**
 * 상단 내비 — 다섯 앱과 같은 모양이다.
 *
 * 이 앱은 로그인 없이 쓰므로 More 메뉴에 부가 기능이 아직 없다. 로그인한 사람에게는
 * Logout 을, 운영 도메인의 익명 사용자에게는 Login 을 보인다. localhost 에서는 포털
 * 세션이 돌아오지 않아 둘 다 감춘다 → lib/portal.ts
 */
export function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const session = useSession();
  const [open, setOpen] = useState(false);
  const [appMenu, setAppMenu] = useState(false);
  const [moreMenu, setMoreMenu] = useState(false);
  const [portal, setPortal] = useState(false);
  const appMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setPortal(usesPortal()), []);

  const logout = () => {
    clearSession();
    router.replace("/");
  };

  useEffect(() => {
    if (!appMenu) return;
    const onClick = (e: MouseEvent) => {
      if (appMenuRef.current && !appMenuRef.current.contains(e.target as Node)) setAppMenu(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [appMenu]);

  useEffect(() => {
    if (!moreMenu) return;
    const onClick = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) setMoreMenu(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [moreMenu]);

  // 경로가 바뀌면 열린 메뉴를 닫는다
  useEffect(() => {
    setMoreMenu(false);
    setAppMenu(false);
    setOpen(false);
  }, [pathname]);

  const signedIn = session.status === "signed-in";
  const showLogin = session.status === "anonymous" && portal;

  return (
    <>
      {open && <div className="topnav-backdrop" onClick={() => setOpen(false)} />}

      <nav className={`topnav ${open ? "topnav--open" : ""}`}>
        <div className="topnav-bar">
          <div className="topnav-logo-wrap" ref={appMenuRef}>
            <button type="button" className="topnav-logo" onClick={() => setAppMenu((v) => !v)}>
              <AppIcon size={28} alt="" priority className="topnav-logo-icon" />
              <span style={{ fontWeight: 900, letterSpacing: "-0.02em" }}>CalmTouch</span>
              <ChevronIcon open={appMenu} />
            </button>
            {appMenu && (
              <div className="app-switcher">
                {otherApps.map((app) => (
                  <a key={app.name} href={app.href} className="app-switcher-item" onClick={() => setAppMenu(false)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={app.iconUrl} alt={app.name} width={28} height={28} className="app-switcher-icon" />
                    <span style={{ fontWeight: 800, letterSpacing: "-0.02em" }}>{app.name}</span>
                  </a>
                ))}
              </div>
            )}
          </div>

          <div className="topnav-links">
            {nav.map(({ href, label }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link key={href} href={href} className="topnav-link" data-active={active}>
                  {label}
                </Link>
              );
            })}
            {showLogin ? (
              <a href={loginUrl(pathname || "/home")} className="topnav-link">
                Login
              </a>
            ) : null}
            {signedIn ? (
              <div className="topnav-more-wrap" ref={moreMenuRef}>
                <button
                  type="button"
                  className="topnav-link topnav-more"
                  onClick={() => setMoreMenu((v) => !v)}
                  aria-expanded={moreMenu}
                >
                  More
                  <ChevronIcon open={moreMenu} />
                </button>
                {moreMenu && (
                  <div className="topnav-more-menu">
                    <button
                      type="button"
                      onClick={() => {
                        setMoreMenu(false);
                        logout();
                      }}
                      className="topnav-more-item topnav-more-item--danger"
                    >
                      Logout
                    </button>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          <button
            type="button"
            className={`topnav-hamburger ${open ? "topnav-hamburger--open" : ""}`}
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? "메뉴 닫기" : "메뉴 열기"}
          >
            <span className="topnav-hamburger-line topnav-hamburger-line--1" />
            <span className="topnav-hamburger-line topnav-hamburger-line--2" />
            <span className="topnav-hamburger-line topnav-hamburger-line--3" />
          </button>

          {/* 스크롤 진행 띠 — .topnav 가 아니라 **.topnav-bar** 안에 둔다.
              .topnav 은 햄버거를 열면 메뉴만큼 키가 자라서, 그 아래 변에
              붙이면 띠가 메뉴 밑으로 내려가 버린다 */}
          <ScrollProgress />
        </div>

        <div className="topnav-menu">
          {nav.map(({ href, label }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                className="topnav-menu-link"
                data-active={active}
                data-sub={false}
                onClick={() => setOpen(false)}
              >
                {label}
              </Link>
            );
          })}
          {showLogin ? (
            <a href={loginUrl(pathname || "/home")} className="topnav-menu-link" data-sub={true}>
              Login
            </a>
          ) : null}
          {signedIn ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                logout();
              }}
              className="topnav-menu-link topnav-menu-logout"
            >
              Logout
            </button>
          ) : null}
        </div>
      </nav>
    </>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      style={{
        transition: "transform 0.2s",
        transform: open ? "rotate(180deg)" : "none",
        flexShrink: 0,
        position: "relative",
        top: 2,
      }}
    >
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
