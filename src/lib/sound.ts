/**
 * Tiny synthesized sound kit via WebAudio — no audio assets needed.
 * Volumes are deliberately low and percussive.
 */

let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', when = 0, glideTo?: number) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + when;
  const osc = c.createOscillator();
  const amp = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
  amp.gain.setValueAtTime(0, t0);
  amp.gain.linearRampToValueAtTime(gain, t0 + 0.006);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(amp).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function knock(freq: number, dur: number, gain: number, when = 0) {
  tone(freq, dur, gain, 'triangle', when);
  tone(freq * 2.7, dur * 0.4, gain * 0.4, 'sine', when);
}

export const sounds = {
  move() {
    knock(660, 0.09, 0.12);
  },
  capture() {
    knock(190, 0.13, 0.2);
    tone(120, 0.1, 0.1, 'triangle', 0.02);
  },
  check() {
    tone(880, 0.09, 0.1, 'square');
    tone(1174, 0.12, 0.08, 'square', 0.08);
  },
  castle() {
    knock(520, 0.08, 0.12);
    knock(520, 0.08, 0.12, 0.11);
  },
  promote() {
    tone(523, 0.1, 0.09, 'triangle');
    tone(659, 0.1, 0.09, 'triangle', 0.09);
    tone(784, 0.16, 0.09, 'triangle', 0.18);
  },
  win() {
    tone(523, 0.14, 0.1, 'triangle');
    tone(659, 0.14, 0.1, 'triangle', 0.12);
    tone(784, 0.22, 0.1, 'triangle', 0.24);
  },
  lose() {
    tone(392, 0.16, 0.1, 'triangle');
    tone(311, 0.24, 0.1, 'triangle', 0.14);
  },
  draw() {
    tone(440, 0.16, 0.09, 'triangle');
    tone(440, 0.2, 0.07, 'triangle', 0.16);
  },
  low() {
    tone(1244, 0.07, 0.07, 'sine');
  },
  click() {
    knock(880, 0.05, 0.07);
  },
  illegal() {
    tone(140, 0.09, 0.09, 'sawtooth');
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
