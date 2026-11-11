from pathlib import Path
import json,urllib.request
base=Path('output/profile-style-20261101')
state=json.loads((base/'browser.private.json').read_text(encoding='utf-8-sig'))
token=state['origins'][0]['localStorage'][0]['value']
req=urllib.request.Request('http://127.0.0.1:8000/api/auth/logout/',data=b'{}',headers={'Authorization':'Token '+token,'Content-Type':'application/json'},method='POST')
with urllib.request.urlopen(req,timeout=15) as reply:
    print('Local verification session revoked:',reply.status)
index=Path(r'C:\Users\Administrator\Desktop\work\INDEX.md')
lines=index.read_text(encoding='utf-8').splitlines()
for i,line in enumerate(lines):
    if line.startswith('| [CAS-WEB '):
        cells=line.split('|')
        cells[2]=cells[2].rstrip()+'；本地用户中心视觉二次修订已对齐前面工作区：统一设计变量、256px深绿选中侧栏、紧凑白色工具栏和表格、底部常驻分页，表单改分区行对齐；6项相关交互及构建通过，桌面和390px手机布局验收通过。 '
        cells[3]=' 刷新本地 /profile 审阅统一风格后的用户中心；本次仅本地调整，后续发布另行确定。原运维待办保持原记录。 '
        cells[4]=' 2026-11-01（本地用户中心及视觉对齐）；2026-10-31 '
        lines[i]='|'.join(cells)
        break
index.write_text('\n'.join(lines)+'\n',encoding='utf-8')
