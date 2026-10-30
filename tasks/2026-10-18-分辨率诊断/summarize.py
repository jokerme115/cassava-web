import csv
import json
import hashlib
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.font_manager import FontProperties

OUT = Path(__file__).parent
inventory = json.loads((OUT / 'inventory.json').read_text(encoding='utf-8'))
records = json.loads((OUT / 'results.json').read_text(encoding='utf-8'))
direct = json.loads((OUT / 'direct-scale-results.json').read_text(encoding='utf-8'))
assert len(records) == 225 and len(direct) == 63
assert all(np.isfinite(r['filtered_ppd']) and 0 <= r['filtered_ppd'] <= 100 for r in records)
assert all(np.isfinite(r['actual_scale_filtered_ppd']) for r in direct)
models = ['resnet101', 'm6_best', 'ensemble']
names = {'resnet101': 'V1.0', 'm6_best': 'V1.1', 'ensemble': '投票'}
levels = ['96', '128', '192', '256', '384', '512', 'native']
stability = []
for model in models:
    for level in levels:
        subset = [r for r in records if r['model'] == model and r['level'] == level and r['arm'] == 'degrade_restore']
        assert len(subset) == 9
        differences = []
        for row in subset:
            baseline = next(r for r in records if r['model'] == model and r['level'] == 'native'
                and r['image_id'] == row['image_id'] and r['crop'] == row['crop'])
            differences.append(abs(row['filtered_ppd'] - baseline['filtered_ppd']))
        stability.append({'model': model, 'information_long_edge': level,
                          'mean_abs_ppd_change_points': float(np.mean(differences)),
                          'max_abs_ppd_change_points': float(np.max(differences))})
dedup = {}
for row in inventory:
    path = Path(row['path'])
    if path.is_file():
        row['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
        dedup.setdefault(row['sha256'], []).append(row['image_id'])
low_unique = [next(r for r in inventory if r['image_id'] == ids[0]) for ids in dedup.values()
              if next(r for r in inventory if r['image_id'] == ids[0])['image_id'] >= 47]
low_zeros = [r['image_id'] for r in low_unique if next(p for p in r['predictions'] if p['single_model_type'] == 'resnet101')['ppd_value'] == 0]
native_supports = {}
for row in records:
    if row['level'] == 'native' and row['model'] == 'resnet101':
        native_supports[f"{row['image_id']}-{row['crop']}"] = {
            'cassava_pixels': row['cassava_pixels'],
            'min_100px_component_as_percent': 10000 / row['cassava_pixels'],
        }
summary = {'readable_image_records': sum(bool(r['width']) for r in inventory),
           'unique_readable_images': len(dedup), 'duplicate_image_groups': [ids for ids in dedup.values() if len(ids) > 1],
           'unique_low_resolution_images': len(low_unique), 'low_resolution_zero_v1_image_ids': low_zeros,
           'experiment_images': 6, 'unique_crops': 12, 'real_model_prediction_calls': 192,
           'derived_voting_maps': 96, 'stability_not_accuracy': stability,
           'native_supports': native_supports, 'ground_truth_accuracy': None,
           'user_confirmed_low_images_are_screenshots_or_compressed': True}
(OUT / 'analysis.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
with (OUT / 'stability.csv').open('w', encoding='utf-8-sig', newline='') as stream:
    writer = csv.DictWriter(stream, fieldnames=list(stability[0])); writer.writeheader(); writer.writerows(stability)
with (OUT / 'direct-scale.csv').open('w', encoding='utf-8-sig', newline='') as stream:
    writer = csv.DictWriter(stream, fieldnames=list(direct[0])); writer.writeheader(); writer.writerows(direct)

font = FontProperties(fname='C:/Windows/Fonts/msyh.ttc')
plt.rcParams['font.family'] = font.get_name()
plt.rcParams['axes.unicode_minus'] = False
fig, axes = plt.subplots(1, 2, figsize=(12, 4.8), constrained_layout=True)
for model, color in zip(models, ['#2563eb', '#059669', '#d97706']):
    rows = [r for r in stability if r['model'] == model and r['information_long_edge'] != 'native']
    axes[0].plot([int(r['information_long_edge']) for r in rows], [r['mean_abs_ppd_change_points'] for r in rows],
                 marker='o', label=names[model], color=color)
axes[0].set_title('细节减少后的输出变化：3张高清图、9个切面', fontsize=11)
axes[0].set_xlabel('缩小后的切面长边（随后还原到相同输入尺寸）')
axes[0].set_ylabel('相对原始预测的PPD平均变化（百分点）')
axes[0].set_xticks([96, 128, 192, 256, 384, 512])
axes[0].legend(frameon=False)
low = [r for r in records if r['arm'] == 'upsample_only' and r['image_id'] == 54 and r['model'] == 'm6_best']
axes[1].plot([r['input_width'] if r['input_width'] > r['input_height'] else r['input_height'] for r in low],
             [r['filtered_ppd'] for r in low], marker='o', color='#059669', linewidth=2)
axes[1].set_title('截图仅插值放大：图片8中间切面，V1.1', fontsize=11)
axes[1].set_xlabel('送入模型的切面长边（原始细节仍只有81像素）')
axes[1].set_ylabel('PPD（%），统一回原坐标计算')
axes[1].set_xticks([81, 256, 512, 768])
for row in low:
    axes[1].annotate(f"{row['filtered_ppd']:.2f}%", (max(row['input_width'], row['input_height']), row['filtered_ppd']),
                     xytext=(0, 8), textcoords='offset points', ha='center', fontsize=9)
for ax in axes:
    ax.grid(alpha=.2)
    ax.spines[['top', 'right']].set_visible(False)
fig.suptitle('分辨率敏感性检查：预测变化不等于准确率变化', fontsize=13)
fig.savefig(OUT / 'resolution-sensitivity.png', dpi=180)
plt.close(fig)

table = []
for level in ['96', '256', '512', 'native']:
    rows = [r for r in direct if r['image_id'] == 43 and r['level'] == level]
    table.append('| ' + str(max(rows[0]['input_width'], rows[0]['input_height'])) + ' | ' + ' | '.join(
        f"{next(r for r in rows if r['model'] == model)['actual_scale_filtered_ppd']:.2f}%" for model in models) + ' |')
report = '''# 分辨率与低PPD诊断

## 结论

低分辨率确实可以造成预测归零。用户确认图片1～9为截图或压缩图，其有效切面只有约62～133像素，处于本次观察到的高风险范围。但PPD低也可能来自实际病变少、模型尺度适配、阈值、后处理或主体范围判断，不能只按PPD认定分辨率不足。

当前采集建议：每个切面尽量达到约512像素，优先保留600～800像素的真实拍摄细节；小于约256像素应优先补拍或寻找原图。这是工程采集目标，不是已经独立验证的最佳准确率分辨率。每张照片有多少万像素不能替代切面实际尺寸；多切面同框时可先用长边3000～4000像素的相机原图，并检查每个切面是否足够大，必要时靠近或单独补拍。

## 当前数据

- 15条图片记录中12张本地原图可读取；另3条本地文件不可读取，不纳入分辨率实验。
- 可读12条去重为11张图，图片8和图片9的文件SHA256完全相同，不能计为两个独立样本。
- 9条截图记录去重为8张，其中历史V1.0的6张为0；另外2张非零。此项是观察关联，不是准确率或因果估计。
- 高清原图尺寸4032×2268或3072×4096，切面约491～782像素；其中也有低PPD，因此低PPD不等于低分辨率。

## 真实推理检查

共6张不同图像、12个切面：V1.0和V1.1真实模型级预测调用192次（M6内部可能包含多次滑窗前向计算），另外派生96份投票概率图。没有训练、没有修改阈值或上线参数，也没有写入业务预测记录。

主检查：3张高清图9个切面，长边96/128/192/256/384/512/原始。缩小再还原到相同输入尺寸，固定主体范围和后处理，测量细节减少对结果的影响。变化指标只表示与原图预测的差异，不是真值误差。

补充检查：同3张高清图各中间切面，按相同7档尺寸直接推理，观察实际输入尺度及固定像素过滤的联合影响。另3张截图各中间切面插值到原尺寸/256/512/768；统一映回原坐标并固定后处理比较，避免把面积计算网格变化当作效果提高。

S15 (4).jpg同一个中间切面，真实缩小后直接推理，参考主体范围保持同一空间区域：

| 切面长边(px) | V1.0 PPD | V1.1 PPD | 投票PPD |
|---|---:|---:|---:|
''' + '\n'.join(table) + '''

其余两张高清图的代表切面缩到长边96像素后，两个模型和投票也均为0。此结果证明低尺寸可以产生归零，但不证明原尺寸PPD为真值，也不能把PPD变大当作更准确。

## 为什么不能说某个尺寸最好

图片8中间切面原始77×81像素，V1.1在原尺寸/插值长边256/512/768时，统一原坐标后的PPD分别约0.00%、24.70%、3.85%、0.00%。放大尺寸与PPD并非单调关系，说明模型对输入尺度敏感，不能通过挑选产生最大PPD的尺寸确定最优。

当前后处理按每块连通区域小于100像素删除，随后使用5×5平滑。相同设置用于几十像素的切面时，可能抹掉细小病斑。应结合相对面积及原始概率图评估，不能直接把阈值调低当作精度修复。

512×512是当前M6推理窗口，不是“达到512就能准确”的保证。插值放大也不能补回拍摄时已经丢失的细节。[OpenCV官方说明](https://docs.opencv.org/4.13.0/da/d54/group__imgproc__transform.html)描述了缩放如何基于已有像素进行插值。

## 下一步验证标准

收集相机原图及同一切面的独立复核标注，在开发验证样本中比较256/384/512/768/1024的分割质量、PPD绝对误差和漏检；选定设置后再用独立测试样本确认。不能在测试集上挑分辨率。当前截图和未复核人工校正不够支撑准确率最优结论。

## 证据

任务目录：`tasks/2026-10-18-分辨率诊断/`。inventory.json记录图片和裁剪尺寸；experiment-manifest.json和direct-scale-manifest.json记录参数；results.csv和direct-scale.csv记录逐项结果；analysis.json记录汇总及去重；probability-maps保存原始概率和对照掩码。

局限：只有6张图，不是冻结测试集；固定已检测切面，没有重新评价检测器在低清整图下的漏检；主体范围仍来自现有颜色规则；没有经独立复核的病斑真值。所有数字属于探索性敏感性检查。
'''
docs = OUT.parent.parent / 'docs'
(docs / '2026-10-18-分辨率与低PPD诊断.md').write_text(report, encoding='utf-8')
print(json.dumps({'readable': summary['readable_image_records'], 'unique': len(dedup),
                  'duplicate_groups': summary['duplicate_image_groups'], 'low_zero_ids': low_zeros,
                  'native_supports': native_supports}, indent=2))
