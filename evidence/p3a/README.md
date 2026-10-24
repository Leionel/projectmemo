# P3-A 验证证据（2026-10-24）

数据来源：本地 Windows 开发机隔离测试库（better-sqlite3 独立文件库，逐迁移重放）；模型为规则/TEST_FIXTURE，本轮真实模型调用 0 次。不包含真实任务效果数据。

## 目录

- `prod-acceptance/`：P2 上线核对（health.release=d618f8c、方案采用/回执读回/幂等重放/影响端点/隔离抽查；问题恢复链路因演示数据无可操作问题未在生产执行，由 P2 本地浏览器验收覆盖）。
- `validation.json`：本轮汇总（命令、退出码、数量、HAP 哈希、开放 Gate）。
- 日志位于仓库 `tmp/p3a-*.log`（不入库，validation.json 记录哈希与关键行）。

## 关键命令与结果

| 检查 | 命令 | 结果 |
|---|---|---|
| 全量单元/集成 | `npm.cmd test` | exit 0；105 文件 / 857 项全过（新增 experienceReuse 15 + experienceNativeContract 1） |
| 冻结任务对照探针 | experienceReuse.test.ts 末段 describe | 通过：建议源自真实样本、不改 goal/成功条件/约束、无禁止式指令、建议块 ≤3 条且总增量 ≤2200 字符 |
| 类型 | `npm.cmd exec tsc -- --noEmit` | exit 0 |
| Lint | `npm.cmd run lint` | 0 错误 0 警告 |
| 鸿蒙单测 | `npm.cmd run harmony:test` | 80/80（新增 experienceContract 3 项） |
| HAP 构建 | `npm.cmd run harmony:build` | 通过；unsigned sha256 `45bb0f558ae9deaca5f1a705d67baf6d2dff2b671ace25476f62a12e5f028378` |
| 迁移空库重放 | `DATABASE_URL=file:./prisma/scratch-replay.db npx prisma migrate deploy` | 全部迁移应用成功（临时库已删） |
| E2E | `npm.cmd run test:e2e` | 见 validation.json（本文件完成时同步） |

## ArkTS 原生契约

tests/experienceNativeContract.test.ts 在 Node VM 中执行真实 `ExperienceService.ets`（@ohos 网络替换为真实 Next 路由）：列表读取轨迹统计 → 激活影子经验 → 再次列表读回 ACTIVE。

## 未验收（保持明确）

- 真实模型下的建议有效性 / 任务成功率 / 过度拒答率 / 负迁移率：未执行留出任务对照。
- 鸿蒙模拟器与真机操作、非开发网络、平台联调：未执行。
- 生产部署：未执行（等本次 ECS 更新）。
