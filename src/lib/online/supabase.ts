/* Online multiplayer — Supabase client + command layer.
   LOCAL-FIRST: without VITE_SUPABASE_URL the client points at the local
   stack (127.0.0.1:54321) whose anon key is a public local constant —
   never ship hosted keys in code. Hosted config comes exclusively from
   env vars the owner sets later. */
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';

const LOCAL_URL = 'http://127.0.0.1:54321';
// the fixed publishable key of the LOCAL supabase stack (public by
// design; derived from config.toml's local JWT secret)
const LOCAL_ANON_KEY = 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';

const url = import.meta.env.VITE_SUPABASE_URL ?? LOCAL_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? LOCAL_ANON_KEY;

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!client) client = createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  return client;
}

export const onlineConfigured = (): boolean => url !== LOCAL_URL || true; // local stack is a valid target

/* ---- guest identity (anonymous auth) ---- */

export async function ensureGuestSession(): Promise<Session> {
  const sb = supabase();
  const { data: existing } = await sb.auth.getSession();
  if (existing.session) return existing.session;
  const { data, error } = await sb.auth.signInAnonymously();
  if (error || !data.session) throw new Error(`guest sign-in failed: ${error?.message ?? 'no session'}`);
  return data.session;
}

export async function currentGuestId(): Promise<string | null> {
  const { data } = await supabase().auth.getSession();
  return data.session?.user.id ?? null;
}

/* ---- commands (Edge Functions; the server is authoritative) ---- */

async function command<T = Record<string, unknown>>(fn: string, body: Record<string, unknown>): Promise<T> {
  const sb = supabase();
  const { data: sessionData } = await sb.auth.getSession();
  const token = sessionData.session?.access_token;
  const res = await fetch(`${url}/functions/v1/${fn}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const payload = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: { code: string; message: string } };
  if (!res.ok || payload.ok === false) {
    throw new OnlineError(payload.error?.code ?? `http-${res.status}`, payload.error?.message ?? res.statusText);
  }
  return payload as T;
}

export class OnlineError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface OnlineGame {
  id: string;
  status: 'waiting' | 'ready' | 'active' | 'completed' | 'abandoned';
  white_id: string | null;
  black_id: string | null;
  white_name: string;
  black_name: string;
  base_ms: number;
  increment_ms: number;
  start_fen: string;
  moves: { san: string; from: string; to: string; fenAfter: string; moveId: string }[];
  version: number;
  turn: 'w' | 'b';
  white_ms_remaining: number;
  black_ms_remaining: number;
  turn_started_at: string | null;
  result: 'white' | 'black' | 'draw' | null;
  result_reason: string | null;
  draw_offer_by: string | null;
  pgn: string | null;
  last_move_id: string | null;
}

export const api = {
  createGame: (name: string, baseMs: number, incrementMs: number, color: 'white' | 'black' | 'random') =>
    command<{ ok: true; gameId: string; token: string; color: 'white' | 'black' }>('create-game', {
      name,
      baseMs,
      incrementMs,
      color,
    }),
  joinGame: (token: string, name: string) =>
    command<{ ok: true; joined?: 'white' | 'black'; rejoined?: boolean; game: OnlineGame }>('join-game', { token, name }),
  getState: (gameId: string) =>
    command<{ ok: true; game: OnlineGame }>('get-state', { gameId }),
  makeMove: (gameId: string, moveId: string, from: string, to: string, promotion?: string) =>
    command<{ ok: true; applied: boolean; replay?: boolean; versionConflict?: boolean; san?: string; game: OnlineGame }>(
      'make-move',
      { gameId, moveId, from, to, promotion },
    ),
  claimTimeout: (gameId: string) =>
    command<{ ok: true; game: OnlineGame }>('claim-timeout', { gameId }),
  resign: (gameId: string) => command<{ ok: true; game: OnlineGame }>('resign', { gameId }),
  draw: (gameId: string, action: 'offer' | 'accept' | 'decline') =>
    command<{ ok: true; game: OnlineGame }>('draw', { gameId, action }),
};

/* ---- invite links ---- */

export function makeInviteLink(gameId: string, token: string): string {
  return `${location.origin}${location.pathname}#/online/join?game=${encodeURIComponent(gameId)}&token=${encodeURIComponent(token)}`;
}

export function parseInviteLink(hash: string): { game: string; token: string } | null {
  const q = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '';
  const p = new URLSearchParams(q);
  const game = p.get('game');
  const token = p.get('token');
  return game && token ? { game, token } : null;
}
