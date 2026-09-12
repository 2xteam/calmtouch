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
