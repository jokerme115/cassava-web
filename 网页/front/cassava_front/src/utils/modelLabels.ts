// 模型显示名：代码内部 key 不变（resnet101 / m6_best / ensemble），
// 对用户统一显示为有监督、半监督、投票三类。
// legacy 旧标签（V1.0 / V1.1 / 投票字样）来自历史数据库记录，同样映射到新名称。
const DISPLAY: Record<string, string> = {
  pbt_c512: 'PBT SegFormer-B2 · c512 五种子',
  pbt_c384: 'PBT SegFormer-B2 · c384 五种子',
  hrnet_w48: 'HRNet-W48 · seed101',
  mask2former_swin_t: 'Mask2Former Swin-T · seed42',
  resnet101: '有监督模型',
  m6_best: '半监督模型',
  ensemble: '投票模型',
  'V1.0': '有监督模型',
  'V1.1': '半监督模型',
  'V1.0 + V1.1 投票': '投票模型',
  双模型投票: '投票模型',
  标准模型: '有监督模型',
  增强模型: '半监督模型',
};

export const modelLabel = (name?: string | null): string => DISPLAY[name || ''] || name || '--';
