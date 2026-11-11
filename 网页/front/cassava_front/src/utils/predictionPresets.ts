export const defaultPredictionParameters = {
  confidenceThreshold: .5, usePostProcessing: true, useTTA: false, minArea: 100, morphKernelSize: 5, morphIterations: 1,
  overlayOpacity: .3, stage1Confidence: .25, stage2Confidence: .25, roiPadding: .1, fallbackRoiPadding: .7,
  expectedCount: 0, stageBoxIou: .5, patchSize: [512, 512] as [number, number], stride: [256, 256] as [number, number],
};
export const frozenModels = ['pbt_c512', 'pbt_c384', 'hrnet_w48', 'mask2former_swin_t'];
export function resolvePredictionParameters(model: string, mode: string, parameters: Record<string, unknown> = {}) {
  const base = { ...defaultPredictionParameters, ...parameters } as typeof defaultPredictionParameters;
  return mode === 'single' && frozenModels.includes(model) ? {
    ...defaultPredictionParameters, confidenceThreshold: .5, stage1Confidence: .5, stage2Confidence: .5,
    usePostProcessing: false, useTTA: false, minArea: 0,
  } : base;
}
