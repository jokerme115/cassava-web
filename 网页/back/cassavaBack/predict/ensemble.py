"""Equal pixel votes, explicit tie breaking, and agreement (not accuracy)."""
import numpy as np

MEMBERS = ('resnet101', 'm6_best')
LABELS = {'resnet101': '有监督模型', 'm6_best': '半监督模型', 'ensemble': '投票模型'}
METHOD = 'pixel_vote_probability_tiebreak'


def vote_probabilities(probabilities, threshold):
    maps = [np.asarray(p, dtype=np.float32) for p in probabilities]
    if len(maps) != 2 or maps[0].shape != maps[1].shape or maps[0].ndim != 2:
        raise ValueError('投票需要两个尺寸一致的二维概率图')
    if not np.isfinite(threshold) or not 0 <= threshold <= 1:
        raise ValueError('病变阈值必须在0到1之间')
    if any(not np.isfinite(p).all() or np.any((p < 0) | (p > 1)) for p in maps):
        raise ValueError('模型概率图无效，不能生成投票结果')
    stack = np.stack(maps)
    votes = stack > threshold
    mean = stack.mean(axis=0)
    count = votes.sum(axis=0)
    mask = (count > 1) | ((count == 1) & (mean > threshold))
    return mask.astype(np.uint8), mean, votes[0] != votes[1]


def voting_summary(cassava, member_masks, disagreement):
    support = np.asarray(cassava) > 0
    area = int(np.count_nonzero(support))
    different = int(np.count_nonzero(support & (np.asarray(disagreement) > 0)))
    return {
        'method': METHOD,
        'tie_rule': 'mean_probability_strict_threshold',
        'score_label': '模型一致率（非准确率）',
        'cassava_pixels': area,
        'disagreement_pixels': different,
        'agreement_percent': 100 * (1 - different / area) if area else None,
        'members': [
            {'model': name, 'label': LABELS[name],
             'ppd_percent': 100 * int(np.count_nonzero(support & (member_masks[name] > 0))) / area if area else None}
            for name in MEMBERS
        ],
    }
