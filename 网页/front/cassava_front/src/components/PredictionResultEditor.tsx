import { Popover } from 'antd';
import { editorScreenMetrics, nearestVertex } from '../utils/editorGeometry';
import { message, modal } from '../utils/feedback';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  RotateCw,
  Brush,
  Check,
  CircleDot,
  Eraser,
  Eye,
  EyeOff,
  Hand,
  Layers3,
  Maximize2,
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

import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { PredictionResult } from '../types';
import { predictionsApi, resolveFileUrl } from '../services/api';
import { calculateMaskPixelMetrics, formatPpd } from '../utils/measurement';
import { readDraft, writeDraft, removeDraft } from '../utils/correctionDrafts';
import { imagePointFromRotatedRect, normalizeRotation } from '../utils/imageRotation';
import { replaceEditedContours } from '../utils/maskContours';

type LayerName = 'cassava' | 'rotten';
type ToolName = 'brush-add' | 'brush-erase' | 'pen-add' | 'pen-erase' | 'smart-add' | 'smart-erase' | 'pan';

interface Masks {
  rotation?: number;
  width: number;
  height: number;
  cassava: Uint8Array;
  rotten: Uint8Array;
}

interface PredictionResultEditorProps {
  prediction: PredictionResult;
  onClose: () => void;
  onSaved: (correction: any) => void;
  onNavigate?: (direction: -1 | 1) => void;
  onReviewed?: () => void;
  positionLabel?: string;
  canPrevious?: boolean;
  canNext?: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ');

const confirmAction = (title: string, content: string, okText: string, cancelText: string) =>
  new Promise<boolean>((resolve) => {
    modal.confirm({
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
      reject(new Error(i18n.t('editor.errors.mask_size', { w: image.naturalWidth, h: image.naturalHeight })));
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return reject(new Error(i18n.t('editor.errors.mask_canvas')));
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, width, height).data;
    const mask = new Uint8Array(width * height);
    for (let i = 0; i < mask.length; i += 1) {
      mask[i] = pixels[i * 4] > 127 ? 1 : 0;
    }
    resolve(mask);
  };
  image.onerror = () => reject(new Error(i18n.t('editor.errors.mask_load', { url })));
  image.src = url;
});

const fetchConfidenceRaster = (url: string, width: number, height: number): Promise<Uint8Array> => new Promise((resolve, reject) => {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => {
    if (image.naturalWidth !== width || image.naturalHeight !== height) {
      reject(new Error(i18n.t('editor.errors.confidence_size', { w: image.naturalWidth, h: image.naturalHeight })));
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return reject(new Error(i18n.t('editor.errors.confidence_canvas')));
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, width, height).data;
    const confidence = new Uint8Array(width * height);
    for (let i = 0; i < confidence.length; i += 1) confidence[i] = pixels[i * 4];
    resolve(confidence);
  };
  image.onerror = () => reject(new Error(i18n.t('editor.errors.confidence_load', { url })));
  image.src = url;
});

const fetchBaseImage = (url: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error(i18n.t('editor.errors.image_load', { url })));
  image.src = url;
});

const maskToBlob = async (mask: Uint8Array, width: number, height: number): Promise<Blob> => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error(i18n.t('editor.errors.export_canvas'));
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
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error(i18n.t('editor.errors.export_failed'))), 'image/png');
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

const toolLabelKey: Record<ToolName, string> = {
  'brush-add': 'editor.tools.brush_add',
  'brush-erase': 'editor.tools.brush_erase',
  'pen-add': 'editor.tools.pen_add',
  'pen-erase': 'editor.tools.pen_erase',
  'smart-add': 'editor.tools.smart_add',
  'smart-erase': 'editor.tools.smart_erase',
  pan: 'editor.tools.pan',
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

const PredictionResultEditor: React.FC<PredictionResultEditorProps> = ({ prediction, onClose, onSaved, onNavigate, onReviewed, positionLabel, canPrevious = true, canNext = true }) => {
  const originalMaskRingsRef = useRef<PolygonRing[]>([]);
  const { t } = useTranslation();
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
  const [theme, setTheme] = useState<'dark' | 'light'>('light');
  const [layer, setLayer] = useState<LayerName>('rotten');
  const [tool, setTool] = useState<ToolName>('brush-add');
  const [brushSize, setBrushSize] = useState(24);
  const [vertexSize, setVertexSize] = useState(2);
  const [zoom, setZoom] = useState(1);
  const [spacePressed, setSpacePressed] = useState(false);
  const [smartThreshold, setSmartThreshold] = useState(0.08);
  const [smartLoading, setSmartLoading] = useState(false);
  const [, setConfidenceReady] = useState(false);
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
  const keyboardActionsRef = useRef({ undo: () => {}, redo: () => {}, save: () => {}, previous: () => {}, next: () => {} });

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
        throw new Error(t('editor.message.no_mask'));
      }
      const image = await fetchBaseImage(resolveFileUrl(payload.original_image_url || prediction.imageUrl));
      const width = Number(source.width || image.naturalWidth);
      const height = Number(source.height || image.naturalHeight);
      const [cassava, rotten] = await Promise.all([
        fetchRaster(resolveFileUrl(source.cassava_mask_url), width, height),
        fetchRaster(resolveFileUrl(source.rotten_mask_url), width, height),
      ]);
      if (!active) return;
      let next: Masks = { width, height, cassava, rotten, rotation: normalizeRotation(Number(source.edit_data?.rotation_degrees || 0)) };
      try {
        const draft = await readDraft(draftKey);
        if (!active) return;
        if (draft && draft.width === width && draft.height === height &&
            await confirmAction(
              t('editor.dialog.draft_title'),
              draft.baseVersion === (payload.current_correction?.version || 0)
                ? t('editor.dialog.draft_content')
                : t('editor.dialog.draft_content_stale'),
              t('editor.dialog.draft_restore'),
              t('editor.dialog.draft_discard'),
            )) {
          next = { width, height, cassava: draft.cassava, rotten: draft.rotten, rotation: draft.rotation || 0 };
          setNote(draft.note);
          setDirty(true);
          setRevision((value) => value + 1);
        }
      } catch { message.warning(t('editor.dialog.draft_warning')); }

      masksRef.current = next;
      setMasks(next);
      setMetrics(calculateMaskPixelMetrics(next.cassava, next.rotten));
      setBaseImage(image);
    }).catch((loadError: any) => {
      if (active) setError(loadError?.message || t('editor.message.load_failed'));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [prediction.id, prediction.imageUrl]);

  const originalPpd = Number(prediction.ppdValue || 0);
  const delta = metrics.ppd - originalPpd;
  const isLight = theme === 'light';
  const shellClass = isLight ? 'bg-surface-muted text-ink' : 'bg-[#101722] text-white';
  const borderClass = isLight ? 'border-hairline' : 'border-hairline';
  const mutedClass = isLight ? 'text-ink-secondary' : 'text-muted';
  const toolbarClass = isLight ? 'bg-white' : 'bg-[#141e2b]';
  const asideClass = isLight ? 'bg-surface-muted' : 'bg-[#111b28]';

  const rotation = masks?.rotation || 0;
  const rotated = rotation % 180 !== 0;
  const canvasWidth = (rotated ? masks?.height : masks?.width) || 0;
  const canvasHeight = (rotated ? masks?.width : masks?.height) || 0;

  const fitToView = useCallback(() => {
    if (!canvasWidth || !canvasHeight || !viewportRef.current) return;
    const availableWidth = Math.max(240, viewportRef.current.clientWidth - 72);
    const availableHeight = Math.max(240, viewportRef.current.clientHeight - 72);
    const fit = Math.min(availableWidth / canvasWidth, availableHeight / canvasHeight);
    setZoom(clamp(fit, 0.02, 4));
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
      const { scale, radius: handleRadius, lineWidth } = editorScreenMetrics(zoom, vertexSize);
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
            context.arc(point.x, point.y, active ? handleRadius * 1.5 : handleRadius, 0, Math.PI * 2);
            context.fill();
            context.strokeStyle = '#0f172a';
            context.lineWidth = scale;
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
          context.arc(point.x, point.y, active ? handleRadius * 1.5 : handleRadius, 0, Math.PI * 2);
          context.fill();
          context.strokeStyle = '#0f172a';
          context.lineWidth = scale;
          context.stroke();
        });
      }
      context.restore();
    }
  }, [baseImage, cassavaOpacity, dimOutside, maskRingDrag, maskRings, masks, polygonDragIndex, polygonPoints, rottenOpacity, showCassava, showOriginal, showRotten, smartSelection, zoom, rotation, vertexSize]);

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
    rotation: value.rotation || 0,
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
    return imagePointFromRotatedRect(event.clientX, event.clientY, rect, masks.width, masks.height, rotation);
  };

  const ensureConfidenceMap = async () => {
    if (confidenceMapRef.current) return confidenceMapRef.current;
    const sourceUrl = editor?.confidence_map_url;
    const current = masksRef.current;
    if (!sourceUrl || !current) throw new Error(t('editor.message.no_confidence'));
    const confidence = await fetchConfidenceRaster(resolveFileUrl(sourceUrl), current.width, current.height);
    confidenceMapRef.current = confidence;
    setConfidenceReady(true);
    return confidence;
  };

  const growSmartRegion = async (point: { x: number; y: number }) => {
    if (layer !== 'rotten') throw new Error(t('editor.message.rotten_only'));
    const current = masksRef.current;
    if (!current) throw new Error(t('editor.message.mask_not_ready'));
    const confidence = await ensureConfidenceMap();
    const width = current.width;
    const height = current.height;
    const total = width * height;
    const seedIndex = Math.floor(point.y) * width + Math.floor(point.x);
    if (!current.cassava[seedIndex]) throw new Error(t('editor.message.click_cassava'));
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
      if (countPixels(selection) === 0) throw new Error(t('editor.message.no_similar'));
      setSmartSelection(selection);
      setSmartSelectionCount(countPixels(selection));
    } catch (smartError: any) {
      message.warning(smartError?.message || t('editor.message.smart_failed'));
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
          message.warning(layer === 'cassava' ? t('editor.tool.convert_empty_cassava') : t('editor.tool.convert_empty_rotten'));
          return;
        }
        const tolerance = Math.max(2, current.width / 480);
        const simplifiedRings = rings
          .map((ring) => simplifyPolygon(ring, tolerance).map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) })))
          .filter((ring) => ring.length >= 3);
        if (!simplifiedRings.length) {
          message.warning(t('editor.tool.convert_too_fine'));
          return;
        }
        const totalPoints = simplifiedRings.reduce((sum, ring) => sum + ring.length, 0);
        setPolygonPoints([]);
        originalMaskRingsRef.current = simplifiedRings.map(ring => ring.map(point => ({ ...point })));
        setMaskRings(simplifiedRings);
        // 转换出来的轮廓表示「当前掩码的边界」，应用时应当还原而不是擦除，故默认用添加工具
        setTool('pen-add');
        message.success(t('editor.tool.converted', { count: simplifiedRings.length, points: totalPoints }));
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
    const target = layer === 'cassava' ? next.cassava : next.rotten;
    const replacement = replaceEditedContours(target, next.width, next.height, originalMaskRingsRef.current, maskRings);
    if (layer === 'cassava') next.cassava = replacement; else next.rotten = replacement;
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
      const { hitRadius, scale } = editorScreenMetrics(zoom, vertexSize);
      const nearest = nearestVertex(maskRings, point, hitRadius);
      if (nearest) {
        event.preventDefault(); setMaskRingDrag(nearest); event.currentTarget.setPointerCapture(event.pointerId); return;
      }
      const firstPoint = polygonPoints[0];
      const closeDistance = 8 * scale;
      if (firstPoint && polygonPoints.length >= 3 && Math.hypot(point.x - firstPoint.x, point.y - firstPoint.y) <= closeDistance) {
        applyPolygon();
        return;
      }
      // 命中已有点 → 进入拖动，而不是新增一个点
      const hitIndex = nearestVertex([polygonPoints], point, hitRadius)?.index ?? -1;
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
    setZoom((value) => clamp(value + direction * 0.1, 0.02, 4));
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
      next.rotation = normalizeRotation(Number(source.edit_data?.rotation_degrees || 0));
      commitSnapshot(current);
      updateMasks(next);
    };
    void load().catch((resetError: any) => message.error(resetError?.message || t('editor.message.restore_failed')));
  };

  const handleVersionChange = async (value: string) => {
    if (!editor || !masksRef.current || savingRef.current || versionLoading) return;
    if ((dirty || polygonPoints.length || maskRings.length || smartSelection) && !(await confirmAction(
      t('editor.dialog.switch_title'),
      t('editor.dialog.switch_content'),
      '继续',
      t('editor.dialog.cancel'),
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
      updateMasks({ ...current, cassava, rotten, rotation: normalizeRotation(Number(source.edit_data?.rotation_degrees || 0)) });
    } catch (versionError: any) { message.error(versionError?.message || t('editor.message.version_failed')); }
    finally { setVersionLoading(false); }
  };

  const handleSave = async () => {
    if (!masksRef.current || savingRef.current || versionLoading) return;
    if (polygonPoints.length || maskRings.length || smartSelection || smartLoading) {
      message.warning(t('editor.save.pending_apply'));
      return;
    }
    if (!dirty) { message.info(t('editor.save.nothing')); return; }
    const saveSnapshot = snapshot(masksRef.current);
    if (!metrics.cassavaPixels) {
      message.warning(t('editor.save.cassava_zero'));
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const form = new FormData();
      form.append('cassava_mask', await maskToBlob(saveSnapshot.cassava, saveSnapshot.width, saveSnapshot.height), 'cassava-mask.png');
      form.append('rotten_mask', await maskToBlob(saveSnapshot.rotten, saveSnapshot.width, saveSnapshot.height), 'rotten-mask.png');
      form.append('edit_data', JSON.stringify({ layer, tool, brushSize, width: saveSnapshot.width, height: saveSnapshot.height, rotation_degrees: saveSnapshot.rotation || 0, source_version: activeSource?.version || 0 }));
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
      message.success(t('editor.save.saved'));
      onSaved(correction);
      return correction;
    } catch (saveError: any) {
      message.error(saveError?.response?.data?.message || saveError?.response?.data?.detail || saveError?.message || t('editor.save.failed'));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const completeReview = async () => {
    if (savingRef.current || versionLoading || polygonPoints.length || maskRings.length || smartSelection) {
      message.warning('请先应用或取消当前选区'); return;
    }
    let version = editor?.current_correction?.version || 0;
    let newlySaved = false;
    if (dirty) { const saved = await handleSave(); if (!saved) return; version = saved.version; newlySaved = true; }
    if (!newlySaved && (activeSource?.version || 0) !== version) { message.warning('请先切换至最新版本，或将当前编辑保存为新修订'); return; }
    try {
      await predictionsApi.completeReview(prediction.id, version);
      message.success('已完成复检'); onReviewed?.(); onNavigate?.(1);
    } catch (error: any) { message.error(error?.response?.data?.error || '完成复检失败，请重新载入'); }
  };
  const rotateImage = (direction: -1 | 1) => {
    if (!masksRef.current || savingRef.current || versionLoading) return;
    if (polygonPoints.length || maskRings.length || smartSelection || smartLoading) { message.warning('请先应用或取消当前选区'); return; }
    const current = masksRef.current;
    commitSnapshot(current);
    updateMasks({ ...snapshot(current), rotation: normalizeRotation((current.rotation || 0) + direction * 90) });
    setCursor(null);
  };
  const navigateResult = async (direction: -1 | 1) => {
    if (savingRef.current || versionLoading || (direction < 0 ? !canPrevious : !canNext)) return;
    if ((dirty || polygonPoints.length || maskRings.length || smartSelection) && !(await confirmAction('切换图片？', '已修改掩码的本机草稿会保留；尚未应用的选区不会保存。', '切换', '继续编辑'))) return;
    if (dirty && masksRef.current) {
      try { await writeDraft({ id: draftKey, baseVersion: editor.current_correction?.version || 0, ...snapshot(masksRef.current), note, savedAt: new Date().toISOString() }); }
      catch { message.error('草稿保存失败，请先保存修订再切换'); return; }
    }
    onNavigate?.(direction);
  };

  keyboardActionsRef.current = {
    undo: handleUndo,
    redo: handleRedo,
    save: () => { void handleSave(); },
    previous: () => { void navigateResult(-1); },
    next: () => { void navigateResult(1); },
  };

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || document.querySelector('.ant-modal-confirm') || target?.tagName === 'INPUT' || target?.tagName === 'SELECT' || target?.tagName === 'TEXTAREA') return;
      if (event.altKey) return;
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

      if (key === 'arrowleft' || key === 'arrowright') { event.preventDefault(); if (!event.repeat) (key === 'arrowleft' ? keyboardActionsRef.current.previous : keyboardActionsRef.current.next)(); }
      else if (key === 'b') setTool('brush-add');
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
      } else if (key === '[') setBrushSize((value) => clamp(value - 1, 1, 120));
      else if (key === ']') setBrushSize((value) => clamp(value + 1, 1, 120));
      else if (key === '+' || key === '=') setZoom((value) => clamp(value + 0.1, 0.02, 4));
      else if (key === '-') setZoom((value) => clamp(value - 0.1, 0.02, 4));
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

  useEffect(() => { setMaskRings([]); setPolygonPoints([]); originalMaskRingsRef.current = []; }, [layer]);
  const hasPendingChanges = dirty || polygonPoints.length > 0 || maskRings.length > 0 || Boolean(smartSelection);
  useEffect(() => {
    if (!dirty || saving || !masksRef.current || !editor) return;
    const timer = window.setTimeout(() => {
      const current = masksRef.current;
      if (!current || savingRef.current) return;
      void writeDraft({ id: draftKey, baseVersion: editor.current_correction?.version || 0,
        ...snapshot(current), note, savedAt: new Date().toISOString() }).catch(() => message.warning(t('editor.dialog.draft_failed')));
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
    if (savingRef.current || versionLoading) { message.info(t('editor.save.busy_hint')); return; }
    if (hasPendingChanges && !(await confirmAction(
      t('editor.dialog.exit_title'),
      t('editor.dialog.exit_content'),
      '退出',
      t('editor.dialog.keep_editing'),
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

  const layerSettings = (name: LayerName) => <div className="w-56 space-y-3 text-ink">
    <button onClick={() => name === 'cassava' ? setShowCassava(value => !value) : setShowRotten(value => !value)} className="flex w-full items-center justify-between text-sm">显示范围{(name === 'cassava' ? showCassava : showRotten) ? <Eye size={16} /> : <EyeOff size={16} />}</button>
    <label className="block text-sm">不透明度 <span className="float-right tabular-nums">{Math.round((name === 'cassava' ? cassavaOpacity : rottenOpacity) * 100)}%</span><input aria-label={t(name === 'cassava' ? 'editor.inspector.cassava_opacity' : 'editor.inspector.rotten_opacity')} type="range" min="0" max="100" value={Math.round((name === 'cassava' ? cassavaOpacity : rottenOpacity) * 100)} onChange={event => (name === 'cassava' ? setCassavaOpacity : setRottenOpacity)(Number(event.target.value) / 100)} className="mt-2 w-full accent-emerald-700" /></label>
  </div>;
  const toolSettings = (name: ToolName) => <div className="w-56 space-y-3 text-ink">
    {name.startsWith('brush') && <label className="block text-sm">画笔大小 <span className="float-right tabular-nums">{brushSize}px</span><input aria-label={t('editor.inspector.brush_size')} type="range" min="1" max="120" value={brushSize} onChange={event => setBrushSize(Number(event.target.value))} className="mt-2 w-full accent-emerald-700" /><input aria-label="画笔像素数" type="number" min="1" max="120" value={brushSize} onChange={event => setBrushSize(clamp(Number(event.target.value) || 1, 1, 120))} className="mt-2 w-full rounded border border-hairline px-2 py-1" /></label>}
    {name.startsWith('pen') && <label className="block text-sm">顶点大小 <span className="float-right tabular-nums">{vertexSize}px</span><input aria-label="顶点大小" type="range" min="1" max="4" step="0.5" value={vertexSize} onChange={event => setVertexSize(Number(event.target.value))} className="mt-2 w-full accent-emerald-700" /></label>}
    {name.startsWith('smart') && <label className="block text-sm">{t('editor.inspector.smart_threshold')}<input aria-label={t('editor.inspector.smart_threshold')} type="range" min="2" max="30" value={Math.round(smartThreshold * 100)} onChange={event => setSmartThreshold(Number(event.target.value) / 100)} className="mt-2 w-full accent-emerald-700" /></label>}
  </div>;

  return (
    <div className={cx('fixed inset-0 z-[70]', isLight ? 'bg-hairline' : 'bg-[#070b12]')}>
      <div className={cx('flex h-screen w-screen flex-col overflow-hidden', shellClass)}>
        <header className={cx('flex items-center justify-between gap-3 border-b px-4 py-1.5', borderClass)}>
          <div className="flex min-w-0 items-baseline gap-2">
            <Layers3 className="h-4 w-4 shrink-0 self-center text-muted" />
            <h2 className="truncate text-sm font-semibold">{prediction.imageName}</h2>
            <span className={cx('hidden shrink-0 text-xs md:inline', mutedClass)} title={t('editor.header.ppd_hint')}>{t('editor.header.ppd')}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button onClick={() => setTheme((value) => value === 'dark' ? 'light' : 'dark')} className={cx('inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs', mutedClass, isLight ? 'hover:bg-white' : 'hover:bg-white/10')} title={t('editor.header.toggle_theme')}>
              {isLight ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}{isLight ? t('editor.header.theme_dark') : t('editor.header.theme_light')}
            </button>
            <button onClick={handleClose} className={cx('rounded-lg p-1.5 transition', mutedClass, isLight ? 'hover:bg-white hover:text-ink' : 'hover:bg-white/10 hover:text-white')} aria-label={t('editor.header.close')}><X className="h-4 w-4" /></button>
          </div>
        </header>

        {loading ? <div className="flex flex-1 items-center justify-center text-muted">{t('editor.header.loading')}</div> : error ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center"><CircleDot className="h-10 w-10 text-amber-300" /><p className="max-w-md text-sm text-muted">{error}</p><button onClick={handleClose} className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-ink">{t('editor.header.back')}</button></div>
        ) : masks && baseImage ? (
          <>
            <div className={cx('flex flex-wrap items-center gap-1.5 border-b px-3 py-1.5', borderClass, toolbarClass)}>
              <span className={cx('mr-1 hidden items-center xl:flex', mutedClass)} title={t('editor.canvas.fullscreen_hint')}><Maximize2 className="h-3.5 w-3.5 text-muted" /></span>
              <div className={cx('mr-1 flex items-center gap-1 rounded-lg p-0.5', isLight ? 'bg-surface-muted' : 'bg-white/5')}>
                <Popover trigger="click" placement="bottomLeft" content={layerSettings('cassava')}><button onClick={() => setLayer('cassava')} className={cx('rounded-md px-2.5 py-1 text-xs', layer === 'cassava' ? 'bg-white text-ink shadow-sm' : mutedClass, layer === 'cassava' ? '' : (isLight ? 'hover:bg-white' : 'hover:bg-white/10'))} title={t('editor.layer.cassava_title')}><i className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[#30b0c7] align-middle" />{t('editor.layer.cassava')}</button></Popover>
                <Popover trigger="click" placement="bottomLeft" content={layerSettings('rotten')}><button onClick={() => setLayer('rotten')} className={cx('rounded-md px-2.5 py-1 text-xs', layer === 'rotten' ? 'bg-white text-ink shadow-sm' : mutedClass, layer === 'rotten' ? '' : (isLight ? 'hover:bg-white' : 'hover:bg-white/10'))} title={t('editor.layer.rotten_title')}><i className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-rose-400 align-middle" />{t('editor.layer.rotten')}</button></Popover>
              </div>
              {(['brush-add', 'brush-erase', 'pen-add', 'pen-erase', 'smart-add', 'smart-erase', 'pan'] as ToolName[]).map((name) => (
                <Popover key={name} trigger="click" placement="bottomLeft" content={toolSettings(name)} open={name === 'pan' ? false : undefined}><button onClick={() => { setTool(name); setSmartSelection(null); setSmartSelectionCount(0); if (!name.startsWith('pen')) { setPolygonPoints([]); setMaskRings([]); setMaskRingDrag(null); } }} className={cx('inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs transition', tool === name ? (isLight ? 'bg-brand-fill text-white' : 'bg-white text-slate-950') : mutedClass, tool === name ? '' : (isLight ? 'hover:bg-white' : 'hover:bg-white/10'))} title={`${t(toolLabelKey[name])}（${toolShortcut[name]}）${name.startsWith('smart') && !editor?.confidence_map_url ? t('editor.tool.needs_confidence') : ''}`}>{activeToolIcon(name)}<span className="hidden md:inline">{t(toolLabelKey[name])}</span></button></Popover>
              ))}
              <Popover trigger="click" placement="bottomLeft" content={<div className="w-44 space-y-3 text-ink"><label className="flex justify-between text-sm">原图<input type="checkbox" checked={showOriginal} onChange={event => setShowOriginal(event.target.checked)} /></label><label className="flex justify-between text-sm">暗化背景<input type="checkbox" checked={dimOutside} onChange={event => setDimOutside(event.target.checked)} /></label></div>}><button aria-label="显示设置" className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm"><Eye size={15} />显示</button></Popover>
              <div className={cx('ml-auto flex items-center gap-1 border-l pl-2', borderClass)}>
                <button onClick={handleUndo} disabled={!history.length} className={cx('rounded-lg p-1.5 disabled:opacity-30', mutedClass, isLight ? 'hover:bg-white' : 'hover:bg-white/10')} title={t('editor.tool.undo')}><Undo2 className="h-3.5 w-3.5" /></button>
                <button onClick={handleRedo} disabled={!future.length} className={cx('rounded-lg p-1.5 disabled:opacity-30', mutedClass, isLight ? 'hover:bg-white' : 'hover:bg-white/10')} title={t('editor.tool.redo')}><Redo2 className="h-3.5 w-3.5" /></button>
                <button onClick={handleReset} className={cx('rounded-lg p-1.5', mutedClass, isLight ? 'hover:bg-white' : 'hover:bg-white/10')} title={t('editor.tool.reset')}><RotateCcw className="h-3.5 w-3.5" /></button>
              </div>
              <button aria-label="向左旋转90度" title="向左旋转90°" disabled={saving || versionLoading} onClick={() => rotateImage(-1)} className="rounded-lg p-1.5 disabled:opacity-30"><RotateCcw className="h-4 w-4" /></button>
              <button aria-label="向右旋转90度" title="向右旋转90°" disabled={saving || versionLoading} onClick={() => rotateImage(1)} className="rounded-lg p-1.5 disabled:opacity-30"><RotateCw className="h-4 w-4" /></button>
              <span className="text-xs tabular-nums">{rotation}°</span>
              <div className={cx('flex items-center gap-1 rounded-lg p-0.5', isLight ? 'bg-surface-muted' : 'bg-white/5')}>
                <button onClick={() => setZoom((value) => clamp(value - 0.1, 0.02, 4))} className={cx('rounded-md p-1.5', mutedClass, isLight ? 'hover:bg-white' : 'hover:bg-white/10')} title={t('editor.tool.zoom_out')}><ZoomOut className="h-3.5 w-3.5" /></button>
                <span className={cx('w-10 text-center text-xs', mutedClass)}>{Math.round(zoom * 100)}%</span>
                <button onClick={() => setZoom((value) => clamp(value + 0.1, 0.02, 4))} className={cx('rounded-md p-1.5', mutedClass, isLight ? 'hover:bg-white' : 'hover:bg-white/10')} title={t('editor.tool.zoom_in')}><ZoomIn className="h-3.5 w-3.5" /></button>
                <button onClick={fitToView} className={cx('rounded-md px-2 py-1 text-xs', mutedClass, isLight ? 'hover:bg-white' : 'hover:bg-white/10')} title={t('editor.tool.fit_title')}>{t('editor.tool.fit')}</button>
              </div>
              {tool.startsWith('pen') && polygonPoints.length >= 3 && <button onClick={applyPolygon} className="inline-flex items-center gap-1 rounded-xl bg-amber-300 px-3 py-2 text-xs font-semibold text-slate-950"><Check className="h-4 w-4" />{t('editor.tool.close_polygon')}</button>}
              {!tool.startsWith('smart') && <button onClick={handleMaskToPolygon} disabled={maskToPolygonLoading} className={cx('inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition disabled:opacity-50', isLight ? 'bg-brand-fill text-white hover:bg-slate-700' : 'bg-white text-slate-950 hover:bg-hairline')} title={t('editor.tool.mask_to_polygon_hint', { layer: layer === 'cassava' ? t('editor.layer.cassava') : t('editor.layer.rotten') })}><Spline className="h-3.5 w-3.5" /><span className="hidden md:inline">{maskToPolygonLoading ? t('editor.tool.converting') : t('editor.tool.mask_to_polygon')}</span></button>}
              {maskRings.length > 0 && <button onClick={applyMaskRings} className="inline-flex items-center gap-1 rounded-xl bg-sky-300 px-3 py-1.5 text-xs font-semibold text-slate-950" title={t('editor.tool.apply_polygon_hint')}><Check className="h-3.5 w-3.5" />{t('editor.tool.apply_polygon', { count: maskRings.length })}</button>}
              {maskRings.length > 0 && <button onClick={() => { setMaskRings([]); setMaskRingDrag(null); }} className={cx('inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs', mutedClass, isLight ? 'hover:bg-white' : 'hover:bg-white/10')} title={t('editor.tool.discard_hint')}><X className="h-3.5 w-3.5" />{t('editor.tool.discard')}</button>}
              {tool.startsWith('smart') && smartSelection && <button onClick={applySmartSelection} className="inline-flex items-center gap-1 rounded-lg bg-amber-300 px-3 py-1.5 text-xs font-semibold text-slate-950"><Check className="h-3.5 w-3.5" />{t('editor.tool.apply_selection', { px: smartSelectionCount.toLocaleString() })}</button>}
            </div>

            <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
              <main ref={viewportRef} className={cx('relative min-h-0 flex-1 overflow-auto p-3 md:p-4', isLight ? 'bg-surface-muted' : 'bg-[#080d14]')} style={{ cursor: tool === 'pan' || spacePressed ? 'grab' : (tool.startsWith('brush') || tool.startsWith('pen')) ? 'none' : 'default' }}>
                <div className="flex min-h-full min-w-full p-2">
                  <div className="relative m-auto shrink-0" style={{ width: canvasWidth * zoom, height: canvasHeight * zoom }}>
                    <div className="absolute left-1/2 top-1/2" style={{ width: masks.width * zoom, height: masks.height * zoom, transform: `translate(-50%, -50%) rotate(${rotation}deg)` }}>
                    <canvas aria-label={t('editor.canvas.aria')} ref={canvasRef} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp} onPointerLeave={() => setCursor(null)} onDoubleClick={handleCanvasDoubleClick} onWheel={handleCanvasWheel} className="block max-w-none rounded-xl shadow-2xl" style={{ width: `${masks.width * zoom}px`, height: `${masks.height * zoom}px`, imageRendering: zoom > 1.5 ? 'pixelated' : 'auto' }} />
                    {cursor && tool.startsWith('brush') && !spacePressed && (
                      <span
                        aria-hidden
                        className="pointer-events-none absolute rounded-full"
                        style={{ left: cursor.x * zoom, top: cursor.y * zoom, width: Math.max(1, brushSize * zoom), height: Math.max(1, brushSize * zoom), background: brushSize * zoom < 3 ? '#fff' : 'transparent', boxShadow: brushSize * zoom < 3 ? 'none' : 'inset 0 0 0 1px #fff, 0 0 0 1px #17212b', transform: 'translate(-50%, -50%)' }}
                      />
                    )}
                    {cursor && tool.startsWith('pen') && !spacePressed && (
                      <span
                        aria-hidden
                        className="pointer-events-none absolute h-1.5 w-1.5 rounded-full border border-hairline bg-transparent shadow-[0_0_0_1px_rgba(15,23,42,0.45)]"
                        style={{ left: cursor.x * zoom, top: cursor.y * zoom, transform: 'translate(-50%, -50%)' }}
                      />
                    )}
                    </div>
                  </div>
                </div>
                <div className={cx('absolute bottom-4 left-4 flex flex-wrap gap-2 rounded-lg border px-2.5 py-1.5 text-xs backdrop-blur', isLight ? 'border-hairline bg-white text-ink-secondary' : 'border-hairline bg-slate-950/75 text-slate-200')}>
                  <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-[#30b0c7]" />{t('editor.layer.cassava')}</span><span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-rose-400" />{t('editor.layer.rotten')}</span>
                </div>
                {onNavigate && <div className="sticky bottom-3 ml-auto flex w-fit items-center gap-2 rounded-lg border border-hairline bg-white px-2 py-1.5 text-ink shadow-sm">
                  <button aria-label="上一张" title="上一张（←）" disabled={!canPrevious || saving || versionLoading} onClick={() => void navigateResult(-1)} className="rounded p-2 disabled:opacity-30"><ChevronLeft size={18} /></button><span className="text-xs tabular-nums">{positionLabel}</span><button aria-label="下一张" title="下一张（→）" disabled={!canNext || saving || versionLoading} onClick={() => void navigateResult(1)} className="rounded p-2 disabled:opacity-30"><ChevronRight size={18} /></button>
                </div>}
              </main>

              <aside className={cx('flex min-h-0 w-full shrink-0 flex-col overflow-hidden border-t p-3 lg:w-[270px] lg:border-l lg:border-t-0', borderClass, asideClass)}>
                <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                <div className={cx('mt-3 rounded-xl border p-3', borderClass, isLight ? 'bg-white' : 'bg-white/[0.04]')}><p className={cx('text-xs', mutedClass)}>{t('editor.inspector.corrected_ppd')}</p><p className={cx('mt-1 text-3xl font-semibold tracking-normal', isLight ? 'text-ink' : 'text-white')}>{formatPpd(metrics.ppd)}</p><p className={cx('mt-1 text-xs', delta >= 0 ? 'text-danger-text' : 'text-muted')}>{t('editor.inspector.delta', { sign: delta >= 0 ? '+' : '', value: delta.toFixed(2) })}</p></div>
                {editor?.corrections?.length > 0 && <div className="mt-3"><label htmlFor="correction-version" className={cx('mb-1.5 block text-xs font-semibold', mutedClass)}>{t('editor.inspector.version')}</label><select id="correction-version" value={activeSource?.version ? String(activeSource.version) : 'model'} onChange={(event) => { void handleVersionChange(event.target.value); }} className={cx('w-full rounded-lg border px-2.5 py-1.5 text-xs outline-none focus:border-slate-400', borderClass, isLight ? 'bg-white text-ink-secondary' : 'bg-slate-950/50 text-slate-200')}><option value="model">{t('editor.inspector.version_model')}</option>{editor.corrections.map((item: any) => <option key={item.version} value={String(item.version)}>{t('editor.inspector.version_option', { version: item.version, ppd: formatPpd(Number(item.ppd_percent)) })}</option>)}</select></div>}
                <div className="mt-3 space-y-2 text-xs">
                  <div className={cx('flex items-center justify-between border-b pb-2', borderClass)}><span className={mutedClass}>{t('editor.inspector.cassava_area')}</span><strong>{metrics.cassavaPixels.toLocaleString()} px</strong></div>
                  <div className={cx('flex items-center justify-between border-b pb-2', borderClass)}><span className={mutedClass}>{t('editor.inspector.rotten_area')}</span><strong className={isLight ? 'text-rose-600' : 'text-rose-400'}>{metrics.rottenPixels.toLocaleString()} px</strong></div>
                  <div className={cx('flex items-center justify-between border-b pb-2', borderClass)}><span className={mutedClass}>{t('editor.inspector.original_ppd')}</span><strong>{formatPpd(originalPpd)}</strong></div>
                  <div className="flex items-center justify-between"><span className="text-muted">{t('editor.inspector.image_size')}</span><strong>{masks.width} × {masks.height}</strong></div>
                </div>
                {prediction.ppd_unit === 'unknown' && <div className={cx('mt-3 rounded-lg border p-2 text-xs', isLight ? 'border-[rgba(245,165,36,0.30)] bg-[rgba(245,165,36,0.12)] text-warn-text' : 'border-amber-300/20 bg-amber-300/10 text-amber-100')}>{t('editor.inspector.unit_unknown')}</div>}

                <label className="mt-3 block text-xs" htmlFor="correction-note">{t('editor.note.label')}</label>
                <textarea id="correction-note" value={note} disabled={saving} maxLength={2000} onChange={(event) => { setNote(event.target.value); setDirty(true); }} className="mt-1 w-full rounded-lg border border-slate-500 bg-transparent p-2 text-xs" placeholder={t('editor.note.placeholder')} />
                </div>
                <div className={cx('shrink-0 border-t pt-2', borderClass)}>
                <p className="mt-1 text-xs text-muted">{saving ? t('editor.note.saving') : dirty ? t('editor.note.dirty') : t('editor.note.clean')}</p>
                <button onClick={handleSave} disabled={saving || versionLoading || smartLoading || !dirty} className="mt-3 flex w-full items-center justify-center gap-2 rounded-[12px] bg-brand-fill px-3 py-2.5 text-xs font-semibold text-white transition hover:bg-brand-fill-hover disabled:cursor-not-allowed disabled:bg-hairline disabled:text-muted"><Save className="h-3.5 w-3.5" />{saving ? t('editor.save.busy') : t('editor.save.button')}</button>
                <button onClick={() => void completeReview()} disabled={saving || versionLoading || smartLoading} className="mt-2 w-full rounded-lg bg-emerald-700 px-3 py-2.5 text-xs font-semibold text-white disabled:opacity-50">{dirty ? '保存并完成复检，下一张' : '确认无需修改，下一张'}</button>
                {onNavigate && <div className="mt-2 flex items-center justify-between gap-2 text-xs"><button disabled={!canPrevious || saving || versionLoading} title="←" onClick={() => void navigateResult(-1)}>← 上一张</button><span>{positionLabel}</span><button disabled={!canNext || saving || versionLoading} title="→" onClick={() => void navigateResult(1)}>下一张 →</button></div>}

                </div>
              </aside>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
};

export default PredictionResultEditor;
