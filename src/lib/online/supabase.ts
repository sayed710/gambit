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

/** True when the build has an explicit backend to talk to. In development
    the local stack (127.0.0.1:54321) is the intended target; a PRODUCTION
    build needs VITE_SUPABASE_URL/ANON_KEY set at build time — falling
    back to localhost there would silently point visitors at their own
    machine. Set both to the LOCAL stack values to build for local E2E. */
const buildTimeUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const buildTimeKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const onlineConfigured = (): boolean => {
  if (import.meta.env.DEV) return true; // dev always targets the local stack
  return Boolean(buildTimeUrl && buildTimeKey);
};

// publishable keys are safe client-side; SECRET keys must never ship to
// the browser bundle — reject them loudly at startup

/**
 * Validates that a Supabase client key is safe to embed in the browser:
 * publishable keys and legacy anon JWTs pass; SECRET keys and legacy
 * service_role JWTs throw (they bypass RLS and must never ship).
 * The role check happens OUTSIDE the decode try/catch so a rejection
 * cannot be swallowed by the decode fallback.
 */
export function validatePublishableKey(key: string): void {
  if (key.startsWith('sb_secret_')) {
    throw new Error('[online] the Supabase key is a SECRET key — service-role keys must never be exposed to the browser.');
  }
  let role: string | undefined;
  const parts = key.split('.');
  if (parts.length === 3) {
    // legacy JWT-shaped key — decode the payload WITHOUT a swallowing
    // try/catch around the role check
    try {
      const json = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
      role = (JSON.parse(json) as { role?: string }).role;
    } catch {
      role = undefined; // undecodable payload — treated as opaque
    }
  }
  if (role === 'service_role') {
    throw new Error('[online] the Supabase key is a legacy service_role JWT — it must never be exposed to the browser.');
  }
}

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  // validated lazily: a rejected key must not crash OFFLINE pages (App
  // imports Online eagerly) — the throw surfaces when online features
  // initialize, where the Online page's error handling catches it
  validatePublishableKey(anonKey);
  if (!client) client = createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  return client;
}

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
