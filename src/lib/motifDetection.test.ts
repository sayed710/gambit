import { describe, expect, it } from 'vitest';
import { detectMotifsForMove, type MotifDetection } from './motifDetection';

/** Apply a move and detect the motifs it creates. */
function detect(fenBefore: string, san: string): MotifDetection[] {
  return detectMotifsForMove(fenBefore, san)!.motifs;
}

const types = (ds: MotifDetection[]) => ds.map((d) => d.type);

describe('motif detection — confirmed tactical motifs', () => {
  it('knight fork: Nc7+ hits king and rook', () => {
    const ds = detect('r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1', 'Nc7+');
    expect(types(ds)).toContain('fork');
    const fork = ds.find((d) => d.type === 'fork')!;
    expect(fork.confidence).toBe('confirmed');
    expect(fork.targetSquares.sort()).toEqual(['a8', 'e8'].sort());
    expect(fork.explanation).toMatch(/fork/i);
  });

  it('pawn fork: c3 attacks two knights', () => {
    const ds = detect('4k3/8/8/8/1n1n4/8/2P5/4K3 w - - 0 1', 'c3');
    expect(types(ds)).toContain('fork');
    const fork = ds.find((d) => d.type === 'fork')!;
    expect(fork.targetSquares.sort()).toEqual(['b4', 'd4'].sort());
    expect(fork.involvedPieces).toContain('n');
  });

  it('double attack: queen hits two rooks along a rank', () => {
    const ds = detect('4k3/8/8/r3r3/8/8/8/3Q1K2 w - - 0 1', 'Qd5');
    expect(types(ds)).toContain('double-attack');
    const da = ds.find((d) => d.type === 'double-attack')!;
    expect(da.targetSquares.sort()).toEqual(['a5', 'e5'].sort());
  });

  it('absolute pin: Bb5 pins Nc6 to the king (remove-proof)', () => {
    const ds = detect('4k3/ppp5/2n5/8/8/8/PPPP1PPP/4KB1R w KQkq - 0 1', 'Bb5');
    const pin = ds.find((d) => d.type === 'pin-absolute');
    expect(pin).toBeDefined();
    expect(pin!.confidence).toBe('confirmed');
    expect(pin!.targetSquares).toContain('c6');
    expect(pin!.explanation).toMatch(/pin/i);
  });

  it('relative pin: Bg5 pins Nf6 behind the queen (remove-proof)', () => {
    const ds = detect('rnb1kb1r/ppppqppp/5n2/8/3P4/8/PPP1PPPP/RNBQKB1R w KQkq - 0 1', 'Bg5');
    const pin = ds.find((d) => d.type === 'pin-relative');
    expect(pin).toBeDefined();
    expect(pin!.targetSquares).toEqual(['f6', 'e7']);
    expect(pin!.explanation).toMatch(/pin/i);
  });

  it('skewer: Rd1+ king in front, rook behind on the file', () => {
    const ds = detect('3r4/8/8/3k4/8/8/8/R3K3 w - - 0 1', 'Rd1+');
    expect(types(ds)).toContain('skewer');
    const sk = ds.find((d) => d.type === 'skewer')!;
    expect(sk.confidence).toBe('confirmed');
    expect(sk.targetSquares).toEqual(['d5', 'd8']);
  });

  it('hanging piece: Bf3 newly attacks the undefended queen', () => {
    const ds = detect('4k3/8/8/3q4/8/8/4B3/4K3 w - - 0 1', 'Bf3');
    expect(types(ds)).toContain('hanging');
    const h = ds.find((d) => d.type === 'hanging')!;
    expect(h.targetSquares).toContain('d5');
    expect(h.involvedPieces).toContain('q');
    expect(h.confidence).toBe('confirmed');
  });

  it('discovered attack: Nd4-c6 uncovers Bb2 against the h8 rook', () => {
    const ds = detect('7r/k7/8/8/3N4/8/1B6/4K3 w - - 0 1', 'Nc6');
    expect(types(ds)).toContain('discovered-attack');
    expect(types(ds)).not.toContain('discovered-check');
    const da = ds.find((d) => d.type === 'discovered-attack')!;
    expect(da.targetSquares).toContain('h8');
    expect(da.involvedPieces).toContain('b'); // revealed attacker is the bishop
  });

  it('discovered check: Nc3 moves uncover Bb2 against the e5 king', () => {
    const ds = detect('8/8/8/4k3/8/2N5/1B6/4K3 w - - 0 1', 'Nb5');
    expect(types(ds)).toContain('discovered-check');
    const dc = ds.find((d) => d.type === 'discovered-check')!;
    expect(dc.targetSquares).toContain('e5');
    expect(dc.confidence).toBe('confirmed');
  });

  it('back-rank mate pattern is confirmed', () => {
    const ds = detect('6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1', 'Re8#');
    expect(types(ds)).toContain('back-rank');
    const br = ds.find((d) => d.type === 'back-rank')!;
    expect(br.confidence).toBe('confirmed');
    expect(br.explanation).toMatch(/back rank/i);
  });
});

describe('motif detection — false-positive guards', () => {
  it('double attack on two pawns only is NOT significant', () => {
    // Nxe5 attacks the c6 and f7 pawns — combined value 2, no king: no motif
    const ds = detect('4k3/8/2p5/2p1p3/8/5N2/8/4K3 w - - 0 1', 'Nxe5');
    const sig = ds.filter((d) => d.type === 'fork' || d.type === 'double-attack');
    expect(sig).toHaveLength(0);
  });

  it('aligned pieces without a real pin are not labeled', () => {
    // Bb2-h8 attacks the corner with nothing between — no pin anywhere
    const ds = detect('4k3/8/8/8/8/8/1B6/4K3 w - - 0 1', 'Bh8');
    expect(ds.find((d) => d.type === 'pin-absolute' || d.type === 'pin-relative')).toBeUndefined();
  });

  it('attacked but adequately defended piece is NOT hanging', () => {
    // Bf3 attacks Qd5 — the black king on e6 defends it
    const ds = detect('8/8/4k3/3q4/8/8/4B3/4K3 w - - 0 1', 'Bf3');
    expect(ds.find((d) => d.type === 'hanging')).toBeUndefined();
  });

  it('rook on the back rank with an escape square is NOT a back-rank motif', () => {
    // king e8 has d8 free (only f7 pawn) — no back-rank weakness
    const ds = detect('4k3/5p2/8/8/8/8/8/4RNK1 w - - 0 1', 'Nh2');
    expect(ds.find((d) => d.type === 'back-rank')).toBeUndefined();
  });

  it('ordinary knight move without targets produces nothing', () => {
    const ds = detect('4k3/8/8/8/8/8/8/4N1K1 w - - 0 1', 'Nd3');
    const significant = ds.filter((d) => d.confidence === 'confirmed');
    expect(significant).toHaveLength(0);
  });
});
