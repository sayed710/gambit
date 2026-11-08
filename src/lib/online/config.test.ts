import { describe, expect, it } from 'vitest';
import { validatePublishableKey } from './supabase';

/* Negative regressions for the online key guard: SECRET keys and legacy
   service_role JWTs must be REJECTED; publishable/anon keys pass. All
   tokens below are FABRICATED (invalid signatures, example ids) — no
   real credentials exist in this file. */

const b64url = (obj: object) =>
  btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const fakeJwt = (payload: object) =>
  `eyJhbGciOiJIUzI1NiJ9.${b64url(payload)}.f4k3s1gn4tur3`;

describe('validatePublishableKey', () => {
  it('accepts a publishable sb_publishable_ key', () => {
    expect(() => validatePublishableKey('sb_publishable_ABCdef123_xYz')).not.toThrow();
  });

  it('accepts a legacy anon JWT (role=anon)', () => {
    const key = fakeJwt({ role: 'anon', iss: 'supabase' });
    expect(() => validatePublishableKey(key)).not.toThrow();
  });

  it('accepts an opaque non-JWT string', () => {
    expect(() => validatePublishableKey('just-some-opaque-key')).not.toThrow();
  });

  it('rejects a modern sb_secret_ key', () => {
    expect(() => validatePublishableKey('sb_secret_TOPSECRETVALUE_1234567890')).toThrow(/SECRET key/);
  });

  it('rejects a legacy service_role JWT (role=service_role)', () => {
    const key = fakeJwt({ role: 'service_role', iss: 'supabase' });
    expect(() => validatePublishableKey(key)).toThrow(/service_role/);
  });

  it('the service_role rejection is NOT swallowed by the decode fallback', () => {
    // regression for the original defect: the throw happened inside the
    // decode try/catch and was silently converted to "fine"
    const key = fakeJwt({ role: 'service_role' });
    let caught: Error | null = null;
    try {
      validatePublishableKey(key);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught?.message).toContain('service_role');
  });

  it('rejects a service_role JWT even with padding-sensitive base64', () => {
    // payload with characters that stress base64url conversion
    const key = fakeJwt({ role: 'service_role', sub: 'x'.repeat(40) });
    expect(() => validatePublishableKey(key)).toThrow(/service_role/);
  });
});
