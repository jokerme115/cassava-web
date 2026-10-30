export interface PixelDimensions { width: number; height: number }

export const RESOLUTION_SCREEN_RULE = '整图长边不足1024像素，或短边不足512像素时提醒；实际以切面清晰度为准。';

export const isLowResolution = (width?: number | null, height?: number | null): boolean | null => {
  if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0) return null;
  return Math.max(width, height) < 1024 || Math.min(width, height) < 512;
};

export const readFileDimensions = (file: File): Promise<PixelDimensions | null> => new Promise(resolve => {
  const url = URL.createObjectURL(file);
  const image = new window.Image();
  let done = false;
  const finish = (value: PixelDimensions | null) => {
    if (done) return;
    done = true;
    window.clearTimeout(timer);
    URL.revokeObjectURL(url);
    image.onload = image.onerror = null;
    resolve(value);
  };
  const timer = window.setTimeout(() => finish(null), 10000);
  image.onload = () => finish({ width: image.naturalWidth, height: image.naturalHeight });
  image.onerror = () => finish(null);
  image.src = url;
});
