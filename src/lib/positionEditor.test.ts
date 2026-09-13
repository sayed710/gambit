import { describe, expect, it } from 'vitest';
import {
  availableCastling,
  buildFen,
  placementFromFen,
  startingPlacement,
  validatePosition,
  type PiecePlacement,
} from './positionEditor';

describe('position editor — FEN building', () => {
  it('builds the standard start position from the starting placement', () => {
    const fen = buildFen(startingPlacement(), 'w', { K: true, Q: true, k: true, q: true }, '-');
    expect(fen).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  });

  it('serializes empty ranks and mixed placements correctly', () => {
    const placement: PiecePlacement = { e1: { c: 'w', t: 'k' }, e4: { c: 'w', t: 'p' }, e8: { c: 'b', t: 'k' } };
    const fen = buildFen(placement, 'w', { K: false, Q: false, k: false, q: false }, '-');
    expect(fen).toBe('4k3/8/8/8/4P3/8/8/4K3 w - - 0 1');
  });

  it('includes en-passant and halfmove fields', () => {
    const placement: PiecePlacement = { e4: { c: 'w', t: 'p' }, e8: { c: 'b', t: 'k' }, a1: { c: 'w', t: 'k' } };
    const fen = buildFen(placement, 'b', { k: true, q: true, K: false, Q: false }, 'e3');
    const parts = fen.split(' ');
    expect(parts[1]).toBe('b');
    expect(parts[2]).toBe('kq');
    expect(parts[3]).toBe('e3');
    expect(parts[4]).toBe('0');
  });
});

describe('position editor — castling availability', () => {
  it('only offers rights when king and rooks are home', () => {
    const full = availableCastling(startingPlacement());
    expect(full).toEqual({ K: true, Q: true, k: true, q: true });
    const partial: PiecePlacement = {
      e1: { c: 'w', t: 'k' },
      h1: { c: 'w', t: 'r' }, // queenside rook gone
      e8: { c: 'b', t: 'k' },
      a8: { c: 'b', t: 'r' }, // kingside rook gone
    };
    expect(availableCastling(partial)).toEqual({ K: true, Q: false, k: false, q: true });
  });
});

describe('position editor — validation', () => {
  it('accepts the start position', () => {
    expect(validatePosition(buildFen(startingPlacement(), 'w', { K: true, Q: true, k: true, q: true }, '-')).ok).toBe(true);
  });

  it('rejects a missing king', () => {
    const placement: PiecePlacement = { e4: { c: 'w', t: 'k' }, d5: { c: 'w', t: 'q' } };
    const r = validatePosition(buildFen(placement, 'w', { K: false, Q: false, k: false, q: false }, '-'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/black king/i);
  });

  it('rejects two white kings', () => {
    const placement: PiecePlacement = { e4: { c: 'w', t: 'k' }, d5: { c: 'w', t: 'k' }, e8: { c: 'b', t: 'k' } };
    const r = validatePosition(buildFen(placement, 'w', { K: false, Q: false, k: false, q: false }, '-'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/white king/i);
  });

  it('rejects pawns on the back ranks', () => {
    const placement: PiecePlacement = { e4: { c: 'w', t: 'k' }, e8: { c: 'b', t: 'k' }, d8: { c: 'w', t: 'p' } };
    const r = validatePosition(buildFen(placement, 'w', { K: false, Q: false, k: false, q: false }, '-'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/pawn/i);
  });

  it('rejects a position where the side not to move is already in check', () => {
    // black to move, but white king is attacked — the side NOT to move is in check
    const placement: PiecePlacement = {
      a1: { c: 'w', t: 'k' },
      a8: { c: 'b', t: 'k' },
      b2: { c: 'b', t: 'q' }, // the black queen on b2 attacks the white king on a1 while black is not to move
    };
    const r = validatePosition(buildFen(placement, 'b', { K: false, Q: false, k: false, q: false }, '-'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/check/i);
  });

  it('round trips through placementFromFen', () => {
    const fen = '4k3/8/8/8/4P3/8/8/4K3 w - - 0 1';
    const placement = placementFromFen(fen);
    expect(placement.e4).toEqual({ c: 'w', t: 'p' });
    expect(buildFen(placement, 'w', { K: false, Q: false, k: false, q: false }, '-')).toBe(fen);
  });
});
