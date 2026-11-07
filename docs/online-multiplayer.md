# Online Multiplayer — architecture & trust boundaries

Milestone 1: private, **unrated**, two-player real-time chess via
invitation link. Guest identities (Supabase anonymous auth). Runs fully
against the **local Supabase stack** (Postgres + Auth + Realtime + Edge
Runtime); hosted deployment is a later, owner-authorized step.

## State machine — `online_games.status`

```
waiting ──(opponent joins: join-game)──▶ ready ──(both seated: the join
transaction flips straight to active when a start timestamp is set)──▶ active
active ──(checkmate/stalemate/draw rules/resign/timeout/accepted draw)──▶ completed
waiting|ready ──(expiry sweep / abandon)──▶ abandoned
```

`ready` is used only if a game can be seated but not started; in this
milestone the join transaction starts the clock immediately, so
`waiting → active` is the normal transition and `ready` stays reserved.

## Trust boundaries

| Trust level | Component | Authority |
|---|---|---|
| **Untrusted** | browser client (both players AND observers) | renders state, sends commands |
| **Authoritative** | Edge Functions (`create-game`, `join-game`, `get-state`, `make-move`, `claim-timeout`, `resign`, `draw-*`) | validate JWT + membership + legality + clocks, own every write |
| **Durable truth** | Postgres `online_games` | FEN, SAN history, version, clocks, result |

- Clients **never** write game rows. Postgres grants for `authenticated`
  on `online_games` are `SELECT` only (RLS: participants only). Every
  mutation goes through an Edge Function running with the service role
  after its own checks (`verify_jwt` enabled + explicit user checks).
- Realtime (`postgres_changes` on the row) is a **notification bell** —
  the client refetches authoritative state through `get-state` and
  reconciles by `version`. Realtime payloads are never trusted.
- The invitation token is 32 random bytes (base64url, ~192 bits); the
  database stores only its SHA-256 hash. Sequential ids authorize
  nothing.
- Display names are cosmetic only — never authorization evidence.
- The anon JWT proves *an identity exists*; membership is `white_id` /
  `black_id` columns compared against `auth.uid()` inside functions.
- `security definer` functions are avoided; Edge Functions use the
  service key server-side only (never shipped to the client bundle).

## Concurrency & clocks

- `version integer` column — every mutation is
  `UPDATE ... WHERE id = $game AND version = $seenVersion`; 0 rows
  updated ⇒ the caller lost the race and re-reads authoritative state.
  Two conflicting moves can never both advance the position.
- Clocks: `turn_started_at timestamptz` + `white_ms_remaining` /
  `black_ms_remaining` + `increment_ms`. On a legal move the function
  computes `elapsed = now() - turn_started_at` **server-side**, rejects
  the move when `elapsed > remaining` (timeout instead), applies the
  increment to the mover, sets the opponent's `turn_started_at = now()`.
  The client only *projects* these timestamps; it never supplies them.
- Timeout adjudication: `claim-timeout` lets any authenticated
  participant claim a win when the opponent's
  `turn_started_at + remaining < now()` (server-verified). No background
  cron is required in this milestone; the claim is the mechanism.
- Idempotency: `make-move` accepts a client-generated `move_id (uuid)`;
  a `(game_id, move_id)` unique index makes replays no-ops returning the
  current authoritative state.

## Guest identities (limits to disclose in UI)

An anonymous session lives in the browser's local storage. Clearing
site data, or using another browser/device without the session, loses
the seat. Names are cosmetic. Games are private (participants only) and
unrated; offline profile ratings are untouched.

## Completed games

Final SAN move list + PGN are persisted on the row; the client offers
PGN download and "open in Review" via the existing Review deep-link
(`location.state.pgn`) — the offline local profile/ratings are never
modified by online games.
