import { isLowResolution, RESOLUTION_SCREEN_RULE } from '../utils/imageResolution';

export default function ImageResolutionLabel({ width, height }: { width?: number | null; height?: number | null }) {
  const low = isLowResolution(width, height);
  if (low === null) return null;
  return <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
    <span className="text-gray-500">{width} × {height} px</span>
    {low && <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-medium text-amber-800" title={RESOLUTION_SCREEN_RULE}>低分辨率</span>}
  </div>;
}
