import { describe, expect, it } from 'vitest';
import { editorScreenMetrics, nearestVertex } from './editorGeometry';

describe('precise contour editing', () => {
  it('keeps vertices and outlines the same screen size between fit, zoom and rotation views', () => {
    const radii = [0.02, 0.18, 0.58, 1, 4].map(zoom => {
      const metrics = editorScreenMetrics(zoom);
      expect(metrics.lineWidth * zoom).toBeCloseTo(1);
      expect(metrics.hitRadius * zoom).toBeCloseTo(6);
      return metrics.radius * zoom;
    });
    expect(radii.every(value => Math.abs(value - radii[0]) < 0.001)).toBe(true);
    expect(radii[0]).toBeLessThanOrEqual(2.5);
  });
  it('selects the closest vertex in dense contours instead of the first nearby vertex', () => {
    const rings = [[{ x: 0, y: 0 }, { x: 5, y: 0 }], [{ x: 5.5, y: 0 }]];
    expect(nearestVertex(rings, { x: 5.4, y: 0 }, 6)).toEqual({ ring: 1, index: 0 });
    expect(nearestVertex(rings, { x: 100, y: 100 }, 6)).toBeNull();
  });
});
