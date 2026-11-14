import { describe, expect, it } from 'vitest';
import { staleRoomAction } from '../../../supabase/functions/_shared/serverRules.ts';

/* Deterministic tests for the stale-room decision (F4): the elapsed vs
   remaining comparison is NUMERIC (an ISO-string subtraction produced
   NaN here — a banked-time game got a fake timeout win). */

const NOW = 1_800_000_000_000; // fixed numeric server reading
const HOUR = 3_600_000;

const activeRoom = (over: Partial<Parameters<typeof staleRoomAction>[0]> = {}) => ({
  status: 'active',
  turn: 'w' as const,
  turn_started_at: new Date(NOW - 25 * HOUR).toISOString(), // 25h of silence
  white_ms_remaining: 600_000,
  black_ms_remaining: 600_000,
  ...over,
});

describe('staleRoomAction', () => {
  it('a truly exhausted clock -> timeout adjudication', () => {
    // 25h elapsed vs 10 minutes remaining: flagged long ago
    expect(staleRoomAction(activeRoom(), NOW)).toBe('timeout');
  });

  it('banked-but-unexpired time -> NO fake win (plain abandon)', () => {
    // increments banked ~50h of remaining time; 25h elapsed < 50h left
    const banked = activeRoom({ white_ms_remaining: 50 * HOUR });
    expect(staleRoomAction(banked, NOW)).toBe('abandon');
  });

  it('the boundary is exact: elapsed === remaining is expired', () => {
    const exact = activeRoom({
      turn_started_at: new Date(NOW - 600_000).toISOString(),
      white_ms_remaining: 600_000,
    });
    expect(staleRoomAction(exact, NOW)).toBe('timeout');
  });

  it('a missing turn_started_at never produces a timeout', () => {
    expect(staleRoomAction(activeRoom({ turn_started_at: null }), NOW)).toBe('abandon');
  });

  it('waiting/ready rooms are simply abandoned', () => {
    expect(staleRoomAction(activeRoom({ status: 'waiting' }), NOW)).toBe('abandon');
    expect(staleRoomAction(activeRoom({ status: 'ready' }), NOW)).toBe('abandon');
  });

  it('completed/abandoned rooms need no action', () => {
    expect(staleRoomAction(activeRoom({ status: 'completed' }), NOW)).toBe('none');
    expect(staleRoomAction(activeRoom({ status: 'abandoned' }), NOW)).toBe('none');
  });
});
