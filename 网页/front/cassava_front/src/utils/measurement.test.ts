import { describe, expect, it } from 'vitest';
import { calculateMaskPixelMetrics, normalizePpdPercent, sanitizeCsvCell, effectivePpd, formatPpd } from './measurement';

describe('measurement utilities', () => {
  it('keeps genuine and manually corrected zero values without inventing disease', () => {
    expect(effectivePpd({ ppdValue: 0, ppd_unit: 'percent' })).toBe(0);
    expect(effectivePpd({ ppdValue: 24, latest_correction_ppd: 0 })).toBe(0);
    expect(formatPpd(0)).toBe('0.00%');
  });

  it('excludes unknown units and failed measurements from healthy classification', () => {
    expect(effectivePpd({ ppdValue: 0, ppd_unit: 'unknown' })).toBeNull();
    expect(effectivePpd({ ppdValue: 0, error_code: 'PARTIAL_RESULT' })).toBeNull();
    expect(effectivePpd({ measurement: { final_ppd: null }, ppdValue: 10 })).toBeNull();
    expect(formatPpd(null)).toBe('待复核');
  });
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
