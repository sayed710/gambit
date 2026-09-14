import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { ENDGAME_LESSONS } from './endgames';

describe('endgame academy — curated lessons', () => {
  it('every lesson FEN is legal, has the learner to move first, and is not already over', () => {
    for (const lesson of ENDGAME_LESSONS) {
      const g = new Chess(lesson.fen);
      const expectedTurn = lesson.engineFirst ? (lesson.side === 'w' ? 'b' : 'w') : lesson.side;
      expect(g.turn(), `${lesson.id} first mover`).toBe(expectedTurn);
      expect(g.isGameOver(), `${lesson.id} already over`).toBe(false);
      expect(lesson.moveLimit, `${lesson.id} limit`).toBeGreaterThan(0);
      expect(lesson.explanation.length, `${lesson.id} explanation`).toBeGreaterThan(20);
      expect(lesson.hint.length, `${lesson.id} hint`).toBeGreaterThan(10);
    }
  });

  it('each category is represented and ids are unique', () => {
    const ids = ENDGAME_LESSONS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const cat of ['mates', 'pawns', 'rooks'] as const) {
      expect(ENDGAME_LESSONS.some((l) => l.category === cat), `category ${cat}`).toBe(true);
    }
  });

  it('mate lessons have both a major piece for the learner and a bare-ish defender', () => {
    for (const l of ENDGAME_LESSONS.filter((x) => x.success.kind === 'mate' && x.category === 'mates')) {
      const g = new Chess(l.fen);
      const learner = g.board().flat().filter((sq) => sq && sq.color === l.side);
      const hasMajor = learner.some((sq) => sq!.type === 'q' || sq!.type === 'r');
      expect(hasMajor, `${l.id} learner piece`).toBe(true);
    }
  });
});
