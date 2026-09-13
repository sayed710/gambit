import { describe, expect, it } from 'vitest';
import { NAV_SECTIONS, sectionForPath, sectionMatches } from './navSection';

describe('navigation section matching', () => {
  it('matches section ownership for every documented route', () => {
    expect(sectionForPath('/play')).toBe('/play');
    expect(sectionForPath('/analysis')).toBe('/analysis');
    expect(sectionForPath('/editor')).toBe('/analysis');
    expect(sectionForPath('/studies')).toBe('/analysis');
    expect(sectionForPath('/studies/123')).toBe('/analysis');
    expect(sectionForPath('/puzzles')).toBe('/puzzles');
    expect(sectionForPath('/repertoire')).toBe('/puzzles');
    expect(sectionForPath('/repertoire/abc')).toBe('/puzzles');
    expect(sectionForPath('/coordinates')).toBe('/puzzles');
    expect(sectionForPath('/library')).toBe('/library');
    expect(sectionForPath('/profile')).toBe('/profile');
    expect(sectionForPath('/')).toBeNull();
  });

  it('keeps the desktop and mobile nav definitions identical', () => {
    // one shared constant is consumed by both navs; assert the shape
    expect(NAV_SECTIONS.map((n) => n.label)).toEqual(['Play', 'Analysis', 'Train', 'Library', 'Profile']);
    expect(sectionMatches(NAV_SECTIONS[1], '/studies/123')).toBe(true);
    expect(sectionMatches(NAV_SECTIONS[2], '/repertoire/abc')).toBe(true);
    expect(sectionMatches(NAV_SECTIONS[0], '/studies/123')).toBe(false);
  });

  it('is not fooled by prefix collisions', () => {
    // /playground must NOT activate Play
    expect(sectionForPath('/playground')).toBeNull();
    expect(sectionMatches(NAV_SECTIONS[0], '/playground')).toBe(false);
  });
});
