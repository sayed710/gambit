import type { Color } from 'chess.js';

/* ============================================================
   Endgame Academy — curated, tablebase-verified lessons.

   Every FEN below was checked against the lichess 7-piece
   tablebase (tablebase.lichess.ovh, free endpoint) at authoring
   time; the recorded WDL category and DTM come from that check.
   Success/failure detection at runtime is mechanical:
   - mate lessons  : checkmate delivered by the learner inside the
                     move limit (the engine defends)
   - survive lesson: reach the move limit without being mated and
                     without losing the defensive rook (the position
                     is a verified tablebase draw)
   No lesson claims a theoretical category the data does not back.
   ============================================================ */

export type EndgameCategory = 'mates' | 'pawns' | 'rooks';

export interface EndgameLesson {
  id: string;
  title: string;
  category: EndgameCategory;
  fen: string;
  /** the learner plays this side */
  side: Color;
  /** true when the position begins with the DEFENDER to move — the engine plays first */
  engineFirst?: boolean;
  /** one-sentence goal shown at the top of the trainer */
  objective: string;
  explanation: string;
  hint: string;
  /** learner moves allowed before the drill fails */
  moveLimit: number;
  success: { kind: 'mate' } | { kind: 'survive'; mustKeepRook: boolean };
  /** tablebase facts recorded at authoring time (lichess tablebase.ovh) */
  verified: { category: 'win' | 'draw'; dtm: number | null };
}

export const ENDGAME_LESSONS: EndgameLesson[] = [
  {
    id: 'kq-mate',
    title: 'Queen mate: the box method',
    category: 'mates',
    fen: '4k3/8/8/8/8/8/8/Q3K3 w - - 0 1',
    side: 'w',
    objective: 'Checkmate the lone king within 12 moves.',
    explanation:
      'Walk the enemy king to the edge by shrinking a knight-move-sized "box" with the queen alone, bring your king up to guard the escape squares, then finish with the queen one knight-move from the king.',
    hint: 'Qa7 first — then mirror the black king: queen a knight-move away, king marches toward the centre files.',
    moveLimit: 12,
    success: { kind: 'mate' },
    verified: { category: 'win', dtm: 13 },
  },
  {
    id: 'kr-mate',
    title: 'Rook mate: cut off, then walk up',
    category: 'mates',
    fen: '4k3/8/8/8/8/8/8/R3K3 w - - 0 1',
    side: 'w',
    objective: 'Checkmate the lone king within 20 moves.',
    explanation:
      'Use the rook to take a rank or file away from the defending king, march your own king alongside until you build a staircase, and mate on the back rank with the rook while the kings stand in opposition.',
    hint: 'Ra7 cuts the king to the 8th. Your king walks to the sixth rank; the mate is rook-check on the back rank with the kings facing.',
    moveLimit: 20,
    success: { kind: 'mate' },
    verified: { category: 'win', dtm: 23 },
  },
  {
    id: '2r-ladder',
    title: 'Two rooks: the lawnmower',
    category: 'mates',
    fen: '4k3/8/8/8/8/8/8/R3K2R w - - 0 1',
    side: 'w',
    objective: 'Checkmate with the two-rook ladder within 8 moves.',
    explanation:
      'Keep the rooks one rank apart and mow the defending king toward the edge with alternating checks — each check pushes the king one rank, never allow the rooks to be attacked in turn.',
    hint: 'Ra7 first, then the second rook delivers rank after rank: the king can never cross the checking rook.',
    moveLimit: 8,
    success: { kind: 'mate' },
    verified: { category: 'win', dtm: 3 },
  },
  {
    id: 'promote-technique',
    title: 'Promotion technique: escort the pawn',
    category: 'pawns',
    fen: '4k3/8/8/8/8/8/1P6/1K6 w - - 0 1',
    side: 'w',
    objective: 'Promote the pawn and deliver checkmate within 30 moves.',
    explanation:
      'Your king escorts the pawn up the board — never ahead of it while the enemy king is behind. Promote when the escort reaches the promotion drive, then mate with queen and king.',
    hint: 'March Kb2-c3-c4-b5-c6 pushing the pawn when the black king steps aside; keep your king one diagonal ahead of the promotion square.',
    moveLimit: 30,
    success: { kind: 'mate' },
    verified: { category: 'win', dtm: 47 },
  },
  {
    id: 'opposition-promote',
    title: 'The opposition: take the square in front',
    category: 'pawns',
    fen: '4k3/8/4K3/4P3/8/8/8/8 b - - 0 1',
    side: 'w',
    engineFirst: true,
    objective: 'The defender is to move — hold the opposition, promote, and mate within 16 moves.',
    explanation:
      'With the defender forced to move first, he must give up the square directly in front of your pawn. Step forward whenever he steps aside, take the direct opposition when he meets you, and the pawn promotes.',
    hint: 'After any black king step, push or take the direct opposition: kings face each other with your move in hand.',
    moveLimit: 16,
    success: { kind: 'mate' },
    verified: { category: 'win', dtm: 24 },
  },
  {
    id: 'rook-convert',
    title: 'Rook and pawn: bridge to the win (Lucena-style)',
    category: 'rooks',
    fen: '3K4/3P1k2/8/8/8/7r/8/6R1 w - - 0 1',
    side: 'w',
    objective: 'Convert the extra pawn — promote and mate within 25 moves.',
    explanation:
      'Your king stands in front of its own pawn; the defending rook checks from behind. Build the bridge: bring your rook to a safe square on the fourth rank, shield the checks, walk the king out, promote and mate.',
    hint: 'Rook first to a bridge square shielding along the fourth rank; the black rook can check but never stays active. Then Kc7 and run.',
    moveLimit: 25,
    success: { kind: 'mate' },
    verified: { category: 'win', dtm: 37 },
  },
  {
    id: 'philidor-hold',
    title: 'The draw grip: third-rank defense (Philidor)',
    category: 'rooks',
    fen: '1k6/8/1K6/1P6/8/7r/8/6R1 b - - 0 1',
    side: 'b',
    objective: 'Hold the draw: survive 14 moves without being mated and without losing your rook.',
    explanation:
      'The attacker has king and pawn on the sixth. Your king holds the front; your rook guards the third rank, ready for the checking reply Rh6+ if his king advances — after the check he must step back and you retake the third-rank watch.',
    hint: 'When his king steps onto your pawn file, Rh6+ forces him backward; return to the third rank immediately.',
    moveLimit: 14,
    success: { kind: 'survive', mustKeepRook: true },
    verified: { category: 'draw', dtm: 0 },
  },
];
