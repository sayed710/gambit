import { describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import TrainTabs, { TRAIN_TABS } from './TrainTabs';

afterEach(cleanup);

describe('TrainTabs — single shared training navigation', () => {
  it('renders every training destination exactly once', () => {
    render(
      <MemoryRouter>
        <TrainTabs current="/training" />
      </MemoryRouter>,
    );
    for (const t of TRAIN_TABS) {
      expect(screen.getAllByText(t.label)).toHaveLength(1);
    }
  });

  it('marks exactly one tab active', () => {
    render(
      <MemoryRouter initialEntries={['/endgames']}>
        <TrainTabs current="/endgames" />
      </MemoryRouter>,
    );
    const active = screen.getAllByRole('link').filter((el) => el.className.includes('on'));
    expect(active).toHaveLength(1);
    expect(active[0].getAttribute('href')).toBe('/endgames');
  });

  it('covers the five documented training areas', () => {
    expect(TRAIN_TABS.map((t) => t.to)).toEqual([
      '/training',
      '/puzzles',
      '/repertoire',
      '/endgames',
      '/coordinates',
    ]);
  });
});
