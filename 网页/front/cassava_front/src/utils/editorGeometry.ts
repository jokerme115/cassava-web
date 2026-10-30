export function editorScreenMetrics(zoom: number, vertexSize = 2) {
  const scale = 1 / Math.max(0.02, zoom);
  return { scale, radius: vertexSize * scale, lineWidth: scale, hitRadius: 6 * scale };
}

export function nearestVertex(rings: Array<Array<{ x: number; y: number }>>, point: { x: number; y: number }, radius: number): { ring: number; index: number } | null {
  let best: { ring: number; index: number } | null = null;
  let distance = radius * radius;
  rings.forEach((ring, r) => ring.forEach((vertex, index) => {
    const next = (vertex.x - point.x) ** 2 + (vertex.y - point.y) ** 2;
    if (next < distance) { distance = next; best = { ring: r, index }; }
  }));
  return best;
}
