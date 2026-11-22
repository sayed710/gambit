import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import MistakeLab from './MistakeLab';
import { SettingsProvider } from '../state/SettingsContext';
import { ProfileProvider } from '../state/ProfileContext';
import { ToastProvider } from '../components/Toast';
import type { GameRecord } from '../lib/types';
import type { GameReport } from '../lib/review';

/* The full harness the page expects (providers + router), against REAL
   localStorage — the lab store is verified-persisted data. */

const MOVES = ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#'];

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

function reviewReport(): GameReport {
  const reviews = MOVES.map((san, i) => ({
    san,
    color: (i % 2 === 0 ? 'w' : 'b') as 'w' | 'b',
    cpl: i === 2 ? 320 : 0,
    classification: (i === 2 ? 'blunder' : 'best') as never,
  }));
  const evals = Array.from({ length: MOVES.length + 1 }, (_, i) => ({ cp: 0, mateIn: null, bestSan: i === 2 ? 'Nf3' : null }));
  return { reviews, evals, accuracy: { w: 90, b: 85 }, counts: { w: {}, b: {} }, avgCpl: { w: 10, b: 20 } } as unknown as GameReport;
}

function seedProfile() {
  localStorage.setItem('gambit.profile', JSON.stringify({ games: [gameRecord()] }));
}

function harness() {
  return render(
    <ToastProvider>
      <SettingsProvider>
        <ProfileProvider>
          <MemoryRouter>
            <MistakeLab />
          </MemoryRouter>
        </ProfileProvider>
      </SettingsProvider>
    </ToastProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('MistakeLab page', () => {
  it('an empty lab states honestly where exercises come from', () => {
    harness();
    expect(screen.getByText(/Nothing in the lab yet/)).toBeTruthy();
    expect(screen.getByText('Exercises: 0')).toBeTruthy();
  });

  it('Sync harvests verified mistakes from the review cache and updates the stats', async () => {
    seedProfile();
    localStorage.setItem('gambit.review.g1', JSON.stringify(reviewReport()));
    harness();
    fireEvent.click(screen.getByRole('button', { name: 'Sync from reviewed games' }));
    await waitFor(() => expect(screen.getByText(/Added 1 exercise from 1 reviewed game/)).toBeTruthy());
    expect(screen.getByText('Exercises: 1')).toBeTruthy();
    // the exercise table names the played move and the engine's answer
    expect(screen.getByText('Qh5')).toBeTruthy();
    expect(screen.getByText('Nf3')).toBeTruthy();
  });

  it('a full session: start, solve the position on the board, finish — persisted', async () => {
    seedProfile();
    localStorage.setItem('gambit.review.g1', JSON.stringify(reviewReport()));
    harness();
    fireEvent.click(screen.getByRole('button', { name: 'Sync from reviewed games' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start session (1)' }));
    // the runner presents the REAL decision context
    expect(screen.getByText(/you played/)).toBeTruthy();
    expect(screen.getAllByText('Qh5').length).toBeGreaterThan(0);
    // solve it: g1 -> f3 is the engine's move (Nf3). A one-exercise queue
    // lands straight on the summary — the solving click IS the session end.
    const g1 = document.querySelector('[data-square="g1"]') as HTMLElement | null;
    const f3 = document.querySelector('[data-square="f3"]') as HTMLElement | null;
    expect(g1).toBeTruthy();
    expect(f3).toBeTruthy();
    if (!g1 || !f3) throw new Error('board squares missing');
    fireEvent.click(g1);
    fireEvent.click(f3);
    await waitFor(() => expect(screen.getByText('Session complete')).toBeTruthy());
    expect(screen.getByText('clean solve')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    const stored = JSON.parse(localStorage.getItem('gambit.mistakeLab.v1') ?? '{}');
    expect(stored.session).toBeNull();
    expect(stored.exercises[0].attempts).toBe(1);
    expect(stored.exercises[0].solved).toBe(1);
  });

  it('an interrupted session resumes exactly where it stopped', () => {
    seedProfile();
    localStorage.setItem('gambit.review.g1', JSON.stringify(reviewReport()));
    // seed a lab store whose session already advanced past exercise 1 of 2
    const exercise = {
      id: 'g1:2',
      gameId: 'g1',
      opponent: 'Engine',
      playedAt: 1,
      ply: 2,
      fenBefore: new Chess('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2').fen(),
      side: 'w',
      playedSan: 'Qh5',
      bestSan: 'Nf3',
      classification: 'blunder',
      cpl: 320,
      createdAt: 1,
      attempts: 0,
      solved: 0,
      lastPracticed: null,
      sr: { due: 0, interval: 0, reps: 0, ease: 2.5, lapses: 0, lastResult: null },
    };
    localStorage.setItem(
      'gambit.mistakeLab.v1',
      JSON.stringify({
        version: 1,
        exercises: [exercise, { ...exercise, id: 'g1:9', ply: 9, fenBefore: exercise.fenBefore }],
        session: { queue: ['g1:2', 'g1:9'], index: 1, startedAt: 1, results: [{ id: 'g1:2', outcome: 'clean' }] },
        lastHarvestAt: 1,
      }),
    );
    harness();
    // the runner resumes at index 1 — "exercise 2 of 2", not a restart
    expect(screen.getByText(/Session · exercise 2 of 2/)).toBeTruthy();
    expect(screen.getByText(/1 clean so far/)).toBeTruthy();
  });

  it('REGRESSION: persisted attempt flags survive a reload (no fake clean solves)', async () => {
    // the session flags say this attempt ALREADY had a wrong guess —
    // solving now must record 'after-wrong', never a clean solve
    seedProfile();
    localStorage.setItem('gambit.review.g1', JSON.stringify(reviewReport()));
    const exercise = labExerciseFixture();
    localStorage.setItem(
      'gambit.mistakeLab.v1',
      JSON.stringify({
        version: 1,
        exercises: [exercise],
        session: {
          queue: ['g1:2'],
          index: 0,
          startedAt: 1,
          results: [],
          flags: { 'g1:2': { assisted: false, firstTry: false } },
        },
        lastHarvestAt: 1,
      }),
    );
    harness();
    const g1 = document.querySelector('[data-square="g1"]') as HTMLElement | null;
    const f3 = document.querySelector('[data-square="f3"]') as HTMLElement | null;
    fireEvent.click(g1 as HTMLElement);
    fireEvent.click(f3 as HTMLElement);
    await waitFor(() => expect(screen.getByText('Session complete')).toBeTruthy());
    // 'after-wrong', NOT 'clean solve' — the persisted flag survived
    expect(screen.queryByText('clean solve')).toBeNull();
    expect(screen.getByText(/solved after retries/)).toBeTruthy();
  });

  it('the answer column is HIDDEN for queued exercises during a session', () => {
    seedProfile();
    localStorage.setItem('gambit.review.g1', JSON.stringify(reviewReport()));
    const exercise = labExerciseFixture();
    localStorage.setItem(
      'gambit.mistakeLab.v1',
      JSON.stringify({
        version: 1,
        exercises: [exercise, { ...exercise, id: 'g1:9', ply: 9 }],
        session: { queue: ['g1:2', 'g1:9'], index: 0, startedAt: 1, results: [], flags: {} },
        lastHarvestAt: 1,
      }),
    );
    harness();
    // both queued exercises show a masked answer while the session runs
    const masked = screen.getAllByText('—');
    expect(masked.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Engine moves are hidden/)).toBeTruthy();
  });

  it('a verified UNDERPROMOTION answer is playable (the piece follows the answer)', async () => {
    seedProfile();
    // a real promotion position: white pawn g7, kings apart; g8=N is legal
    const exercise = {
      id: 'gp:8',
      gameId: 'gp',
      opponent: 'Promo',
      playedAt: 1,
      ply: 8,
      fenBefore: '4k3/6P1/8/8/8/8/8/6K1 w - - 0 1',
      side: 'w' as const,
      playedSan: 'g8=Q+',
      bestSan: 'g8=N',
      classification: 'mistake' as const,
      cpl: 200,
      createdAt: 1,
      attempts: 0,
      solved: 0,
      lastPracticed: null,
      sr: { due: 0, interval: 0, reps: 0, ease: 2.5, lapses: 0, lastResult: null },
    };
    localStorage.setItem(
      'gambit.mistakeLab.v1',
      JSON.stringify({
        version: 1,
        exercises: [exercise],
        session: { queue: ['gp:8'], index: 0, startedAt: 1, results: [], flags: {} },
        lastHarvestAt: 1,
      }),
    );
    harness();
    fireEvent.click(document.querySelector('[data-square="g7"]') as HTMLElement);
    fireEvent.click(document.querySelector('[data-square="g8"]') as HTMLElement);
    await waitFor(() => expect(screen.getByText('Session complete')).toBeTruthy());
    // the queen move would be WRONG here (g8=Q+ ≠ g8=N) — a clean solve
    // proves the runner entered the knight as the verified answer demands
    expect(screen.getByText('clean solve')).toBeTruthy();
  });
});

function labExerciseFixture() {
  return {
    id: 'g1:2',
    gameId: 'g1',
    opponent: 'Engine',
    playedAt: 1,
    ply: 2,
    fenBefore: new Chess('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2').fen(),
    side: 'w' as const,
    playedSan: 'Qh5',
    bestSan: 'Nf3',
    classification: 'blunder' as const,
    cpl: 320,
    createdAt: 1,
    attempts: 0,
    solved: 0,
    lastPracticed: null,
    sr: { due: 0, interval: 0, reps: 0, ease: 2.5, lapses: 0, lastResult: null },
  };
}
