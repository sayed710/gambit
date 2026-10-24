import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Training from './Training';
import { SettingsProvider } from '../state/SettingsContext';
import { ProfileProvider } from '../state/ProfileContext';
import { ToastProvider } from '../components/Toast';
import type { PracticeItem } from '../lib/practiceQueue';

/* ============================================================
   PracticeRunner lifecycle: every distinct item id must start a
   completely fresh session — no resolved/assisted/first-try
   state, hint, reveal or feedback may leak across items, even
   when two items share the same FEN (PR #1 final review).
   ============================================================ */

afterEach(cleanup);

const FEN = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPPPPPP/RNBQKBNR w KQkq - 0 2'; // after 1.e4 e5

function seed(items: PracticeItem[]) {
  localStorage.clear();
  localStorage.setItem('gambit.practice.v1', JSON.stringify(items));
}

function mkItem(id: string, expectedSan: string, objective: string): PracticeItem {
  return {
    id,
    kind: 'mistake',
    fen: FEN,
    side: 'w',
    objective,
    expectedSan,
    createdAt: 1,
    attempts: 0,
    solved: 0,
    lastPracticed: null,
  };
}

function readItem(id: string): PracticeItem | undefined {
  return (JSON.parse(localStorage.getItem('gambit.practice.v1') ?? '[]') as PracticeItem[]).find((x) => x.id === id);
}

function openItem(objective: string) {
  // each card's main button carries the objective text; its sibling Practice button opens the runner
  fireEvent.click(screen.getAllByText(objective)[0].closest('button')!);
}

function ui() {
  return render(
    <ToastProvider>
      <SettingsProvider>
        <ProfileProvider>
          <MemoryRouter>
            <Training />
          </MemoryRouter>
        </ProfileProvider>
      </SettingsProvider>
    </ToastProvider>,
  );
}

/** click-move through the board (the runner's canonical interaction path). */
function playSquare(from: string, to: string) {
  fireEvent.click(document.querySelector(`[data-square="${from}"]`)!);
  fireEvent.click(document.querySelector(`[data-square="${to}"]`)!);
}

describe('PracticeRunner session lifecycle', () => {
  it('solving A then selecting B records B; A stays unchanged (same FEN, different ids)', async () => {
    seed([mkItem('a', 'Nf3', 'Find Nf3 (A)'), mkItem('b', 'Nc3', 'Find Nc3 (B)')]);
    ui();

    openItem('Find Nf3 (A)');
    await waitFor(() => expect(document.querySelector('[data-square="e2"]')).toBeTruthy());
    playSquare('g1', 'f3'); // solve A cleanly
    await waitFor(() => expect(readItem('a')).toMatchObject({ attempts: 1, solved: 1 }));

    // switch WITHOUT exiting: the list stays mounted above the runner
    openItem('Find Nc3 (B)');
    // card + runner aside both show the objective once B's session is mounted
    await waitFor(() => expect(screen.getAllByText('Find Nc3 (B)').length).toBeGreaterThanOrEqual(2));
    playSquare('b1', 'c3'); // solve B first-try — must be recorded as clean
    await waitFor(() => expect(readItem('b')).toMatchObject({ attempts: 1, solved: 1 }));
    expect(readItem('a')).toMatchObject({ attempts: 1, solved: 1 }); // A untouched by B's session
  });

  it('hint state does not leak: hint on A, switch to B, B solves clean', async () => {
    seed([mkItem('a', 'Nf3', 'Find Nf3 (A2)'), mkItem('b', 'Nc3', 'Find Nc3 (B2)')]);
    ui();

    openItem('Find Nf3 (A2)');
    await waitFor(() => expect(document.querySelector('[data-square="e2"]')).toBeTruthy());
    fireEvent.click(screen.getAllByText('Hint')[0]); // assisted flag set on A's session only
    openItem('Find Nc3 (B2)');
    await waitFor(() => expect(screen.getAllByText('Find Nc3 (B2)').length).toBeGreaterThanOrEqual(2));
    playSquare('b1', 'c3');
    await waitFor(() => expect(readItem('b')).toMatchObject({ attempts: 1, solved: 1 }));
    expect(readItem('a')).toMatchObject({ attempts: 0, solved: 0 }); // A never resolved
  });

  it('a completed session cannot record another attempt by replaying moves', async () => {
    seed([mkItem('a', 'Nf3', 'Find Nf3 (A3)')]);
    ui();

    openItem('Find Nf3 (A3)');
    await waitFor(() => expect(document.querySelector('[data-square="e2"]')).toBeTruthy());
    playSquare('g1', 'f3');
    await waitFor(() => expect(readItem('a')).toMatchObject({ attempts: 1, solved: 1 }));
    playSquare('b1', 'c3'); // wrong move after resolution — must not record or even count
    playSquare('g1', 'f3'); // replay of the solve — must not record again
    await new Promise((r) => setTimeout(r, 50));
    expect(readItem('a')).toMatchObject({ attempts: 1, solved: 1 });
  });
});
