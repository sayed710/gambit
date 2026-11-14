import { describe, expect, it, vi } from 'vitest';
import { expireIfStale, type GameRow } from '../../../supabase/functions/_shared/game.ts';

/* expireIfStale's execution contract with a MOCK admin client: the
   update payload matches the decision, and a CAS conflict never
   overwrites a newer result. */

const NOW = Date.now(); // the function reads the REAL clock internally
const HOUR = 3_600_000;

const baseGame = (over: Partial<GameRow> = {}): GameRow => ({
  id: '11111111-1111-1111-1111-111111111111',
  created_at: new Date(NOW - 26 * HOUR).toISOString(),
  updated_at: new Date(NOW - 25 * HOUR).toISOString(),
  creator_id: '22222222-2222-2222-2222-222222222222',
  white_id: '22222222-2222-2222-2222-222222222222',
  black_id: '33333333-3333-3333-3333-333333333333',
  white_name: 'White',
  black_name: 'Black',
  status: 'active',
  base_ms: 600_000,
  increment_ms: 0,
  start_fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  moves: [],
  version: 7,
  turn: 'w',
  white_ms_remaining: 600_000,
  black_ms_remaining: 600_000,
  turn_started_at: new Date(NOW - 25 * HOUR).toISOString(),
  white_ready: true,
  black_ready: true,
  ready_started_at: null,
  result: null,
  result_reason: null,
  draw_offer_by: null,
  pgn: null,
  last_move_id: null,
  ...over,
});

/** A mock admin client whose update() records the patch and returns the
    configured result (data or error). */
function mockAdmin(returnData: any, returnError: unknown = null) {
  const patches: any[] = [];
  const eqs: unknown[] = [];
  const builder = {
    update(patch: Record<string, unknown>) {
      patches.push(patch as any);
      return {
        eq(col: string, val: unknown) {
          eqs.push([col, val]);
          return this;
        },
        in() {
          return this;
        },
        select() {
          return this;
        },
        single() {
          return Promise.resolve({ data: returnData, error: returnError });
        },
      };
    },
    select() {
      return this;
    },
  };
  const admin = { from: () => builder } as unknown as Parameters<typeof expireIfStale>[0];
  return { admin, patches, eqs };
}

describe('expireIfStale (execution contract)', () => {
  it('a truly flagged active room is ADJUDICATED: completed + timeout + PGN', async () => {
    const adjudicated = baseGame({ status: 'completed', result: 'black', result_reason: 'timeout' });
    const { admin, patches } = mockAdmin(adjudicated);
    const game = baseGame();
    const out = await expireIfStale(admin, game);
    expect(patches[0].status).toBe('completed');
    expect(patches[0].result_reason).toBe('timeout');
    expect(typeof patches[0].pgn).toBe('string'); // PGN persisted for history
    expect(patches[0].white_ms_remaining).toBe(0); // white (to move) flagged
    expect((patches[0].version as number)).toBe(game.version + 1);
    expect(out.status).toBe('completed');
  });

  it('banked-but-unexpired time yields an ABANDON without a result', async () => {
    const abandoned = baseGame({ status: 'abandoned' });
    const { admin, patches } = mockAdmin(abandoned);
    const game = baseGame({ white_ms_remaining: 50 * HOUR }); // banked > 25h elapsed
    const out = await expireIfStale(admin, game);
    expect(patches[0].status).toBe('abandoned');
    expect('result' in patches[0]).toBe(false); // NO fabricated result
    expect(out.status).toBe('abandoned');
  });

  it('a CAS conflict does NOT overwrite a newer result', async () => {
    // a newer writer (e.g. a resignation that landed concurrently) won:
    // the update targets the OLD version, gets an error, and the caller
    // receives the stale input view — the DB keeps the newer outcome
    const newer = baseGame({
      status: 'completed',
      result: 'white',
      result_reason: 'resignation',
      version: 9,
    });
    const { admin, patches, eqs } = mockAdmin(null, { message: 'conflict' });
    const game = baseGame();
    const out = await expireIfStale(admin, game);
    expect(patches).toHaveLength(1);
    expect(eqs).toContainEqual(['version', 7]); // CAS on the seen version
    expect(out.version).toBe(7); // the stale view — the DB kept version 9
    expect(out.result_reason).toBeNull(); // nothing was overwritten here
    void newer;
  });

  it('a fresh (non-stale) room is returned untouched', async () => {
    const { admin, patches } = mockAdmin(null);
    const game = baseGame({ updated_at: new Date(NOW - HOUR).toISOString() }); // 1h old
    const out = await expireIfStale(admin, game);
    expect(patches).toHaveLength(0); // no update attempted
    expect(out.status).toBe('active');
    vi; // (import kept for symmetry with the other suites)
  });
});
