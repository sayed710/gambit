/* Shared server-side helpers for the online-chess Edge Functions.
   Every function: verify the caller's JWT, then authorize against the
   game row; the database grants authenticated users SELECT-only on
   online_games and NO write grants — all mutations go through here with
   the service role AFTER these checks. */
import { Chess } from 'npm:chess.js@1.4.0';
import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';

export interface GameRow {
  id: string;
  created_at: string;
  creator_id: string;
  white_id: string | null;
  black_id: string | null;
  white_name: string;
  black_name: string;
  status: 'waiting' | 'ready' | 'active' | 'completed' | 'abandoned';
  base_ms: number;
  increment_ms: number;
  start_fen: string;
  moves: { san: string; from: string; to: string; fenAfter: string; moveId: string }[];
  version: number;
  turn: 'w' | 'b';
  white_ms_remaining: number;
  black_ms_remaining: number;
  turn_started_at: string | null;
  white_ready: boolean;
  black_ready: boolean;
  ready_started_at: string | null;
  result: 'white' | 'black' | 'draw' | null;
  result_reason: string | null;
  draw_offer_by: string | null;
  pgn: string | null;
  last_move_id: string | null;
}

/* Browsers call these functions cross-origin (app origin != functions
   origin) — every response carries CORS headers and every function
   answers the preflight OPTIONS short-circuit via corsPreflight(). */
export const corsHeaders: Record<string, string> = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
};

export const corsPreflight = (): Response => new Response('ok', { status: 200, headers: corsHeaders });

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders,
  });

export const fail = (code: string, message: string, status = 400, extra?: Record<string, unknown>): Response =>
  json({ ok: false, error: { code, message, ...extra } }, status);

/** Client for the CALLER's identity (their JWT) — RLS applies. */
export function userClient(req: Request): SupabaseClient {
  const auth = req.headers.get('Authorization') ?? '';
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
}

/** Service-role client — used ONLY after explicit membership checks. */
export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
}

export async function requireUser(req: Request): Promise<{ id: string } | null> {
  const { data } = await userClient(req).auth.getUser();
  return data.user ? { id: data.user.id } : null;
}

/* ---- payload validation (F3): decoded JSON is UNTRUSTED `unknown`.
   Every field passes through these guards; wrong shapes return
   predictable 4xx responses instead of crashing on string methods. */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A bounded plain string, or null when the value is not a string. */
export function asStr(v: unknown, maxLen: number): string | null {
  if (typeof v !== 'string') return null;
  return v.slice(0, maxLen);
}

/** A bounded, trimmed, non-empty string, or null. */
export function asNonEmptyStr(v: unknown, maxLen: number): string | null {
  const s = asStr(v, maxLen)?.trim();
  return s ? s : null;
}

/** A UUID string, or null. */
export function asUuid(v: unknown): string | null {
  return typeof v === 'string' && UUID_RE.test(v) ? v : null;
}

/** An integer within [lo, hi], or null. */
export function asIntIn(v: unknown, lo: number, hi: number): number | null {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) return null;
  return v;
}

/** One of the allowed string literals, or null. */
export function asEnum<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

/** One of the allowed string literals OR undefined (optional field), or null. */
export function asOptionalEnum<T extends string>(v: unknown, allowed: readonly T[]): T | null | undefined {
  if (v === undefined) return undefined;
  return asEnum(v, allowed);
}

/* ---- stale-room expiry policy (documented): a room left waiting or
   ready for over 24 hours is abandoned on the next join attempt, so
   stale invitations cannot be joined and cannot occupy the open-room
   quota forever. The creator can cancel an unused room at any time. */
export const ROOM_EXPIRY_MS = 24 * 60 * 60 * 1000;

export async function expireIfStale(admin: SupabaseClient, game: GameRow): Promise<GameRow> {
  if (game.status !== 'waiting' && game.status !== 'ready') return game;
  if (Date.now() - new Date(game.created_at).getTime() < ROOM_EXPIRY_MS) return game;
  const { data } = await admin
    .from('online_games')
    .update({ status: 'abandoned', version: game.version + 1, updated_at: new Date().toISOString() })
    .eq('id', game.id)
    .eq('version', game.version)
    .eq('status', game.status)
    .select('*')
    .single();
  return (data as GameRow) ?? game;
}

export async function loadGame(admin: SupabaseClient, gameId: string): Promise<GameRow | null> {
  const { data } = await admin.from('online_games').select('*').eq('id', gameId).maybeSingle();
  return (data as GameRow) ?? null;
}

export function isParticipant(game: GameRow, userId: string): 'w' | 'b' | null {
  if (game.white_id === userId) return 'w';
  if (game.black_id === userId) return 'b';
  return null;
}

/** The authoritative position reached by replaying the stored SAN history. */
export function replay(game: GameRow): Chess {
  const c = new Chess(game.start_fen);
  for (const m of game.moves) {
    c.move(m.san);
  }
  return c;
}

export interface EndInfo {
  over: boolean;
  winner: 'white' | 'black' | null;
  reason: 'checkmate' | 'stalemate' | 'insufficient' | 'threefold' | 'fifty-move' | null;
}

export function detectEnd(c: Chess): EndInfo {
  if (c.isCheckmate()) {
    return { over: true, winner: c.turn() === 'w' ? 'black' : 'white', reason: 'checkmate' };
  }
  if (c.isStalemate()) return { over: true, winner: null, reason: 'stalemate' };
  if (c.isInsufficientMaterial()) return { over: true, winner: null, reason: 'insufficient' };
  if (c.isThreefoldRepetition()) return { over: true, winner: null, reason: 'threefold' };
  if (c.isDrawByFiftyMoves()) return { over: true, winner: null, reason: 'fifty-move' };
  return { over: false, winner: null, reason: null };
}

/** Server-side clock: how much of the mover's time has already elapsed. */
export function elapsedMs(game: GameRow, now: number): number {
  if (!game.turn_started_at) return 0;
  return Math.max(0, now - new Date(game.turn_started_at).getTime());
}

/** The row projection clients receive — never includes the invite hash. */
export function project(game: GameRow) {
  const { invite_code_hash: _invite, ...rest } = game as GameRow & { invite_code_hash?: unknown };
  return rest;
}

export async function saveGame(admin: SupabaseClient, game: GameRow, patch: Partial<GameRow>, seenVersion: number) {
  const { data, error } = await admin
    .from('online_games')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', game.id)
    .eq('version', seenVersion) // optimistic concurrency — conflicting writers lose
    .select('*')
    .single();
  return { data: (data as GameRow) ?? null, error };
}

export async function savePgn(admin: SupabaseClient, game: GameRow, c: Chess) {
  await admin.from('online_games').update({ pgn: c.pgn() }).eq('id', game.id);
}
