# Gambit — chess, played on thin ice

A complete, client-only chess platform with an arctic-clean interface:

- **Play** Stockfish 18 or pass-and-play with honest clocks, opening
  identification, zen mode and a keyboard-friendly workspace
- **Review** every finished game like the big platforms do — accuracies, move
  classifications (Book → Brilliant), an evaluation graph, and one-click jumps
  to the moments that decided the game
- **Analysis board** for any FEN or PGN with MultiPV engine lines
- **Puzzle training** across seven mechanically verified themes
- No account, no server — everything runs in the browser and your profile
  lives in `localStorage`.

![stack](https://img.shields.io/badge/React%2019-Vite%20%2B%20TypeScript-646cff) ![engine](https://img.shields.io/badge/Engine-Stockfish%2018%20WASM-81b64c)

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
npm run preview    # serve the production build
```

## Stack

- **Vite + React 19 + TypeScript** — app shell, routing via `react-router-dom` (hash router)
- **chess.js** — all rules: legal moves, check/checkmate/stalemate, draws,
  en passant, castling, promotion, PGN
- **react-chessboard** — board rendering, drag & drop, right-click arrows
- **Stockfish 18 (WASM, lite single-threaded)** — the opponent at four strengths
  (UCI `Skill Level` + depth/time budgets; weak levels sample from MultiPV),
  plus game analysis. Runs in a Web Worker; a custom negamax engine
  (alpha-beta, quiescence, piece-square tables) remains as an offline fallback
  if the WASM can't load
- **Game review** — every position evaluated by Stockfish; moves classified by
  centipawn loss, per-side accuracy, evaluation graph with weak-move markers,
  cached per game

## Features

- Landing page with a live replay of the Opera Game (Morphy, 1858)
- Play vs. the engine (4 strengths, ~800–2000 Elo) or pass & play
- 10 time controls (bullet → classical + no clock) with increment, flag fall,
  low-time chime
- Click-to-move and drag-and-drop, legal-move dots, last-move & check
  highlights, promotion picker, engine hints (right-drag arrows too)
- Undo (full move pair vs. the engine), resign with confirmation, draw offers
  the engine accepts only when it's worse
- Elo-rated games and puzzles stored locally; profile with stats, sparkline,
  match history
- Game review: step through moves with an evaluation bar and the engine's best
  line
- 16 mate-in-one puzzles generated and verified by `scripts/gen-puzzles.mjs`
- Light/dark/system themes, four board palettes, sound effects (WebAudio,
  no assets), responsive down to phones

## License

App code: MIT. `public/stockfish/` contains [Stockfish](https://github.com/official-stockfish/Stockfish)
builds from [stockfish.js](https://github.com/nmrugg/stockfish.js), licensed **GPL-3.0**.

## Regenerating puzzles

```bash
node scripts/gen-puzzles.mjs
```

Plays random games, keeps positions with exactly one mating move, and writes
`src/data/puzzles.ts`.
