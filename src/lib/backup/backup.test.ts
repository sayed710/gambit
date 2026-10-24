import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildBackup, collectSections } from './exportBackup';
import { BackupError, parseBackupText, previewBackup } from './validate';
import { restoreMerge, restoreReplace, snapshotAll, rollbackTo } from './restore';
import { ALL_SECTIONS, BACKUP_FORMAT_VERSION, checksumOf } from './format';

/* ============================================================
   Backup & Restore — the full durability contract.
   ============================================================ */

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  localStorage.clear();
});

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1';

function seedPopulated() {
  localStorage.setItem(
    'gambit.profile',
    JSON.stringify({
      name: 'Astrid',
      rating: 1420,
      games: [
        {
          id: 'g-keep-1',
          date: 1792000000000,
          mode: 'ai',
          timeControl: { id: '10+0', label: '10 min', category: 'Rapid', minutes: 10, increment: 0 },
          playerColor: 'w',
          opponentName: 'Engine · Club',
          opponentRating: 1300,
          result: 'win',
          reason: 'checkmate',
          moves: ['e4', 'e5', 'Nf3'],
          pgn: '1. e4 e5 2. Nf3',
          ratingBefore: 1400,
          ratingAfter: 1420,
          moveTimings: [
            { ply: 1, color: 'w', thinkMs: 2100, clockBeforeMs: 600000, clockAfterMs: 597900 },
            { ply: 3, color: 'w', thinkMs: 800, clockBeforeMs: 598000, clockAfterMs: 597200 },
          ],
        },
      ],
      puzzle: { solved: 12, streak: 3, byTheme: { fork: { seen: 5, solved: 4 } } },
    }),
  );
  localStorage.setItem('gambit.settings', JSON.stringify({ soundEnabled: true, boardTheme: 'glacier' }));
  localStorage.setItem(
    'gambit.studies.v1',
    JSON.stringify([
      {
        id: 'st-1',
        title: 'Lyon Endgames',
        createdAt: 1,
        updatedAt: 2,
        chapters: [
          {
            id: 'c-1',
            name: 'Chapter 1',
            tree: {
              startFen: START,
              moves: [
                {
                  id: 'n-1',
                  san: 'e4',
                  from: 'e2',
                  to: 'e4',
                  fenBefore: START,
                  fenAfter: AFTER_E4,
                  moveNumber: 1,
                  color: 'w',
                  nags: ['!'],
                  children: [
                    {
                      id: 'n-2',
                      san: 'e5',
                      from: 'e7',
                      to: 'e5',
                      fenBefore: AFTER_E4,
                      fenAfter: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPPPPPP/RNBQKBNR w KQkq - 0 2',
                      moveNumber: 1,
                      color: 'b',
                      nags: [],
                      children: [],
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
    ]),
  );
  localStorage.setItem(
    'gambit.repertoire.v1',
    JSON.stringify([
      {
        id: 'rep-1',
        name: 'White Italian',
        side: 'w',
        createdAt: 1,
        updatedAt: 2,
        lines: [
          {
            id: 'l-1',
            name: 'Main line',
            tree: {
              startFen: START,
              moves: [
                {
                  id: 'rn-1',
                  san: 'e4',
                  from: 'e2',
                  to: 'e4',
                  fenBefore: START,
                  fenAfter: AFTER_E4,
                  moveNumber: 1,
                  color: 'w',
                  nags: [],
                  children: [],
                },
              ],
            },
            preferred: { __root__: 'rn-1' },
          },
        ],
      },
    ]),
  );
  localStorage.setItem(
    'gambit.training.v1',
    JSON.stringify({
      version: 1,
      endgame: { 'kr-mate': { attempted: 4, solved: 3, mastery: 0.8, lastPracticed: 1792000001000, bestAttempts: 2 } },
      repScheduling: { 'rep-1:l-1:rn-1': { lastRating: 'good', dueAt: 1792900000000, intervalDays: 4, reps: 2 } },
      motifs: { fork: { opportunities: 6, found: 2, missed: 4, lastSeen: 1792000002000, recentMisses: [{ gameId: 'g-keep-1', ply: 3 }] } },
      motifGames: { 'g-keep-1': 1792000003000 },
      adaptive: { queue: [], lastGenerated: null },
    }),
  );
  localStorage.setItem(
    'gambit.practice.v1',
    JSON.stringify([
      {
        id: 'p-1',
        kind: 'mistake',
        sourceGameId: 'g-keep-1',
        ply: 3,
        fen: AFTER_E4,
        side: 'w',
        objective: 'Find Nf3',
        expectedSan: 'Nf3',
        createdAt: 1792000004000,
        attempts: 2,
        solved: 1,
        lastPracticed: 1792000005000,
      },
    ]),
  );
  localStorage.setItem('gambit.library.v1', JSON.stringify({ tags: { 'g-keep-1': ['sharp'] }, notes: {}, favorites: ['g-keep-1'] }));
  localStorage.setItem(
    'gambit.review.g-keep-1',
    JSON.stringify({
      reviews: [
        { san: 'e4', color: 'w', cpl: 0, classification: 'best' },
        { san: 'e5', color: 'b', cpl: 12, classification: 'good' },
      ],
      evals: [{ cp: 20, mateIn: null, bestSan: 'e4' }, null, null],
      accuracy: { w: 96, b: 90 },
      counts: { w: {}, b: {} },
      avgCpl: { w: 0, b: 12 },
    }),
  );
  localStorage.setItem('gambit.activeGame', JSON.stringify({ config: { mode: 'pass' }, playerColor: 'w', pgn: '1. e4 e5', clocks: null, savedAt: 5 }));
  localStorage.setItem('gambit.lastConfig', JSON.stringify({ mode: 'ai', playerColor: 'w', aiLevel: 2 }));
}

describe('backup export', () => {
  it('exports an empty application honestly', () => {
    const b = buildBackup({ now: new Date('2026-10-24T10:00:00Z') });
    expect(b.envelope.app).toBe('gambit');
    expect(b.envelope.format).toBe(BACKUP_FORMAT_VERSION);
    expect(b.envelope.integrity.sectionCounts.games).toBe(0);
    expect(b.filename).toBe('gambit-backup-2026-10-24.json');
    // every section key present (undefined payloads), none invented
    expect(Object.keys(b.envelope.sections).sort()).toEqual([...ALL_SECTIONS].sort());
  });

  it('exports a populated application with all domains and integrity', () => {
    seedPopulated();
    const b = buildBackup({ now: new Date('2026-10-24T10:00:00Z') });
    const s = b.envelope.sections;
    expect(s.profile).toMatchObject({ rating: 1420 });
    expect(s.reviews).toHaveProperty('g-keep-1');
    expect(b.envelope.integrity.sectionCounts.games).toBe(1);
    expect(b.envelope.integrity.checksum).toBe(checksumOf(s));
    expect(b.envelope.integrity.bytes).toBeGreaterThan(0);
    // reviews excludable
    const noReviews = buildBackup({ includeReviews: false });
    expect(noReviews.envelope.sections.reviews).toBeUndefined();
  });

  it('exports raw stored values without rewriting them', () => {
    seedPopulated();
    const raw = JSON.parse(localStorage.getItem('gambit.repertoire.v1')!);
    const sections = collectSections();
    expect(JSON.stringify(sections.repertoires)).toBe(JSON.stringify(raw));
  });
});

describe('backup round-trip (replace)', () => {
  it('a PARTIAL export (many sections absent) survives its own checksum round-trip', () => {
    // browser-QA regression: canonicalJson once emitted "key":null for
    // undefined sections, which JSON.stringify drops — the file then
    // failed its own checksum on import
    localStorage.setItem('gambit.profile', JSON.stringify({ rating: 1000, games: [] }));
    const text = buildBackup().text; // studies/training/... all absent
    expect(() => parseBackupText(text)).not.toThrow();
  });

  it('restores every domain byte-faithfully into an empty store', () => {
    seedPopulated();
    const before = snapshotAll();
    const text = buildBackup().text;
    localStorage.clear();
    localStorage.setItem('unrelated.other.app', 'stay put');

    const parsed = parseBackupText(text);
    const result = restoreReplace(parsed);

    expect(result.mode).toBe('replace');
    for (const [key, value] of Object.entries(before)) {
      if (value === null) continue;
      expect(localStorage.getItem(key)).toBe(value);
    }
    expect(localStorage.getItem('unrelated.other.app')).toBe('stay put'); // unrelated origin keys untouched
  });

  it('preserves game ids, move timings, and cached reviews', () => {
    seedPopulated();
    const text = buildBackup().text;
    localStorage.clear();
    restoreReplace(parseBackupText(text));
    const profile = JSON.parse(localStorage.getItem('gambit.profile')!);
    expect(profile.games[0].id).toBe('g-keep-1');
    expect(profile.games[0].moveTimings[1]).toEqual({ ply: 3, color: 'w', thinkMs: 800, clockBeforeMs: 598000, clockAfterMs: 597200 });
    expect(JSON.parse(localStorage.getItem('gambit.review.g-keep-1')!)).toMatchObject({ accuracy: { w: 96, b: 90 } });
  });

  it('preserves study variation trees and repertoire preferred maps', () => {
    seedPopulated();
    const text = buildBackup().text;
    localStorage.clear();
    restoreReplace(parseBackupText(text));
    const study = JSON.parse(localStorage.getItem('gambit.studies.v1')!)[0];
    expect(study.chapters[0].tree.moves[0].children[0].san).toBe('e5'); // variation survived
    const rep = JSON.parse(localStorage.getItem('gambit.repertoire.v1')!)[0];
    expect(rep.lines[0].preferred).toEqual({ __root__: 'rn-1' });
  });

  it('preserves SR due dates, motif markers, and practice progress', () => {
    seedPopulated();
    const text = buildBackup().text;
    localStorage.clear();
    restoreReplace(parseBackupText(text));
    const training = JSON.parse(localStorage.getItem('gambit.training.v1')!);
    expect(training.repScheduling['rep-1:l-1:rn-1']).toMatchObject({ dueAt: 1792900000000, lastRating: 'good' });
    expect(training.motifGames['g-keep-1']).toBe(1792000003000);
    expect(training.motifs.fork.recentMisses[0]).toEqual({ gameId: 'g-keep-1', ply: 3 });
    const practice = JSON.parse(localStorage.getItem('gambit.practice.v1')!);
    expect(practice[0]).toMatchObject({ id: 'p-1', attempts: 2, solved: 1 });
  });

  it('replace prunes reviews that are not in the backup', () => {
    seedPopulated();
    const text = buildBackup({ includeReviews: false }).text;
    localStorage.setItem('gambit.review.g-keep-1', localStorage.getItem('gambit.review.g-keep-1')!); // exists
    const parsed = parseBackupText(text);
    const result = restoreReplace(parsed);
    expect(result.removed).toContain('review.g-keep-1');
    expect(localStorage.getItem('gambit.review.g-keep-1')).toBeNull();
  });
});

describe('merge mode', () => {
  it('importing the same backup twice never duplicates games, studies, repertoires or practice', () => {
    seedPopulated();
    const text = buildBackup().text;
    localStorage.clear();
    restoreMerge(parseBackupText(text));
    const firstCounts = {
      games: JSON.parse(localStorage.getItem('gambit.profile')!).games.length,
      studies: JSON.parse(localStorage.getItem('gambit.studies.v1')!).length,
      reps: JSON.parse(localStorage.getItem('gambit.repertoire.v1')!).length,
      practice: JSON.parse(localStorage.getItem('gambit.practice.v1')!).length,
    };
    restoreMerge(parseBackupText(text)); // second import of the same file
    expect(JSON.parse(localStorage.getItem('gambit.profile')!).games.length).toBe(firstCounts.games);
    expect(JSON.parse(localStorage.getItem('gambit.studies.v1')!).length).toBe(firstCounts.studies);
    expect(JSON.parse(localStorage.getItem('gambit.repertoire.v1')!).length).toBe(firstCounts.reps);
    expect(JSON.parse(localStorage.getItem('gambit.practice.v1')!).length).toBe(firstCounts.practice);
  });

  it('merge adds only NEW games and keeps existing profile state (existing wins)', () => {
    seedPopulated();
    const text = buildBackup().text;
    localStorage.clear();
    // a fresh device with its own game and rating
    localStorage.setItem(
      'gambit.profile',
      JSON.stringify({
        name: 'Local',
        rating: 1500,
        games: [
          {
            id: 'g-local',
            date: 1,
            mode: 'pass',
            timeControl: { id: '10+0', label: '10 min', category: 'Rapid', minutes: 10, increment: 0 },
            playerColor: 'w',
            opponentName: 'x',
            opponentRating: 0,
            result: 'draw',
            reason: 'agreement',
            moves: ['d4'],
            pgn: '1. d4',
            ratingBefore: 1500,
            ratingAfter: 1500,
          },
        ],
      }),
    );
    const result = restoreMerge(parseBackupText(text));
    expect(result.applied).toContain('profile');
    const profile = JSON.parse(localStorage.getItem('gambit.profile')!);
    expect(profile.rating).toBe(1500); // existing aggregate kept, never summed
    expect(profile.games.map((g: { id: string }) => g.id).sort()).toEqual(['g-keep-1', 'g-local']);
  });

  it('merge seeds training only into a fresh install; never sums SR or motifs', () => {
    seedPopulated();
    const text = buildBackup().text;
    localStorage.clear();
    restoreMerge(parseBackupText(text));
    expect(JSON.parse(localStorage.getItem('gambit.training.v1')!).motifs.fork.opportunities).toBe(6);
    // now a device WITH its own training state: merge must not touch it
    localStorage.setItem(
      'gambit.training.v1',
      JSON.stringify({ version: 1, endgame: {}, repScheduling: { 'x:y:z': { lastRating: 'easy', dueAt: 1, intervalDays: 1, reps: 1 } }, motifs: { fork: { opportunities: 1, found: 0, missed: 1, lastSeen: 1, recentMisses: [] } }, motifGames: {}, adaptive: { queue: [], lastGenerated: null } }),
    );
    restoreMerge(parseBackupText(text));
    const training = JSON.parse(localStorage.getItem('gambit.training.v1')!);
    expect(training.motifs.fork.opportunities).toBe(1); // unchanged, not 7
    expect(training.repScheduling['x:y:z']).toBeDefined();
    expect(training.repScheduling['rep-1:l-1:rn-1']).toBeUndefined(); // not silently combined
  });

  it('merge fills only missing review caches', () => {
    seedPopulated();
    const text = buildBackup().text;
    localStorage.clear();
    localStorage.setItem('gambit.review.g-keep-1', JSON.stringify({ reviews: [], evals: [], accuracy: { w: 1, b: 1 }, counts: { w: {}, b: {} }, avgCpl: { w: 0, b: 0 } }));
    restoreMerge(parseBackupText(text));
    expect(JSON.parse(localStorage.getItem('gambit.review.g-keep-1')!).reviews).toEqual([]); // existing kept
  });
});

describe('validation rejects bad files', () => {
  it('rejects malformed JSON', () => {
    expect(() => parseBackupText('{not json')).toThrowError(BackupError);
    try {
      parseBackupText('{not json');
    } catch (e) {
      expect((e as BackupError).code).toBe('NOT_JSON');
    }
  });

  it('rejects an unsupported schema version', () => {
    seedPopulated();
    const b = buildBackup();
    const envelope = JSON.parse(b.text);
    envelope.format = 99;
    expect(() => parseBackupText(JSON.stringify(envelope))).toThrowError(/unsupported/i);
  });

  it('rejects corrupted content via checksum mismatch', () => {
    seedPopulated();
    const envelope = JSON.parse(buildBackup().text);
    envelope.sections.profile.rating = 9999; // tampered after export
    expect(() => parseBackupText(JSON.stringify(envelope))).toThrowError(/checksum/i);
  });

  it('rejects illegal FEN and illegal PGN/move lists', () => {
    seedPopulated();
    const envelope = JSON.parse(buildBackup().text);
    envelope.sections.profile.games[0].moves = ['e4', 'e5', 'Ke9']; // illegal SAN
    envelope.integrity.checksum = checksumOf(envelope.sections); // attacker fixes the checksum — chess rules still reject
    expect(() => parseBackupText(JSON.stringify(envelope))).toThrowError(/illegal SAN/);
    const env2 = JSON.parse(buildBackup().text);
    env2.sections.practice[0].fen = 'not-a-fen';
    env2.integrity.checksum = checksumOf(env2.sections);
    expect(() => parseBackupText(JSON.stringify(env2))).toThrowError(/FEN/);
  });

  it('rejects prototype-pollution keys', () => {
    seedPopulated();
    // inject an OWN "__proto__" property via string surgery — JSON.parse
    // creates it as an own key, exactly like an attacker-supplied file
    const text = buildBackup().text.replace(
      '"soundEnabled": true',
      '"__proto__": { "polluted": true }, "soundEnabled": true',
    );
    expect(text).not.toBe(buildBackup().text); // injection landed
    expect(() => parseBackupText(text)).toThrowError(/forbidden/i);
  });

  it('accepts missing optional legacy sections (library, reviews, session)', () => {
    seedPopulated();
    const envelope = JSON.parse(buildBackup().text);
    delete envelope.sections.library;
    delete envelope.sections.reviews;
    delete envelope.sections.activeGame;
    delete envelope.sections.lastConfig;
    envelope.integrity.checksum = checksumOf(envelope.sections);
    const parsed = parseBackupText(JSON.stringify(envelope));
    expect(previewBackup(parsed).practiceItems).toBe(1);
  });

  it('accepts legacy games without optional fields (timings, pgn)', () => {
    seedPopulated();
    const envelope = JSON.parse(buildBackup().text);
    const game = envelope.sections.profile.games[0];
    delete game.moveTimings;
    delete game.pgn;
    delete game.ratingBefore;
    envelope.integrity.checksum = checksumOf(envelope.sections);
    expect(() => parseBackupText(JSON.stringify(envelope))).not.toThrow();
  });
});

describe('failure recovery', () => {
  it('detects a quota failure and rolls the whole restore back', () => {
    seedPopulated();
    const text = buildBackup().text;
    localStorage.clear();
    localStorage.setItem('gambit.profile', JSON.stringify({ rating: 1111, games: [] }));
    const before = localStorage.getItem('gambit.profile');

    const realSet = Storage.prototype.setItem;
    let calls = 0;
    Storage.prototype.setItem = function (key: string, value: string) {
      calls += 1;
      if (key === 'gambit.training.v1') {
        throw new DOMException('quota exceeded', 'QuotaExceededError');
      }
      return realSet.call(this, key, value);
    };
    try {
      expect(() => restoreReplace(parseBackupText(text))).toThrowError(/quota|rolled back/);
    } finally {
      Storage.prototype.setItem = realSet;
    }
    // rollback restored the pre-restore state
    expect(localStorage.getItem('gambit.profile')).toBe(before);
    expect(calls).toBeGreaterThan(0);
  });

  it('detects a silent write failure (read-back mismatch) and rolls back', () => {
    seedPopulated();
    const text = buildBackup().text;
    localStorage.clear();
    const realSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      const r = realSet.call(this, key, key === 'gambit.settings' ? '{"tampered":1}' : value);
      return r;
    };
    try {
      expect(() => restoreReplace(parseBackupText(text))).toThrowError(/verification failed/i);
    } finally {
      Storage.prototype.setItem = realSet;
    }
    // rollback: nothing from the backup remains
    expect(localStorage.getItem('gambit.settings')).toBeNull();
  });

  it('rollbackTo reinstates removed keys and values', () => {
    localStorage.setItem('gambit.profile', 'keep-me');
    localStorage.setItem('gambit.review.gone', 'gone-value');
    const snap = snapshotAll();
    localStorage.removeItem('gambit.profile');
    localStorage.removeItem('gambit.review.gone');
    localStorage.setItem('gambit.settings', 'new');
    rollbackTo(snap);
    expect(localStorage.getItem('gambit.profile')).toBe('keep-me');
    expect(localStorage.getItem('gambit.review.gone')).toBe('gone-value');
    expect(localStorage.getItem('gambit.settings')).toBeNull();
  });
});
