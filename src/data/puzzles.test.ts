import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { PUZZLES } from './puzzles';

/** Every curated puzzle must be legal and its solution must be playable. */
describe('curated puzzle set integrity', () => {
  it('has no duplicate ids and every FEN/solution is legal', () => {
    const ids = new Set(PUZZLES.map((p) => p.id));
    expect(ids.size).toBe(PUZZLES.length);
    for (const p of PUZZLES) {
      const g = new Chess(p.fen);
      const matches = g.moves({ verbose: true }).filter((m) => m.san.replace(/[+#]/g, '') === p.solution.replace(/[+#]/g, ''));
      expect(matches.length, `${p.id}: solution ${p.solution} must be legal`).toBeGreaterThan(0);
    }
  });

  it('mate puzzles end in checkmate when the solution is played', () => {
    for (const p of PUZZLES.filter((x) => x.theme === 'mate1')) {
      const g = new Chess(p.fen);
      g.move(p.solution);
      expect(g.isCheckmate(), `${p.id}: ${p.solution} must be mate`).toBe(true);
    }
  });

  it('the mate-in-2 solution forces mate against every defence', () => {
    for (const p of PUZZLES.filter((x) => x.theme === 'mate2')) {
      const g = new Chess(p.fen);
      g.move(p.solution);
      expect(g.isCheckmate()).toBe(false); // mate comes on move two, not one
      const replies = g.moves({ verbose: true });
      expect(replies.length).toBeGreaterThan(0);
      for (const reply of replies) {
        g.move(reply);
        const mates = g.moves({ verbose: true }).filter((m) => {
          g.move(m);
          const mate = g.isCheckmate();
          g.undo();
          return mate;
        });
        g.undo();
        expect(mates.length, `${p.id}: defence ${reply.san} must be answerable by mate`).toBeGreaterThan(0);
      }
    }
  });

  it('fork solutions attack two or more enemy pieces', () => {
    for (const p of PUZZLES.filter((x) => x.theme === 'fork')) {
      const g = new Chess(p.fen);
      const m = g.move(p.solution);
      const enemy = p.sideToMove === 'w' ? 'b' : 'w';
      const attacked = g
        .board()
        .flat()
        .filter((sq) => sq && sq.color === enemy && g.attackers(sq.square, p.sideToMove).includes(m.to));
      expect(attacked.length, `${p.id}: ${p.solution} must attack 2+ pieces`).toBeGreaterThanOrEqual(2);
      g.undo();
    }
  });

  it('pin solutions create an absolute pin against the king', () => {
    for (const p of PUZZLES.filter((x) => x.theme === 'pin')) {
      const g = new Chess(p.fen);
      const m = g.move(p.solution);
      const enemy = p.sideToMove === 'w' ? 'b' : 'w';
      // some enemy piece must now be pinned: attacked with the enemy king behind it
      const attacked = g
        .board()
        .flat()
        .filter((sq): sq is NonNullable<typeof sq> => !!sq && sq.color === enemy && sq.type !== 'k' && g.attackers(sq.square, p.sideToMove).includes(m.to));
      const pinned = attacked.some((sq) => {
        const kingSq = g.board().flat().find((s) => s && s.color === enemy && s.type === 'k');
        if (!kingSq) return false;
        // same ray from the attacking piece through sq to the king
        const from = { f: m.to.charCodeAt(0) - 97, r: parseInt(m.to[1], 10) };
        const mid = { f: sq.square.charCodeAt(0) - 97, r: parseInt(sq.square[1], 10) };
        const king = { f: kingSq.square.charCodeAt(0) - 97, r: parseInt(kingSq.square[1], 10) };
        const df = Math.sign(mid.f - from.f);
        const dr = Math.sign(mid.r - from.r);
        if (Math.sign(king.f - mid.f) !== df || Math.sign(king.r - mid.r) !== dr) return false;
        if (df !== 0 && Math.abs(king.f - mid.f) % Math.abs(df) !== 0) return false;
        return true;
      });
      expect(pinned, `${p.id}: ${p.solution} must pin a piece to the king`).toBe(true);
      g.undo();
    }
  });

  it('skewer solutions attack a piece with a more valuable target behind it', () => {
    for (const p of PUZZLES.filter((x) => x.theme === 'skewer')) {
      const g = new Chess(p.fen);
      const m = g.move(p.solution);
      const enemy = p.sideToMove === 'w' ? 'b' : 'w';
      const VAL: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 200 };
      const from = { f: m.to.charCodeAt(0) - 97, r: parseInt(m.to[1], 10) };
      const skewered = g
        .board()
        .flat()
        .some((sq) => {
          if (!sq || sq.color !== enemy) return false;
          if (!g.attackers(sq.square, p.sideToMove).includes(m.to)) return false;
          const t = { f: sq.square.charCodeAt(0) - 97, r: parseInt(sq.square[1], 10) };
          const df = Math.sign(t.f - from.f);
          const dr = Math.sign(t.r - from.r);
          let f = t.f + df;
          let r = t.r + dr;
          while (f >= 0 && f <= 7 && r >= 1 && r <= 8) {
            const beyond = g.board()[8 - r][f];
            if (beyond) {
              if (beyond.color !== enemy) return false;
              // king in front: any enemy piece behind is skewered;
              // otherwise the piece behind must be more valuable
              return sq.type === 'k' ? true : VAL[beyond.type] > VAL[sq.type];
            }
            f += df;
            r += dr;
          }
          return false;
        });
      expect(skewered, `${p.id}: ${p.solution} must skewer toward a more valuable piece`).toBe(true);
      g.undo();
    }
  });

  it('hanging-piece solutions capture an undefended target', () => {
    for (const p of PUZZLES.filter((x) => x.theme === 'hanging')) {
      const g = new Chess(p.fen);
      const m = g.move(p.solution);
      expect(m.captured, `${p.id}: ${p.solution} must be a capture`).toBeTruthy();
      const enemy = p.sideToMove === 'w' ? 'b' : 'w';
      expect(g.attackers(m.to, enemy).length, `${p.id}: target must be undefended`).toBe(0);
      g.undo();
    }
  });

  it('discovered solutions unmask a rook check', () => {
    for (const p of PUZZLES.filter((x) => x.theme === 'discovered')) {
      const g = new Chess(p.fen);
      g.move(p.solution);
      expect(g.isCheck(), `${p.id}: the move must unmask a check`).toBe(true);
      const checkers = g.isCheck() ? g.moves({ verbose: true }).length >= 0 : false;
      void checkers;
      // the checking piece must be the rook, not the moved knight
      const turn = g.turn();
      const kingSquare = g.board().flat().find((sq): sq is NonNullable<typeof sq> => !!sq && sq.type === 'k' && sq.color === turn)!.square;
      const attackers = g.attackers(kingSquare, turn === 'w' ? 'b' : 'w');
      const attackerType = attackers.map((sq) => g.get(sq)?.type);
      expect(attackerType).toContain('r');
    }
  });
});
