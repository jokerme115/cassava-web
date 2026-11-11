"""Normalize interface classes to the shared typography scale, leaving export settings intact."""
from pathlib import Path
import re
root=Path(__file__).resolve().parents[1]
src=root/'网页/front/cassava_front/src'
mapping={13:'text-xs',14:'text-sm',15:'text-base',18:'text-lg',24:'text-2xl',32:'text-3xl',48:'text-5xl'}
report=[]
for path in (src/'components').rglob('*.tsx'):
    if '__tests__' in path.parts: continue
    original=path.read_text(encoding='utf-8'); text=original
    text=re.sub(r'\b(?:xs|sm|md|lg|xl|2xl):text-(?:xs|sm|base|lg|xl|[2-9]xl|\[[0-9.]+(?:px|rem)\])', '', text)
    def fixed(match):
        value=float(match.group(1))*(16 if match.group(2)=='rem' else 1)
        role=min(mapping,key=lambda size:(abs(size-value),-size))
        return mapping[role]
    text=re.sub(r'text-\[([0-9.]+)(px|rem)\]',fixed,text)
    text=text.replace('font-serif','font-sans').replace('font-bold','font-semibold').replace('font-extrabold','font-semibold').replace('font-black','font-semibold')
    text=text.replace('tracking-tighter','tracking-normal').replace('tracking-tight','tracking-normal')
    if path.name=='PageHeader.tsx':text=text.replace('truncate text-xl font-semibold text-ink','page-title truncate')
    if path.name=='ImageManagement.tsx':text=text.replace('cursor-pointer truncate text-xl font-semibold text-ink hover:underline','page-title cursor-pointer truncate hover:underline')
    if path.name=='ContactUs.tsx':
        text=text.replace('relative mt-4 max-w-3xl text-4xl font-semibold tracking-normal', 'page-title relative mt-4 max-w-3xl text-white')
        text=text.replace('mt-2 text-2xl font-semibold text-ink', 'section-title mt-2')
    if path.name=='PredictionModule.tsx':
        text=text.replace('mr-auto inline-flex items-center gap-2 text-base font-semibold', 'section-title mr-auto inline-flex items-center gap-2')
        text=text.replace('<h2 className="text-base font-semibold">', '<h2 className="section-title">')
    if path.name=='HomePage.tsx':
        text=text.replace('text-xl font-semibold tracking-normal">联合研究团队','section-title">联合研究团队')
    if path.name=='CassavaApp.tsx':text=text.replace('mb-3 text-3xl font-semibold','mb-3 text-2xl font-semibold')
    if text!=original:
        path.write_text(text,encoding='utf-8'); report.append(str(path.relative_to(src)))
print('\n'.join(report))
