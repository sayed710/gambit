/* ============================================================
   onboarding — first-run welcome state (stabilization PR-E).

   ONE versioned flag marks "the visitor has seen the welcome
   cards". The flag is COSMETIC: it is written with a plain,
   failure-tolerant save (never checkedSetJSON/reportPersistFailure)
   because the worst case of a lost flag is that the welcome
   shows again — raising the app-wide storage-failure banner for
   it would be noise, not honesty.

   Exported helpers are pure over localStorage so tests can drive
   both states without a browser reload.
   ============================================================ */

import { loadJSON, saveJSON } from './storage';

const KEY = 'onboarding.v1';

interface OnboardingRecord {
  seen: boolean;
  at: string;
}

export function hasSeenOnboarding(): boolean {
  return loadJSON<OnboardingRecord | null>(KEY, null)?.seen === true;
}

export function markOnboardingSeen(): void {
  // failure-tolerant by design — see the module comment
  saveJSON(KEY, { seen: true, at: new Date().toISOString() });
}

export function resetOnboardingForTests(): void {
  try {
    localStorage.removeItem('gambit.' + KEY);
  } catch {
    /* unavailable storage — nothing to reset */
  }
}
