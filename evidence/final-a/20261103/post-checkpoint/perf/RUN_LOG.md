# RUN_LOG — A-新3 量测/回归运行记录（2026-11-03 UTC+8）

- 工作树：`D:\Projects\hongmen-final-a-mission-packet`（分支 `codex/final-a-mission-packet`，HEAD `4b69614` + 本轮未提交改动）。
- 运行时：Node v24.16.0（win32/x64）、better-sqlite3 12.11.1、tsx、Vitest 4.1.12；数据库=每次运行新建的临时 SQLite（WAL，`prisma/migrations/*` 全量重放 52 条迁移/79 表）；`LLM_MODE=mock`，模型/网络调用 0，未启动 Worker。
- 说明：本文件记录**当次实际执行**的命令、退出码与产物；证据 JSON 内另有 `environment`/`checks`/`durationMs` 可独立复核。原始控制台日志在运行机临时目录（未提交），证据以 JSON 为准。

## 1. readback 量测（`scripts/final-a/perf-readback.ts`）

| 阶段 | 命令 | 退出码 | 开始（UTC+8） | 耗时 | 检查 |
|---|---|---|---|---|---|
| BEFORE run1 | `npx.cmd tsx scripts/final-a/perf-readback.ts --phase=BEFORE` | 0 | 2026-11-03 15:13:06 | 5,725 ms | 18/18 |
| BEFORE 主 | 同上 | 0 | 2026-11-03 15:13:18 | 9,393 ms | 18/18 |
| AFTER run1 | `... --phase=AFTER` | 0 | 2026-11-03 15:13:35 | 6,958 ms | 18/18 |
| AFTER 主 | 同上 | 0 | 2026-11-03 15:13:43 | 5,987 ms | 18/18 |
| AFTER2 run1 | `... --phase=AFTER2` | 0 | 2026-11-03 15:14:00 | 6,055 ms | 18/18 |
| AFTER2 主 | 同上 | 0 | 2026-11-03 15:14:10 | 7,492 ms | 18/18 |
| 合并 | `... --merge` | 0 | 2026-11-03 15:14:19 | — | 三阶段均 PROBE_COMPLETED |

产物：
- `readback-perf.json`（BEFORE/AFTER/AFTER2 三栏 + 重复运行对照 + comparison/deltas）
- `runs/readback-perf-{BEFORE,AFTER,AFTER2}.json`（主运行）与 `runs/readback-perf-{...}-run1.json`（重复运行）

阶段代码状态（见证据 `environment.sourceFilesSha256`）：BEFORE=`4b69614` 原始 readback + 仅加只读 `sourcePolicyChecks` 的 materialUseProjection；AFTER=窗口修复 readback（其余同 BEFORE）；AFTER2=最终代码（窗口修复 + 同请求复用）。三阶段同一脚本 sha `eeaa666…`。

## 2. 定向测试（最终代码）

| 命令 | 结果 | 退出码 |
|---|---|---|
| `npm.cmd test -- tests/finalAEvidenceReviewWindow.test.ts` | 5/5 通过 | 0 |
| `npm.cmd test -- tests/continuitySuppression.test.ts tests/ux2SourceBinding.test.ts tests/ux2ClaimSourceRights.test.ts tests/missionMaterialUseProjection.test.ts tests/finalAWorkPacketService.test.ts tests/finalAConcurrencyService.test.ts tests/missionReadbackPanel.test.ts tests/missionNativeContract.test.ts` | 8 文件 61/61 通过 | 0 |
| 完整定向批次（20 文件，见下） | **20 文件 159/159 通过，170.75 s（2026-11-03 15:14:33 起）** | **0** |

完整定向批次文件与用例数：

```
tests/finalAEvidenceReviewWindow.test.ts (5)   tests/finalAConcurrencyService.test.ts (4)
tests/finalAWorkPacketContract.test.ts (34)    tests/finalAWorkPacketService.test.ts (20)
tests/finalAWorkStateContract.test.ts (31)     tests/continuitySuppression.test.ts (2)
tests/missionMaterialUseProjection.test.ts (6) tests/missionEvidenceFitIntegration.test.ts (10)
tests/missionNativeContract.test.ts (15)       tests/missionReadbackPanel.test.ts (4)
tests/ux2ClaimCorrection.test.ts (7)           tests/ux2ClaimSourceRights.test.ts (5)
tests/ux2ConversationDigest.test.ts (1)        tests/ux2CorrectionControls.test.ts (2)
tests/ux2CorrectionRecoordination.test.ts (1)  tests/ux2DigestRuntime.test.ts (1)
tests/ux2HypothesisRuntime.test.ts (3)         tests/ux2InputVersion.test.ts (2)
tests/ux2MigrationUpgrade.test.ts (1)          tests/ux2SourceBinding.test.ts (5)
```

摘要：`Test Files 20 passed (20)` / `Tests 159 passed (159)` / exit 0。

## 3. 类型检查

| 命令 | 结果 | 退出码 |
|---|---|---|
| `npm.cmd exec tsc -- --noEmit` | 0 条诊断（`error TS` 计数 0） | 0 |

## 4. 未运行 / 不宣称

未运行全量 Vitest、`next build`、E2E、hvigor/设备、真实模型、自然日/真人试用；本记录不代表整体放行，也不构成线上性能承诺。
