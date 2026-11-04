import type { EvalResult } from '../lib/engine/engine';

/** Win probability via a logistic curve on centipawns (white perspective). */
function winProbability(cp: number): number {
  return 1 / (1 + Math.exp(-cp / 380));
}

interface EvalBarProps {
  evaluation: EvalResult | null;
  thinking?: boolean;
}

export default function EvalBar({ evaluation, thinking }: EvalBarProps) {
  const cp = evaluation?.cp ?? 0;
  const mate = evaluation?.mateIn ?? null;
  // white advantage fraction from the bottom (white at bottom by convention)
  const whiteShare = mate !== null ? (cp > 0 ? 1 : 0) : Math.max(0.03, Math.min(0.97, winProbability(cp)));
  const label =
    evaluation == null
      ? ''
      : mate !== null
        ? `M${Math.max(1, mate)}`
        : `${cp > 0 ? '+' : cp < 0 ? '−' : ''}${(Math.abs(cp) / 100).toFixed(1)}`;

  return (
    <div
      className="eval-bar"
      role="img"
      aria-label={evaluation ? (mate !== null ? `Mate in ${mate}` : `Evaluation ${label}`) : 'Evaluation loading'}
      title={evaluation ? (mate !== null ? `Mate in ${mate}` : label) : 'Evaluating…'}
    >
      <div className="fill" style={{ transform: `scaleY(${whiteShare})` }} />
      <div className="tick" />
      <span className="eval-score" aria-hidden="true">
        {/* Backed chip: charcoal text on cream keeps ≥4.5:1 over both the
            dark slate and light-ice fill states. */}
        <b className="mono">{thinking ? '…' : label}</b>
      </span>
    </div>
  );
}
