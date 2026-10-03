import { Link } from 'react-router-dom';

/* ============================================================
   TrainTabs — the single source of the Training-area secondary
   navigation. Every training page renders this once; duplicate
   tab lists are a copy-paste bug this component makes impossible.
   ============================================================ */

export const TRAIN_TABS = [
  { to: '/training', label: 'Today' },
  { to: '/puzzles', label: 'Puzzles' },
  { to: '/repertoire', label: 'Repertoire' },
  { to: '/endgames', label: 'Endgames' },
  { to: '/coordinates', label: 'Coordinates' },
];

export default function TrainTabs({ current }: { current: string }) {
  return (
    <nav className="page-tabs mt-2" aria-label="Training area">
      {TRAIN_TABS.map((t) => (
        <Link key={t.to} to={t.to} className={t.to === current ? 'on' : ''}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
