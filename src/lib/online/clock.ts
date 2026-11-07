/* Pure server-clock projection — the client NEVER owns authoritative
   time. Given the last authoritative snapshot (remaining ms per side +
   whose turn_started_at the server stamped), this projects what each
   clock should display right now, against any `now` (testable with a
   deterministic clock). */

export interface ClockSnapshot {
  turn: 'w' | 'b';
  turn_started_at: string | null;
  white_ms_remaining: number;
  black_ms_remaining: number;
  status: string;
}

export interface ProjectedClocks {
  white: number;
  black: number;
  /** the side whose clock is expected to flag first */
  flagged: 'w' | 'b' | null;
}

export function projectClocks(s: ClockSnapshot, now: number): ProjectedClocks {
  let white = s.white_ms_remaining;
  let black = s.black_ms_remaining;
  if (s.status === 'active' && s.turn_started_at) {
    const elapsed = Math.max(0, now - new Date(s.turn_started_at).getTime());
    if (s.turn === 'w') white = Math.max(0, white - elapsed);
    else black = Math.max(0, black - elapsed);
  }
  const flagged =
    s.status !== 'active' || !s.turn_started_at
      ? null
      : (s.turn === 'w' ? white : black) <= 0
        ? s.turn
        : null;
  return { white, black, flagged };
}

/** format ms as m:ss or, under 20 seconds, m:ss.t for the tense phase */
export function formatClock(ms: number): string {
  const clamped = Math.max(0, ms);
  const totalSeconds = Math.floor(clamped / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  if (clamped < 20000) {
    const tenths = Math.floor((clamped % 1000) / 100);
    return `${m}:${String(s).padStart(2, '0')}.${tenths}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** time-control label, e.g. "10 | 0 · Rapid" */
export function formatTimeControl(baseMs: number, incrementMs: number): string {
  const base = Math.round(baseMs / 1000);
  const inc = Math.round(incrementMs / 1000);
  const kind = base <= 120 ? 'Bullet' : base <= 300 ? 'Blitz' : base <= 900 ? 'Rapid' : 'Classical';
  return `${base / 60 | 0} | ${inc} · ${kind}`;
}
