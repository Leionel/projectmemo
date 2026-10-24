# P3-B 更新

沿用 2026-10-24 修复版 `safe-update.sh <本次已推送完整commit>`（typegen → 独立 tsc（堆下限 1280 MiB）→ 跳过构建内类型检查的单进程构建）。命令与 P3_UPDATE.md 相同：

```bash
APP=/opt/projectmemo/app
TARGET=<本次已推送完整commit>
sudo -H -u projectmemo git -C "$APP" fetch origin codex/r3-runtime-research
sudo -H -u projectmemo git -C "$APP" show "$TARGET:deploy/alibaba-cloud-linux/safe-update.sh" > /tmp/projectmemo-safe-update.sh
bash /tmp/projectmemo-safe-update.sh "$TARGET"
```

迁移 `20261024100000_repo_sensing` 只新增 `SourceConnection` / `ExternalSignal` 两张表与索引，不改写既有表。不运行 db:setup、seed 或 reset。

新开关 `REPO_SENSING_ENABLED` 默认 true。服务器只在用户于资料页点"创建并首次刷新/刷新"时匿名请求 api.github.com（无后台轮询；304 条件请求不计限额）；关闭开关或撤销连接立即停止新请求，历史保留。

前置实测（2026-10-24，ECS 上）：`api.github.com` HTTPS 可达（HTTP/2，东南亚边缘）；匿名 core 限额 60/小时、remaining 60；公开仓库 commits JSON 可读。注意 GitHub API 对 HEAD 请求一律回 404，验证请用 GET。

更新后核对：
- `health.release` 为本次 commit；
- 演示账号新建演示项目 → 资料页 → 展开"仓库信号（外部候选）" → 输入 `Leionel/luojia-math-tutor-skill`（ref 留空默认 main 或按需）→ 创建并首次刷新，应出现候选提交列表（含 sha、作者、外链）；
- 点"采纳为项目资料"后状态变已采纳且显示"已写入资料记录"；行动状态不被改变；
- 撤销连接后再点刷新被拒绝（409），不发任何新请求；
- `REPO_SENSING_ENABLED=false` 重启后接口返回未开启；重新开启后历史仍在。

被限流（429）时面板显示"被限流"，不影响其他功能；等限额窗口恢复后手动刷新即可。
