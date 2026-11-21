import type { ReactElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Guide from './Guide';
import CompatGate from '../components/CompatGate';

const renderWithRouter = (ui: ReactElement, { route = '/guide' } = {}) =>
  render(<MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>);

afterEach(() => cleanup());

describe('Guide page', () => {
  it('renders every anchorable section the product links to', () => {
    renderWithRouter(<Guide />);
    for (const id of ['start', 'storage', 'online', 'offline', 'ratings', 'compat', 'keyboard']) {
      expect(document.getElementById(id), `section #${id}`).toBeTruthy();
    }
  });

  it('states the storage truth honestly (clearing data deletes; exports survive a full store)', () => {
    renderWithRouter(<Guide />);
    const text = document.body.textContent ?? '';
    expect(text).toContain('deletes everything');
    expect(text).toContain('storage banner');
    expect(text).toContain('not a complete backup');
    expect(text).toContain('still be read and exported');
  });

  it('distinguishes the local device truth from the online server truth', () => {
    renderWithRouter(<Guide />);
    const text = document.body.textContent ?? '';
    expect(text).toContain('the one exception');
    expect(text).toContain('anonymous guest session');
  });

  it('is reachable content, not an empty shell (back link present)', () => {
    renderWithRouter(<Guide />);
    expect(screen.getByRole('link', { name: 'Back to the board' })).toBeTruthy();
  });

  it('honors a section hash after the lazy page mounts', () => {
    const spy = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = spy;
    try {
      renderWithRouter(<Guide />, { route: '/guide#storage' });
      vi.waitFor(() => {
        expect(spy).toHaveBeenCalled();
        const target = spy.mock.calls[0]?.[0] as { block?: string } | undefined;
        expect(target?.block).toBe('start');
      });
      // the scrolled section is the one the hash named
      const storageTop = document.getElementById('storage')!.getBoundingClientRect().top;
      expect(storageTop).toBeLessThan(50);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
});

describe('CompatGate', () => {
  it('names each missing capability with its reason and offers a reload', () => {
    renderWithRouter(<CompatGate missing={['web-worker']} />);
    const text = document.body.textContent ?? '';
    expect(text).toContain('Web Workers');
    expect(screen.getByRole('button', { name: 'Reload after fixing' })).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull(); // no app routes are mounted
  });
});
