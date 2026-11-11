import { describe, expect, it } from 'vitest';
import { replaceEditedContours } from './maskContours';
describe('boundary edits preserve raster truth', () => {
  const outer = [{ x: 1, y: 1 }, { x: 8, y: 1 }, { x: 8, y: 8 }, { x: 1, y: 8 }];
  const mask = () => { const m = new Uint8Array(100); for (let y = 1; y < 8; y++) for (let x = 1; x < 8; x++) m[y * 10 + x] = 1; m[33] = 0; m[99] = 1; return m; };
  it('unchanged geometry is bit-identical including holes and small islands', () => {
    expect(replaceEditedContours(mask(), 10, 10, [outer], [outer])).toEqual(mask());
  });
  it('inward drag removes the old edge and preserves the hole and unrelated island', () => {
    const inner = [{ x: 1, y: 1 }, { x: 5, y: 1 }, { x: 5, y: 8 }, { x: 1, y: 8 }];
    const result = replaceEditedContours(mask(), 10, 10, [outer], [inner]);
    expect(result[27]).toBe(0); expect(result[33]).toBe(0); expect(result[99]).toBe(1); expect(result[22]).toBe(1);
  });
});
