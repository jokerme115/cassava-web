import { describe, expect, it } from 'vitest';
import { modelLabel } from './modelLabels';

describe('model names', () => {
  it('maps stable IDs to public versions and keeps historical unknown names', () => {
    expect(modelLabel('resnet101')).toBe('V1.0');
    expect(modelLabel('m6_best')).toBe('V1.1');
    expect(modelLabel('ensemble')).toBe('V1.0 + V1.1 投票');
    expect(modelLabel('older')).toBe('older');
  });
});
