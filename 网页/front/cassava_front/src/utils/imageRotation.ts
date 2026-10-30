export const normalizeRotation = (value: number) => ((value % 360) + 360) % 360;

export function imagePointFromRotatedRect(clientX: number, clientY: number,
  rect: { left: number; top: number; width: number; height: number }, width: number, height: number, rotation: number) {
  const u = (clientX - rect.left) / rect.width;
  const v = (clientY - rect.top) / rect.height;
  const angle = normalizeRotation(rotation);
  const [x, y] = angle === 90 ? [v, 1 - u] : angle === 180 ? [1 - u, 1 - v] : angle === 270 ? [1 - v, u] : [u, v];
  return { x: Math.max(0, Math.min(width - 1, x * width)), y: Math.max(0, Math.min(height - 1, y * height)) };
}
