# CT-3 持续调查实施记录

2026-10-29：继续 CT-2/CT-3，复用原 Mission/worker/lease/budget/Goal Reasoning。无新 Runner、Planner、记忆表或真实数据库迁移。

## 已实现的纵向链路

原 `continuationPolicy` 增加版本化 `BOUNDED_INVESTIGATION`。用户在原任务上核对项目范围、截止时间、模型/工具累计总上限、允许工具与安静时段后保存。云模型上下文仍使用原许可，外部读取仍受原公开研究范围和连接权限约束；模型不能产生这份授权。

原 worker 领取同一个 Mission。动态工具选择继续工作，用户暂停、撤权、指令失效或期限到达都在原租约/预占/提交入口重新检查。原 used 预算不因醒来、改许可或进程重启清零。READY 任务按最近运行时间公平领取，扫描先筛选到期的委托调查，避免大量人工等待项挡住批次。

当前唤醒源是本项目新资料、附件修订、真实行动结果和已刷新的仓库信号。定时检查本地输入指纹；无变化零模型调用，变化后提供可访问原资料指针，再进入原动态调查。当前没有后台主动轮询远程 CI；委托 UI 默认内部资料，Web 可明确允许原公开研究工具。CI 连接范围合同已有，但委托表单还没有连接选择器，不能把已有 CI 授权自动变成持续远程监控。

个人注意力读原 GoalQuestionPreference / Anchor STOP、LATER，加用户时区安静时段，返回 DIGEST/QUEUE/SUPPRESS。当前使用原私有 Mission 收件箱，不发送系统推送。需要用户处理的期限、预算和等待状态可在原任务读回；READY 显示“等待 Agent 接续”，不冒充正在执行。尚未完成与原 InterventionDecision/Delivery 的完整紧急打断联动，不能宣称注意力策略全部完成。

Web/ArkTS 都支持核对期限、累计预算及撤销；原确认、Action/resultCardId 回执链保持。三日接续使用隔离库与虚拟日期，未声称真实观察三个自然日。

## 验证

`tests/continuityStages23.test.ts` 覆盖真实原服务的 CI→失败任务→脱敏日志、撤权后的派生成果、同任务三日接续、无变化零模型、预算累计、过期暂停、私有 STOP/安静时段及换步骤不能重发 UNKNOWN。另有 9 个人工等待任务不阻塞委托扫描的负例。

完整服务回归 135 文件 / 1151 项通过；最新补丁受影响检查单独记录。证据目录 `evidence/r4-continuity/20261029-ct2-ct3/` 保存失败和修复记录。最终类型、lint、Web E2E/HAP 状态以实际回执为准。

参考比较：[Temporal TypeScript SDK](https://github.com/temporalio/sdk-typescript)（MIT，超过 500 stars，近期维护）的持久定时与重放边界，[LangGraph](https://github.com/langchain-ai/langgraph)（MIT，活跃维护）的中断/接续与检查点思路。采用持久状态和效果分离原则；本仓库已有持久 Mission，因此不引入这些运行时，不复制外部代码。

## 未完成验收与后续

1. 当前完整 Web 授权/撤回旅程及双端构建结果落盘；补生成式 UI、模型质量和目标设备旅程。
2. 为委托 UI 接入原 CI 连接选择和可批准的远程观察周期，继续使用原 MissionStep 请求记录。
3. 在不泄露私有 Mission 的前提下完成原 USER Intervention 预算、紧急打断和回执联动；保留当前无系统推送默认值。
4. 补双 worker 并发、断线重启、截止瞬间/停止竞争、连续无信息、false silence 与多项目长旅程。

本轮未发起新付费模型调用、生产部署、真实数据库迁移、外部业务写入或 push。用户提醒关注 5 小时额度后进入收尾批次，保留完整能力目标及未完成 Gate。

## 额度收尾检查点
5 小时额度已用100%，北京时间2026-10-29 12:40:38重置。保存实现检查点，未标记CT-2/CT-3全部完成。全量1151项、最新保护8项、类型/lint及HAP通过；最终浏览器回执状态：PENDING，原始日志为 evidence/r4-continuity/20261029-ct2-ct3/e2e-fixed.log。额度后继续核查该结果并完成剩余Gate。

## 2026-10-29 第三批：原 Runner 定时观察、私有注意力与双端收口

本节替代上文“当前没有后台主动轮询”等未完成状态，保留早期失败记录。Web/ArkTS 原委托表单均可选择最多三个已经授权的 CI 连接，确认检查周期、累计请求预算及是否允许脱敏失败日志。保存连接 revision，不能因撤销再授权或 feature flag 自动扩大原许可。只读已收录的最新固定提交；新 ref/head 的发现沿原仓库信号刷新，不悄悄变成仓库全量追踪。

原 worker 到期只将同一 Mission 置为可运行并写入观察意图，不在事务中联网。原 Runner 用原 MissionStep 执行声明过的 CI 状态读取，沿用 lease、HTTP 请求记录、累计工具及元数据预算。成功步骤可在进程恢复后复用，UNKNOWN 不换步骤重发；已知稳定观察比较忽略抓取时间和条目顺序。无变化返回原 WAITING_INPUT，零模型调用；首次/新状态才进入原动态 Goal Reasoning。调查仍由模型动态选择工具，没有固定 CI→job→log 流程。新测试修复了跨 planRevision 后步骤 ordinal 必须在整个 Mission 上单调递增的问题。

私有注意力复用原 USER InterventionPolicy、BudgetLedger 和 InterventionDecision，channel=PRIVATE_MISSION；不创建共享 AgentIntervention，不向项目成员公开原任务。共享决策列表排除私有通道。普通事项留在任务收件箱，STOP/LATER、委托及用户静默期都生效。只有任务真实截止一小时内且存在 CRITICAL/CONFLICT 待答问题才申请一次个人打断预算；无预算继续排队。静默结束、预算日边界无需新资料即可重新判断，既有 GoalQuestion 的 PRESENT/EXPOSED 已接通同一私有决策，避免重复扣预算；主动打开原任务仍可查看问题。Web/ArkTS 可读回“我已看到”的带版本和幂等回执，不将 AVAILABLE 当成送达或已读。默认 systemPush=false，尚未进行设备通知签收。

新增保护覆盖双 worker 同时扫描/领取、HTTP 途中暂停、截止瞬间迟到结果、稳定 CI 零模型、变更后改道、跨项目连接、撤销再授权、同 USER 跨任务预算、静默边界和私有已读权限。多日旅程仍是隔离库虚拟日期；独立 OS 重启长跑、真实多日/目标设备接受度留作环境验收，不改写为已通过。

最终结果：完整服务 1158 项；受影响 25 项；完整 Web 24 通过/2 跳过；鸿蒙 86 项与最新 HAP；类型/lint 通过。付费 pilot 17 次模型请求，费用上界 0.317104 元，UNKNOWN usage=0，原 24 次/5 元 campaign 未重置；保留初次引用失败、同任务恢复和分离模型评审。公开固定 SHA 的真实传输已经取得，真实失败日志域名尚未签收。证据目录同上。

用户追加交付顺序：先把 R3 runtime → PR-6 → CT-1 → CT-2/CT-3 合并到 master，再开始 CT-4 文档深读、CT-5 指标/固定沙箱和 CT-6 论文检索。合并不包含生产部署或真实库迁移。
