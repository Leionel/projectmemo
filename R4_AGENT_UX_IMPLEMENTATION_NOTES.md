# R4 Agent UX Integration 实施记录

## UX-1 · 2026-10-30

基线 e8281d6b8bb8781447eb1ebfb1a60ebcfcd0dd3a，实施分支 codex/ux1-agent-integration。复用原 CT-1～6、ConversationTurn、Mission Runner、指令事件、来源策略与批准／Action 回执；没有迁移真实数据库或新增执行框架。本轮模型／HTTP 传输测试使用隔离夹具，新增付费模型调用 0。

### A · 共享状态与候选

- 新增纯 workState 投影及可选共享 DTO。Focus、项目语境、Mission 摘要／详情、Handoff、Readback 区分等待用户、等待观察、待批准、排队、有效租约、暂停、失败和 UNKNOWN。精确 question/approval ref 只绑定原对象。
- 原 Runner 提问写 waitingFor=USER；无变化观察只在没有尚待回答的问题时标记 OBSERVATION，不替用户解决原问题。旧记录不足以判断时保持未知；持续服务关闭和许可到期不继续承诺检查。
- 全局按状态有界读取候选，合并已有投影数据，最多协调十二个候选项目，不再逐项目调用整套摘要查询。返回覆盖和计数范围；当前显示范围不冒充全部事项。普通失败不固定抢占用户问题、重要提醒与行动。
- 两端遵循相同 primaryContext 和 fallback 选择；工作指令／复用策略进入观察 hash。generatedAt/checkedAt 不制造重复变化；有效时间边界、回前台和原版本变化触发重读。

### B · 双端原位协作

- Web 默认打开焦点视图，显式会话／原对象深链打开协作；主卡和列表去重，主动作指向原问题／批准／行动。当前重点、原目标和实际进度分层，统计收入筛选入口。
- 委托页显示当前重点，提供原对象协作深链；暂停／取消直接可达。提问正文避免在状态摘要重复出现；步骤和技术设置仍可展开，十类语义块与动态工具选择保留。
- ArkTS 同步 WorkState、Focus、Continuity、Mission/Readback DTO 与纯展示适配；当前重点、等待原因、就近协作、暂停和边界刷新沿原页面实现。没有把网页截图当作原生验收。
- 指引草稿复用原 ConversationDraftStore/sessionStorage。丢回包保留原 commandId/expectedSeq，关闭重开可重放；4xx 要求核对后再操作，5xx／断网保留原请求。账号切换继续使用原草稿隔离和清理。

### C · 原任务与回执

沿原多日接续、纠正和并发测试验证原 Mission 恢复、旧提案拒绝、同一 Action/resultCardId、新会话及不同 session 读回；原 generation/lease、预算与 UNKNOWN 结算逻辑保留。新 UX 服务用例验证超过六个项目、观察等待与真实问题并存、私人归属和读取无派发；Web E2E 验证焦点到原问题、就近指引和刷新读回。

### 验证记录

证据目录：evidence/r4-agent-ux/20261030-ux1/。保留首轮失败、修订及最终回执。

- 全量服务：143 文件／1197 项通过（unit-release.log）。新增持久草稿与最后增量另有受影响检查；最终汇总由 acceptance-summary.json 固定源码与检查边界。
- 较早全量暴露旧查询 mock、原生命周期计数、折叠控件选择器；修为当前方法／语义后受影响 35 项通过。随后 7 文件／45 项通过。
- 较早 Web 4 失败／23 通过／2 跳过：新夹具项目描述不足十字、旧状态文字、重复问题正文、旧卡片位置；修订后继续完整回归，失败日志不覆盖。
- ArkTS 阶段曾因新标签映射的对象字面量未获编译器接受失败，改为显式分支；86 项原生测试与 HAP 构建通过。最终源码再次构建与检查，摘要记录产物 hash。
- HDC 当前返回 Empty，未安装或覆盖任何设备应用数据。目标真机、真实自然日用户、独立质量留出集、正式小艺与生产部署仍未签收。

### UX-2 接续

最终交付检查：完整 Web 27 通过／2 个既有场景跳过；最后源码重建后 6 项关键 Web 旅程通过；受影响 11 文件／55 项通过；types、lint、鸿蒙 86 项及 HAP 全部通过。unsigned HAP SHA256 为 469dd63103d668826e1974ef6dd08a194000dc9f5dd684fe9468ffc68425dc7b。原四项工作树修改逐字节保留；Next 生成的 next-env 路径恢复检查前状态。工程闭环完成，真机、真实多日和独立语义质量 Gate 保留。

根据用户随后提供的“Memory Evolution × Dream Verification × Agent Experience”深化要求，UX-2 当前先做代码审计、技术研究和增量规划，不修改 UX-2 业务代码。需要重新比较纠正的存储归属、稳定假设对象、增量综合和 Context Composer；保留原工具／Generative UI／双端范围及原 UX-J04/05/06/09/10/14。F07 修复仍是 UX-2A 前置，不在 UX-1 中冒充已修复。
