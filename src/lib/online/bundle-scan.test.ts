import { describe, expect, it } from 'vitest';
import { scanTextForSecretKeys, validateClientKey } from '../../../scripts/bundle-security-scan.mjs';

// jsdom-provided btoa + base64url conversion (no node Buffer in this tsconfig)
const b64url = (obj: object) => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/* Deterministic negative tests for the bundle-secret scanner. Every
   token below is FABRICATED (invalid signatures, example ids) — no real
   credentials exist in this file or in any artifact it produces. */

// a fabricated legacy anon JWT (role=anon) — clearly fake signature
const FABRICATED_ANON_JWT =
  'eyJhbGciOiJIUzI1NiJ9.' +
  b64url({ role: 'anon', iss: 'supabase-example' }) +
  '.f4k3s1gn4tur3';

// a fabricated legacy service_role JWT — clearly fake signature
const FABRICATED_SERVICE_JWT =
  'eyJhbGciOiJIUzI1NiJ9.' +
  b64url({ role: 'service_role', iss: 'supabase-example' }) +
  '.f4k3s1gn4tur3';

describe('scanTextForSecretKeys', () => {
  it('a valid publishable key passes (no hits)', () => {
    expect(scanTextForSecretKeys('sb_publishable_ABCdef123_xYz')).toEqual([]);
  });

  it('a legacy anonymous JWT passes (no hits)', () => {
    expect(scanTextForSecretKeys(`config = '${FABRICATED_ANON_JWT}'`)).toEqual([]);
  });

  it('a modern sb_secret_ key fails the scan', () => {
    const hits = scanTextForSecretKeys(`key = 'sb_secret_TOPSECRETVALUE_1234567890'`);
    expect(hits.length).toBe(1);
    expect(hits[0]).toContain('sb_secret_');
  });

  it('a legacy service_role JWT fails the scan (decoded payload role)', () => {
    const hits = scanTextForSecretKeys(`key = '${FABRICATED_SERVICE_JWT}'`);
    expect(hits.length).toBe(1);
    expect(hits[0]).toContain('service_role');
  });

  it('the role is detected from the DECODED payload, not plain text', () => {
    // the role only exists base64url-encoded — a plain-text scan would miss it
    const text = `x = '${FABRICATED_SERVICE_JWT}'`;
    expect(text.includes('service_role')).toBe(false); // not visible as plain text
    expect(scanTextForSecretKeys(text).length).toBe(1); // the decoded scan still catches it
  });

  it('a bundled guard function cannot suppress an embedded fake secret', () => {
    // the bundle legitimately contains guard strings AND an embedded
    // secret — the per-JWT scan must still flag the secret
    const bundle = [
      "function validatePublishableKey(key) { if (payload.role === 'service_role') throw ... }",
      "msg = 'a legacy service_role JWT — it must never be exposed to the browser.'",
      `key = '${FABRICATED_SERVICE_JWT}'`, // the embedded fake secret
    ].join('\n');
    const hits = scanTextForSecretKeys(bundle);
    expect(hits.length).toBe(1);
    expect(hits[0]).toContain('service_role');
  });

  it('multiple JWTs: only the service_role one is flagged', () => {
    const bundle = `a='${FABRICATED_ANON_JWT}'; b='${FABRICATED_SERVICE_JWT}'`;
    const hits = scanTextForSecretKeys(bundle);
    expect(hits.length).toBe(1);
    expect(hits[0]).toContain('service_role');
  });
});

describe('validateClientKey (build/security-gate validation)', () => {
  it('a publishable key passes', () => {
    expect(() => validateClientKey('sb_publishable_ABCdef123_xYz')).not.toThrow();
  });

  it('a legacy anonymous JWT passes', () => {
    expect(() => validateClientKey(FABRICATED_ANON_JWT)).not.toThrow();
  });

  it('a modern sb_secret_ key throws', () => {
    expect(() => validateClientKey('sb_secret_TOPSECRETVALUE_1234567890')).toThrow(/SECRET key/);
  });

  it('a legacy service_role JWT throws', () => {
    expect(() => validateClientKey(FABRICATED_SERVICE_JWT)).toThrow(/service_role/);
  });

  it('an empty key throws', () => {
    expect(() => validateClientKey('')).toThrow(/empty/);
  });
});
