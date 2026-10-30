# GitHub 同步说明

私有仓库：https://github.com/jokerme115/cassava-web

远端默认分支 main。本地原开发分支 main 含有早期数据库备份，因此采用单独的 github-main 发布分支，保存当前源码快照，不携带原始历史中的数据库。原分支、文件和暂存区保留，旧仓库 jokerme115/cassava 不受影响。

在项目根目录执行下列命令可重新筛选当前文件、创建发布提交并同步：

```powershell
.venv-backend/Scripts/python.exe notes/publish_github_snapshot_20261030.py
```

脚本使用系统现有 Git Credential Manager 凭据；不会把令牌写入文件。筛选后加入源码、文档、网页资源和字体许可证，排除环境配置、数据库及其备份、模型权重、依赖环境、历史构建、浏览器状态、归档与 Office 文件。本地文件不会被删除。

发布提交会接续 github-main 历史，推送目标为 github/main；脚本不使用强制推送。如果远端已有其他人的更新导致推送被拒绝，应先检查差异再整合。不要直接将原开发分支 main 或所有本地分支推到远端。

每次清单与校验结果保存在忽略的 output/github-publish-manifest.json 和 output/github-publish-proof.json。网页运行说明见 docs/2026-10-30-网页版升级交付说明.md；数据库、权重和本机环境需要单独准备。
