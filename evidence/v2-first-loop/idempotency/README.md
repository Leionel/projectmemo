# 修复：confirmV2Delegation 的幂等绑定

审查基线 `9776f9b`。已复现：同 `requestId` 换项目/目标/材料仍返回旧 Mission，响应 `projectId` 与 Mission 实际归属不一致；后续修改许可会让原请求重试返回“新许可”，而不是原回执。

## 判定规则（当前实现）

- 确认事务内先按 `ownerUserId + createRequestId` 查原 Mission，再决定是否新确认；因此**原请求重试优先于期限/预览校验**，过期后的一致重试仍返回原回执。
- 原确认内容持久化在 `AgentMission.planJson.v2DelegationReceipt`（schemaVersion 1）：`projectId / goalHash / materialHash / previewHash / policyHash / expiresAt / materialSourceId / confirmedAt`。回执只读该记录，不从当前许可重建。
- 完全一致重试：返回原 `missionId / materialSourceId / policyHash / expiresAt`，`alreadyCreated=true`，不新增 Capture/Mission/事件。
- 不一致重放（同编号换项目、目标、材料、预览、期限）：`409 DELEGATION_IDEMPOTENCY_CONFLICT`，原 Mission 与 Capture 不变。
- 并发确认：唯一键冲突/写冲突最多重试 3 次，重试走同一条回执校验路径，结果只有一个 Mission。
- 原请求绑定缺失（历史/被篡改）：拒绝为 `DELEGATION_IDEMPOTENCY_CONFLICT`，不猜测重建。
- Capture、Mission、BOUNDED_INVESTIGATION 许可、`V2_DELEGATION_CONFIRMED` 事件与回执仍在同一事务提交。

## 验证

```powershell
npm.cmd test -- tests/v2DelegationIdempotency.test.ts tests/v2DelegationEntry.test.ts
```

- 6 条幂等回归（一致重试、换项目、改目标/材料/预览/期限、许可后续修改、并发确认、过期后重试）+ 原入口 4 条：10/10 通过，见 `tests.log`。
- tsc、scoped eslint 通过，见 `tsc.log` / `eslint.log`。
- 隔离临时 SQLite；无真实模型调用、无迁移。

## 剩余

- 回执存放在既有 `planJson`，未新增表；若后续要审计导出，可在 Schema 负责人处评估独立回执表。
- 旧 Mission（本功能上线前创建）没有回执字段，统一按冲突处理，需要用户使用新请求编号确认。
