import type { TimeControl } from '../lib/types';

export const TIME_CONTROLS: TimeControl[] = [
  { id: '1+0', label: '1 min', category: 'Bullet', minutes: 1, increment: 0 },
  { id: '2+1', label: '2 min', category: 'Bullet', minutes: 2, increment: 1 },
  { id: '3+0', label: '3 min', category: 'Blitz', minutes: 3, increment: 0 },
  { id: '3+2', label: '3 min', category: 'Blitz', minutes: 3, increment: 2 },
  { id: '5+0', label: '5 min', category: 'Blitz', minutes: 5, increment: 0 },
  { id: '10+0', label: '10 min', category: 'Rapid', minutes: 10, increment: 0 },
  { id: '10+5', label: '10 min', category: 'Rapid', minutes: 10, increment: 5 },
  { id: '15+10', label: '15 min', category: 'Rapid', minutes: 15, increment: 10 },
  { id: '30+0', label: '30 min', category: 'Classical', minutes: 30, increment: 0 },
  { id: 'unlimited', label: 'No clock', category: 'Unlimited', minutes: 0, increment: 0 },
];

export const DEFAULT_TIME_CONTROL = TIME_CONTROLS.find((t) => t.id === '10+0')!;

export function timeControlById(id: string): TimeControl {
  return TIME_CONTROLS.find((t) => t.id === id) ?? DEFAULT_TIME_CONTROL;
}
