from pathlib import Path
root = Path(__file__).resolve().parents[1]
index = root.parents[2]/'INDEX.md'
lines = index.read_text(encoding='utf-8').splitlines(keepends=True)
matches = [n for n,line in enumerate(lines) if line.lstrip().startswith('| [CAS-WEB')]
assert len(matches)==1
n = matches[0]
parts = lines[n].split('|')
assert len(parts)==6
marker = '浏览器8项界面反馈修订完成'
if marker not in parts[2]:
    parts[2] = parts[2].rstrip()+'；'+marker+'（首页、登录、目录工具栏、预测双栏工作台），前端41项测试与构建通过，真实任务105完成。见tasks/2026-10-30-浏览器八项界面反馈修订.md '
parts[3] = ' 复核本次界面调整；继续真实科研图人工复检。容量与真机验证边界保留，详见交付说明。 '
parts[4] = ' 2026-10-30 '
lines[n] = '|'.join(parts)
index.write_text(''.join(lines),encoding='utf-8')
print('CAS-WEB three progress fields updated.')
