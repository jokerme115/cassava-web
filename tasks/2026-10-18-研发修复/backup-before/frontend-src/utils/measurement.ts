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
  const escaped = safe.replaceAll('"', '""');
  return /[",\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
};
