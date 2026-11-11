"""Prepare locally hosted official Inter and Source Han Sans web subsets."""
import sys
import json
import hashlib
from pathlib import Path
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root/'output/font-build-tools'))
import requests
from fontTools.ttLib import TTFont
from fontTools import subset
from fontTools.varLib.instancer import instantiateVariableFont

sources = root/'output/font-sources'; sources.mkdir(parents=True,exist_ok=True)
target = root/'网页/front/cassava_front/public/fonts'; target.mkdir(exist_ok=True)
urls = {
    'SourceHanSansCN-VF.ttf':'https://raw.githubusercontent.com/adobe-fonts/source-han-sans/release/Variable/TTF/Subset/SourceHanSansCN-VF.ttf',
    'InterVariable.woff2':'https://raw.githubusercontent.com/rsms/inter/master/docs/font-files/InterVariable.woff2',
    'SOURCE_HAN_SANS_LICENSE.txt':'https://raw.githubusercontent.com/adobe-fonts/source-han-sans/release/LICENSE.txt',
    'INTER_LICENSE.txt':'https://raw.githubusercontent.com/rsms/inter/master/LICENSE.txt',
}
for name,url in urls.items():
    path = sources/name
    if not path.exists():
        response = requests.get(url, timeout=180); response.raise_for_status(); path.write_bytes(response.content)
    print(name, path.stat().st_size, flush=True)
for name in ['InterVariable.woff2','SOURCE_HAN_SANS_LICENSE.txt','INTER_LICENSE.txt']:
    (target/name).write_bytes((sources/name).read_bytes())

font = TTFont(sources/'SourceHanSansCN-VF.ttf')
instantiateVariableFont(font, {'wght': (400,600)}, inplace=True)
for record in font['name'].names:
    if record.nameID in (1,3,4,6,16,17,25):
        value = 'CassavaHanSans' if record.nameID in (3,6,25) else 'Cassava Han Sans'
        record.string = value.encode(record.getEncoding(), errors='replace')
prepared = sources/'CassavaHanSans-VF.ttf'; font.save(prepared)
cmap = set(font.getBestCmap())
supported = {cp for cp in cmap if cp >= 0x3000}
common = set()
for first in range(0xB0,0xD8):
    for second in range(0xA1,0xFF):
        try: common.update(map(ord,bytes([first,second]).decode('gb2312')))
        except UnicodeDecodeError: pass
src = root/'网页/front/cassava_front/src'
for path in src.rglob('*'):
    if path.suffix in ('.tsx','.ts','.json','.css'):
        common.update(map(ord,path.read_text(encoding='utf-8')))
common &= supported
remaining = supported-common
def ranges(points):
    spans=[]; start=previous=None
    for point in sorted(points):
        if previous is not None and point!=previous+1:
            spans.append(f'U+{start:X}' if start==previous else f'U+{start:X}-{previous:X}')
            start=point
        if start is None:start=point
        previous=point
    if previous is not None:spans.append(f'U+{start:X}' if start==previous else f'U+{start:X}-{previous:X}')
    return ','.join(spans)
css=['@font-face { font-family: "Inter"; src: url("/fonts/InterVariable.woff2") format("woff2"); font-style: normal; font-weight: 100 900; font-display: swap; }']
report={}
for name,points in [('core',common),('extended',remaining)]:
    instance=TTFont(prepared)
    options=subset.Options(); options.flavor='woff2'; options.layout_features=['*']; options.name_IDs=['*']; options.notdef_outline=True
    tool=subset.Subsetter(options=options); tool.populate(unicodes=points); tool.subset(instance)
    instance.flavor='woff2'; filename=f'cassava-han-sans-{name}.woff2'; instance.save(target/filename)
    css.append(f'@font-face {{ font-family: "Cassava Han Sans"; src: url("/fonts/{filename}") format("woff2"); font-style: normal; font-weight: 400 600; font-display: swap; unicode-range: {ranges(points)}; }}')
    report[name]={'glyphs':len(points),'bytes':(target/filename).stat().st_size,'sha256':hashlib.sha256((target/filename).read_bytes()).hexdigest()}
(target/'fonts.css').write_text('\n'.join(css)+'\n',encoding='utf-8')
(target/'PROVENANCE.json').write_text(json.dumps({'sources':urls,'subsets':report,'family':'Cassava Han Sans, derived from Source Han Sans CN; Latin uses original Inter'},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report),flush=True)
