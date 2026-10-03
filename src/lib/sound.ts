/**
 * Gambit sound kit — REAL quiet physical chessboard samples.
 *
 * Sources (all Creative Commons 0 — verified on each sound's page):
 *   move    freesound.org/s/351518/  "chess move on alabaster"  (trimmed, normalized)
 *   capture freesound.org/s/546121/  "Board Start"              (trimmed, normalized)
 *   illegal freesound.org/s/321083/  "Wooden Click"             (as-is, normalized)
 *   promote freesound.org/s/220200/  "Basic Click Wooden"       (trimmed, normalized)
 * Castle = two move placements; check = base + a quieter capture-contact cue
 * (exactly one cue, decided by classifyMoveSound). Win/lose/draw remain
 * restrained procedural tones (heard once per game).
 * License file: src/assets/sounds/AUDIO-SOURCES.md
 */

import moveUrl from '../assets/sounds/move.mp3';
import captureUrl from '../assets/sounds/capture.mp3';
import illegalUrl from '../assets/sounds/illegal.mp3';
import promoteUrl from '../assets/sounds/promote.mp3';

const SAMPLES: Record<string, string> = {
  move: moveUrl,
  capture: captureUrl,
  illegal: illegalUrl,
  promote: promoteUrl,
};

/** Preloaded Audio elements; cloneNode per play so rapid moves never cut each other. */
const elements = new Map<string, HTMLAudioElement>();
let failed = new Set<string>();

for (const [name, url] of Object.entries(SAMPLES)) {
  try {
    const el = new Audio(url);
    el.preload = 'auto';
    el.load();
    elements.set(name, el);
  } catch {
    failed.add(name);
  }
}

/** Procedural fallback for events without a usable sample. */
function proceduralBrush(level = 0.8) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noise(c);
  const low = c.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.value = 600;
  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(0.3 * level, t0 + 0.003);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.035);
  src.connect(low).connect(env).connect(getMaster(c));
  src.start(t0);
  src.stop(t0 + 0.05);
}

let unlocked = false;
/** Browsers gate audio until a user gesture — unlock on the first one. */
export function unlockAudio(): void {
  if (unlocked) return;
  unlocked = true;
  const move = elements.get('move');
  if (move) {
    const probe = move.cloneNode() as HTMLAudioElement;
    probe.volume = 0;
    probe.play().catch(() => {
      /* a later gesture will retry */
      unlocked = false;
    });
  }
  void ac();
}

function playSample(name: string, gainScale: number, delayMs = 0): void {
  const base = elements.get(name);
  if (!base || failed.has(name)) {
    proceduralBrush(gainScale);
    if (import.meta.env.DEV) console.warn(`[sound] sample "${name}" unavailable — procedural fallback`);
    return;
  }
  const play = () => {
    const el = base.cloneNode() as HTMLAudioElement;
    el.volume = Math.min(1, volumeGain(currentVolume) * gainScale);
    el.play().catch(() => {
      if (import.meta.env.DEV) console.warn(`[sound] "${name}" playback failed — unlock pending?`);
      unlocked = false;
    });
  };
  if (delayMs > 0) window.setTimeout(play, delayMs);
  else play();
}

function proceduralTone(freq: number, dur: number, gain: number, when = 0) {
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
    playSample('move', 1);
  },
  capture() {
    playSample('capture', 1);
  },
  castle() {
    playSample('move', 0.95);
    playSample('move', 0.8, 110);
  },
  check() {
    // CUE-ONLY: the base move/capture/castle sound is already played by the
    // caller (soundForMove via planSoundEvents). This event adds just one
    // subtle heavier contact — never replays the base, never a beep.
    playSample('capture', 0.35, 60);
  },
  promote() {
    playSample('promote', 1);
  },
  illegal() {
    playSample('illegal', 0.9);
  },
  win() {
    proceduralTone(330, 0.16, 0.05);
    proceduralTone(415, 0.2, 0.05, 0.14);
  },
  lose() {
    proceduralTone(277, 0.18, 0.05);
    proceduralTone(233, 0.24, 0.05, 0.16);
  },
  draw() {
    proceduralTone(311, 0.18, 0.04);
  },
  low() {
    proceduralBrush(0.35);
  },
  click() {
    proceduralBrush(0.35);
  },
};


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
