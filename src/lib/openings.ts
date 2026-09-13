/**
 * Lightweight opening identification.
 * A compact ECO-style table keyed by the SAN move sequence from the start
 * position. `identify(sanMoves)` returns the longest matching entry — the
 * table is intentionally small: mainline openings a club player will actually
 * meet, not an encyclopedia. Extending it is just appending rows.
 */
export interface OpeningEntry {
  /** SAN moves from the initial position, e.g. "e4 c5 Nf3 d6 d4 cxd4" */
  moves: string;
  name: string;
  eco: string;
}

const TABLE: OpeningEntry[] = [
  { moves: 'e4', name: "King's Pawn Opening", eco: 'B00' },
  { moves: 'e4 e5', name: 'Open Game', eco: 'C20' },
  { moves: 'e4 e5 Nf3', name: "King's Knight Opening", eco: 'C30' },
  { moves: 'e4 e5 Nf3 Nc6', name: 'Open Game: Normal Variation', eco: 'C44' },
  { moves: 'e4 e5 Nf3 Nc6 Bb5', name: 'Ruy Lopez', eco: 'C60' },
  { moves: 'e4 e5 Nf3 Nc6 Bb5 a6', name: 'Ruy Lopez: Morphy Defense', eco: 'C70' },
  { moves: 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4', name: 'Ruy Lopez: Morphy Defense', eco: 'C70' },
  { moves: 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6', name: 'Ruy Lopez: Morphy Defense', eco: 'C70' },
  { moves: 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O', name: 'Ruy Lopez: Closed', eco: 'C84' },
  { moves: 'e4 e5 Nf3 Nc6 Bc4', name: 'Italian Game', eco: 'C50' },
  { moves: 'e4 e5 Nf3 Nc6 Bc4 Bc5', name: 'Italian Game: Giuoco Piano', eco: 'C53' },
  { moves: 'e4 e5 Nf3 Nc6 Bc4 Nf6', name: 'Italian Game: Two Knights Defense', eco: 'C55' },
  { moves: 'e4 e5 Nf3 Nc6 d4', name: 'Scotch Game', eco: 'C44' },
  { moves: 'e4 e5 Nf3 Nc6 d4 exd4', name: 'Scotch Game: Main Line', eco: 'C45' },
  { moves: 'e4 e5 Nf3 Nf6', name: 'Petrov Defense', eco: 'C42' },
  { moves: 'e4 e5 Nf3 d6', name: 'Philidor Defense', eco: 'C41' },
  { moves: 'e4 e5 Nc3', name: 'Vienna Game', eco: 'C25' },
  { moves: 'e4 e5 f4', name: "King's Gambit", eco: 'C30' },
  { moves: 'e4 e5 Bc4', name: 'Bishop’s Opening', eco: 'C23' },
  { moves: 'e4 c5', name: 'Sicilian Defense', eco: 'B20' },
  { moves: 'e4 c5 Nf3', name: 'Sicilian Defense', eco: 'B27' },
  { moves: 'e4 c5 Nf3 d6', name: 'Sicilian Defense: Open', eco: 'B50' },
  { moves: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3', name: 'Sicilian Defense: Najdorf-Adjacent Open', eco: 'B90' },
  { moves: 'e4 c5 Nf3 Nc6', name: 'Sicilian Defense: Old Sicilian', eco: 'B30' },
  { moves: 'e4 c5 Nf3 e6', name: 'Sicilian Defense: French Variation', eco: 'B22' },
  { moves: 'e4 c5 Nc3', name: 'Sicilian Defense: Closed', eco: 'B23' },
  { moves: 'e4 c5 c3', name: 'Sicilian Defense: Alapin Variation', eco: 'B22' },
  { moves: 'e4 e6', name: 'French Defense', eco: 'C00' },
  { moves: 'e4 e6 d4 d5', name: 'French Defense: Main Line', eco: 'C01' },
  { moves: 'e4 e6 d4 d5 Nc3', name: 'French Defense: Paulsen', eco: 'C02' },
  { moves: 'e4 e6 d4 d5 Nc3 Bb4', name: 'French Defense: Winawer', eco: 'C15' },
  { moves: 'e4 e6 d4 d5 Nc3 Nf6', name: 'French Defense: Tarrasch-Adjacent', eco: 'C03' },
  { moves: 'e4 e6 e5', name: 'French Defense: Advance', eco: 'C02' },
  { moves: 'e4 c6', name: 'Caro-Kann Defense', eco: 'B10' },
  { moves: 'e4 c6 d4 d5', name: 'Caro-Kann Defense: Main Line', eco: 'B12' },
  { moves: 'e4 c6 d4 d5 Nc3', name: 'Caro-Kann Defense: Main Line', eco: 'B15' },
  { moves: 'e4 c6 Nc3', name: 'Caro-Kann Defense: Two Knights', eco: 'B10' },
  { moves: 'e4 d5', name: 'Scandinavian Defense', eco: 'B01' },
  { moves: 'e4 d5 exd5 Qxd5', name: 'Scandinavian Defense: Main Line', eco: 'B01' },
  { moves: 'e4 Nf6', name: 'Alekhine Defense', eco: 'B02' },
  { moves: 'e4 d6', name: 'Pirc Defense', eco: 'B07' },
  { moves: 'e4 d6 d4 Nf6', name: 'Pirc Defense', eco: 'B07' },
  { moves: 'e4 g6', name: 'Modern Defense', eco: 'B06' },

  { moves: 'd4', name: "Queen's Pawn Opening", eco: 'A40' },
  { moves: 'd4 d5', name: 'Closed Game', eco: 'D00' },
  { moves: 'd4 d5 c4', name: "Queen's Gambit", eco: 'D06' },
  { moves: 'd4 d5 c4 e6', name: "Queen's Gambit Declined", eco: 'D30' },
  { moves: 'd4 d5 c4 e6 Nc3 Nf6', name: 'QGD: Normal Line', eco: 'D35' },
  { moves: 'd4 d5 c4 c6', name: 'Slav Defense', eco: 'D10' },
  { moves: 'd4 d5 c4 c6 Nf3 Nf6 Nc3', name: 'Slav Defense: Main Line', eco: 'D15' },
  { moves: 'd4 d5 c4 dxc4', name: "Queen's Gambit Accepted", eco: 'D20' },
  { moves: 'd4 d5 c4 Nf6', name: "Queen's Gambit: Marshall Defense", eco: 'D06' },
  { moves: 'd4 d5 Nf3', name: "Queen's Pawn: Zukertort", eco: 'D02' },
  { moves: 'd4 d5 Nf3 Nf6', name: 'Colle-adjacent Zukertort', eco: 'D02' },
  { moves: 'd4 Nf6', name: "Indian Defense", eco: 'A45' },
  { moves: 'd4 Nf6 c4', name: 'Indian Defense', eco: 'A45' },
  { moves: 'd4 Nf6 c4 e6', name: 'Indian Defense: East Indian', eco: 'A45' },
  { moves: 'd4 Nf6 c4 e6 Nc3 Bb4', name: 'Nimzo-Indian Defense', eco: 'E20' },
  { moves: 'd4 Nf6 c4 e6 Nf3 b6', name: 'Queen’s Indian Defense', eco: 'E12' },
  { moves: 'd4 Nf6 c4 e6 Nc3 Bb4 e3', name: 'Nimzo-Indian: Rubinstein', eco: 'E40' },
  { moves: 'd4 Nf6 c4 g6', name: "King's Indian / Grünfeld Complex", eco: 'E60' },
  { moves: 'd4 Nf6 c4 g6 Nc3 d5', name: 'Grünfeld Defense', eco: 'D80' },
  { moves: 'd4 Nf6 c4 g6 Nc3 Bg7', name: "King's Indian Defense", eco: 'E60' },
  { moves: 'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6', name: "King's Indian Defense: Normal", eco: 'E90' },
  { moves: 'd4 f5', name: 'Dutch Defense', eco: 'A80' },
  { moves: 'd4 e6', name: 'Horwitz Defense', eco: 'A40' },
  { moves: 'd4 e5', name: 'Englund Gambit', eco: 'A40' },
  { moves: 'd4 d6', name: 'Rat Defense', eco: 'A41' },

  { moves: 'c4', name: 'English Opening', eco: 'A10' },
  { moves: 'c4 e5', name: 'English Opening: Reversed Sicilian', eco: 'A20' },
  { moves: 'c4 c5', name: 'English Opening: Symmetrical', eco: 'A30' },
  { moves: 'c4 Nf6', name: 'English Opening: Anglo-Indian', eco: 'A15' },
  { moves: 'c4 e6', name: 'English Opening: Agincourt', eco: 'A13' },

  { moves: 'Nf3', name: 'Zukertort Opening', eco: 'A04' },
  { moves: 'Nf3 d5', name: 'Zukertort: Queen’s Pawn Defense', eco: 'A06' },
  { moves: 'Nf3 d5 g3', name: 'King’s Indian Attack', eco: 'A07' },
  { moves: 'Nf3 Nf6 c4', name: 'English-adjacent Réti', eco: 'A15' },
  { moves: 'c4 Nf6 Nc3 e6 Nf3', name: 'English: Neo-Catalan', eco: 'A29' },

  { moves: 'f4', name: "Bird's Opening", eco: 'A02' },
  { moves: 'b3', name: 'Nimzo-Larsen Attack', eco: 'A01' },
  { moves: 'b4', name: 'Polish Opening', eco: 'A00' },
  { moves: 'g3', name: 'Benko Opening', eco: 'A00' },
  { moves: 'e4 g5', name: "Grob-adjacent King's Pawn", eco: 'A00' },
];

const SORTED = [...TABLE].sort((a, b) => b.moves.length - a.moves.length);

/** Identify the opening from a SAN move list; longest prefix wins. */
export function identifyOpening(sanMoves: string[]): OpeningEntry | null {
  const line = sanMoves.join(' ');
  if (!line) return null;
  for (const entry of SORTED) {
    if (line === entry.moves || line.startsWith(entry.moves + ' ')) return entry;
  }
  return null;
}

/** Identify from a FEN-position game object without mutating it. */
export function identifyFromHistory(sanMoves: string[]): OpeningEntry | null {
  return identifyOpening(sanMoves);
}
