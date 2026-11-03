# D3 本地后端/Web 同身份读回：执行结果（进程内探针）

日期：2026-11-03（UTC+8）　Owner：d3-device　执行许可：Lead 于本轮会话批准（仅隔离库、mock、127.0.0.1、执行后必须 `--cleanup` 并核对行数）

## 1. 命令与用时

| 项 | 值 |
|---|---|
| 前置状态快照 | `node tmp/d-final/20261103/d3/db-state.mjs evidence/.../PROBE_DB_STATE_BEFORE.json`（15:05:23.997，全表 0 行） |
| 探针命令 | `npm.cmd exec tsx -- tmp/d-final/20261103/d3/probe-same-identity-readback.ts --cleanup` |
| 开始/结束（UTC+8） | 见 `PROBE_RUN.exit.json`（约 15:05:5x 起，耗时 5.6 s） |
| 退出码 | **0** |
| 结果 | **PASS，19/19 断言通过，0 失败**（`BACKEND_READBACK_PROBE_RESULT.json`） |
| 清理 | 脚本内 `--cleanup` 已执行，`cleanup.done errors=0` |
| 后置状态快照 | `PROBE_DB_STATE_AFTER.json`（15:06:21.178，全表 0 行） |
| 日志 | `PROBE_RUN.log`、`PROBE_RUN.exit.json`、`BACKEND_READBACK_PROBE_RESULT.json` |

## 2. 同身份链断言（全部 PASS）

创建路径：合成 owner/other 身份 + 合成 project → 真实 `createMission` → 真实 `runMissionSlice`（脚本化 provider，`MISSION_ENABLED=true`、`LLM_MODE=mock`，无模型/外网调用）→ `WAITING_INPUT` + QUESTION → 真实 `commandMission("input")` → fixture 提案 + 真实 `commandMission("approval", APPROVED)` → 合成 output/receipt → `readMissionBack` 逐项核对。

| 断言 | 结果 |
|---|---|
| created mission owner / project 匹配合成身份 | PASS |
| mission 进入 WAITING_INPUT，question 属于该 mission | PASS |
| readback `missionId`/`projectId`/`selected.question.id` 同身份 | PASS |
| input 后 version+1，readback 仍同 mission/question | PASS |
| approval 后 version+1，readback 同 `approvalId` | PASS |
| readback `outputId` 同 output | PASS |
| readback `receiptId` 同 receipt，且 `receipt.outputId === outputId` | PASS |
| plain readback `adoptions` 列同一 receipt/output | PASS |
| B 身份读 A 委托 → `MISSION_NOT_FOUND/404` | PASS |
| 跨委托 question → `MISSION_TARGET_NOT_FOUND/404` | PASS |
| 跨委托 output → `MISSION_TARGET_NOT_FOUND/404` | PASS |

> 合成行均标 `D3_SYNTHETIC_ONLY` / `verificationStatus=NEEDS_REVIEW`，报告显式记录 created IDs；不代表 Worker/设备/模型/完成态 PASS。HTTP 腿与 Web UI E2E 本轮未执行（按 Lead：FROZEN 构建后再议，UI 不并入本轮 PASS）。

## 3. 隔离库前后对比（关键）

| 项 | 执行前 | 执行后 |
|---|---|---|
| User / Project / ProjectMembership / AuthSession | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| AgentMission / Event / Approval / Step | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| AgentMissionOutput / MissionArtifactReceipt / GeneratedArtifact | 0 / 0 / 0 | 0 / 0 / 0 |
| Capture / ActionItem | 0 / 0 | 0 / 0 |
| d3- 前缀残留（users/projects/missions） | 0 | 0 |
| DB 文件 size / mtime（UTC+8） | 1,503,232 B / 11:03:07.717 | 1,503,232 B / 15:06:00.867 |
| WAL / SHM | 无 / 无 | 无 / 无 |

说明：SQLite 删除行后文件大小可以保持（页复用），本次 size 未变、行数归零、无 WAL 残留；**没有**写到测试库、开发库或真实用户库，也没有 seed/模型调用/外网写入。

## 4. 限制

- 仅验证“服务层同身份读回链”（Web/API 路由与探针调用同一 `readMissionBack`/`commandMission`），不替代 HTTP 传输、Web UI、Worker、签名、设备、模型与自然日验收。
- 合成 approval/output/receipt 为 fixture 行，报告已标注；不得作为真实业务行为证据。
