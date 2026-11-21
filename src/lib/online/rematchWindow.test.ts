import { describe, expect, it } from 'vitest';
import { REMATCH_WINDOW_MS, rematchWindowElapsed } from '../../../supabase/functions/_shared/serverRules.ts';

/* The renewal affordance gate: the local timestamp reading decides only
   whether the RENEW button shows — never whether the offer IS expired
   (the server adjudicates on the database clock). */

const NOW = 1_800_000_000_000; // fixed numeric reading

describe('rematchWindowElapsed', () => {
  it('a fresh offer (5 minutes) is NOT past the window', () => {
    expect(rematchWindowElapsed(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe(false);
  });

  it('the boundary is exact: a full 10-minute window counts as elapsed', () => {
    expect(rematchWindowElapsed(new Date(NOW - REMATCH_WINDOW_MS).toISOString(), NOW)).toBe(true);
  });

  it('11 minutes (the backdated regression) is elapsed', () => {
    expect(rematchWindowElapsed(new Date(NOW - 11 * 60_000).toISOString(), NOW)).toBe(true);
  });

  it('a missing or unreadable timestamp never claims expiry', () => {
    expect(rematchWindowElapsed(null, NOW)).toBe(false);
    expect(rematchWindowElapsed('not-a-date', NOW)).toBe(false);
  });

  it('a future timestamp (clock running backwards) is not elapsed', () => {
    expect(rematchWindowElapsed(new Date(NOW + 60_000).toISOString(), NOW)).toBe(false);
  });
});
