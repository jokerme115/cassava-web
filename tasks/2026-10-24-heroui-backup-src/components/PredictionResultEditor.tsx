import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Brush,
  Check,
  CircleDot,
  Eraser,
  Eye,
  EyeOff,
  Hand,
  Layers3,
  Maximize2,
  MousePointer2,
  PenTool,
  Redo2,
  RotateCcw,
  Save,
  Sun,
  Sparkles,
  Spline,
  Moon,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Modal, message } from 'antd';
import { PredictionResult } from '../types';
import { predictionsApi, resolveFileUrl } from '../services/api';
import { calculateMaskPixelMetrics } from '../utils/measurement';
import { readDraft, writeDraft, removeDraft } from '../utils/correctionDrafts';

type LayerName = 'cassava' | 'rotten';
type ToolName = 'brush-add' | 'brush-erase' | 'pen-add' | 'pen-erase' | 'smart-add' | 'smart-erase' | 'pan';

interface Masks {
  width: number;
  height: number;
  cassava: Uint8Array;
  rotten: Uint8Array;
}

interface PredictionResultEditorProps {
  prediction: PredictionResult;
  onClose: () => void;
  onSaved: (correction: any) => void;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ');

const confirmAction = (title: string, content: string, okText: string, cancelText: string) =>
  new Promise<boolean>((resolve) => {
    Modal.confirm({
      title,
      content,
      okText,
      cancelText,
      centered: true,
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });

const fetchRaster = (url: string, width: number, height: number): Promise<Uint8Array> => new Promise((resolve, reject) => {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => {
    if (image.naturalWidth !== width || image.naturalHeight !== height) {
      reject(new Error(`掩码尺寸不匹配：${image.naturalWidth} × ${image.naturalHeight}`));
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return reject(new Error('无法创建掩码画布'));
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, width, height).data;
    const mask = new Uint8Array(width * height);
    for (let i = 0; i < mask.length; i += 1) {
      mask[i] = pixels[i * 4] > 127 ? 1 : 0;
    }
    resolve(mask);
  };
  image.onerror = () => reject(new Error(`无法加载掩码：${url}`));
  image.src = url;
});

const fetchConfidenceRaster = (url: string, width: number, height: number): Promise<Uint8Array> => new Promise((resolve, reject) => {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => {
    if (image.naturalWidth !== width || image.naturalHeight !== height) {
      reject(new Error(`置信度图尺寸不匹配：${image.naturalWidth} × ${image.naturalHeight}`));
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return reject(new Error('无法创建置信度画布'));
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, width, height).data;
    const confidence = new Uint8Array(width * height);
    for (let i = 0; i < confidence.length; i += 1) confidence[i] = pixels[i * 4];
    resolve(confidence);
  };
  image.onerror = () => reject(new Error(`无法加载置信度图：${url}`));
  image.src = url;
});

const fetchBaseImage = (url: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error(`无法加载原图：${url}`));
  image.src = url;
});

const maskToBlob = async (mask: Uint8Array, width: number, height: number): Promise<Blob> => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建掩码导出画布');
  const imageData = context.createImageData(width, height);
  const chunkSize = 500_000;
  for (let start = 0; start < mask.length; start += chunkSize) {
    const end = Math.min(mask.length, start + chunkSize);
    for (let i = start; i < end; i += 1) {
      const value = mask[i] ? 255 : 0;
      const offset = i * 4;
      imageData.data[offset] = value;
      imageData.data[offset + 1] = value;
      imageData.data[offset + 2] = value;
      imageData.data[offset + 3] = 255;
    }
    if (end < mask.length) await new Promise<void>((next) => requestAnimationFrame(() => next()));
  }
  context.putImageData(imageData, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('掩码导出失败')), 'image/png');
  });
};

const countPixels = (mask: Uint8Array) => {
  let count = 0;
  for (let i = 0; i < mask.length; i += 1) count += mask[i];
  return count;
};

const pointInPolygon = (x: number, y: number, points: Array<{ x: number; y: number }>) => {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x;
    const yi = points[i].y;
    const xj = points[j].x;
    const yj = points[j].y;
    const intersect = ((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
};

type PolygonPoint = { x: number; y: number };
type PolygonRing = PolygonPoint[];

/** Moore 邻域边界跟踪：跟踪单个连通域的外轮廓（起点由调用方给出）。 */
const traceComponentOutline = (
  match: (x: number, y: number) => boolean,
  startX: number,
  startY: number,
  width: number,
  height: number,
): PolygonRing => {
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const points: PolygonRing = [];
  let cx = startX;
  let cy = startY;
  let dir = 7;
  const limit = width * height * 4;
  for (let step = 0; step < limit; step += 1) {
    points.push({ x: cx, y: cy });
    let found = false;
    for (let k = 0; k < 8; k += 1) {
      const nd = (dir + 5 + k) % 8;
      const nx = cx + dirs[nd][0];
      const ny = cy + dirs[nd][1];
      if (nx >= 0 && ny >= 0 && nx < width && ny < height && match(nx, ny)) {
        cx = nx; cy = ny; dir = nd; found = true; break;
      }
    }
    if (!found) break;
    if (cx === startX && cy === startY) break;
  }
  return points;
};

/**
 * 把二值掩码拆成「每个连通域一个环」的多边形集合。
 * 腐烂区域通常是几十块互不相连的碎片，只跟踪第一个连通域会让其余病害完全看不到。
 */
const traceMaskOutlines = (mask: Uint8Array, width: number, height: number, minArea: number): PolygonRing[] => {
  const labels = new Int32Array(width * height).fill(-1);
  const areas: number[] = [];
  const bounds: Array<{ minX: number; minY: number; maxX: number; maxY: number }> = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || labels[start] !== -1) continue;
    const label = areas.length;
    let area = 0;
    let minX = width; let minY = height; let maxX = 0; let maxY = 0;
    labels[start] = label;
    stack.length = 0;
    stack.push(start);
    while (stack.length) {
      const index = stack.pop() as number;
      const x = index % width;
      const y = (index - x) / width;
      area += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const next = ny * width + nx;
          if (mask[next] && labels[next] === -1) { labels[next] = label; stack.push(next); }
        }
      }
    }
    areas.push(area);
    bounds.push({ minX, minY, maxX, maxY });
  }
  const rings: PolygonRing[] = [];
  for (let label = 0; label < areas.length; label += 1) {
    if (areas[label] < minArea) continue;
    const box = bounds[label];
    let startX = -1;
    let startY = -1;
    for (let y = box.minY; y <= box.maxY && startY < 0; y += 1) {
      for (let x = box.minX; x <= box.maxX; x += 1) {
        if (labels[y * width + x] === label) { startX = x; startY = y; break; }
      }
    }
    if (startX < 0) continue;
    const ring = traceComponentOutline((x, y) => labels[y * width + x] === label, startX, startY, width, height);
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
};

/** Douglas–Peucker 简化：把上千个轮廓点压到几十个可拖动顶点。 */
const simplifyPolygon = (points: Array<{ x: number; y: number }>, tolerance: number): Array<{ x: number; y: number }> => {
  if (points.length <= 4) return points.slice();
  const sqTolerance = tolerance * tolerance;
  const sqSegDist = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
    let x = a.x;
    let y = a.y;
    let dx = b.x - x;
    let dy = b.y - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) { x = b.x; y = b.y; } else if (t > 0) { x += dx * t; y += dy * t; }
    }
    dx = p.x - x;
    dy = p.y - y;
    return dx * dx + dy * dy;
  };
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop() as [number, number];
    let index = -1;
    let maxDist = sqTolerance;
    for (let i = first + 1; i < last; i += 1) {
      const dist = sqSegDist(points[i], points[first], points[last]);
      if (dist > maxDist) { index = i; maxDist = dist; }
    }
    if (index !== -1) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  const result: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < points.length; i += 1) if (keep[i]) result.push(points[i]);
  return result;
};

const toolLabel: Record<ToolName, string> = {
  'brush-add': '画笔添加',
  'brush-erase': '画笔删除',
  'pen-add': '钢笔圈选添加',
  'pen-erase': '钢笔圈选删除',
  'smart-add': '智能点选添加',
  'smart-erase': '智能点选删除',
  pan: '平移',
};

const toolShortcut: Record<ToolName, string> = {
  'brush-add': 'B',
  'brush-erase': 'E',
  'pen-add': 'P',
  'pen-erase': 'Shift+P',
  'smart-add': 'W',
  'smart-erase': 'Shift+W',
  pan: 'H / V',
};

const PredictionResultEditor: React.FC<PredictionResultEditorProps> = ({ prediction, onClose, onSaved }) => {
  const [editor, setEditor] = useState<any>(null);
  const [activeSource, setActiveSource] = useState<any>(null);
  const [masks, setMasks] = useState<Masks | null>(null);
  const masksRef = useRef<Masks | null>(null);
  const [baseImage, setBaseImage] = useState<HTMLImageElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [revision, setRevision] = useState(0);
  const [note, setNote] = useState('');
  const [versionLoading, setVersionLoading] = useState(false);
  const draftKey = `${prediction.id}`;
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [layer, setLayer] = useState<LayerName>('rotten');
  const [tool, setTool] = useState<ToolName>('brush-add');
  const [brushSize, setBrushSize] = useState(24);
  const [zoom, setZoom] = useState(1);
  const [spacePressed, setSpacePressed] = useState(false);
  const [smartThreshold, setSmartThreshold] = useState(0.08);
  const [smartLoading, setSmartLoading] = useState(false);
  const [confidenceReady, setConfidenceReady] = useState(false);
  const [smartSelection, setSmartSelection] = useState<Uint8Array | null>(null);
  const [smartSelectionCount, setSmartSelectionCount] = useState(0);
  const [showCassava, setShowCassava] = useState(true);
  const [showRotten, setShowRotten] = useState(true);
  const [showOriginal, setShowOriginal] = useState(true);
  const [dimOutside, setDimOutside] = useState(true);
  const [cassavaOpacity, setCassavaOpacity] = useState(0.28);
  const [rottenOpacity, setRottenOpacity] = useState(0.68);
  const [polygonPoints, setPolygonPoints] = useState<PolygonPoint[]>([]);
  const [polygonDragIndex, setPolygonDragIndex] = useState<number | null>(null);
  const [maskRings, setMaskRings] = useState<PolygonRing[]>([]);
  const [maskRingDrag, setMaskRingDrag] = useState<{ ring: number; index: number } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [maskToPolygonLoading, setMaskToPolygonLoading] = useState(false);
  const [history, setHistory] = useState<Masks[]>([]);
  const [future, setFuture] = useState<Masks[]>([]);
  const [metrics, setMetrics] = useState({ cassavaPixels: 0, rottenPixels: 0, ppd: 0 });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const strokeBeforeRef = useRef<Masks | null>(null);
  const strokeLastPointRef = useRef<{ x: number; y: number } | null>(null);
  const panningRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null);
  const spacePressedRef = useRef(false);
  const confidenceMapRef = useRef<Uint8Array | null>(null);
  const smartRunRef = useRef(0);
  const keyboardActionsRef = useRef({ undo: () => {}, redo: () => {}, save: () => {} });

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    predictionsApi.getEditor(prediction.id).then(async (payload) => {
      if (!active) return;
      setEditor(payload);
      const source = payload.current_correction || payload;
      setActiveSource(source);
      setNote(source.note || '');
      if (!payload.editor_available && !source.cassava_mask_url) {
        throw new Error('该历史结果没有可编辑的原始掩码，请重新预测后再编辑。');
      }
      const image = await fetchBaseImage(resolveFileUrl(payload.original_image_url || prediction.imageUrl));
      const width = Number(source.width || image.naturalWidth);
      const height = Number(source.height || image.naturalHeight);
      const [cassava, rotten] = await Promise.all([
        fetchRaster(resolveFileUrl(source.cassava_mask_url), width, height),
        fetchRaster(resolveFileUrl(source.rotten_mask_url), width, height),
      ]);
      if (!active) return;
      let next = { width, height, cassava, rotten };
      try {
        const draft = await readDraft(draftKey);
        if (!active) return;
        if (draft && draft.width === width && draft.height === height &&
            await confirmAction(
              '发现未保存的草稿',
              draft.baseVersion === (payload.current_correction?.version || 0)
                ? '发现未保存的本地草稿，是否恢复？'
                : '发现基于旧版本的本地草稿，是否恢复并在保存前重新核对？',
              '恢复草稿',
              '放弃草稿',
            )) {
          next = { width, height, cassava: draft.cassava, rotten: draft.rotten };
          setNote(draft.note);
          setDirty(true);
          setRevision((value) => value + 1);
        }
      } catch { message.warning('浏览器草稿存储不可用，请及时保存版本'); }

      masksRef.current = next;
      setMasks(next);
      setMetrics(calculateMaskPixelMetrics(next.cassava, next.rotten));
      setBaseImage(image);
    }).catch((loadError: any) => {
      if (active) setError(loadError?.message || '编辑数据加载失败');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [prediction.id, prediction.imageUrl]);

  const originalPpd = Number(prediction.ppdValue || 0);
  const delta = metrics.ppd - originalPpd;
  const isLight = theme === 'light';
  const shellClass = isLight ? 'bg-white/40 text-slate-900' : 'bg-[#101722] text-white';
  const borderClass = isLight ? 'border-slate-200' : 'border-white/10';
  const mutedClass = isLight ? 'text-slate-600' : 'text-slate-300';
  const toolbarClass = isLight ? 'bg-white/60' : 'bg-[#141e2b]';
  const asideClass = isLight ? 'bg-white/40' : 'bg-[#111b28]';

  const canvasWidth = masks?.width || 0;
  const canvasHeight = masks?.height || 0;

  const fitToView = useCallback(() => {
    if (!canvasWidth || !canvasHeight || !viewportRef.current) return;
    const availableWidth = Math.max(240, viewportRef.current.clientWidth - 72);
    const availableHeight = Math.max(240, viewportRef.current.clientHeight - 72);
    const fit = Math.min(availableWidth / canvasWidth, availableHeight / canvasHeight);
    setZoom(clamp(fit, 0.25, 4));
  }, [canvasHeight, canvasWidth]);

  useEffect(() => {
    if (!baseImage || !canvasWidth || !canvasHeight) return undefined;
    const frame = requestAnimationFrame(fitToView);
    return () => cancelAnimationFrame(frame);
  }, [baseImage, canvasHeight, canvasWidth, fitToView]);

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !baseImage || !masks) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    canvas.width = masks.width;
    canvas.height = masks.height;
    context.clearRect(0, 0, masks.width, masks.height);
    if (showOriginal) {
      context.drawImage(baseImage, 0, 0, masks.width, masks.height);
    } else {
      context.fillStyle = '#0a111c';
      context.fillRect(0, 0, masks.width, masks.height);
    }
    const overlay = context.createImageData(masks.width, masks.height);
    for (let i = 0; i < masks.cassava.length; i += 1) {
      const isCassava = masks.cassava[i] === 1;
      const isRotten = masks.rotten[i] === 1 && isCassava;
      const offset = i * 4;
      if (dimOutside && !isCassava) {
        overlay.data[offset] = 3;
        overlay.data[offset + 1] = 9;
        overlay.data[offset + 2] = 18;
        overlay.data[offset + 3] = 150;
      } else if (isRotten && showRotten) {
        overlay.data[offset] = 244;
        overlay.data[offset + 1] = 63;
        overlay.data[offset + 2] = 94;
        overlay.data[offset + 3] = Math.round(rottenOpacity * 255);
      } else if (isCassava && showCassava) {
        overlay.data[offset] = 20;
        overlay.data[offset + 1] = 184;
        overlay.data[offset + 2] = 166;
        overlay.data[offset + 3] = Math.round(cassavaOpacity * 255);
      }
    }
    if (smartSelection) {
      for (let i = 0; i < smartSelection.length; i += 1) {
        if (!smartSelection[i]) continue;
        const offset = i * 4;
        overlay.data[offset] = 251;
        overlay.data[offset + 1] = 191;
        overlay.data[offset + 2] = 36;
        overlay.data[offset + 3] = 205;
      }
    }
    // 不能直接把带透明像素的 ImageData 写回主画布：
    // putImageData 会把 alpha=0 的像素也写成透明黑，从而覆盖掉底层原图。
    // 使用独立的透明掩码画布再合成，才能保留原图细节。
    const overlayCanvas = overlayCanvasRef.current || document.createElement('canvas');
    overlayCanvasRef.current = overlayCanvas;
    overlayCanvas.width = masks.width;
    overlayCanvas.height = masks.height;
    const overlayContext = overlayCanvas.getContext('2d');
    if (!overlayContext) return;
    overlayContext.putImageData(overlay, 0, 0);
    context.drawImage(overlayCanvas, 0, 0);
    if (polygonPoints.length > 0 || maskRings.length > 0) {
      // 屏幕像素 → 掩码像素的换算，保证顶点在任何缩放下都是固定屏幕尺寸（小圆点，不遮挡细节）
      const scale = masks.width / Math.max(1, canvas.getBoundingClientRect().width);
      const handleRadius = clamp(4 * scale, 1.5, masks.width);
      const lineWidth = clamp(1.6 * scale, 1, masks.width);
      context.save();
      // 掩码转换出的多环轮廓：青色虚线 + 淡青填充，表示「待确认的病害边界」
      if (maskRings.length > 0) {
        context.strokeStyle = '#38bdf8';
        context.lineWidth = lineWidth;
        context.setLineDash([5 * scale, 4 * scale]);
        context.fillStyle = 'rgba(56, 189, 248, 0.14)';
        maskRings.forEach((ring) => {
          if (ring.length < 3) return;
          context.beginPath();
          ring.forEach((point, index) => index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y));
          context.closePath();
          context.stroke();
          context.fill();
        });
        context.setLineDash([]);
        // 每个环的顶点都可拖动：大块病害也要能调整，因此不做数量截断
        maskRings.forEach((ring, ringIndex) => {
          ring.forEach((point, index) => {
            const active = maskRingDrag?.ring === ringIndex && maskRingDrag.index === index;
            context.beginPath();
            context.fillStyle = active ? '#ffffff' : '#38bdf8';
            context.arc(point.x, point.y, active ? handleRadius * 1.8 : handleRadius * 0.9, 0, Math.PI * 2);
            context.fill();
            context.strokeStyle = '#0f172a';
            context.lineWidth = clamp(1.1 * scale, 0.7, masks.width);
            context.stroke();
          });
        });
      }
      if (polygonPoints.length > 0) {
        context.strokeStyle = '#fbbf24';
        context.lineWidth = lineWidth;
        context.setLineDash([6 * scale, 4 * scale]);
        context.beginPath();
        polygonPoints.forEach((point, index) => index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y));
        if (polygonPoints.length >= 3) context.closePath();
        context.stroke();
        context.setLineDash([]);
        context.fillStyle = 'rgba(251, 191, 36, 0.16)';
        if (polygonPoints.length >= 3) context.fill();
        polygonPoints.forEach((point, index) => {
          const active = polygonDragIndex === index;
          context.beginPath();
          context.fillStyle = index === 0 ? '#f8fafc' : active ? '#ffffff' : '#fbbf24';
          context.arc(point.x, point.y, active ? handleRadius * 1.6 : handleRadius, 0, Math.PI * 2);
          context.fill();
          context.strokeStyle = '#0f172a';
          context.lineWidth = clamp(1.2 * scale, 0.8, masks.width);
          context.stroke();
        });
      }
      context.restore();
    }
  }, [baseImage, cassavaOpacity, dimOutside, maskRingDrag, maskRings, masks, polygonDragIndex, polygonPoints, rottenOpacity, showCassava, showOriginal, showRotten, smartSelection]);

  useEffect(() => { renderCanvas(); }, [renderCanvas]);

  const renderRegion = useCallback((minX: number, minY: number, maxX: number, maxY: number) => {
    const canvas = canvasRef.current;
    const current = masksRef.current;
    if (!canvas || !baseImage || !current) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const x = clamp(Math.floor(minX), 0, current.width - 1);
    const y = clamp(Math.floor(minY), 0, current.height - 1);
    const right = clamp(Math.ceil(maxX), x, current.width - 1);
    const bottom = clamp(Math.ceil(maxY), y, current.height - 1);
    const width = right - x + 1;
    const height = bottom - y + 1;

    if (showOriginal) context.drawImage(baseImage, x, y, width, height, x, y, width, height);
    else {
      context.fillStyle = '#0a111c';
      context.fillRect(x, y, width, height);
    }

    const overlayCanvas = overlayCanvasRef.current || document.createElement('canvas');
    overlayCanvasRef.current = overlayCanvas;
    if (overlayCanvas.width !== current.width || overlayCanvas.height !== current.height) {
      overlayCanvas.width = current.width;
      overlayCanvas.height = current.height;
    }
    const overlayContext = overlayCanvas.getContext('2d');
    if (!overlayContext) return;
    const overlay = overlayContext.createImageData(width, height);
    for (let py = 0; py < height; py += 1) {
      for (let px = 0; px < width; px += 1) {
        const sourceIndex = (y + py) * current.width + x + px;
        const offset = (py * width + px) * 4;
        const isCassava = current.cassava[sourceIndex] === 1;
        const isRotten = current.rotten[sourceIndex] === 1 && isCassava;
        if (dimOutside && !isCassava) {
          overlay.data.set([3, 9, 18, 150], offset);
        } else if (isRotten && showRotten) {
          overlay.data.set([244, 63, 94, Math.round(rottenOpacity * 255)], offset);
        } else if (isCassava && showCassava) {
          overlay.data.set([20, 184, 166, Math.round(cassavaOpacity * 255)], offset);
        }
      }
    }
    overlayContext.clearRect(x, y, width, height);
    overlayContext.putImageData(overlay, x, y);
    context.drawImage(overlayCanvas, x, y, width, height, x, y, width, height);
  }, [baseImage, cassavaOpacity, dimOutside, rottenOpacity, showCassava, showOriginal, showRotten]);

  const snapshot = (value: Masks): Masks => ({
    width: value.width,
    height: value.height,
    cassava: value.cassava.slice(),
    rotten: value.rotten.slice(),
  });

  const updateMasks = (next: Masks) => {
    masksRef.current = next;
    setMasks(next);
    setMetrics(calculateMaskPixelMetrics(next.cassava, next.rotten));
  };

  const applyBrush = (next: Masks, x: number, y: number, erase: boolean) => {
    const radius = Math.max(2, brushSize / 2);
    const minX = clamp(Math.floor(x - radius), 0, next.width - 1);
    const maxX = clamp(Math.ceil(x + radius), 0, next.width - 1);
    const minY = clamp(Math.floor(y - radius), 0, next.height - 1);
    const maxY = clamp(Math.ceil(y + radius), 0, next.height - 1);
    const target = layer === 'cassava' ? next.cassava : next.rotten;
    let cassavaDelta = 0;
    let rottenDelta = 0;
    for (let py = minY; py <= maxY; py += 1) {
      for (let px = minX; px <= maxX; px += 1) {
        if ((px - x) ** 2 + (py - y) ** 2 > radius ** 2) continue;
        const index = py * next.width + px;
        const nextValue = erase ? 0 : 1;
        if (layer === 'rotten' && nextValue && !next.cassava[index]) continue;
        if (target[index] !== nextValue) {
          if (layer === 'cassava') cassavaDelta += nextValue ? 1 : -1;
          else rottenDelta += nextValue ? 1 : -1;
          target[index] = nextValue;
        }
        if (layer === 'cassava' && erase && next.rotten[index]) {
          next.rotten[index] = 0;
          rottenDelta -= 1;
        }
      }
    }
    return { minX, minY, maxX, maxY, cassavaDelta, rottenDelta };
  };

  const applyMetricDelta = (cassavaDelta: number, rottenDelta: number) => {
    if (!cassavaDelta && !rottenDelta) return;
    setMetrics((current) => {
      const cassavaPixels = current.cassavaPixels + cassavaDelta;
      const rottenPixels = current.rottenPixels + rottenDelta;
      return { cassavaPixels, rottenPixels, ppd: cassavaPixels ? rottenPixels / cassavaPixels * 100 : 0 };
    });
  };

  const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !masks) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) * masks.width / rect.width, 0, masks.width - 1),
      y: clamp((event.clientY - rect.top) * masks.height / rect.height, 0, masks.height - 1),
    };
  };

  const ensureConfidenceMap = async () => {
    if (confidenceMapRef.current) return confidenceMapRef.current;
    const sourceUrl = editor?.confidence_map_url;
    const current = masksRef.current;
    if (!sourceUrl || !current) throw new Error('该历史结果没有置信度图，请重新预测后使用智能点选。');
    const confidence = await fetchConfidenceRaster(resolveFileUrl(sourceUrl), current.width, current.height);
    confidenceMapRef.current = confidence;
    setConfidenceReady(true);
    return confidence;
  };

  const growSmartRegion = async (point: { x: number; y: number }) => {
    if (layer !== 'rotten') throw new Error('智能点选目前用于腐烂范围，请先切换到“腐烂范围”。');
    const current = masksRef.current;
    if (!current) throw new Error('掩码尚未加载完成');
    const confidence = await ensureConfidenceMap();
    const width = current.width;
    const height = current.height;
    const total = width * height;
    const seedIndex = Math.floor(point.y) * width + Math.floor(point.x);
    if (!current.cassava[seedIndex]) throw new Error('请点击木薯主体内部，再进行智能点选。');
    const seedValue = confidence[seedIndex];
    const tolerance = Math.max(2, Math.round(smartThreshold * 255));
    const visited = new Uint8Array(total);
    const selected = new Uint8Array(total);
    const queue = new Int32Array(total);
    let head = 0;
    let tail = 0;
    const enqueue = (index: number) => {
      if (index < 0 || index >= total || visited[index]) return;
      visited[index] = 1;
      queue[tail++] = index;
    };
    enqueue(seedIndex);

    return new Promise<Uint8Array>((resolve) => {
      const runId = smartRunRef.current;
      const processChunk = () => {
        if (runId !== smartRunRef.current) {
          resolve(new Uint8Array(total));
          return;
        }
        const chunkEnd = Math.min(tail, head + 12000);
        while (head < chunkEnd) {
          const index = queue[head++];
          if (!current.cassava[index] || Math.abs(confidence[index] - seedValue) > tolerance) continue;
          selected[index] = 1;
          const x = index % width;
          if (x > 0) enqueue(index - 1);
          if (x < width - 1) enqueue(index + 1);
          if (index >= width) enqueue(index - width);
          if (index < total - width) enqueue(index + width);
          if (x > 0 && index >= width) enqueue(index - width - 1);
          if (x < width - 1 && index >= width) enqueue(index - width + 1);
          if (x > 0 && index < total - width) enqueue(index + width - 1);
          if (x < width - 1 && index < total - width) enqueue(index + width + 1);
        }
        if (head < tail) {
          window.requestAnimationFrame(processChunk);
        } else {
          resolve(selected);
        }
      };
      window.requestAnimationFrame(processChunk);
    });
  };

  const handleSmartClick = async (point: { x: number; y: number }) => {
    if (smartLoading) return;
    smartRunRef.current += 1;
    setSmartLoading(true);
    try {
      const selection = await growSmartRegion(point);
      if (countPixels(selection) === 0) throw new Error('没有找到相似的连续区域，请增大相似度阈值。');
      setSmartSelection(selection);
      setSmartSelectionCount(countPixels(selection));
    } catch (smartError: any) {
      message.warning(smartError?.message || '智能点选失败');
    } finally {
      setSmartLoading(false);
    }
  };

  const applySmartSelection = () => {
    if (savingRef.current || versionLoading) return;
    if (!smartSelection || !masksRef.current) return;
    const current = masksRef.current;
    const next = snapshot(current);
    const erase = tool === 'smart-erase';
    for (let i = 0; i < smartSelection.length; i += 1) {
      if (smartSelection[i]) next.rotten[i] = erase ? 0 : 1;
    }
    for (let i = 0; i < next.rotten.length; i += 1) next.rotten[i] = next.rotten[i] && next.cassava[i] ? 1 : 0;
    commitSnapshot(current);
    updateMasks(next);
    setSmartSelection(null);
    setSmartSelectionCount(0);
  };

  const commitSnapshot = (before: Masks) => {
    const bytesPerSnapshot = Math.max(1, before.cassava.byteLength + before.rotten.byteLength);
    const maxSnapshots = clamp(Math.floor((64 * 1024 * 1024) / bytesPerSnapshot), 1, 20);
    setHistory((items) => [...(maxSnapshots > 1 ? items.slice(-(maxSnapshots - 1)) : []), before]);
    setDirty(true);
    setRevision((value) => value + 1);
    setFuture([]);
  };

  const applyPolygon = () => {
    if (savingRef.current || versionLoading) return;
    const current = masksRef.current;
    if (!current || polygonPoints.length < 3) return;
    const next = snapshot(current);
    const erase = tool === 'pen-erase';
    const target = layer === 'cassava' ? next.cassava : next.rotten;
    const minX = Math.max(0, Math.floor(Math.min(...polygonPoints.map((p) => p.x))));
    const maxX = Math.min(next.width - 1, Math.ceil(Math.max(...polygonPoints.map((p) => p.x))));
    const minY = Math.max(0, Math.floor(Math.min(...polygonPoints.map((p) => p.y))));
    const maxY = Math.min(next.height - 1, Math.ceil(Math.max(...polygonPoints.map((p) => p.y))));
    for (let py = minY; py <= maxY; py += 1) {
      for (let px = minX; px <= maxX; px += 1) {
        if (!pointInPolygon(px, py, polygonPoints)) continue;
        const index = py * next.width + px;
        target[index] = erase ? 0 : 1;
        if (layer === 'cassava' && erase) next.rotten[index] = 0;
      }
    }
    for (let i = 0; i < next.rotten.length; i += 1) next.rotten[i] = next.rotten[i] && next.cassava[i] ? 1 : 0;
    commitSnapshot(current);
    updateMasks(next);
    setPolygonPoints([]);
  };

  const handleMaskToPolygon = () => {
    if (savingRef.current || versionLoading) return;
    const current = masksRef.current;
    if (!current) return;
    setMaskToPolygonLoading(true);
    // 轮廓提取是重计算，放到下一帧执行，先把「转换中…」渲染出来
    window.setTimeout(() => {
      try {
        const source = layer === 'cassava' ? current.cassava : current.rotten;
        const minArea = Math.max(24, Math.round((current.width * current.height) / 60000));
        const rings = traceMaskOutlines(source, current.width, current.height, minArea);
        if (!rings.length) {
          message.warning(layer === 'cassava' ? '当前图层没有可转换的区域' : '当前腐烂范围为空，请先涂抹或使用智能点选');
          return;
        }
        const tolerance = Math.max(2, current.width / 480);
        const simplifiedRings = rings
          .map((ring) => simplifyPolygon(ring, tolerance).map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) })))
          .filter((ring) => ring.length >= 3);
        if (!simplifiedRings.length) {
          message.warning('轮廓过于细碎，无法转换为可拖动的多边形');
          return;
        }
        const totalPoints = simplifiedRings.reduce((sum, ring) => sum + ring.length, 0);
        setPolygonPoints([]);
        setMaskRings(simplifiedRings);
        // 转换出来的轮廓表示「当前掩码的边界」，应用时应当还原而不是擦除，故默认用添加工具
        setTool('pen-add');
        message.success(`已转换 ${simplifiedRings.length} 段病害边界（共 ${totalPoints} 个顶点），拖动顶点微调后点「应用多边形」写回掩码`);
      } finally {
        setMaskToPolygonLoading(false);
      }
    }, 0);
  };

  /** 把掩码转换出的多环轮廓一次性写回当前图层。 */
  const applyMaskRings = () => {
    if (savingRef.current || versionLoading) return;
    const current = masksRef.current;
    if (!current || !maskRings.length) return;
    const next = snapshot(current);
    const erase = tool === 'pen-erase';
    const target = layer === 'cassava' ? next.cassava : next.rotten;
    maskRings.forEach((ring) => {
      if (ring.length < 3) return;
      const minX = Math.max(0, Math.floor(Math.min(...ring.map((p) => p.x))));
      const maxX = Math.min(next.width - 1, Math.ceil(Math.max(...ring.map((p) => p.x))));
      const minY = Math.max(0, Math.floor(Math.min(...ring.map((p) => p.y))));
      const maxY = Math.min(next.height - 1, Math.ceil(Math.max(...ring.map((p) => p.y))));
      for (let py = minY; py <= maxY; py += 1) {
        for (let px = minX; px <= maxX; px += 1) {
          if (!pointInPolygon(px, py, ring)) continue;
          const index = py * next.width + px;
          target[index] = erase ? 0 : 1;
          if (layer === 'cassava' && erase) next.rotten[index] = 0;
        }
      }
    });
    for (let i = 0; i < next.rotten.length; i += 1) next.rotten[i] = next.rotten[i] && next.cassava[i] ? 1 : 0;
    commitSnapshot(current);
    updateMasks(next);
    setMaskRings([]);
    setMaskRingDrag(null);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = pointFromEvent(event);
    if (!point || !masksRef.current || savingRef.current || versionLoading) return;
    if (tool === 'pan' || spacePressedRef.current) {
      if (event.button !== 0) return;
      event.preventDefault();
      const viewport = viewportRef.current;
      if (viewport) panningRef.current = { x: event.clientX, y: event.clientY, scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (tool.startsWith('pen')) {
      const canvas = canvasRef.current;
      const scale = canvas ? masksRef.current.width / Math.max(1, canvas.getBoundingClientRect().width) : 1;
      const hitRadius = Math.max(6 * scale, masksRef.current.width / 220);
      // 掩码多环轮廓优先响应拖动：命中任一环的顶点即进入拖动
      if (maskRings.length) {
        for (let ringIndex = 0; ringIndex < maskRings.length; ringIndex += 1) {
          const ring = maskRings[ringIndex];
          for (let index = 0; index < ring.length; index += 1) {
            const item = ring[index];
            if (Math.hypot(item.x - point.x, item.y - point.y) > hitRadius) continue;
            event.preventDefault();
            setMaskRingDrag({ ring: ringIndex, index });
            event.currentTarget.setPointerCapture(event.pointerId);
            return;
          }
        }
      }
      const firstPoint = polygonPoints[0];
      const closeDistance = Math.max(12, masksRef.current.width / 180);
      if (firstPoint && polygonPoints.length >= 3 && Math.hypot(point.x - firstPoint.x, point.y - firstPoint.y) <= closeDistance) {
        applyPolygon();
        return;
      }
      // 命中已有点 → 进入拖动，而不是新增一个点
      const hitIndex = polygonPoints.findIndex((item) => Math.hypot(item.x - point.x, item.y - point.y) <= hitRadius);
      if (hitIndex >= 0) {
        event.preventDefault();
        setPolygonDragIndex(hitIndex);
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
      setPolygonPoints((points) => [...points, point]);
      return;
    }
    if (tool.startsWith('smart')) {
      if (event.button !== 0) return;
      event.preventDefault();
      void handleSmartClick(point);
      return;
    }
    strokeBeforeRef.current = snapshot(masksRef.current);
    const next = masksRef.current;
    const change = applyBrush(next, point.x, point.y, tool === 'brush-erase');
    applyMetricDelta(change.cassavaDelta, change.rottenDelta);
    renderRegion(change.minX, change.minY, change.maxX, change.maxY);
    strokeLastPointRef.current = point;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (savingRef.current || versionLoading) return;
    if (panningRef.current && viewportRef.current) {
      const pan = panningRef.current;
      viewportRef.current.scrollLeft = pan.scrollLeft - (event.clientX - pan.x);
      viewportRef.current.scrollTop = pan.scrollTop - (event.clientY - pan.y);
      return;
    }
    const point = pointFromEvent(event);
    if (point) setCursor(point);
    if (maskRingDrag && point) {
      setMaskRings((rings) => rings.map((ring, ringIndex) => ringIndex === maskRingDrag.ring
        ? ring.map((item, index) => index === maskRingDrag.index ? point : item)
        : ring));
      return;
    }
    if (polygonDragIndex !== null && point) {
      setPolygonPoints((points) => points.map((item, index) => index === polygonDragIndex ? point : item));
      return;
    }
    if (!strokeBeforeRef.current || !masksRef.current || tool.startsWith('pen')) return;
    if (!point) return;
    const next = masksRef.current;
    const previous = strokeLastPointRef.current || point;
    const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
    const stepSize = Math.max(2, brushSize * 0.35);
    const steps = Math.max(1, Math.ceil(distance / stepSize));
    let cassavaDelta = 0;
    let rottenDelta = 0;
    let minX = next.width - 1;
    let minY = next.height - 1;
    let maxX = 0;
    let maxY = 0;
    for (let step = 1; step <= steps; step += 1) {
      const progress = step / steps;
      const change = applyBrush(
        next,
        previous.x + (point.x - previous.x) * progress,
        previous.y + (point.y - previous.y) * progress,
        tool === 'brush-erase',
      );
      cassavaDelta += change.cassavaDelta;
      rottenDelta += change.rottenDelta;
      minX = Math.min(minX, change.minX);
      minY = Math.min(minY, change.minY);
      maxX = Math.max(maxX, change.maxX);
      maxY = Math.max(maxY, change.maxY);
    }
    applyMetricDelta(cassavaDelta, rottenDelta);
    renderRegion(minX, minY, maxX, maxY);
    strokeLastPointRef.current = point;
  };

  const handlePointerUp = () => {
    if (panningRef.current) panningRef.current = null;
    if (polygonDragIndex !== null) setPolygonDragIndex(null);
    if (maskRingDrag) setMaskRingDrag(null);
    if (strokeBeforeRef.current) {
      commitSnapshot(strokeBeforeRef.current);
      strokeBeforeRef.current = null;
    }
    strokeLastPointRef.current = null;
  };

  const handleCanvasWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    if (!event.altKey) return;
    event.preventDefault();
    const direction = event.deltaY > 0 ? -1 : 1;
    setZoom((value) => clamp(value + direction * 0.1, 0.25, 4));
  };

  const handleCanvasDoubleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool.startsWith('pen') && polygonPoints.length >= 3) {
      event.preventDefault();
      applyPolygon();
    }
  };

  const restore = (value: Masks) => updateMasks(snapshot(value));

  const handleUndo = () => {
    if (savingRef.current || versionLoading) return;
    setDirty(true);
    setRevision((value) => value + 1);
    const current = masksRef.current;
    const previous = history[history.length - 1];
    if (!current || !previous) return;
    setFuture((items) => [snapshot(current), ...items]);
    setHistory((items) => items.slice(0, -1));
    restore(previous);
  };

  const handleRedo = () => {
    if (savingRef.current || versionLoading) return;
    setDirty(true);
    setRevision((value) => value + 1);
    const current = masksRef.current;
    const next = future[0];
    if (!current || !next) return;
    setHistory((items) => [...items, snapshot(current)]);
    setFuture((items) => items.slice(1));
    restore(next);
  };

  const handleReset = () => {
    if (savingRef.current || versionLoading) return;
    const source = activeSource || editor;
    if (!source || !masksRef.current) return;
    const load = async () => {
      const current = masksRef.current;
      if (!current) return;
      const next = snapshot(current);
      const [cassava, rotten] = await Promise.all([
        fetchRaster(resolveFileUrl(source.cassava_mask_url), current.width, current.height),
        fetchRaster(resolveFileUrl(source.rotten_mask_url), current.width, current.height),
      ]);
      next.cassava = cassava;
      next.rotten = rotten;
      commitSnapshot(current);
      updateMasks(next);
    };
    void load().catch((resetError: any) => message.error(resetError?.message || '恢复失败'));
  };

  const handleVersionChange = async (value: string) => {
    if (!editor || !masksRef.current || savingRef.current || versionLoading) return;
    if ((dirty || polygonPoints.length || maskRings.length || smartSelection) && !(await confirmAction(
      '当前修改尚未保存',
      '切换版本将替换当前画布，是否继续？',
      '继续',
      '留在当前版本',
    ))) return;
    const source = value === 'model' ? editor : (editor.corrections || []).find((item: any) => String(item.version) === value);
    if (!source?.cassava_mask_url || !source?.rotten_mask_url) return;
    setVersionLoading(true);
    try {
      const current = masksRef.current;
      const [cassava, rotten] = await Promise.all([
        fetchRaster(resolveFileUrl(source.cassava_mask_url), current.width, current.height),
        fetchRaster(resolveFileUrl(source.rotten_mask_url), current.width, current.height),
      ]);
      smartRunRef.current += 1;
      setSmartSelection(null);
      setPolygonPoints([]);
      setMaskRings([]);
      setMaskRingDrag(null);
      setActiveSource(source);
      setHistory([]);
      setFuture([]);
      setDirty(false);
      updateMasks({ ...current, cassava, rotten });
    } catch (versionError: any) { message.error(versionError?.message || '版本加载失败'); }
    finally { setVersionLoading(false); }
  };

  const handleSave = async () => {
    if (!masksRef.current || savingRef.current || versionLoading) return;
    if (polygonPoints.length || maskRings.length || smartSelection || smartLoading) {
      message.warning('请先应用或放弃当前多边形/智能选区，再保存版本');
      return;
    }
    if (!dirty) { message.info('当前没有待保存修改'); return; }
    const saveSnapshot = snapshot(masksRef.current);
    if (!metrics.cassavaPixels) {
      message.warning('木薯主体面积为 0，无法计算 PPD。');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const form = new FormData();
      form.append('cassava_mask', await maskToBlob(saveSnapshot.cassava, saveSnapshot.width, saveSnapshot.height), 'cassava-mask.png');
      form.append('rotten_mask', await maskToBlob(saveSnapshot.rotten, saveSnapshot.width, saveSnapshot.height), 'rotten-mask.png');
      form.append('edit_data', JSON.stringify({ layer, tool, brushSize, width: saveSnapshot.width, height: saveSnapshot.height, source_version: activeSource?.version || 0 }));
      form.append('base_version', String(editor.current_correction?.version || 0));
      form.append('note', note);
      const correction = await predictionsApi.saveCorrection(prediction.id, form);
      setEditor((current: any) => current ? {
        ...current,
        current_correction: correction,
        corrections: [correction, ...(current.corrections || [])],
      } : current);
      setActiveSource(correction);
      setDirty(false);
      try { await removeDraft(draftKey); } catch { /* The server version is already safely stored. */ }
      setHistory([]);
      setFuture([]);
      message.success('人工校正版本已保存');
      onSaved(correction);
    } catch (saveError: any) {
      message.error(saveError?.response?.data?.message || saveError?.response?.data?.detail || saveError?.message || '保存校正结果失败');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  keyboardActionsRef.current = {
    undo: handleUndo,
    redo: handleRedo,
    save: () => { void handleSave(); },
  };

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'SELECT' || target?.tagName === 'TEXTAREA') return;
      const key = event.key.toLowerCase();

      if (event.code === 'Space') {
        event.preventDefault();
        if (!spacePressedRef.current) {
          spacePressedRef.current = true;
          setSpacePressed(true);
        }
        return;
      }

      if (event.ctrlKey || event.metaKey) {
        if (key === 'z') {
          event.preventDefault();
          if (event.shiftKey) keyboardActionsRef.current.redo(); else keyboardActionsRef.current.undo();
        } else if (key === 'y') {
          event.preventDefault();
          keyboardActionsRef.current.redo();
        } else if (key === 's') {
          event.preventDefault();
          keyboardActionsRef.current.save();
        }
        return;
      }

      if (key === 'b') setTool('brush-add');
      else if (key === 'e') setTool('brush-erase');
      else if (key === 'p') setTool(event.shiftKey ? 'pen-erase' : 'pen-add');
      else if (key === 'w') setTool(event.shiftKey ? 'smart-erase' : 'smart-add');
      else if (key === 'h' || key === 'v') setTool('pan');
      else if (key === 'c') setLayer('cassava');
      else if (key === 'r') setLayer('rotten');
      else if (key === 'tab') {
        event.preventDefault();
        setLayer((current) => current === 'cassava' ? 'rotten' : 'cassava');
      }
      else if (key === 'x') {
        setTool((current) => current.endsWith('erase') ? current.replace('-erase', '-add') as ToolName : current.replace('-add', '-erase') as ToolName);
      } else if (key === '[') setBrushSize((value) => clamp(value - 4, 4, 120));
      else if (key === ']') setBrushSize((value) => clamp(value + 4, 4, 120));
      else if (key === '+' || key === '=') setZoom((value) => clamp(value + 0.1, 0.25, 4));
      else if (key === '-') setZoom((value) => clamp(value - 0.1, 0.25, 4));
      else if (key === '0') fitToView();
      else if (key === '1') setZoom(1);
      else if (key === 'escape') { setPolygonPoints([]); setMaskRings([]); setMaskRingDrag(null); }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      event.preventDefault();
      spacePressedRef.current = false;
      setSpacePressed(false);
    };
    const handleWindowBlur = () => {
      spacePressedRef.current = false;
      setSpacePressed(false);
    };

    window.addEventListener('keydown', handleKeyboard);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyboard);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [fitToView]);

  const hasPendingChanges = dirty || polygonPoints.length > 0 || maskRings.length > 0 || Boolean(smartSelection);
  useEffect(() => {
    if (!dirty || saving || !masksRef.current || !editor) return;
    const timer = window.setTimeout(() => {
      const current = masksRef.current;
      if (!current || savingRef.current) return;
      void writeDraft({ id: draftKey, baseVersion: editor.current_correction?.version || 0,
        ...snapshot(current), note, savedAt: new Date().toISOString() }).catch(() => message.warning('草稿暂存失败，请保存版本'));
    }, 800);
    return () => window.clearTimeout(timer);
  }, [revision, dirty, note, saving, draftKey, editor]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (hasPendingChanges || saving) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [hasPendingChanges, saving]);

  const handleClose = async () => {
    if (savingRef.current || versionLoading) { message.info('正在保存或加载，请稍候'); return; }
    if (hasPendingChanges && !(await confirmAction(
      '尚未保存为正式版本',
      '当前修改尚未保存为正式版本，是否退出？已暂存的草稿下次可恢复。',
      '退出',
      '继续编辑',
    ))) return;
    onClose();
  };

  const activeToolIcon = (name: ToolName) => {
    if (name === 'brush-add') return <Brush className="h-4 w-4" />;
    if (name === 'brush-erase') return <Eraser className="h-4 w-4" />;
    if (name.startsWith('pen')) return <PenTool className="h-4 w-4" />;
    if (name.startsWith('smart')) return <Sparkles className="h-4 w-4" />;
    return <Hand className="h-4 w-4" />;
  };

  return (
    <div className={cx('fixed inset-0 z-[70]', isLight ? 'bg-slate-200' : 'bg-[#070b12]')}>
      <div className={cx('flex h-screen w-screen flex-col overflow-hidden', shellClass)}>
        <header className={cx('flex items-center justify-between gap-3 border-b px-4 py-1.5', borderClass)}>
          <div className="flex min-w-0 items-baseline gap-2">
            <Layers3 className="h-4 w-4 shrink-0 self-center text-slate-400" />
            <h2 className="truncate text-sm font-semibold">{prediction.imageName}</h2>
            <span className={cx('hidden shrink-0 text-[11px] md:inline', mutedClass)} title="木薯范围与腐烂范围均可编辑，PPD 实时计算">PPD 实时计算</span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button onClick={() => setTheme((value) => value === 'dark' ? 'light' : 'dark')} className={cx('inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px]', mutedClass, isLight ? 'hover:bg-white/50' : 'hover:bg-white/10')} title="切换深浅主题">
              {isLight ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}{isLight ? '深色' : '浅色'}
            </button>
            <button onClick={handleClose} className={cx('rounded-lg p-1.5 transition', mutedClass, isLight ? 'hover:bg-white/50 hover:text-slate-900' : 'hover:bg-white/10 hover:text-white')} aria-label="关闭编辑器"><X className="h-4 w-4" /></button>
          </div>
        </header>

        {loading ? <div className="flex flex-1 items-center justify-center text-slate-300">正在加载原图和掩码...</div> : error ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center"><CircleDot className="h-10 w-10 text-amber-300" /><p className="max-w-md text-sm text-slate-300">{error}</p><button onClick={handleClose} className="rounded-xl bg-white/60 px-4 py-2 text-sm font-medium text-slate-900">返回结果</button></div>
        ) : masks && baseImage ? (
          <>
            <div className={cx('flex flex-wrap items-center gap-1.5 border-b px-3 py-1.5', borderClass, toolbarClass)}>
              <span className={cx('mr-1 hidden items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] xl:flex', mutedClass)}><Maximize2 className="h-3.5 w-3.5 text-slate-300" />原图全屏编辑</span>
              <div className={cx('mr-1 flex items-center gap-1 rounded-lg p-0.5', isLight ? 'bg-white/40' : 'bg-white/5')}>
                <button onClick={() => setLayer('cassava')} className={cx('rounded-md px-2.5 py-1 text-[11px]', layer === 'cassava' ? 'bg-slate-200 text-slate-900' : mutedClass, layer === 'cassava' ? '' : (isLight ? 'hover:bg-white/70' : 'hover:bg-white/10'))} title="木薯范围（C）">木薯范围</button>
                <button onClick={() => setLayer('rotten')} className={cx('rounded-md px-2.5 py-1 text-[11px]', layer === 'rotten' ? 'bg-rose-400 text-slate-950' : mutedClass, layer === 'rotten' ? '' : (isLight ? 'hover:bg-white/70' : 'hover:bg-white/10'))} title="腐烂范围（R）">腐烂范围</button>
              </div>
              {(['brush-add', 'brush-erase', 'pen-add', 'pen-erase', 'smart-add', 'smart-erase', 'pan'] as ToolName[]).map((name) => (
                <button key={name} onClick={() => { setTool(name); setSmartSelection(null); setSmartSelectionCount(0); if (!name.startsWith('pen')) { setPolygonPoints([]); setMaskRings([]); setMaskRingDrag(null); } }} className={cx('inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] transition', tool === name ? (isLight ? 'bg-[#0a84ff] text-white' : 'bg-white/60 text-slate-950') : mutedClass, tool === name ? '' : (isLight ? 'hover:bg-white/50' : 'hover:bg-white/10'))} title={`${toolLabel[name]}（${toolShortcut[name]}）${name.startsWith('smart') && !editor?.confidence_map_url ? ' · 需重新预测生成置信度图' : ''}`}>{activeToolIcon(name)}<span className="hidden md:inline">{toolLabel[name]}</span></button>
              ))}
              <div className={cx('ml-auto flex items-center gap-1 border-l pl-2', borderClass)}>
                <button onClick={handleUndo} disabled={!history.length} className={cx('rounded-lg p-1.5 disabled:opacity-30', mutedClass, isLight ? 'hover:bg-white/50' : 'hover:bg-white/10')} title="撤销 Ctrl+Z"><Undo2 className="h-3.5 w-3.5" /></button>
                <button onClick={handleRedo} disabled={!future.length} className={cx('rounded-lg p-1.5 disabled:opacity-30', mutedClass, isLight ? 'hover:bg-white/50' : 'hover:bg-white/10')} title="重做 Ctrl+Y"><Redo2 className="h-3.5 w-3.5" /></button>
                <button onClick={handleReset} className={cx('rounded-lg p-1.5', mutedClass, isLight ? 'hover:bg-white/50' : 'hover:bg-white/10')} title="恢复当前版本"><RotateCcw className="h-3.5 w-3.5" /></button>
              </div>
              <div className={cx('flex items-center gap-1 rounded-lg p-0.5', isLight ? 'bg-white/40' : 'bg-white/5')}>
                <button onClick={() => setZoom((value) => clamp(value - 0.1, 0.25, 4))} className={cx('rounded-md p-1.5', mutedClass, isLight ? 'hover:bg-white/70' : 'hover:bg-white/10')} title="缩小 -"><ZoomOut className="h-3.5 w-3.5" /></button>
                <span className={cx('w-10 text-center text-[11px]', mutedClass)}>{Math.round(zoom * 100)}%</span>
                <button onClick={() => setZoom((value) => clamp(value + 0.1, 0.25, 4))} className={cx('rounded-md p-1.5', mutedClass, isLight ? 'hover:bg-white/70' : 'hover:bg-white/10')} title="放大 +"><ZoomIn className="h-3.5 w-3.5" /></button>
                <button onClick={fitToView} className={cx('rounded-md px-2 py-1 text-[11px]', mutedClass, isLight ? 'hover:bg-white/70' : 'hover:bg-white/10')} title="适应窗口">适应</button>
              </div>
              {tool.startsWith('pen') && polygonPoints.length >= 3 && <button onClick={applyPolygon} className="inline-flex items-center gap-1 rounded-xl bg-amber-300 px-3 py-2 text-xs font-semibold text-slate-950"><Check className="h-4 w-4" />闭合钢笔区域</button>}
              {!tool.startsWith('smart') && <button onClick={handleMaskToPolygon} disabled={maskToPolygonLoading} className={cx('inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition disabled:opacity-50', isLight ? 'bg-[#0a84ff] text-white hover:bg-slate-700' : 'bg-white/60 text-slate-950 hover:bg-slate-200')} title={`把当前${layer === 'cassava' ? '木薯' : '腐烂'}范围的掩码边缘转成可拖动的多边形轮廓`}><Spline className="h-3.5 w-3.5" /><span className="hidden md:inline">{maskToPolygonLoading ? '转换中…' : '掩码转多边形'}</span></button>}
              {maskRings.length > 0 && <button onClick={applyMaskRings} className="inline-flex items-center gap-1 rounded-xl bg-sky-300 px-3 py-1.5 text-[11px] font-semibold text-slate-950" title="把当前多环轮廓写回掩码"><Check className="h-3.5 w-3.5" />应用多边形（{maskRings.length} 段）</button>}
              {maskRings.length > 0 && <button onClick={() => { setMaskRings([]); setMaskRingDrag(null); }} className={cx('inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px]', mutedClass, isLight ? 'hover:bg-white/50' : 'hover:bg-white/10')} title="放弃当前转换出的多边形轮廓"><X className="h-3.5 w-3.5" />放弃</button>}
              {tool.startsWith('smart') && smartSelection && <button onClick={applySmartSelection} className="inline-flex items-center gap-1 rounded-lg bg-amber-300 px-3 py-1.5 text-[11px] font-semibold text-slate-950"><Check className="h-3.5 w-3.5" />应用选区 ({smartSelectionCount.toLocaleString()} px)</button>}
            </div>

            <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
              <main ref={viewportRef} className={cx('relative min-h-0 flex-1 overflow-auto p-3 md:p-4', isLight ? 'bg-white/40' : 'bg-[#080d14]')} style={{ cursor: tool === 'pan' || spacePressed ? 'grab' : (tool.startsWith('brush') || tool.startsWith('pen')) ? 'none' : 'default' }}>
                <div className="flex min-h-full min-w-full p-2">
                  <div className="relative m-auto shrink-0" style={{ width: masks.width * zoom, height: masks.height * zoom }}>
                    <canvas aria-label="像素校正画布" ref={canvasRef} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp} onPointerLeave={() => setCursor(null)} onDoubleClick={handleCanvasDoubleClick} onWheel={handleCanvasWheel} className="block max-w-none rounded-xl shadow-2xl" style={{ width: `${masks.width * zoom}px`, height: `${masks.height * zoom}px`, imageRendering: zoom > 1.5 ? 'pixelated' : 'auto' }} />
                    {cursor && tool.startsWith('brush') && !spacePressed && (
                      <span
                        aria-hidden
                        className="pointer-events-none absolute rounded-full border border-white/90 shadow-[0_0_0_1px_rgba(15,23,42,0.45)]"
                        style={{ left: cursor.x * zoom, top: cursor.y * zoom, width: Math.max(8, brushSize * zoom), height: Math.max(8, brushSize * zoom), transform: 'translate(-50%, -50%)' }}
                      />
                    )}
                    {cursor && tool.startsWith('pen') && !spacePressed && (
                      <span
                        aria-hidden
                        className="pointer-events-none absolute h-3 w-3 rounded-full border border-white/90 bg-white/40 shadow-[0_0_0_1px_rgba(15,23,42,0.45)]"
                        style={{ left: cursor.x * zoom, top: cursor.y * zoom, transform: 'translate(-50%, -50%)' }}
                      />
                    )}
                  </div>
                </div>
                <div className={cx('absolute bottom-4 left-4 flex flex-wrap gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] backdrop-blur', isLight ? 'border-slate-200 bg-white/85 text-slate-700' : 'border-white/10 bg-slate-950/75 text-slate-200')}>
                  <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-slate-300" />木薯范围</span><span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-rose-400" />腐烂范围</span><span className="text-slate-400">像素级编辑</span>
                </div>
              </main>

              <aside className={cx('w-full shrink-0 overflow-y-auto border-t p-3 lg:w-[270px] lg:border-l lg:border-t-0', borderClass, asideClass)}>
                <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">测量检查器</h3><span className="rounded-full bg-white/10 px-2 py-1 text-[10px] text-slate-300">实时</span></div>
                <div className={cx('mt-3 rounded-xl border p-3', borderClass, isLight ? 'bg-white/60' : 'bg-white/[0.04]')}><p className={cx('text-[11px]', mutedClass)}>校正后 PPD</p><p className={cx('mt-1 text-3xl font-semibold tracking-tight', isLight ? 'text-slate-900' : 'text-white')}>{metrics.ppd.toFixed(2)}<span className="ml-1 text-base text-slate-400">%</span></p><p className={cx('mt-1 text-[11px]', delta >= 0 ? 'text-rose-500' : 'text-slate-500')}>较原模型 {delta >= 0 ? '+' : ''}{delta.toFixed(2)} 个百分点</p></div>
                {editor?.corrections?.length > 0 && <div className="mt-3"><label htmlFor="correction-version" className={cx('mb-1.5 block text-[11px] font-semibold', mutedClass)}>校正版本</label><select id="correction-version" value={activeSource?.version ? String(activeSource.version) : 'model'} onChange={(event) => { void handleVersionChange(event.target.value); }} className={cx('w-full rounded-lg border px-2.5 py-1.5 text-[11px] outline-none focus:border-slate-400', borderClass, isLight ? 'bg-white/60 text-slate-700' : 'bg-slate-950/50 text-slate-200')}><option value="model">模型初始结果</option>{editor.corrections.map((item: any) => <option key={item.version} value={String(item.version)}>人工校正 v{item.version} · {Number(item.ppd_percent).toFixed(2)}%</option>)}</select></div>}
                <div className="mt-3 space-y-2 text-xs">
                  <div className={cx('flex items-center justify-between border-b pb-2', borderClass)}><span className={mutedClass}>木薯面积</span><strong>{metrics.cassavaPixels.toLocaleString()} px</strong></div>
                  <div className={cx('flex items-center justify-between border-b pb-2', borderClass)}><span className={mutedClass}>腐烂面积</span><strong className="text-rose-400">{metrics.rottenPixels.toLocaleString()} px</strong></div>
                  <div className={cx('flex items-center justify-between border-b pb-2', borderClass)}><span className={mutedClass}>原始模型 PPD</span><strong>{originalPpd.toFixed(2)}%</strong></div>
                  <div className="flex items-center justify-between"><span className="text-slate-400">图像尺寸</span><strong>{masks.width} × {masks.height}</strong></div>
                </div>
                {prediction.ppd_unit === 'unknown' && <div className={cx('mt-3 rounded-lg border p-2 text-[11px]', isLight ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-amber-300/20 bg-amber-300/10 text-amber-100')}>原始结果为历史数据，PPD 单位待确认；人工校正值始终按百分比计算。</div>}

                <div className={cx('mt-3 border-t pt-3', borderClass)}><p className={cx('mb-2 text-[11px] font-semibold', mutedClass)}>显示图层</p><div className="grid grid-cols-2 gap-1">
                  <button onClick={() => setShowOriginal((value) => !value)} title="原图底图" className={cx('flex items-center justify-between rounded-lg px-2 py-1.5 text-left text-[11px]', mutedClass, isLight ? 'hover:bg-white/50' : 'hover:bg-white/5')}><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-white/40" />原图</span>{showOriginal ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5 text-slate-500" />}</button>
                  <button onClick={() => setShowCassava((value) => !value)} title="木薯范围" className={cx('flex items-center justify-between rounded-lg px-2 py-1.5 text-left text-[11px]', mutedClass, isLight ? 'hover:bg-white/50' : 'hover:bg-white/5')}><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-slate-300" />木薯</span>{showCassava ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5 text-slate-500" />}</button>
                  <button onClick={() => setShowRotten((value) => !value)} title="腐烂范围" className={cx('flex items-center justify-between rounded-lg px-2 py-1.5 text-left text-[11px]', mutedClass, isLight ? 'hover:bg-white/50' : 'hover:bg-white/5')}><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-rose-400" />腐烂</span>{showRotten ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5 text-slate-500" />}</button>
                  <button onClick={() => setDimOutside((value) => !value)} title="暗化计算范围外区域" className={cx('flex items-center justify-between rounded-lg px-2 py-1.5 text-left text-[11px]', mutedClass, isLight ? 'hover:bg-white/50' : 'hover:bg-white/5')}><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-slate-500" />暗化</span>{dimOutside ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5 text-slate-500" />}</button>
                </div>
                <div className={cx('mt-3 space-y-2 rounded-lg p-2.5', isLight ? 'bg-white/40' : 'bg-white/[0.03]')}>
                  <div><div className="mb-1 flex justify-between text-[11px] text-slate-400"><span>木薯范围透明度</span><span>{Math.round(cassavaOpacity * 100)}%</span></div><input aria-label="木薯范围透明度" type="range" min="0" max="100" value={Math.round(cassavaOpacity * 100)} onChange={(event) => setCassavaOpacity(Number(event.target.value) / 100)} className="w-full accent-slate-400" /></div>
                  <div><div className="mb-1 flex justify-between text-[11px] text-slate-400"><span>腐烂范围透明度</span><span>{Math.round(rottenOpacity * 100)}%</span></div><input aria-label="腐烂范围透明度" type="range" min="0" max="100" value={Math.round(rottenOpacity * 100)} onChange={(event) => setRottenOpacity(Number(event.target.value) / 100)} className="w-full accent-rose-400" /></div>
                </div></div>

                {(tool === 'brush-add' || tool === 'brush-erase') && <div className={cx('mt-3 border-t pt-3', borderClass)}><div className={cx('mb-1.5 flex items-center justify-between text-[11px]', mutedClass)}><span>画笔大小</span><span>{brushSize}px</span></div><input type="range" min="4" max="120" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} className="w-full accent-slate-400" /></div>}
                {tool.startsWith('pen') && <div className={cx('mt-3 rounded-lg border p-2.5 text-[11px] leading-4', isLight ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-amber-300/20 bg-amber-300/10 text-amber-100')}>钢笔工具：点击原图逐点圈选，靠近起点自动闭合；也可双击完成。</div>}
                {tool.startsWith('smart') && <div className={cx('mt-3 rounded-lg border p-2.5 text-[11px] leading-4', isLight ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-amber-300/20 bg-amber-300/10 text-amber-100')}>
                  <div className="mb-1.5 flex items-center justify-between font-semibold"><span className="flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5" />智能点选</span><span>{Math.round(smartThreshold * 100)}%</span></div>
                  <input aria-label="智能点选相似度阈值" type="range" min="2" max="30" value={Math.round(smartThreshold * 100)} onChange={(event) => setSmartThreshold(Number(event.target.value) / 100)} className="w-full accent-amber-400" />
                  <p className="mt-1.5">点击腐烂区域，选择置信度相近的连续区域。阈值越大，选区越宽。</p>
                  <p className="mt-1">{smartLoading ? '正在计算选区，请稍候...' : confidenceReady ? `已加载置信度图，当前选区 ${smartSelectionCount.toLocaleString()} px` : editor?.confidence_map_url ? '首次点击时按需加载置信度图' : '该结果没有置信度图，请重新预测后使用'}</p>
                </div>}
                <div className={cx('mt-3 rounded-lg p-2.5 text-[11px] leading-4', isLight ? 'bg-white/60 text-slate-600' : 'bg-slate-950/40 text-slate-400')}><p className={cx('flex items-center gap-2', isLight ? 'text-slate-800' : 'text-slate-200')}><MousePointer2 className="h-3.5 w-3.5 text-slate-400" />当前工具：{toolLabel[tool]}</p><p className="mt-1.5">Alt + 滚轮：缩放 | 空格 + 左键：平移</p><p className="mt-1">PPD = 腐烂面积 ÷ 木薯面积 × 100%</p></div>
                <label className="mt-3 block text-xs" htmlFor="correction-note">校正备注</label>
                <textarea id="correction-note" value={note} disabled={saving} maxLength={2000} onChange={(event) => { setNote(event.target.value); setDirty(true); }} className="mt-1 w-full rounded-lg border border-slate-500 bg-transparent p-2 text-xs" placeholder="记录修改原因，便于后续复核" />
                <p className="mt-1 text-[11px] text-slate-400">{saving ? '正在保存，请勿关闭' : dirty ? '有未保存修改 · 草稿自动暂存' : '与当前保存版本一致'}</p>
                <button onClick={handleSave} disabled={saving || versionLoading || smartLoading || !dirty} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-slate-200 px-3 py-2 text-xs font-semibold text-slate-900 transition hover:bg-white/70 disabled:cursor-wait disabled:opacity-60"><Save className="h-3.5 w-3.5" />{saving ? '保存中...' : '保存人工校正版本'}</button>
              </aside>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
};

export default PredictionResultEditor;
