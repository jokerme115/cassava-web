import { useState, type ReactNode } from 'react';
import { ArrowRight, Check, Folder, Image as ImageIcon, Layers3, SlidersHorizontal } from 'lucide-react';
import type { UserPreferences } from '../utils/userPreferences';
import { referenceStyle, type FigureStyle } from '../utils/exportStyle';

export function PreviewFrame({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  return <aside className={`settings-preview${expanded ? ' is-expanded' : ''}`} aria-label={title}><header><span className="preview-live-dot" />效果预览<span className="preview-panel-title">{title}</span><button type="button" className="preview-mobile-toggle" aria-label={`${expanded ? '收起' : '展开'}${title}预览`} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '收起' : '展开'}</button></header><div className="settings-preview-content">{children}</div>{footer && <footer>{footer}</footer>}</aside>;
}

export function DraftStatus({ values, saved }: { values: Record<string, unknown>; saved: object }) {
  const baseline = saved as Record<string, unknown>;
  const count = Object.keys(values).filter(key => values[key] !== undefined && JSON.stringify(values[key]) !== JSON.stringify(baseline[key])).length;
  return <span className={`settings-draft-status${count ? ' is-dirty' : ''}`} role="status">{count ? <><span className="preview-live-dot" />{count} 项更改待保存</> : <><Check size={14} />与已保存设置一致</>}</span>;
}

const outline = 'M232 231 Q231 183 279 169 Q324 154 355 183 Q387 210 383 256 Q380 300 343 312 Q294 330 258 299 Q229 275 232 231Z';
const lesions = ['M268 218L279 211 285 220 281 232 270 230Z', 'M322 272L334 267 343 276 336 287 325 285Z', 'M346 202L354 197 359 204 354 213 348 210Z'];
export function SampleSlice({ style = referenceStyle, preferences, vertices = false, overlays = true }: { style?: FigureStyle; preferences?: UserPreferences; vertices?: boolean; overlays?: boolean }) {
  const p = preferences;
  return <svg viewBox="170 125 275 225" role="img" aria-label="木薯切面效果示例" className="preview-slice">
    <image href="/cases/cassava-lab.jpg" width="600" height="450" />
    {p?.editorDimOutside && <path d={`M0 0H600V450H0Z ${outline}`} fill="black" fillOpacity=".45" fillRule="evenodd" />}
    {overlays && (!p || p.editorShowCassava) && <path d={outline} stroke={style.cassava_color} strokeWidth={style.cassava_line_width} fill={style.cassava_color} fillOpacity={p ? p.cassavaOpacity : style.cassava_fill ? style.cassava_opacity : 0} />}
    {overlays && (!p || p.editorShowRotten) && lesions.map(d => <path key={d} d={d} stroke={style.rotten_color} strokeWidth={style.rotten_line_width} fill={style.rotten_color} fillOpacity={p ? p.rottenOpacity : style.rotten_fill ? style.rotten_opacity : 0} />)}
    {vertices && p?.editorShowRotten && [[268,218],[279,211],[285,220],[281,232],[270,230]].map(([cx,cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={p.vertexSize} fill="white" stroke="#245c45" strokeWidth=".7" />)}
    {p && <circle cx="310" cy="235" r={p.brushSize / 2} fill="white" fillOpacity=".12" stroke="white" strokeWidth="1" strokeDasharray="3 2" />}
  </svg>;
}

export function EditorSettingsPreview({ value }: { value: UserPreferences }) {
  return <PreviewFrame title="人工复检" footer={<><span>示例轮廓 · 非预测结果</span><span>保存后用于下次打开复检</span></>}>
    <div className={`preview-editor${value.editorTheme === 'dark' ? ' is-dark' : ''}`}>
      <div className="preview-mini-toolbar"><Layers3 size={14} /><span>木薯范围</span><i />病斑范围<span className="ml-auto">{value.editorResetZoom ? '适应窗口' : '保留视野'}</span></div>
      <div className={`preview-editor-stage${!value.editorResetZoom ? ' is-zoomed' : ''}`}><SampleSlice preferences={value} vertices /></div>
      <div className="preview-editor-values"><span>画笔 <b data-testid="brush-preview">{value.brushSize}px</b></span><span>顶点 <b>{value.vertexSize}px</b></span><span>主体 <b>{Math.round(value.cassavaOpacity * 100)}%</b></span><span>病斑 <b>{Math.round(value.rottenOpacity * 100)}%</b></span></div>
      <div className="preview-review-flow"><span>完成复检</span><ArrowRight size={15}/><strong>{value.autoAdvanceReview ? '自动进入下一张' : '停留在当前图片'}</strong></div>
    </div>
  </PreviewFrame>;
}

export function FigureSettingsPreview({ value }: { value: FigureStyle }) {
  const stages = value.stages || ['prediction'];
  const names = { original: '原图', yolo: 'YOLO 子图', prediction: '预测结果' };
  const count = 3;
  const columns = Math.min(count, value.columns);
  return <PreviewFrame title="整张导出图" footer={<><span>组合排版示意 · 非预测结果</span><span>每切面 {value.panel_width}px</span></>}>
    <div className="preview-export-scope">一张图中包含：{stages.map(s => names[s]).join('、')}<span>{value.collage ? '跨照片组合' : '同一张照片的完整结果'}</span></div>
    {Array.from({length: value.collage ? 2 : 1}, (_, photo) => <div key={photo} className={`preview-composite preview-composite--${value.stage_layout || 'rows'}`}>
      {stages.map(stage => <section key={stage} className="preview-composite-block" aria-label={names[stage]}>
        {stage === 'original' ? <div className="preview-original-photo"><div>{[0,1,2].map(i => <SampleSlice key={i} overlays={false}/>)}</div></div> : <div className="preview-figure" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: `${Math.min(20, value.padding / 2)}px`, padding: `${Math.min(20, value.padding / 2)}px` }}>
          {Array.from({ length: count }, (_, i) => <div key={i}><SampleSlice style={value} overlays={stage === 'prediction'}/>{stage === 'prediction' && value.show_ppd && <div style={{ fontSize: `${Math.max(8, Math.min(26, value.font_size * (columns > 1 ? .4 : .6)))}px` }} className="preview-figure-label">PPD = —%</div>}{value.show_filename && <p className="preview-filename">原图{photo+1}_切面{i+1}.jpg</p>}</div>)}
        </div>}
      </section>)}
    </div>)}
    <div className="preview-tags"><span>{stages.map(s => names[s]).join(value.stage_layout === 'columns' ? ' → ' : ' ↓ ')}</span><span>每组子图每行 {value.columns} 张</span></div>
  </PreviewFrame>;
}

const examples = [{ name: '木薯切面_01.jpg', date: '2026-05-18', size: 2.4, folder: '实验一' }, { name: '木薯切面_02.jpg', date: '2026-06-03', size: 1.8, folder: '实验二' }, { name: '木薯切面_03.jpg', date: '2026-05-19', size: 3.2, folder: '实验一' }];
export function ListSettingsPreview({ value }: { value: UserPreferences }) {
  const field = value.listSort === 'name' ? 'name' : value.listSort === 'size' ? 'size' : value.listSort === 'folder' ? 'folder' : 'date';
  const items = [...examples].sort((a,b) => (typeof a[field] === 'number' ? Number(a[field]) - Number(b[field]) : String(a[field]).localeCompare(String(b[field]))) * (value.listOrder === 'asc' ? 1 : -1));
  const groupKey = (date: string) => value.listGroup === 'year' ? date.slice(0,4) : value.listGroup === 'month' ? date.slice(0,7) : date;
  return <PreviewFrame title="图片与列表" footer={<><span>示例图片 · 实际列表保存后生效</span><span>每页 {value.listPageSize} 项</span></>}><div className="preview-list-browser"><div className="preview-browser-path"><Folder size={15}/>我的图片<span className="ml-auto"><SlidersHorizontal size={14}/></span></div>
    <div className={value.listView === 'list' ? 'preview-image-list' : 'preview-image-grid'}>{items.map((item,i) => <div key={item.name} className="preview-image-item">
      {value.listGroup !== 'none' && (i === 0 || groupKey(item.date) !== groupKey(items[i-1].date)) && <div className="preview-group">{groupKey(item.date)}</div>}
      <div className="preview-image-content"><img src="/cases/cassava-lab.jpg" alt="木薯切面示例"/><div><strong>{item.name}</strong><span>{item.date} · {item.size} MB</span></div></div>
    </div>)}</div><div className="preview-mini-pagination">1–{value.listPageSize} 项 <span>‹　<b>1</b>　2　›</span></div></div></PreviewFrame>;
}

export function ImportSettingsPreview({ value }: { value: UserPreferences }) {
  const root = value.importMode === 'new' ? '当前目录 / 木薯实验' : '当前目录';
  return <PreviewFrame title="导入后的目录" footer={<><span>示例：木薯实验.zip / 文件夹</span><span>每次导入仍可调整</span></>}><div className="preview-import-source"><Folder size={26}/><div><strong>木薯实验.zip</strong><span>实验一 / 切面01.jpg<br/>实验二 / 切面02.jpg</span></div><ArrowRight size={19}/></div><div className="preview-folder-tree"><p><Folder size={16}/>{root}</p>{['实验一','实验二'].map((folder,i) => <div key={folder}>{value.preserveHierarchy && <p className="preview-tree-folder"><Folder size={15}/>{folder}</p>}<p className={value.preserveHierarchy ? 'preview-tree-image nested' : 'preview-tree-image'}><ImageIcon size={15}/>切面0{i+1}.jpg</p></div>)}</div></PreviewFrame>;
}
