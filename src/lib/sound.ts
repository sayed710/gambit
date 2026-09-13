/**
 * Gambit sound kit — minimal neutral board contact.
 *
 * STATUS: SAMPLE SOURCING UNRESOLVED (this pass). Kenney's CC0 packs moved
 * behind an interactive itch.io gate and Wikimedia Commons holds no clean
 * chess-audio set, so gameplay events stay procedural but deliberately
 * ANTI-MUSICAL: one very short lowpassed noise brush per action, no pitched
 * thump, no tonal identity — the previous 720Hz-bandpass + sine-thump design
 * failed user testing precisely because of its tonal character. Replace this
 * file wholesale with licensed physical samples when sourcing is resolved.
 * AUDIO: INCOMPLETE by the project's own acceptance bar.
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = volumeGain(currentVolume);
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function getMaster(c: AudioContext): GainNode {
  if (!master) {
    master = c.createGain();
    master.gain.value = volumeGain(currentVolume);
    master.connect(c.destination);
  }
  return master;
}

function noise(c: AudioContext): AudioBuffer {
  if (!noiseBuffer) {
    noiseBuffer = c.createBuffer(1, Math.floor(c.sampleRate * 0.12), c.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

/**
 * The one gameplay gesture: a 35ms lowpassed noise brush. No resonant
 * filters, no oscillators — nothing to recognize, nothing to fatigue on.
 */
function brush(when: number, level: number) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + when;
  const jitter = 0.94 + Math.random() * 0.12;

  const src = c.createBufferSource();
  src.buffer = noise(c);
  const low = c.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.value = 600 * jitter;
  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(0.3 * level, t0 + 0.003);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.035);
  src.connect(low).connect(env).connect(getMaster(c));
  src.start(t0);
  src.stop(t0 + 0.05);
}

/** Restrained pure tone — game-end phrases only, once per game. */
function tone(freq: number, dur: number, gain: number, when = 0) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + when;
  const osc = c.createOscillator();
  const amp = c.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.linearRampToValueAtTime(gain, t0 + 0.015);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(amp).connect(getMaster(c));
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

export const sounds = {
  move() {
    brush(0, 0.8);
  },
  capture() {
    // same brush, marginally fuller — not louder-dramatic
    brush(0, 1.05);
  },
  castle() {
    brush(0, 0.8);
    brush(0.1, 0.7);
  },
  check() {
    // identical contact; the board highlight and status carry the information
    brush(0, 0.85);
  },
  promote() {
    brush(0, 1.0);
  },
  illegal() {
    brush(0, 0.5);
  },
  win() {
    tone(330, 0.16, 0.04);
    tone(415, 0.2, 0.04, 0.14);
  },
  lose() {
    tone(277, 0.18, 0.04);
    tone(233, 0.24, 0.04, 0.16);
  },
  draw() {
    tone(311, 0.18, 0.035);
  },
  low() {
    brush(0, 0.35);
  },
  click() {
    brush(0, 0.35);
  },
};
/** Perceptual volume mapping: 0-100 slider to linear gain, clamped. */
export function volumeGain(v: number): number {
  const clamped = Math.max(0, Math.min(100, v)) / 100;
  return Math.round(Math.pow(clamped, 1.4) * 1000) / 1000;
}

let currentVolume = 35;
export function setSoundVolume(v: number): void {
  currentVolume = Math.max(0, Math.min(100, Math.round(v)));
  if (master && ctx) {
    master.gain.setTargetAtTime(volumeGain(currentVolume), ctx.currentTime, 0.01);
  }
}

export type SoundName = keyof typeof sounds;

let enabled = true;
export function setSoundEnabled(v: boolean) {
  enabled = v;
}
export function playSound(name: SoundName) {
  if (!enabled) return;
  try {
    sounds[name]();
  } catch {
    /* audio unavailable — never break the game for a sound */
  }
}
