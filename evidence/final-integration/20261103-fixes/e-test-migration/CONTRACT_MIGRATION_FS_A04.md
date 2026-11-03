# FS-A04 测试合同迁移申请（E 作为原测试作者提交，待主控复核）

**候选**：`4b696141435825a3582816e8e449c0e0cf013f29`（final-a-workpacket-v1）；E 树 `codex/final-e-quality-evidence`，2026-11-03 14:30 UTC+8 起。
**申请性质**：测试合同迁移（CONTRACT_MIGRATION），不是“旧红例已修复”，也不是“新套件全绿所以原问题不存在”。

## 1. 裁决来源

- `03_HANDOFF`（集成树 `evidence/final-integration/20261103-review/HANDOFF.md:17`）：主控 + 两组独立源码复核确认，E-F03 的原断言要求 legacy `readback.observedAt` 恒定属于字段合同误判；A 保留兼容语义，成功观察改读 `observation.lastSuccessfulAt`。
- `16_第二批ABCDE收尾Prompts.md` E 段：允许原测试作者提交明确的合同迁移，但必须附旧/新预期、消费器证据和更强回归，由主控复核；不能只删断言或 skip。

## 2. 旧断言与旧证据（保留，不删除、不改写）

| 项 | 内容 |
|---|---|
| 旧用例 | `tests/final-e/missionCommandsIsolation.test.ts > FS-A04 > 无写入时反复 GET 不应推进“成功观察时间”`（原 33 例之一） |
| 旧断言 | `expect(second.observedAt).toBe(first.observedAt)` |
| 旧实际 | 两次 GET 的 legacy `observedAt` 相差 35 ms（`2026-11-03T…09.206Z` vs `…09.241Z`），`missionUpdatedAt` 未变 |
| 旧证据位置 | `evidence/final-e-20261103/logs/independent-tests-run.log`（原 28/33 红单）、`evidence/final-e-20261103/FINDINGS.json` E-F03、`logs/iterations/` 原始运行 |
| 保留结论 | 旧断言在 485d485 上是红；该红被裁决为合同误判，**不是**产品缺陷被修复 |

## 3. 为什么判为合同误判（消费器证据）

- 源码自述：`lib/mission/readback.ts:299-303` 的 legacy 字段带 `@deprecated 冻结为“本次读取时刻”，与 readAt 同值。刷新页面不会核查资料；成功观察时间只看 workState.observedAt / observation.lastSuccessfulAt。`
- Web 消费：`components/MissionReadback.tsx:91` 渲染 `读取于 {new Date(data.observedAt)…}` —— 该字段一直被当作**读取时间**展示。
- 鸿蒙消费：`harmonyos/entry/src/main/ets/components/MissionReadbackView.ets:74` 渲染 ``读取于 ${this.shortTime(this.data.observedAt)} · 委托版本 …`` —— 同一语义。
- 结论：要求它“无写入时恒定”会与两个真实消费器的“读取于”语义冲突，属于字段合同误判。

## 4. 迁移后的新断言（更强，不是放宽）

新增/替换用例：`tests/final-e/missionCommandsIsolation.test.ts > FS-A04（合同迁移）FI-E-OBS-01`。

| 断言 | 旧套件是否有 | 说明 |
|---|---|---|
| legacy `observedAt === readAt`，两次 GET 前进 | 旧套件相反（要求恒定） | 冻结兼容语义：旧消费者仍读“读取于” |
| 无观察时 `observation.lastSuccessfulAt/lastFailedAt/lastNoNewInformationAt` 全部 null | 无 | 新成功观察时间不得由读取伪造 |
| `observation.readAt === readback.readAt`、`workPacket.observations === observation`、`snapshot.checkedAt === readAt` | 无 | 同一快照同源，防新旧字段分裂 |
| 读取零副作用：Mission 行深度相等、事件数不变 | 部分 | 读取是只读的强约束 |
| `done.note` 不含“无新变化” | 无 | 未观察到 ≠ 无变化 |

补充新文件 `tests/final-e/observationAndSourceUse.test.ts`（10 例）覆盖真实时间语义：

- 原成功观察时间稳定、重复 GET 不推进；
- 真实声明观察失败（`EXECUTION_STOPPED` + `purpose:"DECLARED_OBSERVATION"` + `phase:"TOOL"`）→ `FAILED_LAST` 且保留旧成功时间；
- 用户暂停/取消/预算耗尽不新增观察失败；无观察声明的旧工具失败、模型格式错误不能被推断为观察失败；
- 成功 → 真实失败 → 再次读取的顺序稳定（含事件原样保留）。

## 5. 分母与结果（分开报告）

| 口径 | 文件/用例 | 结果 | 退出码 |
|---|---|---|---|
| **历史 33 例（原套件，迁移动作为其中之一）** | `tests/final-e/*.test.ts` 在 4b69614 上的同一批 33 例 | **32 PASS / 1 FAIL**（唯一红=旧 FS-A04 断言，即本迁移对象；迁移后该文件 13 例全绿） | 旧口径 1 |
| **新独立套件（迁移 + 新增）** | 6 文件 / **49 例** | **49 PASS / 0 FAIL** | **0** |
| 旧 485d485 红单 | 原 33 例 | 28 PASS / 5 FAIL（E-F01×2/E-F02/E-F03/E-F04；已归档） | 1 |

> 49 例全绿**不代表**历史 33 分红单被“修复证明”：E-F01/E-F02/E-F04 已在 4b69614 独立复验为真修复；E-F03 是合同迁移。三者按不同结论分别记账。

## 6. 回归与风险

- 迁移只替换 1 个用例的断言集合（3 个断言 → 6 个断言，强度增加），未删除其他断言、未 skip、未改 mock。
- 新增 16 例独立断言（观察合同 10 + 控制竞争 6）见 `controlAuthority.test.ts`、`observationAndSourceUse.test.ts`。
- 未覆盖风险：真实客户端（C/D）尚未接线 `observation.lastSuccessfulAt`/`readAt` 展示；旧客户端仍显示 legacy `observedAt`（读取于），需 C/D 接线后按新字段复核；本迁移不改变任何产品代码。
- **复核动作**：主控确认迁移口径后，方可把“FS-A04 红例”从 E 红色问题清单移入“已裁决合同迁移（有旧/新证据）”；在此之前保持 `CONTRACT_MIGRATION_SUBMITTED_FOR_REVIEW`。

## 7. 复核命令

```powershell
cd D:\Projects\hongmen-final-e-quality-evidence
npm.cmd test -- tests/final-e/missionCommandsIsolation.test.ts tests/final-e/observationAndSourceUse.test.ts
# 旧证据：evidence/final-e-20261103/logs/independent-tests-run.log（485d485 红单，勿覆盖）
# 新证据：evidence/final-e-20261103/round2-4b69614/logs/（本轮运行日志）
```
