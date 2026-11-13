/* Pure bundle-secret scanner — used by the CI security job and unit-
   tested in src/lib/online/bundle-scan.test.ts.

   Unlike the previous whole-file heuristic (which could be suppressed by
   the presence of guard strings in the same bundle), this scanner works
   PER TOKEN:
   - any `sb_secret_` occurrence is a leak
   - every JWT-shaped string is Base64URL-DECODED and rejected when its
     payload role is `service_role` — the role lives in the encoded
     payload, so guard strings elsewhere in the same file are irrelevant
   - publishable keys and anon-role JWTs pass */

import { Buffer } from 'node:buffer';

/** Markers embedded in FABRICATED test tokens (clearly fake values).
    The tracked-file security scan exempts lines containing these — the
    tokens exist only in negative-regression tests, never in bundles. */
export const FABRICATED_MARKERS = ['f4k3s1gn4tur3', 'sb_secret_TOPSECRETVALUE_1234567890'];

/** Base64url-decode a JWT payload segment (no signature verification —
    this is a credential-shape scan, not an auth check). */
function decodeJwtPayload(jwt) {
  const parts = jwt.split('.');
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

const JWT_RE = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;

/**
 * Scan bundle text for embedded secret credentials.
 * @returns {string[]} human-readable hits (empty = clean)
 */
export function scanTextForSecretKeys(text) {
  const hits = [];
  if (/sb_secret_[A-Za-z0-9_-]{10,}/.test(text)) {
    hits.push('sb_secret_ key present in the bundle');
  }
  const seen = new Set();
  for (const jwt of text.match(JWT_RE) ?? []) {
    if (seen.has(jwt)) continue;
    seen.add(jwt);
    const payload = decodeJwtPayload(jwt);
    if (payload?.role === 'service_role') {
      hits.push('legacy service_role JWT embedded (decoded payload role)');
    }
  }
  return hits;
}

/**
 * Validate a CONFIGURED client key before it is embedded into frontend
 * assets (build/security-gate time — before any visitor can load it).
 * Publishable keys and anon JWTs pass; SECRET keys and service_role
 * JWTs throw.
 */
export function validateClientKey(key) {
  if (typeof key !== 'string' || key.length === 0) {
    throw new Error('[online] the Supabase client key is empty');
  }
  if (/sb_secret_[A-Za-z0-9_-]{10,}/.test(key)) {
    throw new Error('[online] the configured Supabase key is a SECRET key — service-role keys must never be embedded in frontend assets.');
  }
  for (const jwt of key.match(JWT_RE) ?? []) {
    const payload = decodeJwtPayload(jwt);
    if (payload?.role === 'service_role') {
      throw new Error('[online] the configured Supabase key is a legacy service_role JWT — it must never be embedded in frontend assets.');
    }
  }
}
