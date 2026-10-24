# P3-A 更新

沿用 2026-10-24 修复版 `safe-update.sh <本次已推送完整commit>`（typegen → 独立 tsc → 跳过构建内类型检查的单进程构建）。脚本会备份库/附件/配置、停服后按实际可用内存收紧构建堆上限、安装原依赖、生成 Prisma、类型检查失败即回滚，然后增量迁移；健康失败恢复旧代码与构建，保留已迁移数据库。

```bash
APP=/opt/projectmemo/app
TARGET=<本次已推送完整commit>
sudo -H -u projectmemo git -C "$APP" fetch origin codex/r3-runtime-research
sudo -H -u projectmemo git -C "$APP" show "$TARGET:deploy/alibaba-cloud-linux/safe-update.sh" > /tmp/projectmemo-safe-update.sh
bash /tmp/projectmemo-safe-update.sh "$TARGET"
```

迁移 `20261024090000_experience` 只新增 `AgentExperience` / `AgentExperienceUse` 两张表与索引，不改写既有表，不运行 db:setup、seed 或 reset。

新开关 `PROJECT_EXPERIENCE_ENABLED` 默认 true。关闭时停止经验注入与候选同步，委托详情不再显示建议块；已激活状态、样本与历史使用记录保留，重新开启后恢复。经验激活只能由用户在"影子观察"状态下手动发起，服务端不会自动激活任何经验；注入仅为建议文本，不改变任何权限。

更新后核对：
- `curl -s http://127.0.0.1:4400/health` 的 release 为本次 commit；
- 打开任一项目 → 长期委托区，末尾"项目经验历史"可展开，能看到轨迹统计（工程成功/用户采用/行动完成回执/用户自述效果分别计数）；
- 有 ≥2 条同类已采用轨迹的项目会出现"影子观察"条目，点"激活为建议"后委托详情出现"注入中·建议"，"停用此经验"后回到已撤销（保留历史）；
- `PROJECT_EXPERIENCE_ENABLED=false` 重启后建议块消失、再次开启后恢复。

真实模型下的建议有效性未验收；不要把"经验已激活"解释为任务成功率提升。

ECS 更新只覆盖 Web/共享后端。鸿蒙需另行安装本轮 HAP 后在设备上验收同一入口；构建成功不代表设备已更新。
