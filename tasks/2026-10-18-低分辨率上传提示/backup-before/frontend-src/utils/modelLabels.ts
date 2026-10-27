export const modelLabel = (name?: string | null): string => ({
  resnet101: 'V1.0',
  m6_best: 'V1.1',
  ensemble: 'V1.0 + V1.1 投票',
}[name || ''] || name || '--');
