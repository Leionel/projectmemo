# 本批独立复查与修复

## R3.1 / R3.2 后续复查

基线 caf2162。独立 Agent 在临时空库复现两项 P2：

- inspect_action 返回空来源，原行动取消后依赖旧观察的批准仍可消费。修复为 ACTION 指针和实时行 hash；批准前、批准后提交前两条回归。
- WAITING_INPUT 暂停后编辑约束或研究范围会覆盖 resumeStatus，恢复绕过问题。修复保留未回答问题；两条回归。

修复提交 9429ec3；missionRuntime 28/28。用户原有修改未纳入提交。

## R3.3 WP-30 有界独立审查

检查材料版本、幂等确认、循环补查、历史保留和成功验收。新增边界：材料关联卡片已被 Ledger 取代或存在争议时，仅原文/hash 匹配不能当当前缺口已满足。

实现通过 readSetValidator 在确认事务内复用 loadTemporalProject/buildTemporalTimeline；相关状态进入 assessmentHash，SUPERSEDED/CONTESTED 返回 CONFLICT 并保留等待。来源 hash 包含关联卡片与时态关系，预览后关系变化也使旧指针失效。

独立 Agent 新增 missionContinuation.review.test.ts 并验证 1/1。主 Agent 将测试云许可置 true、增加 assessment===CONFLICT 断言后重跑 1/1，避免把“云许可不足”误当时态拒绝证据。主测试还覆盖无关/缺单位/缺时间/无数值、解析失败与修订、重复扫描、迟提交、十次并发确认、来源变化、撤权、取消、预算与权限、关闭开关降级、同 Mission 修订与旧草稿保留。

本批没有剩余已复现阻断。审查不涵盖尚未实施的 WP-31，也未使用真实模型、浏览器或设备验证材料接续。R3.3 整阶段尚未完成。
