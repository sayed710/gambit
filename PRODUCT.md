# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated (original build brief left the stack to the implementer): Vite + React 19 + TypeScript, chess.js for rules, react-chessboard for the board, custom Web-Worker engine. Chosen for a fast, client-only product with no server cost.

## Users

Primary: casual and club-strength chess players who want a frictionless game in the browser — no account, no install, sometimes on a phone, often with 10–30 spare minutes. Secondary: the same person in "pass & play" mode (two people, one device). Inferred from the build brief ("credible modern chess platform", "no account"), not user-confirmed.

## Product Purpose

Gambit is a client-only chess platform: play a local engine (four strengths) or pass-and-play with honest chess clocks, solve generated mate-in-one puzzles, and replay finished games with engine evaluation. Success is a player finishing games repeatedly without friction and returning via their local profile.

## Positioning

A quiet, focused place to play chess: the entire experience — rules engine, AI opponent, analysis, and profile — runs in the browser with zero accounts, zero servers, and zero cost, while still providing Elo-rated games and puzzles. Neighbors (chess.com, lichess) cannot truthfully claim "nothing leaves your device."

## Operating Context

Single-player-at-a-time web app, used in a desktop browser or on mobile. Everything persists in `localStorage` under the `gambit.` prefix (settings, profile, game history). No network calls after load except Google Fonts. The dev server runs at :5173; production build served statically.

## Capabilities and Constraints

- Full legal chess via chess.js: castling, en passant, promotion (picker), check/checkmate/stalemate, insufficient material, threefold repetition, fifty-move rule.
- Custom negamax engine (alpha-beta, quiescence, PSTs) in a Web Worker; four levels (~800/1250/1650/2000 Elo) with deliberate low-level blunder rates.
- 10 time controls (bullet → classical + unlimited) with increment, flag fall, low-time chime.
- Undo (full move pair vs. engine), resign (confirmed), draw offers (engine accepts only when worse), engine hints, board flip, click-to-move + drag-and-drop, right-drag arrows.
- Game records (PGN + SAN) and puzzle results persist locally; Elo K=24 vs. engine level, K=32 vs. puzzle rating.
- Constraint: no backend, ever, in the current scope — no multiplayer, no accounts, no cloud sync. Ratings are local approximations, not global.
- Undecided (deliberately): online play, cloud profiles, opening books/tablebase endings.

## Brand Commitments

- Name: **Gambit**. Tagline voice: "a quiet place to play chess."
- Identity: "a quiet chess journal" — warm paper light theme, espresso dark theme, brass accent, Fraunces serif display + Inter body. This was committed at build time and reaffirmed in the first polish pass.
- No gradients, no glow, no clutter; flat editorial surfaces.

## Evidence on Hand

- Full working implementation with verified engine loop, clocks, puzzles (16 verified mate-in-one puzzles from `scripts/gen-puzzles.mjs`), and review flow.
- A played-and-reviewed game exists in the dev browser profile (loss vs. Engine·Casual).
- No testimonials, press, or user research exists; nothing may be fabricated on these fronts.

## Product Principles

1. **The board is the product.** Every screen serves getting to a board, playing on it, or learning from it.
2. **Honesty over engagement tricks.** Ratings, clocks, and evaluation are real math; no fake numbers, no dark patterns, no streak-guilt.
3. **Nothing leaves the device.** Local-first is a feature and a promise.
4. **Quiet by default.** The interface recedes; chess and typography carry the personality.
5. **Every state is designed.** Empty, loading, error, and end-of-game moments get the same care as the happy path.

## Accessibility & Inclusion

Inferred target: WCAG AA contrast (4.5:1 body text), visible focus rings, keyboard-reachable controls, reduced-motion support (already implemented via media query). No formal audit contract exists yet.
