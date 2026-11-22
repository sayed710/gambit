import { useState } from 'react';
import { Link } from 'react-router-dom';
import { hasSeenOnboarding, markOnboardingSeen } from '../lib/onboarding';

/* ============================================================
   OnboardingCards — the first-run welcome (stabilization PR-E).

   Three quiet cards, shown ONCE on Home until the visitor
   dismisses them or follows a card's call to action. No streaks,
   no urgency, no nagging: the honest three-sentence tour of what
   Gambit is (play + learn), where data lives (this device), and
   the newest capability (online rooms).
   ============================================================ */

const CARDS = [
  {
    to: '/play',
    icon: '♟',
    title: 'Play and learn',
    body: 'Face the engine at four honest strengths, replay your games with review and coaching, and train openings, endgames, and blindfold visualization.',
    cta: 'Start a game',
  },
  {
    to: '/guide#storage',
    icon: '⛁',
    title: 'Your games stay on this device',
    body: 'Local games and training are saved in this browser — no account needed. Online rooms run on a server so two browsers can play, using an anonymous guest session. Backups export as a file you own.',
    cta: 'How storage works',
  },
  {
    to: '/online',
    icon: ' ♞',
    title: 'Play someone online',
    body: 'Create a room, share the invite link, and play in real time with real clocks. Finished? Offer a rematch with swapped colors in one click.',
    cta: 'Open the lobby',
  },
] as const;

export default function OnboardingCards() {
  const [visible, setVisible] = useState(() => !hasSeenOnboarding());
  if (!visible) return null;

  const dismiss = () => {
    markOnboardingSeen();
    setVisible(false);
  };

  return (
    <section className="onboarding" aria-label="Welcome to Gambit">
      <div className="container">
        <div className="onboarding-head">
          <p className="section-label">Welcome</p>
          <h2>Three things worth knowing</h2>
        </div>
        <div className="onboarding-grid">
          {CARDS.map((card) => (
            <article key={card.to} className="onboarding-card">
              <span className="onboarding-icon" aria-hidden="true">
                {card.icon}
              </span>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
              <Link className="btn btn-ghost btn-sm" to={card.to} onClick={dismiss}>
                {card.cta}
              </Link>
            </article>
          ))}
        </div>
        <div className="onboarding-actions">
          <button type="button" className="btn btn-gold" onClick={dismiss}>
            Got it
          </button>
        </div>
      </div>
    </section>
  );
}
