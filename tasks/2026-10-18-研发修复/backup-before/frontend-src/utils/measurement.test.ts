import { describe, expect, it } from 'vitest';
import { calculateMaskPixelMetrics, normalizePpdPercent, sanitizeCsvCell } from './measurement';

describe('measurement utilities', () => {
  it('calculates rotten area only inside the cassava mask', () => {
    const result = calculateMaskPixelMetrics(
      new Uint8Array([1, 1, 0, 0]),
      new Uint8Array([1, 0, 1, 1]),
    );
    expect(result).toEqual({ cassavaPixels: 2, rottenPixels: 1, ppd: 50 });
  });

  it('normalizes explicit ratio values but preserves percent and unknown values', () => {
    expect(normalizePpdPercent(0.25, 'ratio')).toBe(25);
    expect(normalizePpdPercent(0.25, 'percent')).toBe(0.25);
    expect(normalizePpdPercent(0.25, 'unknown')).toBe(0.25);
  });

  it('neutralizes spreadsheet formulas in exported CSV cells', () => {
    expect(sanitizeCsvCell('=HYPERLINK("bad")')).toBe('"\'=HYPERLINK(""bad"")"');
    expect(sanitizeCsvCell('normal')).toBe('normal');
  });
});
