# D3 本地后端/Web 同身份读回：计划与隔离核账（未执行重负载）

日期：2026-11-03（UTC+8）　Owner：d3-device　状态：**PLAN_READY（脚本已备，未执行；按 Lead 指示先报计划）**

> 边界：只用隔离准备库 `prisma/final-preparation.db`；不碰真实用户库、不 seed 用户数据、不调用模型/外网、不写 tracked 源码/公共脚本。**本轮未启动 next dev、未启动长驻进程、未写隔离库（只做了只读迁移/行数核对）。**

## 1. 已核实的环境事实（只读）

| 项 | 值 | 时间/来源 |
|---|---|---|
| 隔离库 | `D:/Projects/hongmen-final-d-harmony-native/prisma/final-preparation.db`，1,503,232 bytes，mtime 2026-11-03 11:03:07 | `raw/isolated_db_state.log` |
| 迁移 | `_prisma_migrations` 51 条，全部 finished；最新 `20261102140000_project_intake_draft` | 同上（readonly sqlite 打开） |
| 业务行数 | User/Project/ProjectMembership/AgentMission/Event/Approval/Output/Receipt/AuthSession 均 **0** | 同上（空库，无 seed、无用户数据） |
| D 端口规划 | `tmp/final-preparation/context.json`：track=d，**port=34114**（仅本地预览） | 文件 |
| 脚本端口 | `npm.cmd run harmony:backend` = `next dev -H 127.0.0.1 -p 4400` | `package.json` |
| 端口占用快照（14:52） | 34111 被其他 Track（B）进程占用（未触碰）；**34114、4400、5555、33321 空闲** | `Get-NetTCPConnection -State Listen` |
| 启动环境模板 | `tmp/final-preparation/Start-Track.ps1`：设置独立 DATABASE_URL、ATTACHMENT_DIR、LLM_MODE=mock、MISSION_ENABLED=true、MISSION_WRITES_ENABLED=true、MISSION_WEB_ENABLED=false、MISSION_AUTO_CONTINUATION_ENABLED=false；port 已占用则拒绝启动（不杀别树进程） | 只读 |
| 启动方式 | `Start-Track.ps1 -PrepareOnly` 仅校验环境；不带参数才 `npm.cmd run dev -- --hostname 127.0.0.1 --port 34114` | 只读 |

## 2. 同身份读回的合同（要核对什么）

一次合成链路应满足：

```
同一个合成 userId / projectId
  └─ missionId（POST /api/missions → createMission）
       ├─ questionId（runner 合成 QUESTION；POST /input 用同一 ID 补料）
       ├─ approvalId（approval 提案；POST /approvals/{approvalId} 用同一 ID 批准）
       ├─ outputId（成果草稿 revision；readback?outputId=）
       └─ receiptId（MissionArtifactReceipt；readback?receiptId=，且 receipt.outputId === outputId）
```

- **正向**：readback 的 `missionId / projectId / selected.question.id / selected.approval.id / selected.output.id / selected.receipt.id(outputId)` 与创建链路逐项相等；`plain readback` 的 `adoptions` 列出同一 receiptId/outputId。
- **负向（同一身份合同的一部分）**：B 身份读 A 的委托 → `MISSION_NOT_FOUND/404`；同身份但 A 委托 + B 委托的 questionId/outputId → `MISSION_TARGET_NOT_FOUND/404`，不得改指向另一结果。
- **同一函数**：Web 与 API 的读回都走 `app/api/missions/[id]/readback/route.ts → readMissionBack`；输入/批准都走 `app/api/missions/[id]/input|approvals/[approvalId] → commandMission`；创建走 `POST /api/missions → createMission`。因此进程内服务调用与 HTTP 路由是同一合同（HTTP 腿可选复核）。
- **不冒充**：合成 mission/草稿/回执标 `D3_SYNTHETIC_ONLY`，`verificationStatus=NEEDS_REVIEW`；不写完成/效果，不代表 Worker/设备/模型 PASS。

## 3. 探针脚本（已备，位于 tmp，未执行）

`tmp/d-final/20261103/d3/probe-same-identity-readback.ts`

**安全护栏（脚本内置）**
1. `DATABASE_URL` 必须解析为 `<repo>/prisma/final-preparation.db`，否则退出；
2. 只允许 `http://127.0.0.1:<port>` 的 HTTP 复核；
3. `LLM_MODE=mock`，provider 全为脚本化 fixture（无模型/外网调用）；
4. 所有合成行带唯一 `runTag`（`d3-<时间>-<随机>`），可 `--cleanup` 精确删除；
5. 不修改 tracked 源码/公共脚本；报告写到 `evidence/final-d/20261103/d3/`。

**执行阶段**
| 阶段 | 动作 | 断言 |
|---|---|---|
| identity | 创建合成 owner/other 用户+project+membership+session | 合成身份隔离 |
| mission | `createMission`（真实服务） | owner/project 匹配 |
| question | `runMissionSlice` 脚本化 ask（最多 2 次）；失败则 fixture QUESTION + WAITING_INPUT | 状态 WAITING_INPUT、question 属于该 mission |
| input | 真实 `commandMission(..., "input", {requestId, expectedVersion, questionId, answer})` | version+1；readback 同 mission/question |
| approval | fixture 步骤+提案（PENDING），真实 `commandMission(..., "approval", {decision:"APPROVED", proposalHash})` | version+1；readback 同 approvalId；失败不伪造 PASS（记 NOT_RUN+FAIL 供复核） |
| output | 合成 `AgentMissionOutput`（NEEDS_REVIEW） | readback?outputId 同 ID |
| receipt | 合成 `GeneratedArtifact`+`MissionArtifactReceipt` | readback?receiptId 同 ID 且 receipt.outputId 同 output；plain readback adoptions 同 ID |
| 负向 | 跨身份、跨委托 question/output | 分别 404 MISSION_NOT_FOUND / MISSION_TARGET_NOT_FOUND |
| HTTP（可选） | `GET /api/missions/{id}/readback?questionId=`，Bearer session token | 200 且 missionId/questionId 相同 |

**执行命令（仓库根目录）**
```powershell
# 1) 干跑（不写库、不导入 db）：确认路径/环境
npm.cmd exec tsx -- tmp/d-final/20261103/d3/probe-same-identity-readback.ts --dry-run

# 2) 正式（仅隔离库；一次进程，结束即退出）
npm.cmd exec tsx -- tmp/d-final/20261103/d3/probe-same-identity-readback.ts

# 3) 需要清掉本次合成行时
npm.cmd exec tsx -- tmp/d-final/20261103/d3/probe-same-identity-readback.ts --cleanup
```
预期：退出码 0 = 全部断言 PASS；非 0 = 有 FAIL/未执行环节（报告逐条列出）。结果写到 `evidence/final-d/20261103/d3/BACKEND_READBACK_PROBE_RESULT.json`（可用 `--report` 覆盖）。

## 4. 可选 HTTP 腿（需要 Lead 明确批准才启动服务）

本轮**未启动**。若需要 HTTP 复核，执行顺序（串行、记录 PID/端口/退出码，结束即停，不占用构建槽）：

```powershell
# 0) 重新查占用；34114 被占用则失败退出，绝不杀别树进程
Get-NetTCPConnection -State Listen -LocalPort 34114 -ErrorAction SilentlyContinue

# 1) 用与本树一致的隔离环境启动本地服务（后台 job，记录 PID/端口/日志）
#    env 同 tmp/final-preparation/Start-Track.ps1（DATABASE_URL=file:<repo>/prisma/final-preparation.db,
#    ATTACHMENT_DIR=<repo>/tmp/final-preparation/attachments, LLM_MODE=mock, MISSION_ENABLED=true 等）
npm.cmd run dev -- --hostname 127.0.0.1 --port 34114

# 2) 等 /health 或首页 200 后（仅 127.0.0.1），带 --http-base 执行探针
npm.cmd exec tsx -- tmp/d-final/20261103/d3/probe-same-identity-readback.ts --http-base http://127.0.0.1:34114

# 3) 记录退出码/日志/PID，然后只停本次启动的进程；不碰 34111 等其他 Track 进程
```
> 注意：服务端的 `Constants.ets` 地址核验属于设备轨；34114 只是本机预览端口，不能写成"设备已可访问"的证明。

## 5. 需要 Lead 确认的事项

1. 是否批准**执行进程内探针**（只写隔离库合成行）；是否要求执行后立即 `--cleanup` 删除合成行；
2. 是否需要 HTTP 腿（需要短暂启动 34114 本地服务；若批准，我会先查占用再启动、记录 PID/端口/日志，结束后只停自己的进程）；
3. 执行时机：建议在 FROZEN 后的 `harmony:test`/`harmony:build` 前后由 Lead 指定资源槽，避免与构建/其他 Track 重负载并发；
4. 该探针只证明"服务/读回同一身份链"，不替代 Worker、签名、设备、模型与自然日验收。

## 6. 本轮未做与已知限制

- 未执行探针（等待 Lead 批准）；未启动 next dev / 长驻进程；未写隔离库；未调用模型。
- 迁移状态是只读核对，不是"候选已迁移"的部署声明；服务端若新增迁移仍由 Lead/主控决策。
- fixture 的 approval/output/receipt 行会在报告里显式标注 `SYNTHETIC`，不能作为真实业务行为或完成证据。
