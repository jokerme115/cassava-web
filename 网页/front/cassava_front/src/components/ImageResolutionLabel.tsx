import { isLowResolution, RESOLUTION_SCREEN_RULE } from '../utils/imageResolution';

export default function ImageResolutionLabel({ width, height }: { width?: number | null; height?: number | null }) {
  const low = isLowResolution(width, height);
  if (low === null) return null;
  return <div className="flex flex-wrap items-center gap-1.5 text-xs">
    <span className="text-muted">{width} × {height} px</span>
    {low && <span className="rounded-full border border-[rgba(245,165,36,0.30)] bg-[rgba(245,165,36,0.12)] px-2 py-0.5 font-medium text-warn-text" title={RESOLUTION_SCREEN_RULE}>低分辨率</span>}
  </div>;
}
