# E5 收尾回执：T1 会议导入闭环界面

日期：2026-09-12。起点 HEAD `2d0db16`。

## 改动

1. **MeetingService.ets / models/Meeting.ets**：preview/confirm 客户端与契约模型（typedChanges、applied、afterSnapshotId）。
2. **MeetingImportSheet.ets**（bindSheet BIG 半模态，工作台"导入会议文本"入口）：
   - 草稿：会议文本 + 会议日期（YYYY-MM-DD）；失败/取消保留输入；
   - 预览：按 决策取代/新增行动/截止变化/结论记录 分类；每项展示标题、原文片段、拟取代对象/绝对新截止；逐项勾选仅限 PROPOSED，NEEDS_CLARIFICATION 红底显示澄清原因且禁勾选；
   - 确认：只提交 proposalId+sourceTextHash+proposalVersion+选择集合；409 STATE_CHANGED_REPREVIEW 时保留输入并自动重新预览；其他错误提示可重试同一次确认（幂等）；
   - 完成：列出实际变更 ID 与去向（新记忆/新待办/新截止），一键"查看会后变化对比"（base→after 快照 Diff，复用状态变化 Sheet）。
3. 工作台记录入口卡拆为"开始记录"+"导入会议文本"两个按钮。

## 命令与退出码

- `npm.cmd run harmony:test` → BUILD SUCCESSFUL，27/27
- `npm.cmd exec tsc -- --noEmit` → 0（后端无改动）

## 状态

| 项 | 代码验收 | 设备验收 | 总状态 |
|---|---|---|---|
| T1 | PASS | 尚未执行 | IN_PROGRESS |

## 剩余限制

- 抽取为规则引擎（界面已标注"规则抽取，未使用模型语义理解"）。
- 超时后"重试同一次确认"由用户手动触发（幂等保证不重复写入）；自动重试未实现。
- 设备矩阵未执行（含键盘遮挡、85% 高度 Sheet 滚动）。
