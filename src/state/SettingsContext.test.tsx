import { beforeEach, describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import { initializeSettings, SettingsProvider, useSettings } from './SettingsContext';
import { loadJSON, saveJSON } from '../lib/storage';

/* F1 regression suite — the board theme contract:
   Walnut is the DEFAULT for fresh settings; every explicitly saved theme
   (including the retired-as-default Glacier) persists across reloads.
   No migration may rewrite a user's stored choice. */

const read = () => initializeSettings().boardTheme;

/** Renders the provider and returns the context's set() via a probe. */
function renderProvider() {
  let exposed: ReturnType<typeof useSettings> | null = null;
  function Probe() {
    exposed = useSettings();
    return null;
  }
  render(
    <SettingsProvider>
      <Probe />
    </SettingsProvider>,
  );
  return () => {
    if (!exposed) throw new Error('probe not mounted');
    return exposed;
  };
}

describe('initializeSettings (board theme persistence)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('no saved settings -> Walnut (the new default)', () => {
    expect(read()).toBe('walnut');
  });

  it('a saved Glacier preference is PRESERVED (not migrated away)', () => {
    saveJSON('settings', { boardTheme: 'glacier' });
    expect(read()).toBe('glacier');
    // a "reload" (re-initialization) keeps it
    expect(read()).toBe('glacier');
  });

  it('other saved themes remain unchanged', () => {
    for (const theme of ['seaice', 'polarnight', 'aurora', 'frost', 'walnut']) {
      saveJSON('settings', { boardTheme: theme });
      expect(read()).toBe(theme);
    }
  });

  it('round-trip: the user changes Walnut -> Glacier through the provider and it survives a reload', () => {
    // first visit: fresh default
    expect(read()).toBe('walnut');

    // the user opens Settings and picks Glacier — the provider persists it
    const getCtx = renderProvider();
    act(() => {
      getCtx().set('boardTheme', 'glacier');
    });
    expect((loadJSON('settings', {}) as { boardTheme?: string }).boardTheme).toBe('glacier');

    // "reload": a fresh provider reads the persisted choice
    expect(read()).toBe('glacier');
  });

  it('round-trip back: Glacier -> Walnut through the provider also persists', () => {
    saveJSON('settings', { boardTheme: 'glacier' });
    const getCtx = renderProvider();
    act(() => {
      getCtx().set('boardTheme', 'walnut');
    });
    expect(read()).toBe('walnut');
  });
});
