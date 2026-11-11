"""Apply the eight browser feedback items, preserving pre-edit component copies."""
from pathlib import Path
import shutil

root = Path(__file__).resolve().parents[1]
components = root/'网页/front/cassava_front/src/components'
backup = root/'notes/ui-feedback-before-20261030'
backup.mkdir(exist_ok=True)
for name in ['HomePage.tsx', 'LoginPage.tsx', 'ImageManagement.tsx', 'PredictionModule.tsx']:
    if not (backup/name).exists():
        shutil.copy2(components/name, backup/name)

path = components/'HomePage.tsx'
s = path.read_text(encoding='utf-8')
start = s.index('  const strengths = [')
end = s.index('  const researchBlocks = [', start)
s = s[:start]+'''  const strengths = [
    { icon: Brain, title: '资料归档', value: '原图与拍摄信息', tags: ['文件夹', 'ZIP / 7Z / RAR'], mark: '01' },
    { icon: BarChart3, title: '批量分析', value: '模型队列', tags: ['批量预测', '后台处理'], mark: '02' },
    { icon: Shield, title: '人工复检', value: '逐像素校正', tags: ['双层掩码', '修订留存'], mark: '03' },
    { icon: Globe2, title: '成果导出', value: '图像与数值', tags: ['轮廓成图', 'CSV / Excel / ZIP'], mark: '04' },
  ];

'''+s[end:]
start = s.index('        {/* 四项能力')
end = s.index('        {/* CTA */}', start)
s = s[:start]+'''        <section aria-label="平台功能" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {strengths.map(item => <article key={item.title} className="home-capability relative overflow-hidden rounded-[20px] border border-hairline bg-white p-5 sm:p-6">
            <div className="flex items-center justify-between"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-muted text-brand-fill"><item.icon className="h-5 w-5" /></span><span className="font-serif text-sm text-muted/60">{item.mark}</span></div>
            <p className="mt-5 text-xs font-medium tracking-widest text-muted">{item.title}</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-ink">{item.value}</h2>
            <div className="mt-5 flex flex-wrap gap-x-3 gap-y-2 border-t border-hairline pt-4 text-xs text-ink-secondary">{item.tags.map(tag => <span key={tag}>{tag}</span>)}</div>
          </article>)}
        </section>

        <section aria-label="联合研究团队">
          <div className="mb-5 flex items-center justify-between"><h2 className="text-xl font-semibold tracking-tight">联合研究团队</h2><button onClick={() => onSectionChange('contact')} className="inline-flex items-center gap-2 text-sm font-medium text-accent-text">了解团队<ArrowRight className="h-4 w-4" /></button></div>
          <div className="grid gap-5 lg:grid-cols-2">
            {researchBlocks.map((block, index) => <article key={block.title} className="grid overflow-hidden rounded-[22px] border border-hairline bg-white sm:grid-cols-[132px_minmax(0,1fr)]">
              <div className="relative flex min-h-[150px] items-center justify-center overflow-hidden bg-surface-muted">
                {index === 0 ? <img src="/cases/cassava-lab.jpg" alt="木薯切面实验照片" loading="lazy" className="h-full w-full object-cover" /> : <img src="/assets/logo-128.webp" alt="联合研究标识" loading="lazy" className="h-20 w-20 object-contain" />}
              </div>
              <div className="flex flex-col p-5 sm:p-6"><p className="text-xs font-medium tracking-wider text-accent-text">{index === 0 ? '中国热带农业科学院' : '海南师范大学'}</p><h3 className="mt-3 text-lg font-semibold leading-relaxed text-ink">{block.title}</h3><div className="mt-5 flex flex-wrap gap-2">{(index === 0 ? ['种质资源', '品种选育', '田间研究'] : ['计算机视觉', '人工智能', '科研协作']).map(tag => <span key={tag} className="rounded-md bg-surface-muted px-2 py-1 text-xs text-ink-secondary">{tag}</span>)}</div></div>
            </article>)}
          </div>
        </section>

'''+s[end:]
s = s.replace("  const cardClass = 'rounded-[20px] border border-hairline bg-white shadow-[0_6px_24px_rgba(28,56,39,0.035)]';\n", '')
path.write_text(s, encoding='utf-8')

path = components/'LoginPage.tsx'
s = path.read_text(encoding='utf-8').replace('ArrowRight, Lock, Sparkles, User2', 'ArrowRight, Lock, User2')
start = s.index('    <div className="min-h-[calc(100vh-92px)]')
end = s.index('            {loginError && (', start)
s = s[:start]+'''    <div className="login-page flex min-h-full items-center justify-center bg-surface-muted px-4 py-6 sm:px-8">
      <div className="login-shell grid w-full max-w-[1040px] overflow-hidden rounded-[28px] border border-hairline bg-white shadow-[0_16px_60px_rgba(27,60,43,0.07)] lg:grid-cols-[1fr_1fr]">
        <section aria-label="木薯研究工作台" className="login-visual relative hidden min-h-[580px] overflow-hidden bg-brand-fill text-white lg:flex lg:flex-col lg:justify-between">
          <img src="/cases/ppd-example.png" alt="木薯切面轮廓图" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(15,46,34,.35),rgba(15,46,34,.05)_40%,rgba(15,46,34,.95))]" />
          <div className="relative flex items-center gap-3 p-8"><img src="/assets/logo-128.webp" alt="" className="h-10 w-10 rounded-full bg-white" /><span className="text-xs font-medium tracking-[.2em]">CASSAVA LAB</span></div>
          <div className="relative p-9"><p className="text-xs tracking-[.2em] text-white/70">CASSAVA · PPD</p><h1 className="mt-4 font-serif text-4xl leading-snug">木薯图像<br />研究工作台</h1><div className="mt-7 h-px w-12 bg-white/40" /><p className="mt-5 text-xs leading-6 text-white/75">中国热带农业科学院<br />海南师范大学</p></div>
        </section>
        <section className="flex flex-col justify-center px-6 py-8 sm:px-10 lg:px-12 lg:py-10">
          <div className="flex h-full flex-col justify-center">
            <div className="mb-7"><p className="mb-2 text-xs font-medium tracking-[.2em] text-accent-text lg:hidden">CASSAVA LAB</p><h2 className="text-2xl font-semibold tracking-tight text-ink">{t('login.sign_in')}</h2></div>
'''+s[end:]
s = s.replace('className="my-8 flex items-center gap-4"', 'className="my-5 flex items-center gap-4"')
s = s.replace('rounded-full card px-5', 'rounded-xl border border-hairline bg-white px-5')
s = s.replace('rounded-full bg-brand-fill px-5', 'rounded-xl bg-brand-fill px-5')
s = s.replace('rounded-2xl border border-hairline bg-white pl-11', 'rounded-xl border border-hairline bg-white pl-11')
path.write_text(s, encoding='utf-8')

path = components/'PredictionModule.tsx'
s = path.read_text(encoding='utf-8')
advanced_start = s.index('              {showAdvanced && (')
advanced_end = s.index('                </fieldset>', advanced_start)+len('                </fieldset>\n              )}')
advanced = s[advanced_start:advanced_end]
s = s.replace('Brain, Play, Image as ImageIcon, FolderOpen, Zap, Search', 'Play, Image as ImageIcon, FolderOpen, Search').replace("import PageHeader from './PageHeader';\n", '')
s = s.replace("  const selectionType = 'images';\n", '').replace("  const [showNameModal, setShowNameModal] = useState(false);\n", '').replace("  const [pendingPayload, setPendingPayload] = useState<any>(null);\n", '')
s = s.replace("  // Monitor language changes, update model descriptions\n  useEffect(() => {\n  }, [t]);\n", '')
start = s.index('  // 一键提交：')
s = s[:start]+'''  const folderOnlySelection = Boolean(selectedRealFolder) && selectedItems.length === 0;
  const folderImageCount = folders.filter(folder => selectedFolderAndDescendants?.has(String(folder.id))).reduce((sum, folder) => sum + folder.imageCount, 0);
  const summaryImageCount = folderOnlySelection ? folderImageCount : selectedItems.length;
  const submitTask = async (payload: any) => {
    if (submittingRef.current) return;
    if (!taskName.trim()) { setError('请输入任务名称'); return; }
    submittingRef.current = true; setLoading(true); setError(null);
    try {
      const created = await createTask({ ...payload, name: taskName.trim() });
      updateWorkspace({ selectedIds: [] }); setSelectedItems([]);
      message.success(t('prediction.task_created'));
      if (created?.id) navigate(`/tasks?task=${created.id}`);
    } catch (caught: any) {
      const detail = getApiErrorMessage(caught, t('prediction.create_task_failed'));
      setError(detail); message.error(detail);
    } finally { submittingRef.current = false; setLoading(false); }
  };
  const handleStartFolderPrediction = () => {
    if (selectedRealFolder && selectedFolderAndDescendants) void submitTask(buildTaskPayload('folders', Array.from(selectedFolderAndDescendants), folderImageCount));
  };
  const handleStartPrediction = () => {
    if (folderOnlySelection) { handleStartFolderPrediction(); return; }
    if (!selectedItems.length) return;
    void submitTask(buildTaskPayload('images', selectedItems, selectedItems.length));
  };
  const chooseFolder = (key: string) => {
    setSelectedItems([]);
    setSelectedFolder(key === ALL_NODE_VALUE ? null : key === UNCATEGORIZED_NODE_VALUE ? 'uncategorized' : key);
  };
  const pageSelected = filteredImages.length > 0 && filteredImages.every(image => selectedItems.includes(image.id));

  return (
    <div className="prediction-workbench h-full min-h-0 p-3 sm:p-4">
      <div className="prediction-columns grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-label="选择图片" className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-hairline bg-white">
          <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-hairline px-4 py-3">
            <h2 className="mr-auto inline-flex items-center gap-2 text-base font-semibold"><ImageIcon className="h-4 w-4 text-brand-fill" />选择图片</h2>
            <span className="text-xs tabular-nums text-muted">{selectedItems.length ? `已选 ${selectedItems.length} 张` : `${totalImages} 张`}</span>
            {selectedItems.length > 0 && <button onClick={() => setSelectedItems([])} className="text-xs text-accent-text">清空选择</button>}
          </header>
          <div className="flex min-h-0 flex-1">
            <aside ref={folderTreeRef} className="hidden w-[170px] shrink-0 overflow-y-auto border-r border-hairline p-2 sm:block">
              <p className="mb-2 flex items-center gap-2 px-2 py-2 text-xs font-medium text-muted"><FolderOpen className="h-3.5 w-3.5" />文件夹</p>
              <Tree className="folder-tree prediction-folder-tree" treeData={folderTreeData} selectedKeys={selectedFolderTreeKeys} defaultExpandAll blockNode
                titleRender={(node: any) => <span className="flex min-w-0 items-center justify-between gap-2"><span className="truncate">{node.name ?? node.title}</span>{node.count !== undefined && <span className="text-[10px] tabular-nums opacity-60">{node.count}</span>}</span>}
                onSelect={keys => { if (keys[0]) chooseFolder(String(keys[0])); }} />
            </aside>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-hairline p-3">
                <div className="relative min-w-[120px] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><input id="prediction-search-images" name="prediction-search-images" type="search" placeholder={t('images.search')} value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="h-9 w-full rounded-lg border border-hairline bg-surface-muted pl-9 pr-3 text-sm outline-none focus:border-accent-line" /></div>
                <select aria-label={t('a11y.sort_by')} value={sortBy} onChange={e => setSortBy(e.target.value as any)} className="h-9 max-w-[140px] rounded-lg bg-transparent px-2 text-xs text-ink-secondary"><option value="date">{t('images.sort.date')}</option><option value="name">{t('images.sort.name')}</option><option value="size">{t('images.sort.size')}</option></select>
                <button onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')} aria-label={t('a11y.sort_order')} className="rounded-lg p-2 text-muted hover:bg-surface-muted">{sortOrder === 'asc' ? <SortAsc className="h-4 w-4" /> : <SortDesc className="h-4 w-4" />}</button>
                <button onClick={() => setSelectedItems(pageSelected ? selectedItems.filter(id => !filteredImages.some(image => image.id === id)) : [...new Set([...selectedItems, ...filteredImages.map(image => image.id)])])} aria-pressed={pageSelected} className="h-9 rounded-lg border border-hairline px-3 text-xs text-accent-text">{pageSelected ? '取消本页' : `全选本页 (${filteredImages.length})`}</button>
                <select aria-label="选择文件夹" className="h-9 w-full rounded-lg border border-hairline bg-white px-2 text-sm sm:hidden" value={selectedFolderTreeKeys[0]} onChange={e => chooseFolder(e.target.value)}><option value={ALL_NODE_VALUE}>{t('images.all_images')}</option><option value={UNCATEGORIZED_NODE_VALUE}>{t('images.uncategorized')}</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select>
              </div>
              <div className="prediction-image-scroll min-h-0 flex-1 overflow-y-auto p-3">
                {imagesLoading ? <div className="flex h-40 items-center justify-center text-sm text-muted">加载中…</div> : !filteredImages.length ? <div className="flex h-40 items-center justify-center text-sm text-muted">没有匹配的图片</div> : <div className="grid grid-cols-1 gap-2 min-[1200px]:grid-cols-2 2xl:grid-cols-3">
                  {filteredImages.map(image => <label key={image.id} className={`flex min-w-0 cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors ${selectedItems.includes(image.id) ? 'border-accent-line bg-surface-muted' : 'border-hairline hover:bg-surface-muted'}`}>
                    <input name={`prediction-image-${image.id}`} aria-label={`选择 ${image.name}`} type="checkbox" checked={selectedItems.includes(image.id)} onChange={e => handleItemSelect(image.id, e.target.checked)} className="h-4 w-4 shrink-0 accent-[#245b45]" />
                    <img src={image.preview_url || image.image_url || image.url} alt={image.name} loading="lazy" className="h-16 w-16 shrink-0 rounded-lg bg-surface-muted object-cover" />
                    <div className="min-w-0"><p className="truncate text-sm font-medium text-ink" title={image.name}>{image.name}</p><ImageResolutionLabel width={image.pixel_width} height={image.pixel_height} /></div>
                  </label>)}
                </div>}
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-hairline px-3 py-2"><span className="text-xs text-muted">共 {totalImages} 张</span><Pagination current={imagesPage} pageSize={imagesPageSize} total={totalImages} showSizeChanger={false} size="small" onChange={page => void goToImagesPage(page)} /></div>
            </div>
          </div>
        </section>

        <aside aria-label="任务配置" className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-hairline bg-white">
          <header className="flex shrink-0 items-center gap-2 border-b border-hairline px-5 py-3"><SlidersHorizontal className="h-4 w-4 text-brand-fill" /><h2 className="text-base font-semibold">{t('prediction.configuration')}</h2></header>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
            <div><label htmlFor="prediction-task-name" className="mb-2 block text-xs font-medium text-ink-secondary">{t('prediction.task_name')}</label><input id="prediction-task-name" name="prediction-task-name" value={taskName} onChange={e => setTaskName(e.target.value)} maxLength={50} className="h-10 w-full rounded-lg border border-hairline px-3 text-sm outline-none focus:border-accent-line" /></div>
            <div><label htmlFor="prediction-mode" className="mb-2 block text-xs font-medium text-ink-secondary">{t('prediction.prediction_mode')}</label><div className="flex rounded-lg bg-surface-muted p-1">{(['single','ensemble'] as const).map(mode => <button key={mode} id={mode === 'single' ? 'prediction-mode' : undefined} aria-pressed={predictionMode === mode} onClick={() => setPredictionMode(mode)} className={`flex-1 rounded-md py-2 text-xs ${predictionMode === mode ? 'bg-white font-medium text-ink shadow-sm' : 'text-muted'}`}>{mode === 'single' ? t('prediction.mode.single') : '投票模型'}</button>)}</div></div>
            <div><label htmlFor="prediction-model-type" className="mb-2 block text-xs font-medium text-ink-secondary">{t('prediction.model')}</label><select id="prediction-model-type" name="prediction-model-type" disabled={predictionMode === 'ensemble'} value={predictionMode === 'ensemble' ? 'ensemble' : modelType} onChange={e => setModelType(e.target.value)} className="h-10 w-full rounded-lg border border-hairline bg-white px-2 text-xs disabled:bg-surface-muted">{predictionMode === 'ensemble' && <option value="ensemble">DeepLab-R101 + M6 投票</option>}{modelOptions.filter(option => option.value !== 'ensemble').map(option => <option key={option.value} value={option.value} disabled={!option.available}>{option.label}{!option.available ? ` · ${option.reason}` : ''}</option>)}</select>
              {predictionMode === 'single' && <details className="mt-2 text-xs text-muted"><summary className="cursor-pointer">版本与权重</summary><p className="mt-2">{modelOptions.find(item => item.value === modelType)?.weightSource}</p>{modelOptions.find(item => item.value === modelType)?.members?.map(member => <p key={member.file} className="mt-1 break-all" title={member.sha256}>{member.file} · {member.sha256.slice(0,12)}</p>)}</details>}
            </div>
            <div><div className="mb-2 flex justify-between text-xs"><label htmlFor="prediction-confidence-threshold">{t('prediction.confidence_threshold')}</label><span className="tabular-nums text-muted">{advancedParams.confidenceThreshold.toFixed(2)}</span></div><input id="prediction-confidence-threshold" type="range" disabled={frozenProtocol} min="0.1" max="1" step="0.1" value={advancedParams.confidenceThreshold} onChange={e => setAdvancedParams(previous => ({...previous, confidenceThreshold:Number(e.target.value)}))} className="w-full accent-[#245b45]" /></div>
            <button onClick={() => setShowAdvanced(!showAdvanced)} aria-expanded={showAdvanced} className="flex items-center gap-2 text-xs text-accent-text"><SlidersHorizontal className="h-3.5 w-3.5" />{showAdvanced ? t('prediction.advanced_settings.hide') : t('prediction.advanced_settings.show')}</button>
'''+advanced+'''
          </div>
          <footer className="shrink-0 border-t border-hairline bg-surface-muted p-4">
            <div className="mb-3 flex items-center justify-between gap-2 text-xs"><span className="min-w-0 truncate text-muted">{folderOnlySelection ? selectedRealFolder?.name : '已选择'}</span><strong className="shrink-0 tabular-nums">{summaryImageCount} 张</strong></div>
            {error && <p role="alert" className="mb-3 text-xs text-danger-text">{error}</p>}
            <button onClick={handleStartPrediction} disabled={!summaryImageCount || loading} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-fill text-sm font-medium text-white transition hover:bg-brand-fill-hover disabled:cursor-not-allowed disabled:opacity-40"><Play className="h-4 w-4" />{loading ? '正在创建…' : t('prediction.create_task')}</button>
            {selectedRealFolder && selectedItems.length > 0 && <button onClick={handleStartFolderPrediction} disabled={loading || !folderImageCount} className="mt-2 w-full py-1 text-xs text-accent-text">{t('prediction.submit_folder', {name:selectedRealFolder.name,count:folderImageCount})}</button>}
            {selectedRealFolder && !selectedItems.length && <button onClick={handleStartFolderPrediction} disabled={loading || !folderImageCount} className="sr-only">{t('prediction.submit_folder', {name:selectedRealFolder.name,count:folderImageCount})}</button>}
          </footer>
        </aside>
      </div>
    </div>
  );
};

export default PredictionModule;
'''
path.write_text(s,encoding='utf-8')
print('Homepage, login and prediction layouts updated; prior component copies retained.')
