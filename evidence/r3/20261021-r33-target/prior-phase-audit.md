# R3.1 / R3.2 Target 前置复查

日期：2026-10-21。审查方：independent_review。只读核对规划、当前源码与已存在回执；本轮未重跑全量检查、未调用真实模型或搜索。

## 范围结论

两份规划没有单列 R3.1 Target 或 R3.2 Target 增量包。路线图第154–155行将两阶段定义为 WP-10/11/12、WP-20/21；第162、184–188行将 Target 增量归于自动接续、关键 Claim 语义判定、后续入口及评测。不能把前两阶段本地测试通过推断成 Target 通过。

当前可确认：核心工程已实现并有主要本地回归；部分既定契约和专项验证尚未完整覆盖，MODEL/SEARCH 外部 Gate 未关闭。下列差距属于已写契约或验证缺口，不另行发明 Target 功能。

## 逐项核对

| 阶段 / 项目 | 实现 | 已有验证与边界 | 直接定位 |
|---|---|---|---|
| R3.1 持久 Mission、等待输入、恢复、不可变 Output | 已实现 | 脚本 Provider、独立 SQLite 和 UI 闭环有通过证据；不证明真实自主选择 | lib/mission/runner.ts:18；tests/missionRuntime.test.ts:30–31、43；evidence/r3/20261020-r31-r32/R3.1/results.json |
| R3.1 冻结批准、Action 原子创建与幂等 | 已实现 | 20次并发批准、事务中断及提交后进程退出有本地证据 | lib/mission/approvalService.ts:10；tests/missionRuntime.test.ts:32、44、46 |
| R3.1 租约、预算、完整故障矩阵 | 实现存在；矩阵验证不完整 | 事务中断重复10次；提交后退出用例仅一次；双Worker用例是同进程Promise并发，没有两个OS进程争抢全局槽的证据 | R3_PHASE_SPECS.md:234–236；tests/missionRuntime.test.ts:37–39、44、46 |
| R3.1 原生工具协议与JSON替代 | 两种路径已实现 | 多调用拒绝及一次修复已测；未找到正向原生消息配对和恢复的专项验收；真实协议兼容性未验收 | lib/mission/modelAdapter.ts:9、17；tests/missionResearch.test.ts:47；R3.2/results.json:89 |
| R3.1 inspect_project完整状态观察 | 部分实现 | 实际返回项目目标和最多20条行动；未接规格列出的freshness、Health findings与projectState | R3_PHASE_SPECS.md:98；lib/mission/tools.ts:15–21 |
| R3.2 Scope、隔离公开查询、受限Fetch与来源历史 | 已实现 | fixture / mock HTTP 已覆盖主要正负路径 | lib/mission/tools/researchTools.ts:25–45；tests/missionResearch.test.ts:28–45 |
| R3.2 真实Search/Fetch、两个独立正文来源、失败替代 | 外部未验收 | 回执明确paidApiCalls=0，并列出MODEL / SEARCH待验收 | R3_PHASE_SPECS.md:246–247；R3.2/results.json:84、88–90 |
| R3.2 网页注入、改写外传、DNS与重定向边界 | 部分本地验证 | 有敏感词/编码、IP/IPv6、固定认证端点测试；未找到完整网页注入诱导执行、中文/英文改写、托管Fetch DNS重绑定专项验收 | R3_PHASE_SPECS.md:245–246；tests/missionResearch.test.ts:40–43 |
| R3.2 Research Output、精确引用、内外来源分层 | 已实现 | 有本地回归；内容仍标未核验，结构合法不等于语义支持 | lib/mission/outputService.ts:9–14；tests/missionResearch.test.ts:30–32、44、49–50 |
| R3.2 六轮指代、否决保持、上下文压力下来源保留 | 有上下文实现；专项验证不足 | 当前取最近12条混合事件、16个步骤；未找到六轮指代/否决及上下文压力的专属回归 | R3_PHASE_SPECS.md:254；lib/mission/contextBuilder.ts:7–22 |
| 两阶段真实动态轨迹 | 外部未验收 | R3.1三类动态轨迹、R3.2内部/外部/混合/缺私有指标四类任务不能由脚本轨迹替代 | R3_PHASE_SPECS.md:220、255；R3.1/results.json:38；R3.2/results.json:88 |

## 探针与评测准备

WP-00B 要求每类至少3次、原生tools/tool role/usage及实际Fetch验证（R3_PHASE_SPECS.md:207）。当前 scripts/probe-mission-provider.ts:8–10 每类仅一次单响应，没有执行工具后再回传tool role；scripts/probe-mission-search.ts:6–7 仅一次search，无Fetch。脚本本身尚不足以执行完整规定验收。

tests/fixtures/missions/minimum-v1.json:2–3 明确是12题合成模板、非真实模型成绩；未找到 scripts/eval-missions.ts。30题、消融和用户小测归于WP-50，不在本次审查中擅自评定其他阶段完成状态。

## 已存在证据的解释

R3.1/results.json 的 mode 为 SCRIPTED_PROVIDER_AND_INDEPENDENT_SQLITE；R3.2/results.json 的 providerMode 为 SCRIPTED_FIXTURE_AND_MOCK_HTTP。R3.2/ui-smoke.json 证明创建、约束、范围、重入、原问题答复及批准TODO行动的本地UI闭环。它们支持工程与本地故障结论，不支持真实自主质量、供应商兼容性或Target整体验收结论。

本报告只记录此次复查时的源码与回执，不将历史测试数量当作当前候选重新执行的证明。报告中路径均相对仓库根目录；R3.1/results.json、R3.2/results.json、R3.2/ui-smoke.json 位于 evidence/r3/20261020-r31-r32/。
