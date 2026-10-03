/* ============================================================
   moveSound — pure sound-event selection for a chess move.

   Exactly ONE coherent chain per move: a base physical sound
   (move / capture / castle / promote) plus at most one subtle
   check layer. Checkmate never layers check — the game-end
   phrase carries the moment. The referee (useGame.commitMove)
   consumes this so duplicate check playback is impossible.
   ============================================================ */

export type MoveSoundBase = 'move' | 'capture' | 'castle' | 'promote';

export interface MoveSoundPlan {
  base: MoveSoundBase;
  /** one subtle check cue, never stacked */
  checkLayer: boolean;
  /** 'lose-or-win' = the caller plays its win/lose phrase instead of more move audio */
  endSound: 'lose-or-win' | null;
}

export interface MoveSoundInput {
  san: string;
  capture: boolean;
  promotion: boolean;
}

import type { SoundName } from './sound';

/**
 * The exact playback chain for a graded move. 'check' is a cue-only event
 * (sounds.check adds one subtle contact); the base never replays inside it.
 */
export function planSoundEvents(plan: MoveSoundPlan): SoundName[] {
  const events: SoundName[] = [plan.base];
  if (plan.checkLayer) events.push('check');
  return events;
}

export function classifyMoveSound(m: MoveSoundInput): MoveSoundPlan {
  const isCastle = m.san.startsWith('O-O');
  const base: MoveSoundBase = m.promotion ? 'promote' : isCastle ? 'castle' : m.capture ? 'capture' : 'move';
  const checkmate = m.san.includes('#');
  const checkLayer = !checkmate && m.san.includes('+');
  return { base, checkLayer, endSound: checkmate ? 'lose-or-win' : null };
}
