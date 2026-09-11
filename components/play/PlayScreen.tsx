"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ENGINES } from "@/lib/engines/index";
import { EngineUnsupportedError, type SceneEngine } from "@/lib/engines/types";
import { loadColor, rememberRecent, saveColor } from "@/lib/recent";
import type { Scene } from "@/lib/scenes";

/**
 * 장면 하나를 전체 화면으로 띄우는 플레이어.
 *
 * 엔진은 모른다 — `lib/engines/index.ts` 에서 장면의 `engine` 키로 지연 로드하고,
 * 입력 네 가지(포인터 · 휠 · 기울기 · 흐름)와 도구(지우기 · 색 · 소리)를 넘겨 준다.
 *
 * UI 는 탭(pointerdown)하면 나타나고 3초 뒤 사라진다. 문지르는 동안에는 늘리지 않는다 —
 * 손을 움직이는 내내 버튼이 떠 있으면 화면을 만지는 느낌이 깨진다.
 */

/** 도구 패널 열림 상태를 기억하는 키 — 기기마다 한 번 정하면 그대로 */
const PANEL_KEY = "calmtouch:panel";
const IDLE_BEFORE_DRIFT_MS = 2200;
const DRIFT_EVERY_MS = 1700;
const TILT_EVERY_MS = 120;

type Status = "loading" | "ok" | "no";

export function PlayScreen({ scene }: { scene: Scene }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<SceneEngine | null>(null);
  const router = useRouter();

  const [status, setStatus] = useState<Status>("loading");
  const [reason, setReason] = useState<string>("");
  /** 도구 패널 — 처음엔 접혀 있고, 연 채로 나가면 다음에도 열려 있다 */
  const [panelOpen, setPanelOpen] = useState(false);
  const [drift, setDrift] = useState(scene.idleDrift);
  const [tilt, setTilt] = useState(false);
  const [tiltAvailable, setTiltAvailable] = useState(false);
  const [sound, setSound] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [canFullscreen, setCanFullscreen] = useState(false);
  const [color, setColor] = useState<string>(scene.color.kind === "single" ? scene.color.defaultColor : "#eef7f8");
  /** 기울기 안내 — 켰는데 센서 값이 안 오면 왜인지 알려 준다 */
  const [tiltNote, setTiltNote] = useState<string>("");
  const lastOrientationAt = useRef(0);
  const [colorReady, setColorReady] = useState(false);

  /* 이벤트 핸들러가 최신 설정을 읽도록 ref 에 비춘다 */
  const settings = useRef({ drift, tilt });
  useEffect(() => {
    settings.current = { drift, tilt };
  }, [drift, tilt]);

  const togglePanel = useCallback(() => {
    setPanelOpen((v) => {
      try { window.localStorage.setItem(PANEL_KEY, v ? "0" : "1"); } catch { /* 시크릿 모드 등 */ }
      return !v;
    });
  }, []);

  const tiltBase = useRef<{ beta: number; gamma: number } | null>(null);
  const tiltNow = useRef<{ beta: number; gamma: number } | null>(null);

  // ── 첫 렌더: 기기 능력 · 저장된 색 (렌더 중에 document 를 보면 hydration 이 어긋난다) ──
  useEffect(() => {
    setTiltAvailable("DeviceOrientationEvent" in window);
    setCanFullscreen(!!document.documentElement.requestFullscreen);
    if (scene.color.kind === "single") {
      const saved = loadColor(scene.slug);
      if (saved) setColor(saved);
    }
    setColorReady(true);
    rememberRecent(scene.slug);
    try { setPanelOpen(window.localStorage.getItem(PANEL_KEY) === "1"); } catch { /* ignore */ }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPanelOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scene]);

  // ── 엔진 로드 · 입력 연결 ────────────────────────────────
  useEffect(() => {
    if (!colorReady) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let engine: SceneEngine | null = null;
    let cleanup: (() => void) | null = null;

    const load = ENGINES[scene.engine];
    if (!load) {
      setReason("이 장면은 아직 준비 중이에요");
      setStatus("no");
      return;
    }
    load()
      .then((factory) => {
        if (cancelled) return;
        try {
          engine = factory(canvas, { scene, color, sound: false });
        } catch (e) {
          setReason(e instanceof EngineUnsupportedError ? e.message : "이 장면을 그리는 중에 문제가 생겼어요");
          setStatus("no");
          return;
        }
        engineRef.current = engine;
        setStatus("ok");

        let lastActive = performance.now();
        const pressed = new Set<number>();
        const last = new Map<number, { x: number; y: number }>();
        let lastMouse = { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 };
        const local = (e: { clientX: number; clientY: number }) => {
          const r = canvas.getBoundingClientRect();
          return { x: e.clientX - r.left, y: e.clientY - r.top };
        };

        const onDown = (e: PointerEvent) => {
          const { x, y } = local(e);
          const id = e.pointerType === "mouse" ? 0 : e.pointerId;
          pressed.add(id);
          last.set(id, { x, y });
          lastActive = performance.now();
          engine!.pointerDown(x, y, id);
        };
        const onMove = (e: PointerEvent) => {
          const { x, y } = local(e);
          const id = e.pointerType === "mouse" ? 0 : e.pointerId;
          if (e.pointerType === "mouse") lastMouse = { x, y };
          const prev = last.get(id);
          last.set(id, { x, y });
          if (!prev) {
            if (e.pointerType !== "mouse") return;
            engine!.pointerMove(x, y, 0, 0, id, false);
            return;
          }
          const dx = x - prev.x;
          const dy = y - prev.y;
          if (dx === 0 && dy === 0) return;
          const isPressed = pressed.has(id) || e.pointerType !== "mouse";
          if (isPressed || e.pointerType === "mouse") lastActive = performance.now();
          engine!.pointerMove(x, y, dx, dy, id, isPressed);
        };
        const onUp = (e: PointerEvent) => {
          const id = e.pointerType === "mouse" ? 0 : e.pointerId;
          pressed.delete(id);
          if (e.pointerType !== "mouse") last.delete(id);
          engine!.pointerUp(id);
        };
        const onLeave = (e: PointerEvent) => {
          const id = e.pointerType === "mouse" ? 0 : e.pointerId;
          pressed.delete(id);
          last.delete(id);
          engine!.pointerUp(id);
        };
        const onWheel = (e: WheelEvent) => {
          e.preventDefault();
          lastActive = performance.now();
          engine!.wheel(lastMouse.x, lastMouse.y, Math.max(-80, Math.min(80, e.deltaY)));
        };
        const onOrientation = (e: DeviceOrientationEvent) => {
          if (e.beta == null || e.gamma == null) return;
          lastOrientationAt.current = performance.now();
          tiltNow.current = { beta: e.beta, gamma: e.gamma };
          if (!tiltBase.current) tiltBase.current = { beta: e.beta, gamma: e.gamma };
        };
        const onVisibility = () => {
          if (document.hidden) engine!.stop();
          else engine!.start();
        };

        canvas.addEventListener("pointerdown", onDown);
        canvas.addEventListener("pointermove", onMove);
        canvas.addEventListener("pointerup", onUp);
        canvas.addEventListener("pointercancel", onLeave);
        canvas.addEventListener("pointerleave", onLeave);
        canvas.addEventListener("wheel", onWheel, { passive: false });
        window.addEventListener("deviceorientation", onOrientation);
        // 일부 안드로이드 크롬은 absolute 쪽으로만 값을 준다
        window.addEventListener("deviceorientationabsolute", onOrientation as EventListener);
        document.addEventListener("visibilitychange", onVisibility);

        const driftTimer = window.setInterval(() => {
          if (!settings.current.drift) return;
          if (performance.now() - lastActive < IDLE_BEFORE_DRIFT_MS) return;
          engine!.idle();
        }, DRIFT_EVERY_MS);

        const tiltTimer = window.setInterval(() => {
          if (!settings.current.tilt || !tiltBase.current || !tiltNow.current) return;
          const fx = Math.max(-1, Math.min(1, (tiltNow.current.gamma - tiltBase.current.gamma) / 30));
          const fy = Math.max(-1, Math.min(1, -(tiltNow.current.beta - tiltBase.current.beta) / 30));
          if (Math.hypot(fx, fy) < 0.08) return;
          lastActive = performance.now();
          engine!.tilt(fx, fy);
        }, TILT_EVERY_MS);

        engine.start();

        cleanup = () => {
          canvas.removeEventListener("pointerdown", onDown);
          canvas.removeEventListener("pointermove", onMove);
          canvas.removeEventListener("pointerup", onUp);
          canvas.removeEventListener("pointercancel", onLeave);
          canvas.removeEventListener("pointerleave", onLeave);
          canvas.removeEventListener("wheel", onWheel);
          window.removeEventListener("deviceorientation", onOrientation);
          window.removeEventListener("deviceorientationabsolute", onOrientation as EventListener);
          document.removeEventListener("visibilitychange", onVisibility);
          window.clearInterval(driftTimer);
          window.clearInterval(tiltTimer);
        };
      })
      .catch(() => {
        if (cancelled) return;
        setReason("장면을 불러오지 못했어요. 네트워크를 확인하고 다시 열어 주세요");
        setStatus("no");
      });

    return () => {
      cancelled = true;
      cleanup?.();
      engine?.dispose();
      engineRef.current = null;
    };
    // color 는 처음 값만 넘기고 이후는 setColor 로 전달한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorReady, scene]);

  // ── 전체 화면 ─────────────────────────────────────────────
  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = async () => {
    const el = rootRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await el.requestFullscreen();
    } catch {
      /* iOS Safari 는 requestFullscreen 이 없다 — 홈 화면에 추가하면 standalone 으로 뜬다 */
    }
  };

  const toggleTilt = async () => {
    if (tilt) {
      setTilt(false);
      setTiltNote("");
      tiltBase.current = null;
      return;
    }
    // https 가 아니면 브라우저가 센서 이벤트를 보내지 않는다 (localhost 는 예외)
    if (typeof window !== "undefined" && window.location.protocol !== "https:" && window.location.hostname !== "localhost") {
      setTiltNote("기울기는 https 로 열었을 때만 돼요. 주소를 확인해 주세요.");
      return;
    }
    // iOS 13+ — 사용자 동작 안에서 허용을 받아야 한다. 이 함수는 버튼 클릭 핸들러다
    const D = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
    if (D?.requestPermission) {
      try {
        const r = await D.requestPermission();
        if (r !== "granted") {
          setTiltNote("동작 센서 접근이 허용되지 않았어요. 설정 › Safari › 동작 및 방향 접근을 켜 주세요.");
          return;
        }
      } catch {
        setTiltNote("동작 센서 허용을 요청하지 못했어요. 페이지를 새로 열고 다시 눌러 주세요.");
        return;
      }
    }
    tiltBase.current = null;
    setTilt(true);
    setTiltNote("기울기 켬 — 센서 값을 기다려요…");
    const started = performance.now();
    window.setTimeout(() => {
      if (lastOrientationAt.current >= started) setTiltNote("");
      else setTiltNote("센서 값이 오지 않아요. 브라우저 사이트 설정에서 '움직임 센서'가 허용돼 있는지 확인해 주세요.");
    }, 1800);
  };

  const pickColor = (hex: string) => {
    setColor(hex);
    saveColor(scene.slug, hex);
    engineRef.current?.setColor?.(hex);
  };

  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    engineRef.current?.setSound?.(next);
  };

  const clear = () => {
    engineRef.current?.clear();
  };

  /**
   * 뒤로 — 목록에서 들어왔으면 **브라우저 뒤로가기**로 돌아간다. 그래야 보던 스크롤 자리가 그대로다.
   * `/scenes` 로 새로 이동하면 목록 맨 위로 튄다(2026-09-11 사용자 지적).
   * 링크로 바로 들어와 이 앱 안의 이전 페이지가 없으면 목록으로 이동한다.
   */
  const goBack = () => {
    const cameFromApp = document.referrer.startsWith(window.location.origin) && window.history.length > 1;
    if (cameFromApp) router.back();
    else router.push("/scenes");
  };

  return (
    <div ref={rootRef} className="play">
      <canvas ref={canvasRef} className="play-canvas" aria-label={`${scene.title} 장면`} />

      {status === "no" ? (
        <div className="play-unsupported">
          <p className="eyebrow">NOT AVAILABLE</p>
          <h1 className="headline">이 장면을 열 수 없어요</h1>
          <p className="lead">{reason}</p>
          <Link className="btn btn--ghost" href="/scenes" style={{ marginTop: 18 }}>
            장면 목록으로
          </Link>
        </div>
      ) : null}

      <div className="play-bar">
        <button type="button" className="play-btn" aria-label="장면 목록으로" onClick={goBack}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          type="button"
          className="play-btn play-fab"
          aria-label={panelOpen ? "도구 닫기" : "도구 열기"}
          aria-expanded={panelOpen}
          aria-controls="play-panel"
          onClick={togglePanel}
        >
          {panelOpen ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              <circle cx="9" cy="7" r="2.2" fill="var(--footer-bg)" stroke="currentColor" strokeWidth="2" />
              <circle cx="15" cy="12" r="2.2" fill="var(--footer-bg)" stroke="currentColor" strokeWidth="2" />
              <circle cx="10" cy="17" r="2.2" fill="var(--footer-bg)" stroke="currentColor" strokeWidth="2" />
            </svg>
          )}
        </button>
      </div>

      {/* 도구 패널 — 떠 있는 카드. 열고 닫는 건 오직 사용자다 (저절로 숨지 않는다 · 2026-09-11 사용자 지적) */}
      <section id="play-panel" className="play-panel" data-open={panelOpen ? "yes" : "no"} aria-hidden={!panelOpen} aria-label="장면 도구">
        <div className="play-title">
          <span className="play-title-name">{scene.title}</span>
          <span className="play-title-sub">{scene.subtitle}</span>
        </div>

        <div className="play-tools">
          <Toggle label="흐름" on={drift} onClick={() => setDrift((v) => !v)} />
          {scene.sound ? <Toggle label="소리" on={sound} onClick={toggleSound} /> : null}
          {tiltAvailable && scene.tilt !== false ? <Toggle label="기울기" on={tilt} onClick={toggleTilt} /> : null}
        </div>
        {tiltNote ? <p className="play-note">{tiltNote}</p> : null}

        {scene.color.kind === "single" ? (
          <div className="play-chips" role="group" aria-label="색 고르기">
            {scene.color.presets.map((hex) => (
              <button
                key={hex}
                type="button"
                className="play-chip"
                style={{ background: hex }}
                aria-label={`색 ${hex}`}
                aria-pressed={color.toLowerCase() === hex.toLowerCase()}
                onClick={() => pickColor(hex)}
              />
            ))}
            <label className="play-chip play-chip--custom" title="직접 고르기">
              <input type="color" value={color} onChange={(e) => pickColor(e.target.value)} aria-label="직접 고르기" />
              <span aria-hidden="true">+</span>
            </label>
          </div>
        ) : null}

        <div className="play-actions">
          <button type="button" className="play-btn play-btn--label" onClick={clear}>
            지우기
          </button>
          {canFullscreen ? (
            <button type="button" className="play-btn play-btn--label" onClick={toggleFullscreen}>
              {fullscreen ? "창으로" : "전체 화면"}
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}

/**
 * 켬/끔 스위치 — 켜지면 진하게, 꺼지면 흐리게. 상태는 색이 아니라 **손잡이 자리와 밝기**로도 읽힌다.
 * 글자에 "켬/끔" 을 붙이지 않는다 — 스위치가 그 말을 대신한다.
 */
function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button type="button" className="play-toggle" role="switch" aria-checked={on} onClick={onClick}>
      <span className="play-toggle-track" aria-hidden="true">
        <span className="play-toggle-knob" />
      </span>
      <span className="play-toggle-label">{label}</span>
    </button>
  );
}
