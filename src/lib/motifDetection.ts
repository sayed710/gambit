import { Chess } from 'chess.js';
import type { Color, Square } from 'chess.js';

/* ============================================================
   motifDetection — conservative, deterministic tactical motif
   detector. Every motif is proven from board geometry (attack
   sets, ray intersection, attack/defense counts) or from the
   game state (check/mate). No strategic concepts, no vibes.

   Confidence:
   - confirmed  mechanically proven from the board
   - likely     strongly supported but threat-based (back-rank
                weakness that is not an actual mate)
   Only CONFIRMED motifs feed persistent weakness statistics.
   ============================================================ */

export type MotifType =
  | 'fork'
  | 'double-attack'
  | 'pin-absolute'
  | 'pin-relative'
  | 'skewer'
  | 'hanging'
  | 'discovered-attack'
  | 'discovered-check'
  | 'back-rank';

export type MotifConfidence = 'confirmed' | 'likely';

export interface MotifDetection {
  type: MotifType;
  confidence: MotifConfidence;
  fenBefore: string;
  fenAfter: string;
  actorColor: Color;
  sourceSquare?: Square;
  targetSquares: Square[];
  /** piece letters of involved pieces (attacker first, then targets) */
  involvedPieces: string[];
  /** deterministic key so UI copy can be generated, never stored prose */
  explanationKey: string;
  explanation: string;
}

export interface MotifMoveInput {
  fenBefore: string;
  fenAfter: string;
  san: string;
  from: string;
  to: string;
  color: Color;
}

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

function squareFile(sq: string): number {
  return FILES.indexOf(sq[0]);
}
function squareRank(sq: string): number {
  return parseInt(sq[1], 10);
}
function sq(f: number, r: number): Square | null {
  if (f < 0 || f > 7 || r < 1 || r > 8) return null;
  return `${FILES[f]}${r}` as Square;
}

/** All enemy pieces of `color` on the board: [square, type]. */
function piecesOf(game: Chess, color: Color): [Square, string][] {
  const out: [Square, string][] = [];
  for (const row of game.board()) {
    for (const cell of row) {
      if (cell && cell.color === color) out.push([cell.square, cell.type]);
    }
  }
  return out;
}

/** True when a piece on `from` attacks the enemy piece on `to`. */
function attacksSquare(game: Chess, from: Square, to: Square): boolean {
  return game.attackers(to, game.get(from)!.color).includes(from);
}

/** Squares of enemy pieces (with value >= min) attacked by the piece on `from`. */
function significantTargets(game: Chess, from: Square, enemy: Color, min: number): [Square, string][] {
  const out: [Square, string][] = [];
  for (const [sq0, type] of piecesOf(game, enemy)) {
    if (VALUE[type] < min) continue;
    if (attacksSquare(game, from, sq0)) out.push([sq0, type]);
  }
  return out;
}

/** Number of defenders of a square by color. */
function defendedCount(game: Chess, square: Square, byColor: Color): number {
  return game.attackers(square, byColor).length;
}

/** True when `sq` lies strictly between `a` and `b` on a shared rank/file/diagonal ray. */
function strictlyBetween(a: string, b: string, target: string): boolean {
  if (!alignedRay(a, b) || !alignedRay(a, target) || !alignedRay(b, target)) return false;
  const fa = squareFile(a);
  const ra = squareRank(a);
  const fb = squareFile(b);
  const rb = squareRank(b);
  const ft = squareFile(target);
  const rt = squareRank(target);
  const dFile = Math.sign(fb - fa);
  const dRank = Math.sign(rb - ra);
  const towardB = (dFile === 0 || Math.sign(ft - fa) === dFile) && (dRank === 0 || Math.sign(rt - ra) === dRank);
  const beforeB = (dFile === 0 || Math.abs(ft - fa) < Math.abs(fb - fa)) && (dRank === 0 || Math.abs(rt - ra) < Math.abs(rb - ra));
  const notA = !(ft === fa && rt === ra);
  const notB = !(ft === fb && rt === rb);
  return towardB && beforeB && notA && notB;
}

/** True when two squares share a rank, file, or diagonal ray. */
function alignedRay(a: string, b: string): boolean {
  return squareFile(a) === squareFile(b) || squareRank(a) === squareRank(b) || Math.abs(squareFile(a) - squareFile(b)) === Math.abs(squareRank(a) - squareRank(b));
}

/** Squares strictly between two squares on a ray (exclusive both ends); [] when not aligned. */
function betweenSquares(a: string, b: string): Square[] {
  if (!alignedRay(a, b)) return [];
  const out: Square[] = [];
  const fa = squareFile(a);
  const ra = squareRank(a);
  const fb = squareFile(b);
  const rb = squareRank(b);
  const dFile = Math.sign(fb - fa);
  const dRank = Math.sign(rb - ra);
  let f = fa + dFile;
  let r = ra + dRank;
  let guard = 0;
  while ((f !== fb || r !== rb) && guard < 16) {
    const s = sq(f, r);
    if (s) out.push(s);
    f += dFile;
    r += dRank;
    guard += 1;
  }
  return out;
}

function mk(
  type: MotifType,
  confidence: MotifConfidence,
  input: MotifMoveInput,
  sourceSquare: Square | undefined,
  targetSquares: Square[],
  involvedPieces: string[],
  explanation: string,
): MotifDetection {
  return {
    type,
    confidence,
    fenBefore: input.fenBefore,
    fenAfter: input.fenAfter,
    actorColor: input.color,
    sourceSquare,
    targetSquares,
    involvedPieces,
    explanationKey: `${type}:${input.san}:${targetSquares.slice().sort().join('+')}`,
    explanation,
  };
}

/** Piece name for generated copy. */
const NAME: Record<string, string> = {
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king',
};

/** True when the SAME absolute pin (slider shielding the king) already
 * existed before the move — a pre-existing pin must not be attributed to
 * an unrelated move. */
function absolutePinExisted(
  before: Chess,
  kingSq: Square,
  victSq: Square,
  victType: string,
  sliderSq: Square,
  mine: Color,
  enemy: Color,
): boolean {
  const kingBefore = before.get(kingSq);
  const victBefore = before.get(victSq);
  const sliderBefore = before.get(sliderSq);
  if (!kingBefore || kingBefore.color !== enemy || kingBefore.type !== 'k') return false;
  if (!victBefore || victBefore.color !== enemy || victBefore.type !== victType) return false;
  if (!sliderBefore || sliderBefore.color !== mine) return false;
  if (!strictlyBetween(sliderSq, kingSq, victSq)) return false;
  const probe = new Chess(before.fen());
  try {
    probe.remove(victSq);
  } catch {
    return false;
  }
  return probe.attackers(kingSq, mine).includes(sliderSq);
}

/** Pins, proven mechanically by removing a piece and re-checking king safety. */
function pinDetections(after: Chess, before: Chess, input: MotifMoveInput, enemy: Color): MotifDetection[] {
  const out: MotifDetection[] = [];
  const kingSq = piecesOf(after, enemy).find(([, t]) => t === 'k')?.[0];
  if (!kingSq) return out;

  for (const [victSq, victType] of piecesOf(after, enemy)) {
    if (victType === 'k') continue;
    const probe = new Chess(after.fen());
    try {
      probe.remove(victSq);
    } catch {
      continue;
    }
    // the victim must be shielded along a line from some slider to the king:
    // geometrically, the victim sits strictly between that slider and the king
    const shielded = piecesOf(after, input.color).some(([sliderSq, sliderType]) => {
      if (sliderType !== 'b' && sliderType !== 'r' && sliderType !== 'q') return false;
      return strictlyBetween(sliderSq, kingSq, victSq);
    });
    if (!shielded) continue;
    const xRayAttackers = probe.attackers(kingSq, input.color).filter((a) => {
      const p = after.get(a);
      return !!p && (p.type === 'b' || p.type === 'r' || p.type === 'q');
    });
    if (xRayAttackers.length === 0) continue;
    // confirmed absolute pin: without this piece the king is attacked
    const sliderSq = xRayAttackers[0];
    const sliderType = after.get(sliderSq)?.type ?? 'q';
    if (absolutePinExisted(before, kingSq, victSq, victType, sliderSq, input.color, enemy)) continue; // not created by this move
    out.push(
      mk(
        'pin-absolute',
        'confirmed',
        input,
        sliderSq as Square,
        [victSq],
        [sliderType, victType],
        `${NAME[sliderType][0].toUpperCase() + NAME[sliderType].slice(1)} pin: the ${NAME[victType]} on ${victSq} cannot move — the king on ${kingSq} would be exposed to the ${NAME[sliderType]} on ${sliderSq}.`,
      ),
    );
  }
  return out;
}

/** True when c lies beyond b on the straight line through a and b (a, b, c collinear, ordered). */
function alignedThrough(a: string, b: string, c: string): boolean {
  const fa = squareFile(a);
  const ra = squareRank(a);
  const fb = squareFile(b);
  const rb = squareRank(b);
  const fc = squareFile(c);
  const rc = squareRank(c);
  const dFile1 = fb - fa;
  const dRank1 = rb - ra;
  const dFile2 = fc - fb;
  const dRank2 = rc - rb;
  // collinear (cross product zero) and same direction
  const cross = dFile1 * dRank2 - dRank1 * dFile2;
  const dot = dFile1 * dFile2 + dRank1 * dRank2;
  return cross === 0 && dot > 0;
}

/** True when the same skewer ray (slider, front, behind) existed before. */
function skewerExisted(
  before: Chess,
  from0: Square,
  frontSq: Square,
  frontType: string,
  behindSq: Square,
  behindType: string,
  mine: Color,
  enemy: Color,
): boolean {
  const sliderBefore = before.get(from0);
  const frontBefore = before.get(frontSq);
  const behindBefore = before.get(behindSq);
  if (!sliderBefore || sliderBefore.color !== mine) return false;
  if (!frontBefore || frontBefore.color !== enemy || frontBefore.type !== frontType) return false;
  if (!behindBefore || behindBefore.color !== enemy || behindBefore.type !== behindType) return false;
  if (!attacksSquare(before, from0, frontSq)) return false;
  return betweenSquares(from0, frontSq).every((b) => before.get(b) === undefined || b === from0 || b === frontSq);
}

/** Skewer: attacker -> higher-value enemy piece -> lower-value enemy piece, all on one ray. */
function skewerDetections(after: Chess, before: Chess, input: MotifMoveInput, enemy: Color): MotifDetection[] {
  const out: MotifDetection[] = [];
  for (const [from0, type0] of piecesOf(after, input.color)) {
    if (type0 !== 'b' && type0 !== 'r' && type0 !== 'q') continue;
    for (const [frontSq, frontType] of piecesOf(after, enemy)) {
      if (!attacksSquare(after, from0, frontSq)) continue;
      const between = betweenSquares(from0, frontSq);
      if (between.some((b) => after.get(b))) continue; // must be a clean ray to the front piece
      const frontValue = frontType === 'k' ? 999 : VALUE[frontType]; // the king outranks everything
      const dFile = Math.sign(squareFile(frontSq) - squareFile(from0));
      const dRank = Math.sign(squareRank(frontSq) - squareRank(from0));
      // candidate squares behind the front piece
      let f = squareFile(frontSq) + dFile;
      let r = squareRank(frontSq) + dRank;
      while (f >= 0 && f <= 7 && r >= 1 && r <= 8) {
        const behindSq = sq(f, r)!;
        const behindPiece = after.get(behindSq);
        if (behindPiece && behindPiece.color === enemy && behindPiece.type !== 'k' && VALUE[behindPiece.type] < frontValue) {
          if (skewerExisted(before, from0, frontSq, frontType, behindSq, behindPiece.type, input.color, enemy)) break; // pre-existing
          out.push(
            mk(
              'skewer',
              'confirmed',
              input,
              from0,
              [frontSq, behindSq],
              [type0, frontType, behindPiece.type],
              `${NAME[type0][0].toUpperCase() + NAME[type0].slice(1)} skewer: the ${NAME[frontType]} on ${frontSq} stands in front of the ${NAME[behindPiece.type]} on ${behindSq} on the same line.`,
            ),
          );
          break;
        }
        if (behindPiece) break; // any piece on the ray stops the geometry
        f += dFile;
        r += dRank;
      }
      void dFile;
      void dRank;
    }
  }
  return out;
}

/** Fork / double attack by the moved piece. */
function forkDetections(after: Chess, input: MotifMoveInput, enemy: Color): MotifDetection[] {
  const to = input.to as Square;
  const moved = after.get(to);
  if (!moved || moved.color !== input.color) return [];
  // the king always counts; otherwise two targets worth >= 3 total (pawn-only double attacks excluded)
  const targets = significantTargets(after, to, enemy, 0);
  const significant = targets.filter(([, type]) => type === 'k' || VALUE[type] >= 3);
  if (significant.length >= 2) {
    const hasKing = significant.some(([, t]) => t === 'k');
    const values = significant.reduce((sum, [, t]) => sum + VALUE[t], 0);
    const isFork = moved.type === 'n' || moved.type === 'p' || hasKing;
    const type: MotifType = isFork ? 'fork' : 'double-attack';
    const label = isFork
      ? `${NAME[moved.type][0].toUpperCase() + NAME[moved.type].slice(1)} fork`
      : 'Double attack';
    const detail = significant.map(([sq0, t]) => `${NAME[t]} on ${sq0}`).join(' and ');
    return [
      mk(
        type,
        'confirmed',
        input,
        to,
        significant.map(([sq0]) => sq0),
        [moved.type, ...significant.map(([, t]) => t)],
        `${label}: the ${NAME[moved.type]} on ${to} attacks ${detail}${hasKing ? ' (king included)' : ` — combined value ${values}`}.`,
      ),
    ];
  }
  // double-attack also covers two rook+ targets attacked along a line even at lower value? no — keep conservative.
  return [];
}

/** Hanging piece: attacked and completely undefended (value >= 3), created/exposed by the move. */
function hangingDetections(after: Chess, before: Chess, input: MotifMoveInput, enemy: Color): MotifDetection[] {
  const out: MotifDetection[] = [];
  for (const [sq0, type] of piecesOf(after, enemy)) {
    if (type === 'k' || VALUE[type] < 3) continue;
    const attackedBy = after.attackers(sq0, input.color);
    if (attackedBy.length === 0) continue;
    if (defendedCount(after, sq0, enemy) > 0) continue;
    // must be NEWLY hanging (the move created/exposed it), not a pre-existing condition
    if (before.get(sq0)?.type === type) {
      const wasAttacked = before.attackers(sq0, input.color).length > 0;
      const wasDefended = defendedCount(before, sq0, enemy) > 0;
      if (wasAttacked && !wasDefended) continue; // already hanging before the move
    }
    const attackerSq = attackedBy[0];
    const attackerType = after.get(attackerSq)?.type ?? '?';
    out.push(
      mk(
        'hanging',
        'confirmed',
        input,
        attackerSq as Square,
        [sq0],
        [attackerType, type],
        `Hanging ${NAME[type]}: the ${NAME[type]} on ${sq0} is attacked by the ${NAME[attackerType]} on ${attackerSq} and has no defender.`,
      ),
    );
  }
  return out;
}

/** Discovered attack / check: the moved piece uncovers a slider's attack. */
function discoveredDetections(
  before: Chess,
  after: Chess,
  input: MotifMoveInput,
  enemy: Color,
): MotifDetection[] {
  const out: MotifDetection[] = [];
  const movedFrom = input.from as Square;
  const movedWas = before.get(movedFrom);
  if (!movedWas || movedWas.color !== input.color) return out;
  if (movedWas.type !== 'n' && movedWas.type !== 'p') return out; // only leapers create simple discoveries

  for (const [sliderSq, sliderType] of piecesOf(after, input.color)) {
    if (sliderType !== 'b' && sliderType !== 'r' && sliderType !== 'q') continue;
    if (sliderSq === input.to) continue; // the moved piece landing square is not a discovery
    for (const [targetSq, targetType] of piecesOf(after, enemy)) {
      // the ray from the slider to this target must pass through the vacated square
      if (!betweenSquares(sliderSq, targetSq).includes(movedFrom)) continue;
      if (!attacksSquare(after, sliderSq, targetSq)) continue;
      if (before.attackers(targetSq, input.color).includes(sliderSq)) continue; // attack existed before
      if (targetType === 'k') {
        out.push(
          mk(
            'discovered-check',
            'confirmed',
            input,
            sliderSq,
            [targetSq],
            [sliderType, 'k'],
            `Discovered check: moving the ${NAME[movedWas.type]} from ${movedFrom} uncovered the ${NAME[sliderType]} on ${sliderSq}, checking the king on ${targetSq}.`,
          ),
        );
      } else if (VALUE[targetType] >= 5) {
        out.push(
          mk(
            'discovered-attack',
            'confirmed',
            input,
            sliderSq,
            [targetSq],
            [sliderType, targetType],
            `Discovered attack: the ${NAME[movedWas.type]} left ${movedFrom}, uncovering the ${NAME[sliderType]} on ${sliderSq} against the ${NAME[targetType]} on ${targetSq}.`,
          ),
        );
      }
      break; // first newly-attacked target on this slider's ray is enough
    }
  }
  return out;
}

/** Back-rank weakness / mate. CONFIRMED only when it is an actual mate. */
function backRankDetections(after: Chess, input: MotifMoveInput, enemy: Color): MotifDetection[] {
  const kingSq = piecesOf(after, enemy).find(([, t]) => t === 'k')?.[0];
  if (!kingSq) return [];
  const backRank = enemy === 'w' ? 1 : 8;
  if (squareRank(kingSq) !== backRank) return [];

  // an actor rook/queen on the enemy back rank
  const heavy = piecesOf(after, input.color).find(([sq0, t]) => (t === 'r' || t === 'q') && squareRank(sq0) === backRank);
  if (!heavy) return [];

  if (after.isCheckmate()) {
    return [
      mk(
        'back-rank',
        'confirmed',
        input,
        heavy[0],
        [kingSq],
        [heavy[1], 'k'],
        `Back-rank mate: the ${NAME[heavy[1]]} on ${heavy[0]} mates the king on ${kingSq}, trapped on its own back rank.`,
      ),
    ];
  }

  // likely weakness: the king's back-rank flight squares are attacked or blocked
  const f = squareFile(kingSq);
  const adjacents = [sq(f - 1, backRank), sq(f + 1, backRank)].filter((s0): s0 is Square => !!s0);
  const noFlight = adjacents.every((s0) => {
    const piece = after.get(s0);
    if (piece && piece.color === enemy) return true;
    return after.attackers(s0, input.color).some((a) => {
      const p = after.get(a);
      return p && (p.type === 'r' || p.type === 'q');
    });
  });
  if (after.isCheck() && noFlight) {
    return [
      mk(
        'back-rank',
        'likely',
        input,
        heavy[0],
        [kingSq],
        [heavy[1], 'k'],
        `Back-rank weakness: the ${NAME[heavy[1]]} on ${heavy[0]} checks the king on ${kingSq}, which has no back-rank escape.`,
      ),
    ];
  }
  return [];
}

/** Run every detector over one move. */
/** True when the same relative pin geometry existed before the move. */
function relativePinExisted(
  before: Chess,
  victSq: Square,
  victType: string,
  behindSq: Square,
  behindType: string,
  sliderSq: Square,
  mine: Color,
  enemy: Color,
): boolean {
  const victBefore = before.get(victSq);
  const behindBefore = before.get(behindSq);
  const sliderBefore = before.get(sliderSq);
  if (!victBefore || victBefore.color !== enemy || victBefore.type !== victType) return false;
  if (!behindBefore || behindBefore.color !== enemy || behindBefore.type !== behindType) return false;
  if (!sliderBefore || sliderBefore.color !== mine) return false;
  const probe = new Chess(before.fen());
  try {
    probe.remove(victSq);
  } catch {
    return false;
  }
  return probe.attackers(behindSq, mine).includes(sliderSq) && alignedThrough(sliderSq, victSq, behindSq);
}

/** Relative pin: removing piece E newly exposes a MORE valuable enemy piece to one of our sliders. */
function relativePinDetections(after: Chess, before: Chess, input: MotifMoveInput, enemy: Color): MotifDetection[] {
  const out: MotifDetection[] = [];
  for (const [victSq, victType] of piecesOf(after, enemy)) {
    if (victType === 'k') continue;
    const probe = new Chess(after.fen());
    try {
      probe.remove(victSq);
    } catch {
      continue;
    }
    for (const [behindSq, behindType] of piecesOf(after, enemy)) {
      if (behindSq === victSq || behindType === 'k') continue;
      if (VALUE[behindType] <= VALUE[victType]) continue;
      // a slider of ours must now attack `behindSq` through the removed square
      const through = after
        .attackers(behindSq, input.color)
        .filter(() => false); // pre-move attacks are recomputed on the probe
      void through;
      const newAttackers = probe.attackers(behindSq, input.color).filter((a) => {
        const p = probe.get(a);
        return p && (p.type === 'b' || p.type === 'r' || p.type === 'q');
      });
      if (newAttackers.length === 0) continue;
      const sliderSq = newAttackers[0];
      if (!alignedThrough(sliderSq, victSq, behindSq)) continue;
      const sliderType = after.get(sliderSq)?.type ?? 'q';
      if (relativePinExisted(before, victSq, victType, behindSq, behindType, sliderSq, input.color, enemy)) continue; // pre-existing
      out.push(
        mk(
          'pin-relative',
          'confirmed',
          input,
          sliderSq as Square,
          [victSq, behindSq],
          [sliderType, victType, behindType],
          `${NAME[sliderType][0].toUpperCase() + NAME[sliderType].slice(1)} relative pin: the ${NAME[victType]} on ${victSq} shields the more valuable ${NAME[behindType]} on ${behindSq} from the ${NAME[sliderType]} on ${sliderSq}.`,
        ),
      );
      break;
    }
  }
  return out;
}

export function detectMotifs(input: MotifMoveInput): MotifDetection[] {
  const before = new Chess();
  try {
    before.load(input.fenBefore);
  } catch {
    return [];
  }
  const after = new Chess();
  try {
    after.load(input.fenAfter);
  } catch {
    return [];
  }
  const enemy: Color = input.color === 'w' ? 'b' : 'w';

  const discovered = discoveredDetections(before, after, input, enemy);
  const discoveredTargets = new Set(discovered.flatMap((d) => d.targetSquares));

  const out: MotifDetection[] = [
    ...forkDetections(after, input, enemy),
    ...pinDetections(after, before, input, enemy),
    ...relativePinDetections(after, before, input, enemy),
    ...skewerDetections(after, before, input, enemy),
    ...hangingDetections(after, before, input, enemy).filter(
      (h) => !discoveredTargets.has(h.targetSquares[0]),
    ),
    ...discovered,
    ...backRankDetections(after, input, enemy),
  ];

  // one detection per type (keep the highest-value evidence), stable order
  const seen = new Set<MotifType>();
  const unique: MotifDetection[] = [];
  for (const d of out) {
    if (seen.has(d.type)) continue;
    seen.add(d.type);
    unique.push(d);
  }
  return unique;
}

/** Detect the motifs a candidate move would create, without touching a game. */
export function detectMotifsForMove(fenBefore: string, san: string): { motifs: MotifDetection[]; fenAfter: string } | null {
  const game = new Chess();
  try {
    game.load(fenBefore);
  } catch {
    return null;
  }
  let move;
  try {
    move = game.move(san);
  } catch {
    return null;
  }
  if (!move) return null;
  return {
    motifs: detectMotifs({
      fenBefore,
      fenAfter: game.fen(),
      san: move.san,
      from: move.from,
      to: move.to,
      color: move.color,
    }),
    fenAfter: game.fen(),
  };
}
