import { Button, Checkbox, InputNumber, Select, Slider, Switch } from 'antd';
import type { FigureStyle } from '../utils/exportStyle';
export default function FigureStyleFields({ value, onChange }: { value: FigureStyle; onChange: (style: FigureStyle) => void }) {
  const change = <K extends keyof FigureStyle>(key: K, next: FigureStyle[K]) => onChange({ ...value, [key]: next });
  const stages = value.stages || ['prediction'];
  const names = { original: '原图', yolo: 'YOLO 子图', prediction: '预测结果' };
  return <div className="space-y-5">
    <fieldset className="space-y-3 border-b border-hairline pb-4"><legend className="mb-2 text-sm font-semibold">一张图中包含</legend>
      {(['original', 'yolo', 'prediction'] as const).map(stage => <div key={stage} className="flex items-center justify-between gap-2"><Checkbox checked={stages.includes(stage)} disabled={stages.length === 1 && stages.includes(stage)} onChange={e => change('stages', e.target.checked ? [...stages, stage] : stages.filter(s => s !== stage))}>{names[stage]}</Checkbox>{stages.includes(stage) && <div className="flex gap-1"><Button size="small" aria-label={`${names[stage]}前移`} disabled={stages.indexOf(stage) === 0} onClick={() => { const next = [...stages], i = next.indexOf(stage); [next[i-1], next[i]] = [next[i], next[i-1]]; change('stages', next); }}>↑</Button><Button size="small" aria-label={`${names[stage]}后移`} disabled={stages.indexOf(stage) === stages.length-1} onClick={() => { const next = [...stages], i = next.indexOf(stage); [next[i+1], next[i]] = [next[i], next[i+1]]; change('stages', next); }}>↓</Button></div>}</div>)}
      <label className="block text-sm">内容排列<Select aria-label="内容排列" className="mt-2 w-full" value={value.stage_layout || 'rows'} onChange={v => change('stage_layout', v)} options={[{value:'rows',label:'上下排列'}, {value:'columns',label:'左右排列'}]}/></label>
      <p className="text-xs text-muted">{stages.map(s => names[s]).join(value.stage_layout === 'columns' ? ' → ' : ' ↓ ')}</p>
    </fieldset>
    {(['cassava', 'rotten'] as const).map(layer => <fieldset key={layer} className="space-y-3 border-b border-hairline pb-4"><legend className="mb-2 text-sm font-semibold">{layer === 'cassava' ? '木薯主体' : '病斑'}</legend>
      <label className="flex items-center justify-between gap-3 text-sm">颜色<input aria-label={`${layer}颜色`} type="color" value={value[`${layer}_color`]} onChange={e => change(`${layer}_color`, e.target.value)} /></label>
      <label className="flex items-center justify-between gap-3 text-sm">线宽<InputNumber min={0} max={20} value={value[`${layer}_line_width`]} onChange={v => change(`${layer}_line_width`, Number(v ?? 2))} /></label>
      <label className="flex items-center justify-between gap-3 text-sm">填充<Switch checked={value[`${layer}_fill`]} onChange={v => change(`${layer}_fill`, v)} /></label>
      <label className="block text-sm">填充不透明度 {Math.round(value[`${layer}_opacity`] * 100)}%<Slider disabled={!value[`${layer}_fill`]} min={0} max={1} step={.01} value={value[`${layer}_opacity`]} onChange={v => change(`${layer}_opacity`, v)} /></label>
    </fieldset>)}
    {(['show_ppd', 'show_filename', 'collage'] as const).map((key, i) => <label key={key} className="flex items-center justify-between gap-3 text-sm">{['显示 PPD', '显示文件名', '跨照片拼图'][i]}<Switch checked={value[key]} onChange={v => change(key, v)} /></label>)}
    {(['font_size', 'columns', 'padding', 'panel_width'] as const).map((key, i) => <label key={key} className="flex items-center justify-between gap-3 text-sm">{['PPD 字号', '每行子图数', '子图间留白(px)', '每张子图宽度(px)'][i]}<InputNumber min={[12, 1, 0, 128][i]} max={[96, 8, 120, 2048][i]} value={value[key]} onChange={v => change(key, Math.round(Number(v ?? value[key])))} /></label>)}
  </div>;
}
