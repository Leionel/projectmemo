# ProjectMemo 开发约定

忆程 ProjectMemo 面向大学生项目学习，以项目记忆、状态变化、提醒和行动复盘为核心。Web 与鸿蒙 ArkTS 客户端共用 Next.js 后端；业务事实以服务端持久数据为准。产品文案、错误提示与示例数据使用简体中文。

## 工作范围与完成条件

- 审查任务先报告可复现问题与证据；方案任务交付文档。实现任务持续完成相关代码、调用方适配和必要验证，不在第一版修改后提前停止。
- 已授权范围内的本地修改、独立测试库验证、修复本次引入的问题及重跑受影响检查可直接进行。设备、凭据或部署条件不足只阻塞相关验收，继续其他可验证工作。
- 保留用户未提交修改及旧验收证据。真实数据清空、不可逆迁移、公开部署、外部写入和付费调用必须落在用户明确授权范围内；普通实现选择不新增审批环节。

## 环境与命令

Node.js 24；Windows PowerShell 使用 `npm.cmd`。依赖安装用 `npm.cmd install`；已有 `.env` 不覆盖。首次数据库初始化涉及迁移和 seed，先核对目标库，不把 `db:setup` 当作修复现有环境的通用命令。

| 任务 | 命令 |
|---|---|
| Web 开发 | `npm.cmd run dev` |
| 鸿蒙本地后端 | `npm.cmd run harmony:backend` |
| 指定测试 | `npm.cmd test -- tests/meetingStateDiff.test.ts`（按改动替换测试文件） |
| 全量单元/集成测试 | `npm.cmd test` |
| 类型 / lint | `npm.cmd exec tsc -- --noEmit` / `npm.cmd run lint` |
| Web 构建 / E2E | `npm.cmd run build` / `npm.cmd run test:e2e` |
| 鸿蒙检查 / HAP 构建 | `npm.cmd run harmony:test` / `npm.cmd run harmony:build` |

按变更风险选检查；文档小改核对命令、链接和差异即可，不要求每次全量构建。跨端契约或发布变更需覆盖相关客户端；已通过的检查只在新修改、失败或未决风险需要时重跑。

## 测试与数据边界

- `vitest.config.ts` 指向独立测试库并关闭文件并行；部分测试切换 `DATABASE_URL` 且共享 Prisma singleton，不直接开启文件并行。
- 新增写入探针在导入 `lib/db.ts` 前设置独立数据库；不要依赖真实开发库或模型凭据。迁移既要能从空库重放，也要能在旧库副本增量升级。
- E2E 的隔离环境见 `scripts/e2e-env.ts`、`scripts/setup-e2e.ts` 和 `scripts/run-e2e.ts`。修改脚本时保留数据库隔离及 Windows 进程清理行为。
- `db:setup` 包含 seed；`db:demo-reset` 会清空项目。命令带 `--confirm` 不等于获得用户删除真实数据的授权。
- 新证据使用新目录，注明数据来源和真实模型/mock；不把密钥、个人数据库或签名私钥写进回执与提交包。

## 业务不变量

- API 契约修改同时核查 Web 调用方及 `harmonyos/entry/src/main/ets/models/`、`services/`。鸿蒙地址来源是 `harmonyos/entry/src/main/ets/common/Constants.ets`，模拟器地址不作为评审设备可访问的证明。
- 重要确认和重试由服务端保证项目归属、提案绑定、幂等与相关源版本校验；前端禁用按钮不能替代持久化约束。业务数据与完成回执原子提交，模型/网络请求放事务外。
- 记忆有效性复用 `lib/memory/temporalLedger.ts` 与相关服务。保留原始 Capture、附件修订和历史快照；归档不改变事实有效性，Unknown 不当作 False，来源存在不等于支持某个结论。
- 行动完成保留 `resultCardId` 的复盘回执链。创建、排程、完成是不同状态；`isSimulated` 数据不计入真实行为和效果。
- 产品内 Copilot/会议提案须经用户确认才应用业务变更；这是产品交互契约，不是要求开发代理每次本地编辑都询问。
- 保留 `AgentRun` 的 provider、状态与失败/降级原因。规则/mock 模式不需要模型 API，但鸿蒙仍依赖后端；不能据此宣称手机完全离线可用。

## 代码入口

- `app/api/`：参数校验、服务调用及 `lib/api.ts` 错误映射；使用 SQLite 原生模块的服务运行在 Node.js runtime。
- `lib/services/`、`lib/repositories/`：用例编排与数据访问；沿用相邻模块边界，不为本次小改统一重构全库。
- `lib/types.ts`、`lib/types/`：共享契约；`prisma/schema.prisma`、`prisma/migrations/`：持久化契约。
- Prisma 生成目录是 `lib/generated/prisma`；客户端从 `@/lib/generated/prisma/client` 导入，不改用 `@prisma/client`。

## 按任务读取

- 环境启动和构建：查 `package.json`、`README.md` 相关章节及实际脚本；旧文档与代码不一致时先核实。
- 九项能力完善或阶段执行：查 [完善方案](PROJECTMEMO_IMPROVEMENT_PLAN_2026-09-14.md) 的对应批次及 [实施记录](PROJECTMEMO_IMPROVEMENT_NOTES_2026-09-14.md)，不因文件存在就自动执行全部路线图。
- 复赛封包、安装或提交：查 [放行清单](REMATCH_SUBMISSION_GATE_2026-09-14.md)。构建成功、设备安装、平台联调、提交成功分别提供证据；unsigned HAP 不等于最终交付。
- 缺陷复查：按任务查相关审查报告和 `evidence/` 回执；历史 PASS、测试数量和截图不是当前版本状态。

实现收尾说明实际改变、执行过的验证及剩余限制。按计划执行时更新相应实施记录；不为每个小改强制生成新报告，也不把阶段进度累积进本文件。
