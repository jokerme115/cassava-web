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
  Moon,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { message } from 'antd';
import { PredictionResult } from '../types';
import { predictionsApi, resolveFileUrl } from '../services/api';
import { calculateMaskPixelMetrics } from '../utils/measurement';

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
  const [polygonPoints, setPolygonPoints] = useState<Array<{ x: number; y: number }>>([]);
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
      const next = { width, height, cassava, rotten };
      masksRef.current = next;
      setMasks(next);
      setMetrics(calculateMaskPixelMetrics(cassava, rotten));
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
  const shellClass = isLight ? 'bg-slate-100 text-slate-900' : 'bg-[#101722] text-white';
  const borderClass = isLight ? 'border-slate-200' : 'border-white/10';
  const mutedClass = isLight ? 'text-slate-600' : 'text-slate-300';
  const toolbarClass = isLight ? 'bg-white' : 'bg-[#141e2b]';
  const asideClass = isLight ? 'bg-slate-50' : 'bg-[#111b28]';

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
    if (polygonPoints.length > 0) {
      context.save();
      context.strokeStyle = '#fbbf24';
      context.lineWidth = Math.max(2, masks.width / 450);
      context.setLineDash([8, 6]);
      context.beginPath();
      polygonPoints.forEach((point, index) => index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y));
      context.stroke();
      context.setLineDash([]);
      context.fillStyle = 'rgba(251, 191, 36, 0.16)';
      context.fill();
      polygonPoints.forEach((point, index) => {
        context.beginPath();
        context.fillStyle = index === 0 ? '#f8fafc' : '#fbbf24';
        context.arc(point.x, point.y, Math.max(3, Math.min(6, masks.width / 1000)), 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = '#172033';
        context.lineWidth = Math.max(2, masks.width / 700);
        context.stroke();
      });
      context.restore();
    }
  }, [baseImage, cassavaOpacity, dimOutside, masks, polygonPoints, rottenOpacity, showCassava, showOriginal, showRotten, smartSelection]);

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
    setHistory((items) => [...items.slice(-(maxSnapshots - 1)), before]);
    setFuture([]);
  };

  const applyPolygon = () => {
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

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = pointFromEvent(event);
    if (!point || !masksRef.current) return;
    if (tool === 'pan' || spacePressedRef.current) {
      if (event.button !== 0) return;
      event.preventDefault();
      const viewport = viewportRef.current;
      if (viewport) panningRef.current = { x: event.clientX, y: event.clientY, scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (tool.startsWith('pen')) {
      const firstPoint = polygonPoints[0];
      const closeDistance = Math.max(12, masksRef.current.width / 180);
      if (firstPoint && polygonPoints.length >= 3 && Math.hypot(point.x - firstPoint.x, point.y - firstPoint.y) <= closeDistance) {
        applyPolygon();
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
    if (panningRef.current && viewportRef.current) {
      const pan = panningRef.current;
      viewportRef.current.scrollLeft = pan.scrollLeft - (event.clientX - pan.x);
      viewportRef.current.scrollTop = pan.scrollTop - (event.clientY - pan.y);
      return;
    }
    if (!strokeBeforeRef.current || !masksRef.current || tool.startsWith('pen')) return;
    const point = pointFromEvent(event);
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
    const current = masksRef.current;
    const previous = history[history.length - 1];
    if (!current || !previous) return;
    setFuture((items) => [snapshot(current), ...items]);
    setHistory((items) => items.slice(0, -1));
    restore(previous);
  };

  const handleRedo = () => {
    const current = masksRef.current;
    const next = future[0];
    if (!current || !next) return;
    setHistory((items) => [...items, snapshot(current)]);
    setFuture((items) => items.slice(1));
    restore(next);
  };

  const handleReset = () => {
    const source = activeSource || editor;
    if (!source || !masksRef.current) return;
    const load = async () => {
      const current = masksRef.current;
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
    void load();
  };

  const handleVersionChange = async (value: string) => {
    if (!editor || !masksRef.current) return;
    const source = value === 'model'
      ? editor
      : (editor.corrections || []).find((item: any) => String(item.version) === value);
    if (!source?.cassava_mask_url || !source?.rotten_mask_url) return;
    const current = masksRef.current;
    const [cassava, rotten] = await Promise.all([
      fetchRaster(resolveFileUrl(source.cassava_mask_url), current.width, current.height),
      fetchRaster(resolveFileUrl(source.rotten_mask_url), current.width, current.height),
    ]);
    setActiveSource(source);
    setHistory([]);
    setFuture([]);
    updateMasks({ ...current, cassava, rotten });
  };

  const handleSave = async () => {
    if (!masks || saving) return;
    if (!metrics.cassavaPixels) {
      message.warning('木薯主体面积为 0，无法计算 PPD。');
      return;
    }
    setSaving(true);
    try {
      const form = new FormData();
      form.append('cassava_mask', await maskToBlob(masks.cassava, masks.width, masks.height), 'cassava-mask.png');
      form.append('rotten_mask', await maskToBlob(masks.rotten, masks.width, masks.height), 'rotten-mask.png');
      form.append('edit_data', JSON.stringify({ layer, tool, brushSize, width: masks.width, height: masks.height }));
      const correction = await predictionsApi.saveCorrection(prediction.id, form);
      setEditor((current: any) => current ? {
        ...current,
        current_correction: correction,
        corrections: [correction, ...(current.corrections || [])],
      } : current);
      setActiveSource(correction);
      setHistory([]);
      setFuture([]);
      message.success('人工校正版本已保存');
      onSaved(correction);
    } catch (saveError: any) {
      message.error(saveError?.response?.data?.detail || saveError?.message || '保存校正结果失败');
    } finally {
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
      else if (key === 'escape') setPolygonPoints([]);
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
        <header className={cx('flex items-center justify-between border-b px-5 py-2', borderClass)}>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-teal-300"><Layers3 className="h-4 w-4" /> Measurement workspace</div>
            <h2 className="mt-0.5 truncate text-base font-semibold">{prediction.imageName}</h2>
            <p className={cx('mt-0.5 text-[11px]', mutedClass)}>木薯范围与腐烂范围可编辑，PPD 实时计算</p>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setTheme((value) => value === 'dark' ? 'light' : 'dark')} className={cx('inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px]', mutedClass, isLight ? 'hover:bg-slate-100' : 'hover:bg-white/10')} title="切换深浅主题">
              {isLight ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}{isLight ? '深色' : '浅色'}
            </button>
            <button onClick={onClose} className={cx('rounded-lg p-1.5 transition', mutedClass, isLight ? 'hover:bg-slate-100 hover:text-slate-900' : 'hover:bg-white/10 hover:text-white')} aria-label="关闭编辑器"><X className="h-4 w-4" /></button>
          </div>
        </header>

        {loading ? <div className="flex flex-1 items-center justify-center text-slate-300">正在加载原图和掩码...</div> : error ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center"><CircleDot className="h-10 w-10 text-amber-300" /><p className="max-w-md text-sm text-slate-300">{error}</p><button onClick={onClose} className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-slate-900">返回结果</button></div>
        ) : masks && baseImage ? (
          <>
            <div className={cx('flex flex-wrap items-center gap-1.5 border-b px-3 py-1.5', borderClass, toolbarClass)}>
              <span className={cx('mr-1 hidden items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] xl:flex', mutedClass)}><Maximize2 className="h-3.5 w-3.5 text-teal-300" />原图全屏编辑</span>
              <div className={cx('mr-1 flex items-center gap-1 rounded-lg p-0.5', isLight ? 'bg-slate-100' : 'bg-white/5')}>
                <button onClick={() => setLayer('cassava')} className={cx('rounded-md px-2.5 py-1 text-[11px]', layer === 'cassava' ? 'bg-teal-400 text-slate-950' : mutedClass, layer === 'cassava' ? '' : (isLight ? 'hover:bg-white' : 'hover:bg-white/10'))} title="木薯范围（C）">木薯范围</button>
                <button onClick={() => setLayer('rotten')} className={cx('rounded-md px-2.5 py-1 text-[11px]', layer === 'rotten' ? 'bg-rose-400 text-slate-950' : mutedClass, layer === 'rotten' ? '' : (isLight ? 'hover:bg-white' : 'hover:bg-white/10'))} title="腐烂范围（R）">腐烂范围</button>
              </div>
              {(['brush-add', 'brush-erase', 'pen-add', 'pen-erase', 'smart-add', 'smart-erase', 'pan'] as ToolName[]).map((name) => (
                <button key={name} onClick={() => { setTool(name); setSmartSelection(null); setSmartSelectionCount(0); if (!name.startsWith('pen')) setPolygonPoints([]); }} className={cx('inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] transition', tool === name ? (isLight ? 'bg-slate-900 text-white' : 'bg-white text-slate-950') : mutedClass, tool === name ? '' : (isLight ? 'hover:bg-slate-100' : 'hover:bg-white/10'))} title={`${toolLabel[name]}（${toolShortcut[name]}）${name.startsWith('smart') && !editor?.confidence_map_url ? ' · 需重新预测生成置信度图' : ''}`}>{activeToolIcon(name)}<span className="hidden md:inline">{toolLabel[name]}</span></button>
              ))}
              <div className={cx('ml-auto flex items-center gap-1 border-l pl-2', borderClass)}>
                <button onClick={handleUndo} disabled={!history.length} className={cx('rounded-lg p-1.5 disabled:opacity-30', mutedClass, isLight ? 'hover:bg-slate-100' : 'hover:bg-white/10')} title="撤销 Ctrl+Z"><Undo2 className="h-3.5 w-3.5" /></button>
                <button onClick={handleRedo} disabled={!future.length} className={cx('rounded-lg p-1.5 disabled:opacity-30', mutedClass, isLight ? 'hover:bg-slate-100' : 'hover:bg-white/10')} title="重做 Ctrl+Y"><Redo2 className="h-3.5 w-3.5" /></button>
                <button onClick={handleReset} className={cx('rounded-lg p-1.5', mutedClass, isLight ? 'hover:bg-slate-100' : 'hover:bg-white/10')} title="恢复当前版本"><RotateCcw className="h-3.5 w-3.5" /></button>
              </div>
              <div className={cx('flex items-center gap-1 rounded-lg p-0.5', isLight ? 'bg-slate-100' : 'bg-white/5')}>
                <button onClick={() => setZoom((value) => clamp(value - 0.1, 0.25, 4))} className={cx('rounded-md p-1.5', mutedClass, isLight ? 'hover:bg-white' : 'hover:bg-white/10')} title="缩小 -"><ZoomOut className="h-3.5 w-3.5" /></button>
                <span className={cx('w-10 text-center text-[11px]', mutedClass)}>{Math.round(zoom * 100)}%</span>
                <button onClick={() => setZoom((value) => clamp(value + 0.1, 0.25, 4))} className={cx('rounded-md p-1.5', mutedClass, isLight ? 'hover:bg-white' : 'hover:bg-white/10')} title="放大 +"><ZoomIn className="h-3.5 w-3.5" /></button>
                <button onClick={fitToView} className={cx('rounded-md px-2 py-1 text-[11px]', mutedClass, isLight ? 'hover:bg-white' : 'hover:bg-white/10')} title="适应窗口">适应</button>
              </div>
              {tool.startsWith('pen') && polygonPoints.length >= 3 && <button onClick={applyPolygon} className="inline-flex items-center gap-1 rounded-xl bg-amber-300 px-3 py-2 text-xs font-semibold text-slate-950"><Check className="h-4 w-4" />闭合钢笔区域</button>}
              {tool.startsWith('smart') && smartSelection && <button onClick={applySmartSelection} className="inline-flex items-center gap-1 rounded-lg bg-amber-300 px-3 py-1.5 text-[11px] font-semibold text-slate-950"><Check className="h-3.5 w-3.5" />应用选区 ({smartSelectionCount.toLocaleString()} px)</button>}
            </div>

            <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
              <main ref={viewportRef} className={cx('relative min-h-0 flex-1 overflow-auto p-3 md:p-4', isLight ? 'bg-slate-100' : 'bg-[#080d14]')} style={{ cursor: tool === 'pan' || spacePressed ? 'grab' : 'crosshair' }}>
                <div className="flex min-h-full min-w-full items-center justify-center p-2">
                  <canvas ref={canvasRef} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp} onDoubleClick={handleCanvasDoubleClick} onWheel={handleCanvasWheel} className="max-w-none rounded-xl shadow-2xl" style={{ width: `${masks.width * zoom}px`, height: `${masks.height * zoom}px`, imageRendering: zoom > 1.5 ? 'pixelated' : 'auto' }} />
                </div>
                <div className={cx('absolute bottom-4 left-4 flex flex-wrap gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] backdrop-blur', isLight ? 'border-slate-200 bg-white/85 text-slate-700' : 'border-white/10 bg-slate-950/75 text-slate-200')}>
                  <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-teal-400" />木薯范围</span><span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-rose-400" />腐烂范围</span><span className="text-slate-400">像素级编辑</span>
                </div>
              </main>

              <aside className={cx('w-full shrink-0 overflow-y-auto border-t p-3 lg:w-[270px] lg:border-l lg:border-t-0', borderClass, asideClass)}>
                <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">测量检查器</h3><span className="rounded-full bg-teal-400/10 px-2 py-1 text-[10px] text-teal-300">实时</span></div>
                <div className={cx('mt-3 rounded-xl border p-3', borderClass, isLight ? 'bg-white' : 'bg-white/[0.04]')}><p className={cx('text-[11px]', mutedClass)}>校正后 PPD</p><p className={cx('mt-1 text-3xl font-semibold tracking-tight', isLight ? 'text-slate-900' : 'text-white')}>{metrics.ppd.toFixed(2)}<span className="ml-1 text-base text-teal-500">%</span></p><p className={cx('mt-1 text-[11px]', delta >= 0 ? 'text-rose-500' : 'text-emerald-500')}>较原模型 {delta >= 0 ? '+' : ''}{delta.toFixed(2)} 个百分点</p></div>
                {editor?.corrections?.length > 0 && <div className="mt-3"><label htmlFor="correction-version" className={cx('mb-1.5 block text-[11px] font-semibold', mutedClass)}>校正版本</label><select id="correction-version" value={activeSource?.version ? String(activeSource.version) : 'model'} onChange={(event) => { void handleVersionChange(event.target.value); }} className={cx('w-full rounded-lg border px-2.5 py-1.5 text-[11px] outline-none focus:border-teal-300', borderClass, isLight ? 'bg-white text-slate-700' : 'bg-slate-950/50 text-slate-200')}><option value="model">模型初始结果</option>{editor.corrections.map((item: any) => <option key={item.version} value={String(item.version)}>人工校正 v{item.version} · {Number(item.ppd_percent).toFixed(2)}%</option>)}</select></div>}
                <div className="mt-3 space-y-2 text-xs">
                  <div className={cx('flex items-center justify-between border-b pb-2', borderClass)}><span className={mutedClass}>木薯面积</span><strong>{metrics.cassavaPixels.toLocaleString()} px</strong></div>
                  <div className={cx('flex items-center justify-between border-b pb-2', borderClass)}><span className={mutedClass}>腐烂面积</span><strong className="text-rose-400">{metrics.rottenPixels.toLocaleString()} px</strong></div>
                  <div className={cx('flex items-center justify-between border-b pb-2', borderClass)}><span className={mutedClass}>原始模型 PPD</span><strong>{originalPpd.toFixed(2)}%</strong></div>
                  <div className="flex items-center justify-between"><span className="text-slate-400">图像尺寸</span><strong>{masks.width} × {masks.height}</strong></div>
                </div>
                {prediction.ppd_unit === 'unknown' && <div className={cx('mt-3 rounded-lg border p-2 text-[11px]', isLight ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-amber-300/20 bg-amber-300/10 text-amber-100')}>原始结果为历史数据，PPD 单位待确认；人工校正值始终按百分比计算。</div>}

                <div className={cx('mt-3 border-t pt-3', borderClass)}><p className={cx('mb-2 text-[11px] font-semibold', mutedClass)}>显示图层</p><div className="space-y-1">
                  <button onClick={() => setShowOriginal((value) => !value)} className={cx('flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[11px]', mutedClass, isLight ? 'hover:bg-slate-100' : 'hover:bg-white/5')}><span className="flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-slate-100" />原图底图</span>{showOriginal ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5 text-slate-500" />}</button>
                  <button onClick={() => setShowCassava((value) => !value)} className={cx('flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[11px]', mutedClass, isLight ? 'hover:bg-slate-100' : 'hover:bg-white/5')}><span className="flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-teal-400" />木薯范围</span>{showCassava ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5 text-slate-500" />}</button>
                  <button onClick={() => setShowRotten((value) => !value)} className={cx('flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[11px]', mutedClass, isLight ? 'hover:bg-slate-100' : 'hover:bg-white/5')}><span className="flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-rose-400" />腐烂范围</span>{showRotten ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5 text-slate-500" />}</button>
                  <button onClick={() => setDimOutside((value) => !value)} className={cx('flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[11px]', mutedClass, isLight ? 'hover:bg-slate-100' : 'hover:bg-white/5')}><span className="flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-slate-500" />暗化计算范围外</span>{dimOutside ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5 text-slate-500" />}</button>
                </div>
                <div className={cx('mt-3 space-y-2 rounded-lg p-2.5', isLight ? 'bg-slate-100' : 'bg-white/[0.03]')}>
                  <div><div className="mb-1 flex justify-between text-[11px] text-slate-400"><span>木薯范围透明度</span><span>{Math.round(cassavaOpacity * 100)}%</span></div><input aria-label="木薯范围透明度" type="range" min="0" max="100" value={Math.round(cassavaOpacity * 100)} onChange={(event) => setCassavaOpacity(Number(event.target.value) / 100)} className="w-full accent-teal-400" /></div>
                  <div><div className="mb-1 flex justify-between text-[11px] text-slate-400"><span>腐烂范围透明度</span><span>{Math.round(rottenOpacity * 100)}%</span></div><input aria-label="腐烂范围透明度" type="range" min="0" max="100" value={Math.round(rottenOpacity * 100)} onChange={(event) => setRottenOpacity(Number(event.target.value) / 100)} className="w-full accent-rose-400" /></div>
                </div></div>

                {(tool === 'brush-add' || tool === 'brush-erase') && <div className={cx('mt-3 border-t pt-3', borderClass)}><div className={cx('mb-1.5 flex items-center justify-between text-[11px]', mutedClass)}><span>画笔大小</span><span>{brushSize}px</span></div><input type="range" min="4" max="120" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} className="w-full accent-teal-400" /></div>}
                {tool.startsWith('pen') && <div className={cx('mt-3 rounded-lg border p-2.5 text-[11px] leading-4', isLight ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-amber-300/20 bg-amber-300/10 text-amber-100')}>钢笔工具：点击原图逐点圈选，靠近起点自动闭合；也可双击完成。</div>}
                {tool.startsWith('smart') && <div className={cx('mt-3 rounded-lg border p-2.5 text-[11px] leading-4', isLight ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-amber-300/20 bg-amber-300/10 text-amber-100')}>
                  <div className="mb-1.5 flex items-center justify-between font-semibold"><span className="flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5" />智能点选</span><span>{Math.round(smartThreshold * 100)}%</span></div>
                  <input aria-label="智能点选相似度阈值" type="range" min="2" max="30" value={Math.round(smartThreshold * 100)} onChange={(event) => setSmartThreshold(Number(event.target.value) / 100)} className="w-full accent-amber-400" />
                  <p className="mt-1.5">点击腐烂区域，选择置信度相近的连续区域。阈值越大，选区越宽。</p>
                  <p className="mt-1">{smartLoading ? '正在计算选区，请稍候...' : confidenceReady ? `已加载置信度图，当前选区 ${smartSelectionCount.toLocaleString()} px` : editor?.confidence_map_url ? '首次点击时按需加载置信度图' : '该结果没有置信度图，请重新预测后使用'}</p>
                </div>}
                <div className={cx('mt-3 rounded-lg p-2.5 text-[11px] leading-4', isLight ? 'bg-white text-slate-600' : 'bg-slate-950/40 text-slate-400')}><p className={cx('flex items-center gap-2', isLight ? 'text-slate-800' : 'text-slate-200')}><MousePointer2 className="h-3.5 w-3.5 text-teal-500" />当前工具：{toolLabel[tool]}</p><p className="mt-1.5">Alt + 滚轮：缩放 | 空格 + 左键：平移</p><p className="mt-1">PPD = 腐烂面积 ÷ 木薯面积 × 100%</p></div>
                <button onClick={handleSave} disabled={saving} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-teal-400 px-3 py-2 text-xs font-semibold text-slate-950 transition hover:bg-teal-300 disabled:cursor-wait disabled:opacity-60"><Save className="h-3.5 w-3.5" />{saving ? '保存中...' : '保存人工校正版本'}</button>
              </aside>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
};

export default PredictionResultEditor;
