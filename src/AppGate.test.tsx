import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import AppGate from './AppGate';
import { resetOnboardingForTests } from './lib/onboarding';

/* The compatibility decision must happen BEFORE any storage-writing
   provider mounts: an incompatible browser gets ONLY the gate (finding:
   "the blocked app still writes user data"). jsdom has no Worker, so the
   default runtime is incompatible here; the probe simulates a capable
   browser for the boot path. The gate is ASYNC: the module-worker
   self-test must complete before either outcome renders. */
afterEach(() => {
  cleanup();
  resetOnboardingForTests();
});

describe('AppGate', () => {
  it('an incompatible browser gets ONLY the gate — no app content mounts', async () => {
    render(<AppGate />); // default runtime: jsdom has no Worker
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('A higher standard for chess')).toBeNull(); // hero never mounted
    expect(screen.queryByRole('navigation')).toBeNull(); // no layout, no providers
  });

  it('REGRESSION: Worker exists but the module-worker self-test fails -> blocked with the specific reason', async () => {
    render(<AppGate probe={{ 'web-worker': true }} />);
    // jsdom cannot start the real module-worker probe -> it fails -> the
    // browser must NOT be classified compatible (owner regression #3)
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Module workers');
  });

  it('a capable browser boots the real app', async () => {
    render(<AppGate probe={{ 'web-worker': true, 'module-worker': true, webassembly: true }} />);
    expect(await screen.findByText('A higher standard for chess')).toBeTruthy(); // Home hero mounted
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
