import type { ReactElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Guide from './Guide';
import CompatGate from '../components/CompatGate';

/* Guide renders under REAL routes with a catch-all sentinel: a link that
   navigates away from /guide unmounts it (rendering the sentinel) — a
   plain element wrapper could never observe that regression. */
const renderWithRouter = (ui: ReactElement, { route = '/guide' } = {}) =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/guide" element={ui} />
        <Route path="*" element={<div data-testid="not-found">nothing here</div>} />
      </Routes>
    </MemoryRouter>,
  );

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

  it('distinguishes the local device truth from the online server truth (no absolute privacy claim)', () => {
    renderWithRouter(<Guide />);
    const text = document.body.textContent ?? '';
    expect(text).toContain('the one exception');
    expect(text).toContain('anonymous guest session');
    expect(text).toContain('display name you choose'); // the server stores the chosen name
    expect(text).not.toContain('No personal data'); // removed absolute claim
  });

  it('an in-guide cross-reference stays ON the guide (raw # anchors would break HashRouter)', async () => {
    const spy = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = spy;
    try {
      renderWithRouter(<Guide />, { route: '/guide' });
      fireEvent.click(screen.getByRole('link', { name: 'where your data lives' }));
      // the guide REMAINS mounted (never routed away) and the hash effect scrolls
      await vi.waitFor(() => expect(spy).toHaveBeenCalled());
      expect(screen.queryByTestId('not-found')).toBeNull();
      expect(screen.getByRole('heading', { name: 'A quiet place to play chess — how it works' })).toBeTruthy();
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('is reachable content, not an empty shell (back link present)', () => {
    renderWithRouter(<Guide />);
    expect(screen.getByRole('link', { name: 'Back to the board' })).toBeTruthy();
  });

  it('honors a section hash after the lazy page mounts', async () => {
    const spy = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = spy;
    try {
      renderWithRouter(<Guide />, { route: '/guide#storage' });
      await vi.waitFor(() => {
        expect(spy).toHaveBeenCalled();
        const target = spy.mock.calls[0]?.[0] as { block?: string } | undefined;
        expect(target?.block).toBe('start');
      });
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
