# P3-B 更新

## 2026-10-24 复查修复版本

本轮发布包含 7 类复查修复和 Web/鸿蒙 GitHub 入口。验证：108 文件/882 测试、14 E2E、tsc/lint、83 鸿蒙测试通过，HAP 构建通过；完整证据见 `evidence/fix-p3-review-20261024/REPORT.md`。

新增迁移 `20261024120000_p3_review_boundaries`：经验唯一键增加用户归属，过滤旧派生经验中可能混入的异主样本；不足两条自有样本的 ACTIVE/SHADOW 回到候选，原 Mission、资料及 Use 历史保留。另新增连接 revision、分页续取字段与采纳命令回执。`safe-update.sh` 会在停服备份、构建通过后执行增量迁移；不能省略迁移或用 seed/reset 代替。

Web 入口：项目概览上方「GitHub 仓库」→资料页直接展开连接表单。鸿蒙入口：项目概览或资料页「GitHub 仓库」；需安装新 HAP。首次建立最近 30 条基线，后续每次最多四页，PARTIAL 时继续刷新完成剩余范围。

ECS 仍使用下面的版本绑定更新方式，更新命令中的 TARGET 必须是本次已经推送的完整 commit。上线后核对 health.release、两个服务 active，以及 Prisma 迁移输出。构建失败的回滚保留已执行的增量迁移，不会自动覆盖生产数据库。

沿用 2026-10-24 修复版 `safe-update.sh <本次已推送完整commit>`（typegen → 独立 tsc（堆下限 1280 MiB）→ 跳过构建内类型检查的单进程构建）。执行方式见下方统一入口。

日常发布统一使用 [ECS 更新命令](README.md#更新发布已部署机器)：在 root 终端用 heredoc、`mktemp` 提取目标提交的脚本，失败立即停止并清理临时文件。代码发布后另按 [Focus 开关与验收](FOCUS_UPDATE.md) 核对环境配置。

此前基线迁移 `20261024100000_repo_sensing` 新增 `SourceConnection` / `ExternalSignal`；本次同时应用上方复查迁移。不运行 db:setup、seed 或 reset。

开关 `REPO_SENSING_ENABLED` 默认 true。服务器只在用户于资料页点"创建并首次刷新/刷新"时匿名请求 api.github.com，无后台轮询，不承诺匿名 304 免配额。关闭开关或撤销连接停止新请求，提交阶段重查连接 revision/授权，历史保留。

前置实测（2026-10-24，ECS 上）：`api.github.com` HTTPS 可达（HTTP/2，东南亚边缘）；匿名 core 限额 60/小时、remaining 60；公开仓库 commits JSON 可读。注意 GitHub API 对 HEAD 请求一律回 404，验证请用 GET。

更新后核对：
- `health.release` 为本次 commit；
- 项目概览 →「GitHub 仓库」→ 输入 `owner/repo`（ref 留空默认 main 或按需）→ 创建并首次刷新，应出现候选提交列表（含 sha、作者、外链）；这一步会创建连接和候选，仅在自己的演示项目中手动验收；
- 点"采纳为项目资料"后状态变已采纳且显示"已写入资料记录"；行动状态不被改变；
- 撤销连接后再点刷新被拒绝（409），不发任何新请求；
- `REPO_SENSING_ENABLED=false` 重启后接口返回未开启；重新开启后历史仍在。

被限流（429）时面板显示"被限流"，不影响其他功能；等限额窗口恢复后手动刷新即可。
