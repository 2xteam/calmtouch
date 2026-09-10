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

/** 펜타토닉 한 옥타브 — 윈드차임 관 다섯 개 */
export const PENTATONIC = [523.25, 587.33, 659.25, 783.99, 880.0];
