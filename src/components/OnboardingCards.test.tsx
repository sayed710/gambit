import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { hasSeenOnboarding, markOnboardingSeen, resetOnboardingForTests } from '../lib/onboarding';
import OnboardingCards from './OnboardingCards';

const renderCards = () =>
  render(
    <MemoryRouter>
      <OnboardingCards />
    </MemoryRouter>,
  );

afterEach(() => {
  cleanup();
  resetOnboardingForTests();
});

describe('OnboardingCards (first-run welcome)', () => {
  it('a fresh visitor sees exactly three welcome cards', () => {
    renderCards();
    expect(screen.getByRole('region', { name: 'Welcome to Gambit' })).toBeTruthy();
    expect(screen.getAllByRole('article').length).toBe(3);
    expect(screen.getByRole('button', { name: 'Got it' })).toBeTruthy();
  });

  it('dismissing persists the flag and removes the cards immediately', () => {
    renderCards();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('region', { name: 'Welcome to Gambit' })).toBeNull();
    expect(hasSeenOnboarding()).toBe(true);
  });

  it('a returning visitor never sees the cards again', () => {
    markOnboardingSeen();
    renderCards();
    expect(screen.queryByRole('region', { name: 'Welcome to Gambit' })).toBeNull();
  });

  it('following a card call to action also dismisses the welcome', () => {
    renderCards();
    fireEvent.click(screen.getByRole('link', { name: 'Start a game' }));
    expect(screen.queryByRole('region', { name: 'Welcome to Gambit' })).toBeNull();
    expect(hasSeenOnboarding()).toBe(true);
  });

  it('the cards cover the three honest topics (play, storage, online)', () => {
    renderCards();
    for (const title of ['Play and learn', 'Your games stay on this device', 'Play someone online']) {
      expect(screen.getByText(title)).toBeTruthy();
    }
  });
});
