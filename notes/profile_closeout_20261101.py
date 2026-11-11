from pathlib import Path
import json, urllib.request
base=Path('output/profile-redesign-20261101')
auth=json.loads((base/'browser-auth.private.json').read_text(encoding='utf-8-sig'))
req=urllib.request.Request('http://127.0.0.1:8000/api/auth/logout/',data=b'{}',headers={'Authorization':'Token '+auth['token'],'Content-Type':'application/json'},method='POST')
with urllib.request.urlopen(req,timeout=15) as reply:
    print('Temporary verification session revoked:',reply.status)
index=Path(r'C:\Users\Administrator\Desktop\work\INDEX.md')
lines=index.read_text(encoding='utf-8').splitlines()
for i,line in enumerate(lines):
    if line.startswith('| [CAS-WEB '):
        fields=line.split('|')
        fields[2]=fields[2].rstrip()+'；2026-11-01 本地用户中心已重设计：账号/管理设置分层，修复角色权限回显、完整保存、成员计数与授权即时生效；工作区偏好接入复检和导出，操作日志统一分页；前端69/后端107项、构建与类型检查通过；本地原6账号/39任务/141结果/22导入保留，未推送或部署。见源代码/tasks/2026-11-01-本地用户中心重设计.md '
        fields[3]=' 本地审阅 /profile 设置、用户、角色和功能权限；验收后再决定是否发布本次修改。原运维待办：'+fields[3].strip()+' '
        fields[4]=' 2026-11-01（本地用户中心）；2026-10-31 '
        lines[i]='|'.join(fields)
        break
else:
    raise RuntimeError('CAS-WEB row not found')
index.write_text('\n'.join(lines)+'\n',encoding='utf-8')
print('INDEX updated')
