/* ============================================================
   navSection — one shared route→section matching system for the
   desktop main-nav and the mobile disclosure menu. Layout.tsx
   consumes NAV_SECTIONS for both, so active states can never
   drift between the two.
   ============================================================ */

export interface NavSection {
  to: string;
  label: string;
  /** path prefixes owned by this section */
  match: string[];
}

export const NAV_SECTIONS: NavSection[] = [
  { to: '/play', label: 'Play', match: ['/play'] },
  { to: '/analysis', label: 'Analysis', match: ['/analysis', '/editor', '/studies'] },
  { to: '/puzzles', label: 'Train', match: ['/puzzles', '/repertoire', '/coordinates'] },
  { to: '/library', label: 'Library', match: ['/library'] },
  { to: '/profile', label: 'Profile', match: ['/profile'] },
];

/** True when `pathname` belongs to the section's routes (prefix, segment-safe). */
export function sectionMatches(section: NavSection, pathname: string): boolean {
  return section.match.some((m) => pathname === m || pathname.startsWith(`${m}/`));
}

/** Which section a path belongs to; null for none (e.g. Home). */
export function sectionForPath(pathname: string): string | null {
  const found = NAV_SECTIONS.find((n) => sectionMatches(n, pathname));
  return found ? found.to : null;
}
