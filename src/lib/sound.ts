/**
 * Gambit sound kit — a quiet physical chess board.
 *
 * Procedural WebAudio: short filtered-noise transients (wood contact)
 * over a low sine thump (table resonance). No musical oscillators for
 * game events, no square/saw for anything a player hears often. Each
 * play varies slightly so repetition never becomes a machine loop.
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

/** Perceptual volume mapping: 0–100 slider → linear gain, clamped. */
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

function noise(c: AudioContext): AudioBuffer {
  if (!noiseBuffer) {
    noiseBuffer = c.createBuffer(1, Math.floor(c.sampleRate * 0.12), c.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

/**
 * A wooden piece placed on the board: a bandpassed noise transient
 * (the click of wood on felt) with a soft low thump (table resonance).
 * `intensity` scales loudness and brightness slightly.
 */
function tap(when: number, intensity = 1) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + when;
  const jitter = 0.92 + Math.random() * 0.16; // ±8% — never a machine loop

  const src = c.createBufferSource();
  src.buffer = noise(c);
  const band = c.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 720 * jitter * (0.9 + intensity * 0.15);
  band.Q.value = 1.1;
  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(0.5 * intensity, t0 + 0.004);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.075);
  src.connect(band).connect(env).connect(getMaster(c));
  src.start(t0);
  src.stop(t0 + 0.1);

  const thump = c.createOscillator();
  const thumpGain = c.createGain();
  thump.type = 'sine';
  thump.frequency.setValueAtTime(165 * jitter, t0);
  thump.frequency.exponentialRampToValueAtTime(120, t0 + 0.06);
  thumpGain.gain.setValueAtTime(0.0001, t0);
  thumpGain.gain.linearRampToValueAtTime(0.22 * intensity, t0 + 0.006);
  thumpGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.07);
  thump.connect(thumpGain).connect(getMaster(c));
  thump.start(t0);
  thump.stop(t0 + 0.09);
}

/** A quiet pure tone, only for the restrained game-end phrases. */
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
    tap(0, 0.9);
  },
  capture() {
    // slightly heavier contact: firmer tap plus a soft secondary brush
    tap(0, 1.15);
    tap(0.035, 0.45);
  },
  castle() {
    // two placements, naturally spaced
    tap(0, 0.85);
    tap(0.11, 0.75);
  },
  check() {
    // a normal move plus a firmer, lower placement — no alarm
    tap(0, 0.95);
    tap(0.06, 0.7);
  },
  promote() {
    // a distinctly firmer placement, still a single physical event
    tap(0, 1.25);
    tap(0.05, 0.6);
  },
  illegal() {
    // a short muted dull contact — rejection without a buzz
    const c = ac();
    if (!c) return;
    const t0 = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = noise(c);
    const low = c.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 260;
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(0.28, t0 + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
    src.connect(low).connect(env).connect(getMaster(c));
    src.start(t0);
    src.stop(t0 + 0.07);
  },
  win() {
    tone(330, 0.16, 0.05);
    tone(415, 0.22, 0.05, 0.14);
  },
  lose() {
    tone(277, 0.18, 0.05);
    tone(233, 0.26, 0.05, 0.16);
  },
  draw() {
    tone(311, 0.2, 0.045);
  },
  low() {
    tap(0, 0.4);
  },
  click() {
    tap(0, 0.4);
  },
};

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
