# Online Multiplayer — architecture & trust boundaries

Milestone 1: private, **unrated**, two-player real-time chess via
invitation link. Guest identities (Supabase anonymous auth). Runs fully
against the **local Supabase stack** (Postgres + Auth + Realtime + Edge
Runtime); hosted deployment is a later, owner-authorized step.

## State machine — `online_games.status`

```
waiting ──(opponent joins: join-game)──▶ ready
ready ──(BOTH players acknowledge: ready function, one CAS write)──▶ active
active ──(checkmate/stalemate/draw rules/resign/timeout/accepted draw)──▶ completed
waiting|ready ──(creator cancel-game, or the 24h expiry)──▶ abandoned
ready ──(readiness stall >60s, either participant claims)──▶ abandoned
```

`ready` is a REAL state (readiness protocol): the join does NOT start
any clock. Each client acknowledges with the `ready` command; when both
`white_ready`/`black_ready` are true, the SAME atomic write flips the
room to active and stamps `turn_started_at` from the SERVER clock —
White's clock can never start before both players can see the game,
for either creator color. A room stuck in `ready` for over 60 seconds
may be abandoned by either participant (bounded pre-game stall), and
the creator can cancel a waiting/ready room at any time via
`cancel-game` — a room whose opponent already seated CANNOT be
cancelled (the command refuses with the authoritative game, so a stale
cancel click never resigns a live game).

## Trust boundaries

| Trust level | Component | Authority |
|---|---|---|
| **Untrusted** | browser client (both players AND observers) | renders state, sends commands |
| **Authoritative** | Edge Functions (`create-game`, `join-game`, `get-state`, `make-move`, `ready`, `cancel-game`, `claim-timeout`, `resign`, `draw`) | validate JWT + members + bounded untrusted payloadship + legality + clocks, own every write |
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

## Policies (server-authoritative, documented)

- **Draw offers**: an offer stands until the OPPONENT (the intended
  recipient) accepts it, declines it explicitly, or declines it
  implicitly BY MOVING. The offerer's own move does not withdraw it.
  Offer/accept/move races resolve through the row's version CAS —
  exactly one writer wins and the losers re-read the authoritative row.
- **Open-room quota**: a creator may hold at most 8 open rooms
  (waiting/ready/active, regardless of age). Enforced ATOMICALLY by the
  `create_online_game()` database function: a per-creator transaction
  advisory lock (`pg_advisory_xact_lock`) serializes concurrent creates
  by the same identity and the count+insert share one transaction —
  a flood cannot exceed the quota and old open rooms cannot escape it.
- **Stale rooms**: a room left waiting/ready for over 24 hours is
  abandoned by the expiry reconciliation on the next join attempt; the
  creator can cancel an unused room at any time. A readiness stall
  longer than 60 seconds can be abandoned by either participant.
- **Cancellation vs resignation**: `cancel-game` touches only
  waiting/ready rooms; `resign` touches only active games. The two
  semantics can never overlap.
- **Quota scope (known limitation)**: the 8-room quota is per guest
  identity. Anonymous sign-in mints fresh identities at will, so a
  determined caller can rotate identities to exceed it. Identity
  fluidity is inherent to the guest-auth milestone; a hosted
  deployment should rate-limit at the gateway (per-IP) or upgrade the
  auth requirement before going public. The quota still bounds
  accidental accumulation (the common case) and is enforced
  atomically.
