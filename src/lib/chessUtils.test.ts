import { describe, expect, it } from 'vitest';
import { hasMatingMaterial } from './chessUtils';

describe('hasMatingMaterial (FIDE 6.9 timeout rule)', () => {
  const cases: [fen: string, color: 'w' | 'b', expected: boolean, name: string][] = [
    // fen, tested color, expected
    ['7k/8/8/8/8/8/R7/K7 b - - 0 1', 'w', true, 'rook mates'],
    ['k7/8/8/8/8/8/Q7/K7 b - - 0 1', 'w', true, 'queen mates'],
    ['k7/8/8/8/8/8/P7/K7 b - - 0 1', 'w', true, 'pawn mates (promotion)'],
    ['k7/8/8/8/8/8/B7/K7 b - - 0 1', 'w', false, 'single bishop vs bare king cannot mate'],
    ['k7/8/8/8/8/8/N7/K7 b - - 0 1', 'w', false, 'single knight cannot mate'],
    // two bishops on opposite colors: mate exists
    ['k7/8/8/8/8/8/1B6/K6B w - - 0 1', 'w', true, 'opposite-color bishops mate'],
    // two bishops on the same color: no mate
    ['k7/8/8/2b5/8/8/1B6/K7 b - - 0 1', 'w', false, 'same-color bishops cannot mate'],
    ['k7/8/8/2b5/8/8/1B6/K7 b - - 0 1', 'b', false, 'black single bishop on the same complex cannot mate either'],
    ['7k/8/8/8/8/8/P7/N6K w - - 0 1', 'w', true, 'single knight + enemy pawn: helpmate via blockade'],
    // knight + bishop: helpmate exists
    ['k7/8/8/8/8/8/1BN5/K7 b - - 0 1', 'w', true, 'bishop+knight mates'],
    // two knights: documented approximation — treated as mating material
    ['k7/8/8/8/8/8/1NN5/K7 b - - 0 1', 'w', true, 'two knights treated as mating material'],
    // bare king
    ['k7/8/8/8/8/8/8/K7 b - - 0 1', 'w', false, 'bare king cannot mate'],
    // opponent side check on the same positions
    ['7k/8/8/8/8/8/r7/K7 b - - 0 1', 'b', true, 'black with rook mates'],
  ];

  it.each(cases)('$3', (fen, color, expected) => {
    expect(hasMatingMaterial(fen, color)).toBe(expected);
  });
});
