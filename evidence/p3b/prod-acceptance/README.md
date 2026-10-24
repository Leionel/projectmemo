# P3-A / P3-B 生产验收回执（evidence/p3b/prod-acceptance）

- **日期**：2026-10-24（所有时间戳为 UTC，见各 JSON 的 `at` 字段）
- **目标环境**：https://project.luojiatutor.xyz（生产）
- **数据来源**：真实生产 API + 公开 GitHub 仓库（api.github.com）。无 mock、无本地库。
- **账号**：复赛演示账号 contest-demo（仅操作该账号自己的数据）。
- **发布版本核验**：`GET /health` → `status=ok`，`release=49da9fe3d6a0117bd50cb03360e97d44d3e3271a`（2026-10-24T10:52:03Z，即本次验收目标版本，非 d618f8c/56f1edb 旧值）。
- **执行方式**：`runner.mjs`（本目录，无凭据）；用户名/密码经环境变量传入，accessToken 仅存于进程内存，绝不写入任何文件；每个阶段独立登录（共产生 8 条会话记录，7 天过期自动失效）。
- **原始 JSON**：本目录全部 `*.json` 为逐请求原始响应（含请求方法/路径/请求体/HTTP 状态）。`state.json` 仅保存非敏感 id。

## 结论总表

| # | 链路 | 结果 | 关键数值 |
|---|---|---|---|
| A1 | GET /api/projects 列出演示账号项目 | 通过 | 2 个项目，列表首个为「人工智能创意赛 忆程 ProjectMemo 作品开发」(cmt9uzmx…) |
| A2 | GET /api/projects/{id}/experiences | 通过 | `enabled:true`；trajectory：missionCount=2，engineeringSucceeded=0，adopted=0，actionsCompleted=0，realOutcomeAttested=0；experiences=[]（演示历史委托多为失败暂停，与任务预期一致） |
| A3 | GET /api/missions?projectId → GET /api/missions/{id} 含 experience 块 | 通过 | 项目下 2 个 mission（首个 PAUSED）；详情含 `experience:{enabled:true,suggestions:[],note:…}`，无 500 |
| A4a | 未认证访问 experiences 端点 | 通过 | HTTP 401 `UNAUTHORIZED`「未提供身份凭据，请先登录」 |
| A4b | 对不存在经验执行下层操作 | 通过 | HTTP 404 `EXPERIENCE_NOT_FOUND`「经验不存在或不可访问」 |
| B0 | 新建演示项目 | 通过 | 「洛加数学技能仓库跟踪」cmvmabwy10003svrawzrfth86，201 |
| B1 | 建连接 + 首刷产生候选信号 | 通过 | `Leionel/luojia-math-tutor-skill@main` ACTIVE；首刷 `lastStatus=OK`，created=30 条真实 GitHub 提交（含 sha/作者/标题/外链，如 c6d7a6a90a「Merge pull request #2 …」作者 Shengxin Xiao） |
| B2 | 列表读回 | 通过 | 1 connection，30 signals 全部 CANDIDATE |
| B3 | 二次刷新 ETag 条件请求 | 通过 | `status=NOT_MODIFIED`，created=0，`connection.lastStatus=NOT_MODIFIED`，复用 etag `W/"1878fe40…"` |
| B4 | 采纳链路 | 通过 | 行动（TODO、isSimulated=false）创建后 ADOPT：signal→ADOPTED、有 adoptedCaptureId、带 actionId 时 linkedActionId=行动 id；行动状态保持 TODO（信号不构成完成）；项目 `_count.captures` 0→1→2（sourceType=仓库信号，经源码确认 captures 无独立列表端点，以项目详情计数与 API 契约验证） |
| B5 | 采纳幂等 | 通过 | 同 signal 重复 ADOPT 返回 200、状态仍 ADOPTED、同一 adoptedCaptureId、响应无新 captureId、captures 停在 2 |
| B6a | 不存在 actionId 的 ADOPT | 通过 | HTTP 404 `ACTION_NOT_FOUND`「关联的行动不存在或不属于当前项目」，信号保持 CANDIDATE |
| B6b | DISMISS 候选信号 | 通过 | 200、signal→DISMISSED、captures 前后均为 2（未采纳零事实写入）。附加佐证：对已 ADOPTED 信号 DISMISS 得 409 `SIGNAL_ADOPTED`（已采纳不可变） |
| B7 | 撤销测试（第二连接） | 通过 | `Leionel/projectmemo@master`（首刷 OK、30 信号）→ REVOKE → `status=REVOKED`（reason=验收撤销测试）→ 再 REFRESH 得 HTTP 409 `CONNECTION_REVOKED`；历史信号保留（连接 2 的 30 条信号仍在列表中，演示连接的信号不受影响） |

**总判定：14/14 通过，无未通过项。**

## 4xx 原文汇总（本轮全部 4xx，无 5xx）

| 场景 | 状态 | 响应体 |
|---|---|---|
| 首次登录用了错误字段名 `email`（runner 前的手工探测） | 422 | `{"error":{"code":"VALIDATION_ERROR","message":"提交内容不完整或格式不正确","details":[{"expected":"string","code":"invalid_type","path":["username"],"message":"Invalid input"}]}}`（修正为 `username` 后 200） |
| A4a 未认证 | 401 | `{"error":{"code":"UNAUTHORIZED","message":"未提供身份凭据，请先登录"}}` |
| A4b 经验不存在 | 404 | `{"error":{"code":"EXPERIENCE_NOT_FOUND","message":"经验不存在或不可访问"}}` |
| B6a actionId 不存在 | 404 | `{"error":{"code":"ACTION_NOT_FOUND","message":"关联的行动不存在或不属于当前项目"}}` |
| B6 附加：DISMISS 已采纳信号 | 409 | `{"error":{"code":"SIGNAL_ADOPTED","message":"已采纳的信号不再变更；项目事实请从资料侧修改"}}` |
| B7 撤销后 REFRESH | 409 | `{"error":{"code":"CONNECTION_REVOKED","message":"连接已撤销，不再发起任何新请求；历史信号保留"}}` |

## 生产演示数据改动清单（全部落在 contest-demo 账号）

**新建项目**：「洛加数学技能仓库跟踪」（cmvmabwy10003svrawzrfth86，scenario=COMPETITION）。

**新建连接 ×2**：
1. `Leionel/luojia-math-tutor-skill@main`（cmvmacdtb0006svran5dce3b2）——**ACTIVE**（保留作演示连接）。
2. `Leionel/projectmemo@master`（cmvmahppf001dsvraei37ew7w）——**REVOKED**（撤销测试用，reason=验收撤销测试）。

**新建行动 ×1**：「复核仓库信号采纳演示行动」（cmvmacocy0012svra17vkkl97，TODO，isSimulated=false）。

**信号处置**（合计 60 条候选信号进入演示项目，均来自上述两个公开仓库的真实提交）：
- 采纳 ×2：c6d7a6a90a…（cmvmaceg90010svrae2wvq7sk，无关联行动——见「执行说明」）、a08f1003f7…（cmvmaceg0000zsvra9x7f6lsk，关联上述行动）。各产生 1 条 Capture（sourceType=仓库信号），共 **2 条 Capture**。
- 驳回 ×1：cmvmacefq000ysvranel549qx（DISMISSED，零事实写入）。
- 其余 57 条保持 CANDIDATE 未动。

**会话记录**：8 条（每阶段一次登录，2026-10-31 过期）。

## 执行说明（如实记录）

- **首次 ADOPT 未带 actionId**：runner 读取行动创建响应时取错路径（响应为 `{action:{…}}`），导致第一条信号的采纳体缺 `actionId`，`linkedActionId` 为 null。该采纳本身是有效写入（ADOPTED + Capture）。`linkedActionId` 断言随后用第二条信号（b4b-* 文件）补测通过。
- **B6 首轮跑在已采纳信号上**：b4b 补测消耗了 b6 原定的候选信号，首轮 b6 得到 200（幂等早返回）与 409（DISMISS 已采纳），遂用新候选信号（b6b-* 文件）重测出 404/DISMISS 标准路径。首轮文件保留作附加证据。
- **本地网络抖动**：执行期间本机到站点出现间歇性 `UND_ERR_CONNECT_TIMEOUT`（Node fetch），runner 加连接重试后全部成功；生产端响应均正常，与本验收结论无关。

## 边界声明

- **本轮零模型调用**：未触发任何 LLM/embedding 端点；全部写路径（建项目/建行动/信号采纳）经源码核对为纯 CRUD + 规则式状态刷新，本轮唯一外呼是 api.github.com（仓库感知匿名只读）。
- **零凭据落盘**：accessToken 从未写入任何文件（登录响应保存前已即时脱敏，见 00-login.json）；用户名/密码仅存在于当次命令环境变量。
- **未触碰其他用户数据**：全部请求限于 contest-demo 自己的项目/委托/行动/信号；未运行 seed/reset/db:setup。
- 本目录未提交、未推送（按任务要求保留为本地证据）。

## 未验证项 / 范围外

- **鸿蒙端**不在本轮范围（未做 ArkTS 客户端联调与真机验证）。
- **增量刷新**（新提交推送后 `created>0`）未在生产复现——首刷 created=30 已覆盖抓取路径，NOT_MODIFIED 已覆盖条件请求路径，但"游标重叠扫描"的增量分支未实测。
- **GitHub 异常分支**（403/429 限流、私有仓库 404）未在生产触发，仅源码核对。
- 真实模型（P0-A/P0-B provider）效果验证不在本轮。
