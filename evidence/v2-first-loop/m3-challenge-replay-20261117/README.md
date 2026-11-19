# M3 挑战隐私、指标题与回访简报（2026-11-17）

基线 `95fcc4f`。复用既有 Mission 事件、Output、来源权限和 AgentPresentation；无新依赖、无 Schema/Migration。

## 实现

- **删除尝试/保留边界**：挑战命令新增 `DELETE_ATTEMPT`，只写 tombstone（题号列表+数量），不复制回答正文；会话按事件顺序重放，删除只移除删除前已回答项，之后可重新作答。返回 `retentionDays=30` 与“逻辑删除、不宣称物理擦除”的说明。STOP、撤权、来源变化、新稿、24h 过期仍各自独立。
- **指标可比性题**：新增 `METRIC` 挑战，只对来源中的真实 `MetricRecord` 行复用 `lib/experiments/metrics.ts` 的 `compareMetricRecords`；输出 MATCH / UNKNOWN / DIFFER 三态，缺少两条记录时拒绝出题。答案键不下发；不自动判断事实真假。
- **冻结集合**：`planning/v2-first-loop/evaluation/challenge-rules.v1.json`（20 条规则案例）与 `challenge-report-contexts.v1.json`（12 条报告情境），全部标记 `SYNTHETIC_ONLY`，`realAuthorizedSources=0`；测试锁定 SHA256 并逐条复现期望。
- **站内回访简报**：`GET/POST /api/missions/[id]/reentry-brief`；从上次 `REENTRY_BRIEF_SEEN` 之后取最多 3 项（判断优先，其次成果更新），分别返回发生/记录时间，已读、已处理、已批准分开（批准仍走原成果采纳，不由回访推进）。确认已读只写回执事件，不增加 Mission version、不写 Output。Web 工作台新增回访面板（5 秒有界刷新、可打开原版本、标记已看/已处理）。
- **未实现**：双人冲刺。按任务书“先交一条最有价值的闭环”保留为独立探索，不把静态入口写成完成。

## 验证命令与实际结果

```powershell
npm.cmd test -- tests/v2ChallengeMetricPrivacy.test.ts tests/v2ReentryBrief.test.ts tests/v2FrozenChallengeSets.test.ts tests/v2Challenges.test.ts
# 5 + 3 + 3 + 17 = 28 条通过；回归见 m4 目录 targeted log（含材料旅程共 45 条）
$env:V2_ENTRY_PORT='4440'; $env:V2_ENTRY_PRODUCTION='true'
npm.cmd exec tsx -- scripts/v2-entry-demo.ts
$env:M3_EVIDENCE_DIR='evidence/v2-first-loop/m4-20261117/browser-m3'
npm.cmd exec tsx -- scripts/verify-v2-m3.ts
```

浏览器六项通过，新增“回访简报显示第 1 版、标记已看不推进 Mission”；原三轮彩排/引用追溯/暂停材料/撤权回归均通过。截图 `browser/desktop.png`、`mobile.png`，失败尝试保留在 `browser/history/`。使用隔离 SQLite 与 localhost HTTP mock，不是真机/真实用户。

## 兼容与未验

- 新挑战 kind/action 为增量；旧客户端忽略 `retentionDays/logicalDeletionNote` 仍工作；事件接口仍隐藏题面/答案。
- 指标题仅合成 MetricRecord；真实授权实验来源、真实报告情境、人工语义复核：UNVERIFIED。
- 删除为逻辑删除；事件审计保留，物理擦除/保留期到期清理未实现也不宣称。
- 通知点击/站内深链的原对象定位：沿用既有 EntryAbility 路由，未做真实通知通道。
