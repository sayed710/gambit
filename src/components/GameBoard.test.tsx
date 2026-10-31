import type { ComponentProps } from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { SettingsProvider } from '../state/SettingsContext';
import GameBoardDefault, { badgeOffset } from './GameBoard';
const Board = (props: ComponentProps<typeof GameBoardDefault>) => (
  <SettingsProvider>
    <GameBoardDefault {...props} />
  </SettingsProvider>
);

/* ============================================================
   Review quality badges — the classification badge pinned to the
   moved piece's destination square.
   ============================================================ */

describe('badgeOffset', () => {
  it('white orientation: a1 bottom-left, h8 top-right', () => {
    expect(badgeOffset('a1', 'white')).toEqual({ left: '0%', top: '87.5%' });
    expect(badgeOffset('h8', 'white')).toEqual({ left: '87.5%', top: '0%' });
  });

  it('black orientation flips both axes', () => {
    expect(badgeOffset('a1', 'black')).toEqual({ left: '87.5%', top: '0%' });
    expect(badgeOffset('h8', 'black')).toEqual({ left: '0%', top: '87.5%' });
  });
});

describe('GameBoard squareBadge', () => {
  it('renders the glyph on the destination square', () => {
    const { container } = render(
      <Board
        boardId="t"
        fen="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
        orientation="white"
        squareBadge={{ square: 'e4', text: '!', color: '#7ac70c', title: 'Best — e4' }}
      />,
    );
    const badge = container.querySelector('[data-square-badge="e4"]');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe('!');
    expect((badge as HTMLElement).style.background).toBe('rgb(122, 199, 12)'); // #7ac70c
    expect(badge?.getAttribute('aria-hidden')).toBe('true'); // the move list carries the info
  });

  it('the badge layer never intercepts clicks or drags', () => {
    const { container } = render(
      <Board
        boardId="t2"
        fen="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
        orientation="white"
        squareBadge={{ square: 'd4', text: '\u2605', color: '#26c2a3', title: 'Great' }}
      />,
    );
    const layer = container.querySelector('[data-square-badge]')?.parentElement as HTMLElement;
    expect(layer.style.pointerEvents).toBe('none');
  });

  it('no badge without one', () => {
    const { container } = render(
      <Board boardId="t3" fen="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" orientation="white" />,
    );
    expect(container.querySelector('[data-square-badge]')).toBeNull();
  });
});
