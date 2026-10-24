# P2 更新

沿用 `safe-update.sh <本次已推送完整commit>`，不运行模型验收。脚本会备份库/附件/配置、停服后按实际可用内存收紧构建堆上限、安装原依赖、生成 Prisma、`next typegen` 后独立运行 `tsc --noEmit`（失败即回滚），再以单 worker、跳过构建内并行类型检查的方式执行 `next build --webpack`，然后增量迁移；健康失败恢复旧代码与构建，保留已迁移数据库。

```bash
APP=/opt/projectmemo/app
TARGET=<本次已推送完整commit>
sudo -H -u projectmemo git -C "$APP" fetch origin codex/r3-runtime-research
sudo -H -u projectmemo git -C "$APP" show "$TARGET:deploy/alibaba-cloud-linux/safe-update.sh" > /tmp/projectmemo-safe-update.sh
bash /tmp/projectmemo-safe-update.sh "$TARGET"
```

迁移 `20261024020000_goal_decision_impact` 只增加四张表、外键与唯一约束，不改写旧项目或回执。不要执行 db:setup、seed 或 reset。

新开关 `TYPED_IMPACT_ENABLED`、`DECISION_SCENARIOS_ENABLED`、`GOAL_QUESTION_ENABLED` 默认 true。主动展示还需原 `INTERVENTION_BUDGET_ENABLED=true`，沿用 USER 预算/静默。关闭新采用后仍可读历史，已经采用计划的提交保护保持生效。原 MISSION 开关与模型配置不变，不需要新密钥。

更新后核对：health.release、Web/worker active；测试账号对比并采用到同一 Mission，刷新读回同一回执；来源改变使旧预览409；相关材料可回原问题，不知道/稍后/停止/恢复生效；未授权账户不能读取其他人的方案与问题。模型意见默认不勾选，必须沿用原资料许可和预算。

ECS 更新只覆盖 Web/共享后端。鸿蒙要另外安装本轮 HAP 后验收同 ID 旅程；构建成功不代表设备已更新。
