# W04 Temporal Evidence Ledger 本地实现回执

日期：2026-08-30

## 状态

`IMPLEMENTED / LOCAL G4 PASS / AVD RUNTIME PENDING`

## 已实现

- `CardRelation` 新增 `relationType`、`confidence`、`confirmed`、`confirmedAt`、`revokedAt`、`validFrom`、`validTo`；旧关系迁移为 `RELATED + confirmed=false`。
- 新 migration 保留旧数据，取消旧的卡片对唯一约束，以便保留多次提议、撤销和重新提议的审计历史。
- 新增时间点有效性计算、当前事实计算和 `SUPERSEDES` 成环检测。
- 新增读取、提议、确认、撤销四个接口；服务端拒绝跨项目、自环、重复生效关系和取代环。
- Search 响应增加 `current`、`supportState`、`supersededBy`、`temporalReason`，旧检索排序和 fallback 继续工作。
- `TEMPORAL_MEMORY_ENABLED=false` 时停止关系写入，并让搜索回到不激活时态关系的兼容状态。
- HarmonyOS `MemoryTimeline` 增加“决策演化”，覆盖当前有效、已取代、存在冲突、待确认、已撤销、证据不足，并提供确认/撤销操作。

## 本地验证

| 检查 | 结果 |
|---|---|
| Prisma migration replay + API 集成 | PASS |
| Vitest | 14 files / 101 tests PASS |
| Temporal 专项 | 12/12 PASS |
| TypeScript | PASS |
| ESLint | PASS |
| Next.js production build | PASS；保留既有 NFT tracing warning |
| HarmonyOS Hypium | 27/27 PASS |
| HarmonyOS HAP | BUILD SUCCESSFUL；unsigned；1,781,270 bytes；SHA-256 `ff3317d51dba4b719e4b345b488509b22051eb06dc0d2785afe7ada8964dd618` |
| W04 deterministic benchmark | 60 cases PASS；各主指标 1.0，安全计数 0 |

benchmark 的原始样例、人工定义标签、预测与指标位于 `benchmark.json`。该集合是规则型合成基准，适合回归而不是比赛最终盲测；后续仍需补充真实项目人工标注样例。

## 尚未宣称通过

- 当前 `hdc list targets` 为空，未完成 DevEco 模拟器上的两卡片纵向演示、截图和布局 dump。
- 没有真实项目盲测集；当前 60 组为模式化人工定义回归集，不能替代赛前独立标注。
- 尚未实现模型自动提议关系；当前只提供严格 API 提议，并坚持所有提议必须人工确认后才生效。
