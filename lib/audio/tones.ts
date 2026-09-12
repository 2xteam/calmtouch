/**
 * 아주 작은 소리 도구 — Web Audio 만 쓴다(Tone.js 없이).
 * 공이 벽에 닿는 소리, 윈드차임 관이 울리는 소리 정도다.
 *
 * 브라우저는 사용자 제스처 없이 소리를 못 낸다. `ensure()` 는 탭 핸들러 안에서 부른다.
 * 기본은 무음이고 도구 바의 "소리" 버튼으로 켠다.
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

export function ensureAudio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/**
 * 관이 울리는 소리 — 기본음 + 배음 2개, 지수 감쇠. 윈드차임 · 공.
 *   freq  Hz  · vel 0~1 세기 · decay 초
 */
export function chime(freq: number, vel = 0.6, decay = 2.4) {
  const c = ensureAudio();
  if (!c || !master) return;
  const now = c.currentTime;
  const partials: [number, number][] = [
    [1, 1],
    [2.76, 0.35],
    [5.4, 0.12],
  ];
  for (const [ratio, amp] of partials) {
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq * ratio;
    const g = c.createGain();
    const peak = Math.max(0.0001, vel * amp * 0.5);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(peak, now + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, now + decay / ratio);
    osc.connect(g).connect(master);
    osc.start(now);
    osc.stop(now + decay / ratio + 0.05);
  }
}

/** 둥— 하는 짧은 타격음. 공이 벽에 닿을 때. pitch 는 공 크기에 따라 */
export function thud(pitch = 180, vel = 0.5) {
  const c = ensureAudio();
  if (!c || !master) return;
  const now = c.currentTime;
  const osc = c.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(pitch * 1.6, now);
  osc.frequency.exponentialRampToValueAtTime(pitch, now + 0.08);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, vel * 0.6), now + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
  osc.connect(g).connect(master);
  osc.start(now);
  osc.stop(now + 0.3);
}

/**
 * 기계식 스위치(축) 소리 — 축마다 성격이 다르다 (2026-09-12 사용자: "축마다 특성이 있는 소리, 아주 중요").
 *
 *   적축  선형(45g) — 걸림 없이 내려가 바닥에 "탁". 클릭 없음. 맑고 가벼운 바닥 소리
 *   흑축  선형(60g) — 적축보다 무겁고 낮은 "턱". 바닥 소리가 굵다
 *   갈축  택타일(45g) — 중간에 작은 걸림(범프) 잡음이 먼저 살짝, 바닥은 조금 먹먹한 "톡"
 *   청축  클리키(50g) — 클릭 재킷이 튀며 높고 날카로운 "칙" 이 먼저, 바닥 "탁". 손을 떼면 또 한 번 작은 클릭
 *   무접점 정전용량(45g, 러버돔) — 깊고 둥근 "토크"(코토코토). 낮은 몸통이 조금 길고, 돔이 "폭" 하는 중저역 잡음.
 *          손을 떼면 돔이 돌아오는 부드러운 "톡"
 *
 * 소리는 세 조각으로 만든다: 바닥 몸통(사인, 음높이가 빠르게 떨어진다) · 잡음 조각(밴드패스) · 클릭 핑(높은 사인, 아주 짧게).
 * pitch 는 키마다 조금 다르게 (0.9~1.1)
 */
export type SwitchKind = "red" | "blue" | "brown" | "black" | "topre";

type Piece = { body: [number, number, number, number]; noise: [number, number, number, number]; click?: [number, number, number]; bump?: number };
// body: [시작 Hz, 끝 Hz, 길이 s, 세기] · noise: [중심 Hz, Q, 길이 s, 세기] · click: [Hz, 길이 s, 세기] · bump: 범프 잡음 세기
const DOWN: Record<SwitchKind, Piece> = {
  red: { body: [300, 140, 0.075, 0.42], noise: [2000, 0.9, 0.028, 0.42] },
  black: { body: [230, 105, 0.095, 0.55], noise: [1400, 0.9, 0.032, 0.4] },
  brown: { body: [280, 130, 0.08, 0.38], noise: [1500, 1.2, 0.03, 0.3], bump: 0.16 },
  blue: { body: [320, 150, 0.07, 0.36], noise: [2600, 0.8, 0.024, 0.34], click: [4300, 0.022, 0.55] },
  topre: { body: [190, 88, 0.14, 0.62], noise: [650, 1.4, 0.04, 0.5] },
};
const UP: Record<SwitchKind, Piece> = {
  red: { body: [520, 380, 0.03, 0.08], noise: [2600, 1, 0.016, 0.16] },
  black: { body: [480, 340, 0.03, 0.09], noise: [2200, 1, 0.016, 0.16] },
  brown: { body: [520, 380, 0.03, 0.08], noise: [2400, 1, 0.018, 0.18] },
  blue: { body: [560, 400, 0.03, 0.08], noise: [3000, 0.9, 0.016, 0.2], click: [3600, 0.016, 0.3] },
  topre: { body: [260, 150, 0.06, 0.2], noise: [900, 1.4, 0.025, 0.22] },
};

export function keySound(kind: SwitchKind, phase: "down" | "up", pitch = 1) {
  const c = ensureAudio();
  if (!c || !master) return;
  const now = c.currentTime;
  const p = (phase === "down" ? DOWN : UP)[kind];
  let t0 = now;
  // 범프 — 바닥 닿기 직전 아주 작은 걸림 잡음 (갈축)
  if (p.bump) { noiseBurst(c, now, 1100 * pitch, 1.5, 0.014, p.bump); t0 = now + 0.02; }
  // 클릭 — 바닥보다 먼저 (청축)
  if (p.click) {
    const [f, len, vel] = p.click;
    const osc = c.createOscillator(); osc.type = "triangle"; osc.frequency.value = f * pitch;
    const g = c.createGain(); g.gain.setValueAtTime(vel, now); g.gain.exponentialRampToValueAtTime(0.0001, now + len);
    osc.connect(g).connect(master); osc.start(now); osc.stop(now + len + 0.01);
    noiseBurst(c, now, 5200 * pitch, 0.7, 0.008, vel * 0.7);
    t0 = now + 0.012;
  }
  const [f0, f1, blen, bvel] = p.body;
  const osc = c.createOscillator(); osc.type = "sine";
  osc.frequency.setValueAtTime(f0 * pitch, t0); osc.frequency.exponentialRampToValueAtTime(f1 * pitch, t0 + blen * 0.6);
  const g = c.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(bvel, t0 + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t0 + blen);
  osc.connect(g).connect(master); osc.start(t0); osc.stop(t0 + blen + 0.02);
  const [nf, nq, nlen, nvel] = p.noise;
  noiseBurst(c, t0, nf * pitch, nq, nlen, nvel);
}
function noiseBurst(c: AudioContext, at: number, freq: number, q: number, len: number, vel: number) {
  if (!master) return;
  const n = Math.max(8, Math.floor(c.sampleRate * len));
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2;
  const src = c.createBufferSource(); src.buffer = buf;
  const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = freq; bp.Q.value = q;
  const g = c.createGain(); g.gain.setValueAtTime(vel, at); g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  src.connect(bp).connect(g).connect(master); src.start(at); src.stop(at + len + 0.01);
}

/**
 * 톡 — 기계식 키캡이 바닥에 닿는 소리. 짧은 잡음 "틱" + 낮은 몸통 울림 "톡". 키캡 장면.
 *   pitch 0.8~1.2 배율 — 키마다 조금씩 다르게
 */
export function thock(pitch = 1) {
  const c = ensureAudio();
  if (!c || !master) return;
  const now = c.currentTime;
  // 틱 — 아주 짧은 잡음, 높은 대역
  const n = Math.floor(c.sampleRate * 0.03);
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2;
  const src = c.createBufferSource(); src.buffer = buf;
  const hp = c.createBiquadFilter(); hp.type = "bandpass"; hp.frequency.value = 2600 * pitch; hp.Q.value = 0.8;
  const g1 = c.createGain(); g1.gain.setValueAtTime(0.5, now); g1.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
  src.connect(hp).connect(g1).connect(master); src.start(now); src.stop(now + 0.05);
  // 톡 — 낮은 사인 몸통, 빠르게 떨어지는 음높이
  const osc = c.createOscillator(); osc.type = "sine";
  osc.frequency.setValueAtTime(420 * pitch, now); osc.frequency.exponentialRampToValueAtTime(140 * pitch, now + 0.05);
  const g2 = c.createGain(); g2.gain.setValueAtTime(0.0001, now); g2.gain.exponentialRampToValueAtTime(0.45, now + 0.003); g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
  osc.connect(g2).connect(master); osc.start(now); osc.stop(now + 0.13);
}

/**
 * 바삭 — 굳은 왁스가 갈라지는 소리. 짧은 잡음 알갱이 서너 개를 띄엄띄엄.
 * 왁뿌(왁스 뿌시기 볼) 장면. strength 0~1
 */
export function crackle(strength = 0.6) {
  const c = ensureAudio();
  if (!c || !master) return;
  const now = c.currentTime;
  const pops = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < pops; i++) {
    const len = 0.012 + Math.random() * 0.02;
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate * len), c.sampleRate);
    const data = buf.getChannelData(0);
    for (let j = 0; j < data.length; j++) {
      const env = 1 - j / data.length;
      data[j] = (Math.random() * 2 - 1) * env * env;
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1800 + Math.random() * 2600;
    bp.Q.value = 1.2;
    const g = c.createGain();
    g.gain.value = Math.max(0.0001, strength * (0.5 + Math.random() * 0.5) * 0.9);
    src.connect(bp).connect(g).connect(master);
    const at = now + i * (0.02 + Math.random() * 0.05);
    src.start(at);
    src.stop(at + len + 0.01);
  }
}

/** 펜타토닉 한 옥타브 — 윈드차임 관 다섯 개 */
export const PENTATONIC = [523.25, 587.33, 659.25, 783.99, 880.0];
