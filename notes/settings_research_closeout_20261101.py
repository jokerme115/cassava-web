from pathlib import Path
p=Path(r'C:\Users\Administrator\Desktop\work\INDEX.md')
lines=p.read_text(encoding='utf-8').splitlines()
for i,line in enumerate(lines):
    if line.startswith('| [CAS-WEB '):
        fields=line.split('|')
        fields[2]=fields[2].rstrip()+'；2026-11-01 全站设置归并调研完成：已对照CVAT/Label Studio官方文档及本地7类模块，形成列表默认值、预测预设、导出模板与连续复检的分批减负建议；仅调研，业务代码及云端未改。见docs/2026-11-01-全站设置归并与流程减负调研.md。 '
        fields[3]=' 审阅设置归并调研，优先列表默认值、预测预设和导出快捷层；再实施连续复检与快捷键。现有本地用户中心已交付，后续发布另行确定，原运维待办保持记录。 '
        fields[4]=' 2026-11-01（设置归并调研、本地用户中心及视觉对齐）；2026-10-31 '
        lines[i]='|'.join(fields)
        break
else: raise RuntimeError('CAS-WEB row missing')
p.write_text('\n'.join(lines)+'\n',encoding='utf-8')
print('Research record and INDEX updated; application unchanged')
