import type { AdaptiveItem, AdaptiveItemKind, MotifStat, SrRecord } from './trainingStore';
export type { AdaptiveItem, AdaptiveItemKind };

/* ============================================================
   adaptiveEngine — deterministic, rule-based recommendation.

   score = severity(0-40) + failure frequency(0-30) + recency(0-20)
           + due status(0-10), rounded. Every item carries a plain
   "recommended because…" explanation. No randomness, no AI claims.
   Session = top items capped at 15, ending with a light
   visualization exercise when the queue is thin.
   ============================================================ */

export interface ReviewMistake {
  gameId: string;
  ply: number;
  san: string;
  className: string;
  when: number;
  motif?: string;
}

export interface AdaptiveSource {
  now?: number;
  /** per-theme puzzle record from the profile */
  puzzleThemes?: Record<string, { solved: number; failed: number }>;
  /** motif statistics from training store */
  motifStats?: Record<string, MotifStat>;
  /** endgame lesson progress from training store */
  endgame?: Record<string, { attempted: number; solved: number; bestAttempts: number | null; lastPracticed: number | null; mastery: number }>;
  /** SR records keyed like gambit.training.v1 */
  repScheduling?: Record<string, SrRecord>;
  /** positions available for repertoire drills */
  repertoirePositions?: { repertoireId: string; lineId: string; nodeKey: string; san: string }[];
  /** reviewed mistakes (blunder/mistake/miss) with optional motif */
  reviewMistakes?: ReviewMistake[];
}

const SEVERITY_WEIGHT: Record<string, number> = {
  blunder: 40,
  mistake: 30,
  miss: 28,
  inaccuracy: 15,
};

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function recencyBoost(when: number | null | undefined, now: number): number {
  if (!when) return 0;
  const days = (now - when) / 86_400_000;
  if (days <= 1) return 20;
  if (days <= 7) return 12;
  if (days <= 30) return 5;
  return 0;
}

export function buildAdaptiveSession(src: AdaptiveSource = {}): AdaptiveItem[] {
  const now = src.now ?? Date.now();
  const items: AdaptiveItem[] = [];

  // ——— reviewed mistakes: severity + how often + recency
  for (const m of src.reviewMistakes ?? []) {
    const severity = SEVERITY_WEIGHT[m.className] ?? 10;
    const boost = recencyBoost(m.when, now);
    items.push({
      id: `mistake-${m.gameId}-${m.ply}`,
      kind: 'mistake',
      reason: `Recommended because you played a ${m.className} (${m.san}) in this position.`,
      score: clampScore(severity + boost),
      ref: { gameId: m.gameId, ply: String(m.ply) },
      createdAt: m.when,
    });
  }

  // ——— puzzle themes: failure rate
  for (const [theme, st] of Object.entries(src.puzzleThemes ?? {})) {
    const total = st.solved + st.failed;
    if (total === 0) continue;
    const failRate = st.failed / total;
    if (st.failed === 0) continue;
    items.push({
      id: `puzzle-${theme}`,
      kind: 'puzzle',
      reason: `Recommended because you missed ${theme} puzzles ${st.failed} of ${total} attempts.`,
      score: clampScore(10 + failRate * 40 + (st.failed >= 3 ? 10 : 0)),
      ref: { theme },
      createdAt: now,
    });
    void motifEq;
  }

  // ——— motif stats from review misses
  for (const [motif, st] of Object.entries(src.motifStats ?? {})) {
    if (st.missed === 0) continue;
    items.push({
      id: `motif-${motif}`,
      kind: 'motif',
      reason: `Recommended because you missed this motif (${motif}) ${st.missed} time${st.missed === 1 ? '' : 's'}.`,
      score: clampScore(12 + Math.min(20, st.missed * 8) + recencyBoost(st.lastSeen, now)),
      ref: { motif },
      createdAt: st.lastSeen ?? now,
    });
  }

  // ——— endgame lessons: low mastery, recent practice
  for (const [lessonId, p] of Object.entries(src.endgame ?? {})) {
    if (p.attempted === 0) continue;
    if (p.mastery >= 0.9) continue;
    items.push({
      id: `endgame-${lessonId}`,
      kind: 'endgame',
      reason: `Recommended because your success rate here is ${Math.round(p.mastery * 100)}% over ${p.attempted} attempt${p.attempted === 1 ? '' : 's'}.`,
      score: clampScore(15 + (1 - p.mastery) * 30 + recencyBoost(p.lastPracticed, now)),
      ref: { lessonId },
      createdAt: p.lastPracticed ?? now,
    });
  }

  // ——— repertoire: due or lapsed positions
  for (const p of src.repertoirePositions ?? []) {
    const key = `${p.repertoireId}:${p.lineId}:${p.nodeKey}`;
    const rec = src.repScheduling?.[key];
    if (!rec) continue;
    if (rec.lapses > 0) {
      items.push({
        id: `rep-${key}`,
        kind: 'repertoire',
        reason: `Recommended because this repertoire position lapsed ${rec.lapses} time${rec.lapses === 1 ? '' : 's'}${rec.due <= now ? ' and is due for review' : ''}.`,
        score: clampScore(20 + rec.lapses * 10 + (rec.due <= now ? 10 : 0)),
        ref: { repertoireId: p.repertoireId },
        createdAt: rec.due,
      });
    } else if (rec.due <= now && rec.interval > 0) {
      items.push({
        id: `rep-${key}`,
        kind: 'repertoire',
        reason: 'Recommended because this repertoire position is due for review.',
        score: clampScore(15 + rec.reps * 2),
        ref: { repertoireId: p.repertoireId },
        createdAt: rec.due,
      });
    }
  }

  items.sort((a, b) => b.score - a.score || b.createdAt - a.createdAt);
  const capped = items.slice(0, 15);

  // thin queue -> light fillers round the session out
  if (capped.length < 5 && !capped.some((i) => i.kind === 'puzzle')) {
    capped.push({
      id: 'puzzle-mixed',
      kind: 'puzzle',
      reason: 'A mixed puzzle set keeps tactics sharp.',
      score: 5,
      ref: {},
      createdAt: now,
    });
  }
  if (capped.length < 5) {
    capped.push({
      id: 'vis-daily',
      kind: 'visualization',
      reason: 'A short visualization warm-up rounds out today’s session.',
      score: 4,
      ref: {},
      createdAt: now,
    });
  }
  return capped;
}

// keep the type import honest for future motif-equality checks
const motifEq: AdaptiveItemKind = 'motif';
