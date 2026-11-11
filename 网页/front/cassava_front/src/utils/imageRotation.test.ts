import { describe, expect, it } from 'vitest';
import { imagePointFromRotatedRect, normalizeRotation } from './imageRotation';

describe('rotated editing coordinates', () => {
  it.each([0, 90, 180, 270])('maps a non-square image pixel back after %i degrees', angle => {
    const width = 5, height = 3, x = 1.5, y = 1.5;
    const [u, v] = angle === 90 ? [1 - y / height, x / width] : angle === 180 ? [1 - x / width, 1 - y / height] : angle === 270 ? [y / height, 1 - x / width] : [x / width, y / height];
    const rect = { left: 42, top: 17, width: angle % 180 ? 60 : 100, height: angle % 180 ? 100 : 60 };
    const point = imagePointFromRotatedRect(rect.left + u * rect.width, rect.top + v * rect.height, rect, width, height, angle);
    expect(point.x).toBeCloseTo(x); expect(point.y).toBeCloseTo(y);
  });
  it('normalizes reverse and full rotations without changing masks', () => {
    expect(normalizeRotation(-90)).toBe(270); expect(normalizeRotation(360)).toBe(0);
  });
});
