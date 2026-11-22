import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Review from './Review';
import { SettingsProvider } from '../state/SettingsContext';
import { ProfileProvider } from '../state/ProfileContext';
import { ToastProvider } from '../components/Toast';
import { Chess } from 'chess.js';
import type { GameRecord } from '../lib/types';
import type { GameReport } from '../lib/review';

/* ============================================================
   Review cache-recovery integration (Gambit 2.0 M1 quality gate).

   The engine hook is mocked at the useEngine seam: evaluate() is
   the ONLY thing runGameAnalysis consumes from it, so these tests
   drive the REAL Review flow — cache fast path, reanalysis, cache
   replacement, Lab send, failure honesty — without any worker.
   ============================================================ */

const MOVES = ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#'];

const engineMock = vi.hoisted(() => ({
  evaluate: vi.fn(),
}));

vi.mock('../lib/engine/useEngine', () => ({
  useEngine: () => ({ evaluate: engineMock.evaluate, search: vi.fn() }),
}));

function replayFens(): string[] {
  const game = new Chess();
  const fens = [game.fen()];
  for (const san of MOVES) {
    game.move(san);
    fens.push(game.fen());
  }
  return fens;
}

/** Engine script keyed by POSITION (not call order — the page's live-eval
    probe interleaves with the analysis pass): white blunders with Qh5 —
    the position before it has the verified best move Nf3, the position
    after is much worse for white. */
function scriptEngine() {
  const fens = replayFens();
  const script = new Map<string, { cp: number; mateIn: number | null; bestSan: string | null }>([
    [fens[2], { cp: 0, mateIn: null, bestSan: 'Nf3' }],
    [fens[3], { cp: -400, mateIn: null, bestSan: null }],
    [fens[7], { cp: 9500, mateIn: 1, bestSan: null }],
  ]);
  engineMock.evaluate.mockImplementation(async (fen: string) => script.get(fen) ?? { cp: 0, mateIn: null, bestSan: null, depth: 12 });
}

function gameRecord(): GameRecord {
  return {
    id: 'g1',
    date: 1_800_000_000_000 - 86_400_000,
    mode: 'ai',
    timeControl: { id: 'rapid10', label: '10 min', category: 'Rapid', minutes: 10, increment: 0 },
    playerColor: 'w',
    opponentName: 'Engine',
    opponentRating: 1200,
    result: 'win',
    reason: 'checkmate',
    moves: MOVES,
    pgn: MOVES.join(' '),
    ratingBefore: 1200,
    ratingAfter: 1216,
  };
}

/** A structurally complete report for the REAL line (passes the old
    structural fast path); `corrupt` swaps one cached SAN so the shared
    semantic verification must reject it. */
function healthyCache(corrupt = false): GameReport {
  const reviews = MOVES.map((san, i) => ({
    san: corrupt && i === 4 ? 'Qf3' : san,
    color: (i % 2 === 0 ? 'w' : 'b') as 'w' | 'b',
    cpl: i === 2 ? 320 : 0,
    classification: (i === 2 ? 'blunder' : 'best') as never,
  }));
  const evals = Array.from({ length: MOVES.length + 1 }, (_, i) => ({
    cp: 0,
    mateIn: null,
    bestSan: i === 2 ? 'Nf3' : null,
  }));
  return { reviews, evals, accuracy: { w: 90, b: 85 }, counts: { w: {}, b: {} }, avgCpl: { w: 10, b: 20 } } as unknown as GameReport;
}

function seedGame() {
  localStorage.setItem('gambit.profile', JSON.stringify({ games: [gameRecord()] }));
}

function labStore() {
  return JSON.parse(localStorage.getItem('gambit.mistakeLab.v1') ?? 'null');
}

function harness() {
  return render(
    <ToastProvider>
      <SettingsProvider>
        <ProfileProvider>
          <MemoryRouter initialEntries={['/review/g1']}>
            <Routes>
              <Route path="/review/:id" element={<Review />} />
              <Route path="*" element={<div data-testid="not-found">nothing</div>} />
            </Routes>
          </MemoryRouter>
        </ProfileProvider>
      </SettingsProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  engineMock.evaluate.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('Review cache-recovery flow (real page, mocked engine seam)', () => {
  it('a healthy cache is REUSED — no engine analysis runs at all', { timeout: 20_000 }, async () => {
    seedGame();
    localStorage.setItem('gambit.review.g1', JSON.stringify(healthyCache()));
    scriptEngine();
    harness();
    // the report renders straight from the cache
    expect(await screen.findByRole('button', { name: 'Learn from your mistakes' }, { timeout: 10000 })).toBeTruthy();
    // the full analysis pass would call the engine plies+1 times; the fast
    // path runs at most the single final-position live probe
    expect(engineMock.evaluate.mock.calls.length).toBeLessThan(MOVES.length + 1);
  });

  it('a same-length cache with an INCORRECT SAN is rejected: fresh analysis runs and REPLACES the cache', async () => {
    seedGame();
    localStorage.setItem('gambit.review.g1', JSON.stringify(healthyCache(true))); // reviews[4].san = 'Qf3'
    scriptEngine();
    harness();
    // reanalysis runs through the real flow (the engine seam IS used)
    await waitFor(() => expect(engineMock.evaluate).toHaveBeenCalled());
    // onComplete replaced the damaged cache with the FRESH report
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('gambit.review.g1') ?? 'null') as GameReport | null;
      expect(stored?.reviews[4]?.san).toBe('Bc4'); // canonical, not the corrupt text
    });
    // and the report is live
    expect(await screen.findByRole('button', { name: 'Learn from your mistakes' })).toBeTruthy();
  });

  it('after reanalysis the verified mistakes reach the Mistake Lab', async () => {
    seedGame();
    localStorage.setItem('gambit.review.g1', JSON.stringify(healthyCache(true)));
    scriptEngine();
    harness();
    await screen.findByRole('button', { name: 'Learn from your mistakes' });
    fireEvent.click(screen.getByRole('button', { name: 'Send mistakes to the Lab' }));
    await waitFor(() => expect(screen.getByText(/Sent 1 mistake to the Lab/)).toBeTruthy());
    const stored = labStore();
    expect(stored.exercises).toHaveLength(1);
    expect(stored.exercises[0].id).toBe('g1:2');
    expect(stored.exercises[0].bestSan).toBe('Nf3'); // the verified answer, not invented
  });

  it('a FAILED reanalysis (engine answers nothing) does not report success or overwrite the cache', async () => {
    seedGame();
    const damaged = healthyCache(true);
    localStorage.setItem('gambit.review.g1', JSON.stringify(damaged));
    engineMock.evaluate.mockRejectedValue(new Error('engine down')); // every evaluation fails
    harness();
    // the analysis finishes with an all-null report — the guard refuses it
    await waitFor(() => expect(screen.getByText(/engine could not analyze this game/)).toBeTruthy());
    // the damaged cache was NOT overwritten by the unusable all-null report
    const stored = JSON.parse(localStorage.getItem('gambit.review.g1') ?? 'null') as GameReport | null;
    expect(stored?.reviews[4]?.san).toBe('Qf3'); // still the (damaged) original — untouched
    expect(screen.queryByRole('button', { name: 'Learn from your mistakes' })).toBeNull(); // no false success
    // and an IN-PLACE retry control exists (no leave-and-reopen needed)
    expect(screen.getByRole('button', { name: 'Retry analysis' })).toBeTruthy();
    scriptEngine(); // the engine recovers...
    fireEvent.click(screen.getByRole('button', { name: 'Retry analysis' }));
    expect(await screen.findByRole('button', { name: 'Learn from your mistakes' }, { timeout: 10000 })).toBeTruthy();
    // the retry replaced the damaged cache with a fresh, usable report
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('gambit.review.g1') ?? 'null') as GameReport | null;
      expect(stored?.reviews[4]?.san).toBe('Bc4');
    });
  });

  it('an INTERRUPTED reanalysis (unmount mid-run) leaves the cache untouched', async () => {
    seedGame();
    const damaged = healthyCache(true);
    localStorage.setItem('gambit.review.g1', JSON.stringify(damaged));
    engineMock.evaluate.mockImplementation(() => new Promise(() => {})); // never resolves
    const { unmount } = harness();
    await waitFor(() => expect(engineMock.evaluate).toHaveBeenCalled());
    unmount(); // the player navigates away mid-analysis
    await new Promise((r) => setTimeout(r, 50));
    const stored = JSON.parse(localStorage.getItem('gambit.review.g1') ?? 'null') as GameReport | null;
    expect(stored?.reviews[4]?.san).toBe('Qf3'); // nothing was written back
  });
});
