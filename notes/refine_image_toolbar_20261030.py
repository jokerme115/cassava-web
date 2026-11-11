from pathlib import Path
root = Path(__file__).resolve().parents[1]/'网页/front/cassava_front/src/components'
path = root/'ImageManagement.tsx'
s = path.read_text(encoding='utf-8')
s = s.replace('className="flex items-center justify-between w-full group min-w-0"', 'className="relative flex items-center justify-between w-full group min-w-0"')
s = s.replace('className="flex items-center ml-1 opacity-0 group-hover:opacity-100 transition-opacity"', 'className="absolute right-0 top-0 hidden h-full items-center rounded-md bg-white px-1 shadow-sm group-hover:flex group-focus-within:flex"')
s = s.replace('              <Tree\n', '              <Tree\n                className="folder-tree image-folder-tree"\n')
s = s.replace('draggable={!isGuest && !isSharedWithMeView}', 'draggable={!isGuest && !isSharedWithMeView ? { icon: false } : false}')
start = s.index('              {/* Toolbar: sort / group / view */}')
end = s.index('            <div className="flex items-center space-x-2 flex-wrap">', start)
toolbar = s[start:end]
toolbar = toolbar.replace('flex shrink-0 items-center gap-1 rounded-lg border border-hairline bg-surface-muted p-1', 'image-view-tools flex shrink-0 items-center gap-1')
toolbar = toolbar.replace('rounded-lg border border-hairline-strong px-3 py-1.5 text-sm transition-all duration-200 focus:border-transparent focus:ring-2 focus:ring-accent-line', 'h-9 rounded-md border-0 bg-transparent px-2 text-[13px] text-ink-secondary outline-none hover:bg-surface-muted focus:ring-2 focus:ring-accent-line')
toolbar = toolbar.replace('rounded-lg border border-hairline-strong p-2 transition-all duration-200 hover:border-accent-line hover:text-accent-text', 'rounded-md p-2 text-muted transition-colors hover:bg-surface-muted hover:text-accent-text')
toolbar = toolbar.replace('<div className="flex items-center gap-1">', '<div className="flex items-center gap-0.5 rounded-lg bg-surface-muted p-0.5">')
s = s[:start]+toolbar+s[end:]
s = s.replace('className="mb-3 flex items-center justify-between rounded-lg card px-3 py-2 shadow-sm"', 'className="mb-3 flex min-h-10 flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline pb-3 text-xs"')
s = s.replace('本页全选（{filteredAndSortedImages.length}）', '全选本页')
old = '''                {!isGuest && <Button size="small" type="link" onClick={() => void selectAllMatching()}>选择全部符合条件的 {totalImages} 张</Button>}
                <div className="text-sm text-muted">
                  {t('images.page_items', { count: filteredAndSortedImages.length })}
                </div>'''
new = '''                {selectedImages.length > 0 && <span className="font-medium text-ink">已选 {selectedImages.length} 张</span>}
                {!isGuest && filteredAndSortedImages.every(image => selectedImages.includes(image.id)) && selectedImages.length < totalImages && totalImages > filteredAndSortedImages.length && <button className="text-accent-text hover:underline" onClick={() => void selectAllMatching()}>全选{searchQuery.trim() ? '搜索结果' : selectedFolder === null ? '全部图片' : '当前目录'}（{totalImages} 张）</button>}
                {selectedImages.length > 0 && <button className="text-muted hover:text-ink" onClick={() => setSelectedImages([])}>取消选择</button>}
                <div className="ml-auto text-muted">本页 {filteredAndSortedImages.length} 张 · 共 {totalImages} 张</div>'''
assert old in s
s = s.replace(old,new)
path.write_text(s,encoding='utf-8')
