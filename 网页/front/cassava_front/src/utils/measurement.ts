export const normalizePpdPercent = (value: unknown, unit?: string) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return unit === 'ratio' ? parsed * 100 : parsed;
};

export const calculateMaskPixelMetrics = (cassava: Uint8Array, rotten: Uint8Array) => {
  if (cassava.length !== rotten.length) throw new Error('木薯和腐烂掩码尺寸不一致');
  let cassavaPixels = 0;
  let rottenPixels = 0;
  for (let index = 0; index < cassava.length; index += 1) {
    if (!cassava[index]) continue;
    cassavaPixels += 1;
    if (rotten[index]) rottenPixels += 1;
  }
  return {
    cassavaPixels,
    rottenPixels,
    ppd: cassavaPixels ? rottenPixels / cassavaPixels * 100 : 0,
  };
};

export const sanitizeCsvCell = (value: unknown) => {
  const raw = value === null || value === undefined ? '' : String(value);
  const safe = /^\s*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  const escaped = safe.replace(/"/g, '""');
  return /[",\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
};


type MeasuredResult = {
  ppdValue?: number;
  ppd_unit?: string;
  latest_correction_ppd?: number | null;
  error_code?: string;
  errorCode?: string;
  measurement?: { final_ppd: number | null };
};

export const effectivePpd = (result: MeasuredResult): number | null => {
  if (result.measurement) return result.measurement.final_ppd;
  if (result.latest_correction_ppd != null) return Number.isFinite(Number(result.latest_correction_ppd)) ? Number(result.latest_correction_ppd) : null;
  if (result.ppd_unit === 'unknown' || result.error_code || result.errorCode) return null;
  return typeof result.ppdValue === 'number' && Number.isFinite(result.ppdValue) ? result.ppdValue : null;
};

export const formatPpd = (value: number | null | undefined) => value == null ? '待复核' : `${value.toFixed(2)}%`;

/** 只要数字本身（表格/统计卡用），非有限值给占位符。 */
export const formatPpdValue = (value: number | null | undefined, fallback = '-') =>
  typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : fallback;
