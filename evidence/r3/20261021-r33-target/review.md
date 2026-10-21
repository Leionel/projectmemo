# R3.3 Target 独立审查与修复复核

日期：2026-10-21。审查方：independent_review。审查范围为预授权自动接续、策略撤销与执行边界、Claim 规则/Judge、预算及失败降级。未使用真实模型、搜索、开发数据库或付费 API。

## 已关闭发现

| 问题 | 独立复现 | 修复与复核 |
|---|---|---|
| P1：结构化指标匹配覆盖未满足的显式额外要求 | 问题要求“2026-10 留出集A 的 Dice”，metric 字段匹配但 terms 中的“留出集A”完全缺失。原预览同时返回 SUFFICIENT、present:false 和 remaining:[留出集A]，随后自动恢复为 READY | continuationService.ts 的评估现在要求 structuredMatch 且 checks.every(present)；不满足额外要求保持不足。正式回归“结构化字段匹配不能覆盖未满足的显式附加要求”通过 |
| P2：材料扫描与自动接续扫描共享 updatedAt 导致固定分组饥饿 | 独立临时库16个合格等待任务，连续4轮默认扫描/自动处理，signals=[8,0,0,0]、continued=[0,0,0,0]、READY=0、WAITING_INPUT=16；只有8个任务曾产生到达信号 | sourceSignals.ts 导出 scanWaitingMaterialBatch 的 missionIds；processMaterialContinuationBatch 将同批ID传给自动处理，Worker使用该统一入口。正式16任务回归通过，全部合格任务能得到处理 |

## 独立执行的复核

- 命令：`npm.cmd test -- tests/missionAutomaticContinuation.test.ts`。
- 结果：1文件、12测试通过，退出码0，耗时13.76秒。
- 测试使用独立临时SQLite及脚本Provider；覆盖上述两项回归，并包含预算/云许可/成员权限/取消/暂停、执行中撤销自动许可、自动片段写边界和晚到冲突的既有专项用例。
- 两项发现已关闭；本轮未修改实现或测试。

## Claim 数值、单位与否定的限定复查

另用纯函数探针对完整引文及部分引文进行了6项核查；数据库客户端被指向独立临时目录，未执行真实模型请求。

| 输入 | 实际结果 |
|---|---|
| Dice 0.95 对来源 Dice 0.85，同句型完整来源 | CONTRADICTS / NUMERIC_MISMATCH |
| 10ms 对来源10秒 | NOT_ENOUGH_INFORMATION / UNIT_MISMATCH |
| 显著改善对来源未显著改善，同句型完整来源 | CONTRADICTS / NEGATION_MISMATCH |
| 完全一致的引文、未配置Judge | NOT_CHECKED / JUDGE_NOT_CONFIGURED |
| 部分引文中的否定关系、未配置Judge | NOT_CHECKED / JUDGE_NOT_CONFIGURED |
| 部分引文中的10ms对10秒 | NOT_ENOUGH_INFORMATION / UNIT_MISMATCH |

6项中自动ENTAILS为0。当前 verifyResearchClaims 没有将逐字匹配的规则ENTAILS直接写成最终支持；肯定支持依赖Judge返回。未发现本轮探针中的确定性错误支持。

边界：数值/否定规则只覆盖相应完整来源和句型，不代表所有语义矛盾已识别；部分引文否定用例保留未核验。此结论不替代真实Judge兼容性、双人独立标注、支持精确率及过度拒答评测。代码审查确认Judge走模型预算预留、Output最多3次Judge调用，失败保留NOT_CHECKED；未宣称真实Judge质量通过。

本轮报告仅记录实际独立复现与复核，不把主实现方其他检查结果充作本轮独立执行结果。
