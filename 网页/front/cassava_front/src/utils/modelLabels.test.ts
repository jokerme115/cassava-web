import { describe, expect, it } from 'vitest';
import { modelLabel } from './modelLabels';

describe('model names', () => {
  it('maps stable IDs to supervised, semi-supervised and voting models', () => {
    expect(modelLabel('resnet101')).toBe('有监督模型');
    expect(modelLabel('m6_best')).toBe('半监督模型');
    expect(modelLabel('ensemble')).toBe('投票模型');
  });

  it('maps legacy stored labels and keeps unknown names', () => {
    expect(modelLabel('V1.0')).toBe('有监督模型');
    expect(modelLabel('V1.1')).toBe('半监督模型');
    expect(modelLabel('V1.0 + V1.1 投票')).toBe('投票模型');
    expect(modelLabel('older')).toBe('older');
  });
});
