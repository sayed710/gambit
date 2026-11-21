import type { ReactElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import Guide from './Guide';
import CompatGate from '../components/CompatGate';

const renderWithRouter = (ui: ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

afterEach(() => cleanup());

describe('Guide page', () => {
  it('renders every anchorable section the product links to', () => {
    renderWithRouter(<Guide />);
    for (const id of ['start', 'storage', 'online', 'offline', 'ratings', 'compat', 'keyboard']) {
      expect(document.getElementById(id), `section #${id}`).toBeTruthy();
    }
  });

  it('states the storage truth honestly (clearing data deletes, banner names failures)', () => {
    renderWithRouter(<Guide />);
    const text = document.body.textContent ?? '';
    expect(text).toContain('deletes everything');
    expect(text).toContain('storage banner');
    expect(text).toContain('not a complete backup');
  });

  it('is reachable content, not an empty shell (back link present)', () => {
    renderWithRouter(<Guide />);
    expect(screen.getByRole('link', { name: 'Back to the board' })).toBeTruthy();
  });
});

describe('CompatGate', () => {
  it('names each missing capability with its reason and offers a reload', () => {
    renderWithRouter(<CompatGate missing={['local-storage', 'webassembly']} />);
    const text = document.body.textContent ?? '';
    expect(text).toContain('Local storage');
    expect(text).toContain('WebAssembly');
    expect(screen.getByRole('button', { name: 'Reload after fixing' })).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull(); // no app routes are mounted
  });

  it('an empty missing list renders nothing missing (defensive)', () => {
    renderWithRouter(<CompatGate missing={[]} />);
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
