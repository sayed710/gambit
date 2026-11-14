import { describe, expect, it } from 'vitest';
import { describeHttpFailure } from './supabase';

/* Regression tests: the command layer must never surface an EMPTY
   user-facing error — missing/null/empty server messages and empty
   status texts all fall through to a clear default. Structured codes
   and the authoritative game payload are preserved. */

describe('describeHttpFailure', () => {
  it('prefers a non-empty server message', () => {
    const d = describeHttpFailure({ ok: false, error: { code: 'illegal', message: 'illegal move' } }, 409, 'Conflict');
    expect(d.code).toBe('illegal');
    expect(d.message).toBe('illegal move');
  });

  it('an EMPTY server message falls through to the status text', () => {
    const d = describeHttpFailure({ ok: false, error: { code: 'state', message: '' } }, 409, 'Conflict');
    expect(d.code).toBe('state');
    expect(d.message).toBe('Conflict');
    expect(d.message.length).toBeGreaterThan(0);
  });

  it('a NULL server message falls through to the status text', () => {
    const d = describeHttpFailure({ ok: false, error: { code: 'state', message: null as unknown as string } }, 409, 'Conflict');
    expect(d.message).toBe('Conflict');
  });

  it('a missing error object falls back to the http- code and status text', () => {
    const d = describeHttpFailure({}, 500, 'Internal Server Error');
    expect(d.code).toBe('http-500');
    expect(d.message).toBe('Internal Server Error');
  });

  it('an empty statusText falls through to a clear default carrying the status', () => {
    const d = describeHttpFailure({ ok: false, error: { code: 'state', message: '' } }, 503, '');
    expect(d.code).toBe('state');
    expect(d.message).toBe('request failed (HTTP 503)');
    expect(d.message.length).toBeGreaterThan(0);
  });

  it('empty statusText AND no error object still produce a clear message', () => {
    const d = describeHttpFailure({}, 404, '');
    expect(d.message).toBe('request failed (HTTP 404)');
  });

  it('a whitespace-only server message is treated as empty', () => {
    const d = describeHttpFailure({ ok: false, error: { code: 'x', message: '   ' } }, 409, 'Conflict');
    expect(d.message).toBe('Conflict');
  });

  it('a whitespace-only statusText falls through to the default', () => {
    const d = describeHttpFailure({}, 429, '   ');
    expect(d.message).toBe('request failed (HTTP 429)');
  });

  it('a non-string code is replaced by the http- code', () => {
    const d = describeHttpFailure({ ok: false, error: { code: 42 as unknown as string, message: 'boom' } }, 400, '');
    expect(d.code).toBe('http-400');
    expect(d.message).toBe('boom');
  });
});
