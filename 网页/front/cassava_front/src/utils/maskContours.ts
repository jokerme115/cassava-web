export type Point = { x: number; y: number };
export const insidePolygon = (x: number, y: number, points: Point[]) => {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / ((b.y - a.y) || 1e-9) + a.x) inside = !inside;
  }
  return inside;
};

/** Apply only the boundary edit delta. Never rasterize untouched masks from polygons. */
export function replaceEditedContours(source: Uint8Array, width: number, height: number,
  originals: Point[][], edited: Point[][]): Uint8Array {
  const output = source.slice();
  edited.forEach((ring, index) => {
    const original = originals[index];
    if (!original || ring.length < 3 || JSON.stringify(original) === JSON.stringify(ring)) return;
    const member = new Uint8Array(source.length);
    const first = original.find(point => source[Math.round(point.y) * width + Math.round(point.x)]);
    if (!first) return;
    const seed = Math.round(first.y) * width + Math.round(first.x), stack = [seed]; member[seed] = 1;
    while (stack.length) {
      const pixel = stack.pop()!, x = pixel % width, y = Math.floor(pixel / width);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, next = ny * width + nx;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height && source[next] && !member[next]) { member[next] = 1; stack.push(next); }
      }
    }
    const all = [...original, ...ring];
    const minX = Math.max(0, Math.floor(Math.min(...all.map(p => p.x)))), maxX = Math.min(width - 1, Math.ceil(Math.max(...all.map(p => p.x))));
    const minY = Math.max(0, Math.floor(Math.min(...all.map(p => p.y)))), maxY = Math.min(height - 1, Math.ceil(Math.max(...all.map(p => p.y))));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const before = insidePolygon(x, y, original), after = insidePolygon(x, y, ring), pixel = y * width + x;
      if (before && !after && member[pixel]) output[pixel] = 0;
      if (!before && after) output[pixel] = 1;
    }
  });
  return output;
}
