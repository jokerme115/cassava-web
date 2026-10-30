"""Update only the project's three INDEX progress fields, retaining the old row."""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
path = root.parents[2]/'INDEX.md'
lines = path.read_text(encoding='utf-8').splitlines(keepends=True)
matches = [i for i,line in enumerate(lines) if line.lstrip().startswith('| [CAS-WEB')]
assert len(matches)==1
index = matches[0]
parts = lines[index].split('|')
assert len(parts)==6
backup = root/'notes/2026-10-30-网页版升级前INDEX记录.md'
if not backup.exists():
    backup.write_text('# 升级前 INDEX 记录\n\n'+lines[index], encoding='utf-8')
parts[2] = ' 本地网页版升级已实现并验收：目录/可续传导入/三种压缩包/回收站/模型注册/版本化复检/参考样式导出；后端67、前端40项通过，四类主模型真实CPU推理、千图导入及桌面/移动尺寸流程通过；保留原始数据与历史修订，未发布线上。见项目docs/2026-10-30-网页版升级交付说明.md及tasks/2026-10-29-网页版升级实施记录.md '
parts[3] = ' 使用scripts/Start-Local.ps1启动本地前后端及导入worker；真实科研图逐张复检；如需容量或真机结论，补5GB满载与实体手机/Safari验收。验收数据与暂存文件保留，线上部署和桌面端不在本轮范围；既有线上待办见升级前INDEX归档记录。 '
parts[4] = ' 2026-10-30 '
lines[index] = '|'.join(parts)
path.write_text(''.join(lines), encoding='utf-8')
print('CAS-WEB status, next step and date updated; previous row preserved.')
