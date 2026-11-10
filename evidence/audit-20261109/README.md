# 2026-11-09 全面排查回执

- 数据来源：每次运行新建的临时 SQLite 库，迁移重放后写入构造数据，未访问开发库或线上库。
- 模型：mock（`LLM_MODE=mock`），未调用真实模型，未写入外部日历。
- `before-fix.log`：修复前的 `tests/auditRegression20261109.test.ts` 结果，失败即复现。
- `full-after-fix.log`：修复后的全量 vitest 结果。
- 两进程 SQLite 争用（临时库，每轮 4 秒）：
  - DELETE + `BEGIN`：成功 783，`SQLITE_BUSY` 168
  - WAL + `BEGIN`：成功 59969，`SQLITE_BUSY` 7519
  - WAL + `BEGIN IMMEDIATE`：成功 101542，`SQLITE_BUSY` 0
- 未覆盖：ECS 实际环境、真机后台提醒、真实模型超时、备份脚本在 Linux 上的完整运行。

## 第二轮

- `full-after-second-pass.log`：第二轮修复后的全量 vitest 结果，2022 条通过；同样使用临时库和 mock，未访问开发库或线上库，未调用真实模型。
- 鸿蒙单元测试 155 条通过；Web 构建和 E2E 通过（E2E 使用 `scripts/e2e-env.ts` 隔离库）。
- 旧库升级：dev、p1-acceptance、harmony-ux2、preview 四份副本的临时拷贝升级到 53 条迁移，integrity ok，外键 0 问题。
- 未覆盖：真机日历写入和日期显示、ECS 上的 Worker unit、真实小艺调用。
