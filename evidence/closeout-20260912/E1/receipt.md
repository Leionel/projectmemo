# E1 收尾回执：S1 快照正确性与统一时态

日期：2026-09-12。HEAD：`387e502`（起点）→ 本回执对应提交见 git log。工作树遗留：`next-env.d.ts`（Next 自动生成，非本包修改）。

## 本包改动

1. **sequence 历史身份**（迁移 20260912220000）：快照增加项目内递增 `sequence`，唯一键 `(projectId, sequence)`；旧行按 (evaluatedAt, id) 回填（已在开发库验证：存量 v1 行 seq=1、游标引用保留）。latest/previous/check-in 全部按 sequence 排序，不再依赖毫秒时间。
2. **仅最新复用 + 有界重试**：refresh 只在最新行的 sourceHash+policyVersion+evaluationKey 全部匹配时复用；恢复旧内容必产生新 sequence。并发 sequence 冲突整事务有界重试（≤3 次，重读源与最新序号）。
3. **policyVersion v2 + 跨版本保护**：规则版本升至 "2"（v1 行的历史 payload 不再冒充新规则结论）；diff 在行级与 payload 级双查 policyVersion，跨版本返回 REBUILD_REQUIRED。
4. **业务确认补偿刷新**：confirmChangeImpact 提交成功后尝试刷新快照；功能关闭或刷新失败返回 `stateRefreshPending=true`，不伪装业务失败。鸿蒙状态面板进入项目即显式刷新（§5.3 崩溃补偿），移除"EMPTY 手动建基线"分支。
5. **独立测试库**（§2.3）：vitest 显式 `DATABASE_URL=file:./prisma/test-vitest.db`（已 migrate deploy，gitignore 覆盖 `prisma/*.db`），全量测试不再落在开发库。
6. 沿用上一轮（387e502）已关闭项：Ledger 统一时态计算、contentHash 业务投影、源数组排序、源读取入事务、验收探针四场景转正式断言。

## 命令与退出码

| 命令 | 结果 |
|---|---|
| `npm.cmd exec tsc -- --noEmit` | 0 |
| `npm.cmd test`（独立库 prisma/test-vitest.db） | 28 文件 / 194 测试全部通过，0 |
| `tsx evidence/acceptance-20260912/probe.ts` | 0；recurrence/conflict/hash/dep 四项全绿（`probe-results.json`） |
| `prisma migrate deploy`（开发库 + 测试库） | 成功 |

## 必过用例对照

- 同一 goal A→B→A：三条历史、最新为 A、第四次刷新复用不新增 → `field round-trip` 集成测试 ✓
- 并发相同刷新：`concurrent identical refreshes` → 同一快照 ID、仅一行 ✓（单连接 SQLite 串行化，真实并发进程间行为未注入故障，如实记录）
- CONTRADICTS/未来生效/撤销：`confirmed CONTRADICTS surfaces as conflict`、`future validFrom` ✓
- 事实不变仅推进一秒 / 数组顺序：`contentHash ignores observation time` ✓
- 跨 deadline 边界：`crossing a deadline boundary` ✓
- 写入成功但刷新失败：`confirm reports stateRefreshPending when state feature is disabled` ✓；刷新失败重试不重复业务记录由事务边界保证（confirm 的事务先于刷新）✓
- 旧库迁移：开发库回填验证 ✓（本文件上方记录）；独立旧库副本演练未做，如实记录

## 状态

| 项 | 代码验收 | 设备验收 | 总状态 | 证据 |
|---|---|---|---|---|
| S1 | PASS | 尚未执行 | IN_PROGRESS | 本目录 + 全量测试日志 |
| M1（E1 共享部分：状态一致性） | PASS | 尚未执行 | IN_PROGRESS | 同上 |

## 剩余限制

- 设备验收（刷新、重启、已读游标、空态/错误态）未执行，需模拟器/真机记录。
- 并发故障注入（真多进程写冲突）未做；better-sqlite3 单连接下以重试逻辑兜底。
- 面板进入即刷新会自动创建基线（计划 §5.3 口径），首次使用不再有手动 CTA——产品语义变化已在此声明。
