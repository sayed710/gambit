import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import AppGate from './AppGate';
import { resetOnboardingForTests } from './lib/onboarding';

/* The compatibility decision must happen BEFORE any storage-writing
   provider mounts: an incompatible browser gets ONLY the gate (finding:
   "the blocked app still writes user data"). jsdom has no Worker, so the
   default runtime is incompatible here; the probe simulates a capable
   browser for the boot path. */
afterEach(() => {
  cleanup();
  resetOnboardingForTests();
});

describe('AppGate', () => {
  it('an incompatible browser gets ONLY the gate — no app content mounts', () => {
    render(<AppGate />); // default runtime: jsdom has no Worker
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByText('A higher standard for chess')).toBeNull(); // hero never mounted
    expect(screen.queryByRole('navigation')).toBeNull(); // no layout, no providers
  });

  it('a capable browser boots the real app', () => {
    render(<AppGate probe={{ 'web-worker': true, webassembly: true }} />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('A higher standard for chess')).toBeTruthy(); // Home hero mounted
  });
});
