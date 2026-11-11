import { describe, it, expect } from 'vitest';
import { resolvePredictionParameters } from './predictionPresets';
describe('frozen model presets', () => {
  it('cannot overwrite the frozen protocol via a saved personal preset', () => {
    const parameters = resolvePredictionParameters('pbt_c512', 'single', { confidenceThreshold: .1, useTTA: true, usePostProcessing: true, minArea: 888, patchSize: [32, 32] });
    expect(parameters).toMatchObject({ confidenceThreshold: .5, useTTA: false, usePostProcessing: false, minArea: 0, patchSize: [512, 512] });
  });
  it('retains intentional overrides for a configurable model', () => {
    expect(resolvePredictionParameters('m6', 'single', { confidenceThreshold: .7 }).confidenceThreshold).toBe(.7);
  });
});
