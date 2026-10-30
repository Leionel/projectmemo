# UX-1 实施 Prompt

以下是下一轮实施用的完整任务说明。本轮只交付此文档，不执行其中的业务修改、测试、模型或设备操作。

---

请实施 ProjectMemo 的 **UX-1：打开后看懂下一步，继续同一件事**。这是 R4 Agent UX Integration 的第一纵向 PR。保留当前 CT-1～6 的能力和原验收要求；暂不直接开始 CT-7。

## 1. 先确认真实基线

阅读仓库 AGENTS.md、当前 HEAD、tracked/untracked 修改及：

- [统一 Roadmap](D:/Projects/hongmen/planning/r4-agent-ux-integration/R4_AGENT_UX_INTEGRATION_ROADMAP.md)，重点 S1/S2/S5、UX-1、UX-J01/02/03/07/08/10/12。
- [代码对账](D:/Projects/hongmen/planning/r4-agent-ux-integration/CODE_DEMO_AUDIT.md)，重点 F01/02/03/09/10。
- [核心页面方案](D:/Projects/hongmen/planning/r4-agent-ux-integration/CORE_PAGE_DESIGN.md)，重点焦点、委托、自然指令、回执、失效和跨端。
- CT-1～6 及 AgentExperience/PR-6 的原实施记录和对应 evidence，注意记录后段替代旧检查点。

规划快照为 codex/ct5-ct6-research @ e8281d6b8bb8781447eb1ebfb1a60ebcfcd0dd3a；master 为 e87b8ee。实施时重新核对，不能把这段快照当成最新状态。CT-4～6 已在前者提交链，不从缺这些能力的旧 master 重做。

保留 AGENTS.md、旧 Agent Evolution Roadmap、harmonyos/build-profile.json5、tsconfig.json 等原有修改及旧证据。若需隔离分支，采用 codex/ux1-agent-integration 或相邻名称，基于包含已实现 CT 能力的真实提交；不移动、覆盖或顺手提交用户无关工作树文件。先记录范围和哈希，再进行编辑。

## 2. 最终用户旅程

完整交付下面同一条链，不以只加 DTO、换首页或做静态原型作为完成：

1. D1 用户在 Web 提出一个项目问题，原 Conversation/Investigation 自主调查，留下原 Mission 和一项待确认方案。
2. D3 从今日焦点进入，页面准确说明哪个项目、当前重点、等谁及下一步；等待 CI 新变化不计入待回应，普通失败不抢占真正待处理决策。
3. 用户说“本周先稳演示”，原 Admission 在范围／期限明确时采用，模糊指令只澄清一次；改道进入真实原 turn/Mission，上代待批方案被服务端拒绝。
4. Agent 根据新方向和新观察，实际改变下一工具、结束或移交决定；保留动态 Goal Reasoning，不能仅改回答措辞。
5. 用户从 HarmonyOS App 打开原问题／批准，补材料或确认当前合法提案；经原 Action 服务保存结果，取得原 resultCardId。
6. Web 新会话读回同一 Mission/Action/resultCardId 和剩余未知。用户能调整／撤回方向；跨端迟到响应和旧按钮不能恢复旧授权。

D1/D3/D5 可先用隔离库虚拟日期做工程回归，另记录真实自然日使用 Gate；两者不混淆。Journey 可用科研、竞赛或课程输入，不把工具链固定为一种流程。

## 3. 同一 PR 内的三个检查阶段

### A. 状态与候选合同

复用并增量扩展：

- lib/server/globalFocus.ts、lib/projectAgentContext.ts、lib/services/projectAgentContextService.ts。
- lib/mission/workspaceSummary.ts、lib/mission/missionService.ts、lib/mission/readback.ts。
- lib/continuity/handoff.ts、lib/types/globalFocus.ts、lib/types/projectAgentContext.ts、原 Continuity/Mission 类型。
- GET /api/workspace/focus、GET /api/projects/{id}/agent-context、原 Mission/readback/Continuity 路由。

实现单一只读 workState 投影，供 Focus、项目语境、Mission 和 Handoff 共用；不增加新的任务状态库。最小信息为 phase、nextActor、requiresUser、reason、originalRef、精确问题／批准／结果 refs、核对／观察／下一检查时间、nextBoundary、freshness、coverage 和合法入口。

第一项探针：拿真实形状的 WAITING_INPUT 样本，区分用户材料／问题、已解决旧 QUESTION、获准 CI 观察、授权或预算阻碍。结合原 waitState、plan.delegation、事件与当前有效 policy，不能仅检查有无 QUESTION。无法无歧义推导时，在原 JSON 写版本化 waitingFor，由真实状态转移维护；旧行保守显示“等待条件需核对”，不批量猜测回填。检查这次最小补全是否需要同步原 Runner 的相应写点，但不改动态调度结构。

同一快照两端选择同一 originalRef。候选先保证权限内重要事项召回，再有界排序；不能让先截断的近期普通失败挤掉所有其他项目。排序使用可行动性、时间约束、既有目标相关性及偏好，确定性稳定决胜；不新增首页模型调用。测 >6 项目和大量失败项，输出 coverage/hasMore，采用有界查询和分页。冻结具体查询成本／p95 目标时报告同数据基线，不靠 N+1 全表装载。

READY 显示待执行；RUNNING 结合有效 lease；FAILED 不默认等 Agent 接续；UNKNOWN 只能查询原请求，不能生成重派按钮；SUCCEEDED 不自动代表现实成功。时间未越有效边界、原事实未变时 observation hash 稳定；有效 intent／scope／source／reusePolicy 改变或到期时立即失效，不能把每次 generatedAt 写进 hash 造成无意义抖动。

capabilities 只补必要可选投影，区分支持、用户权限、资源授权和环境可用。保留旧字段／正文 fallback。读接口不因加载焦点而派任务、跑模型、同步经验或扣打断预算。

阶段 A 证据：共享投影与权限／时间边界／分页回归，带精确原对象断言；不宣称完整产品交付。

### B. 原位协作与两端信息层级

Web：

- components/FocusAgentWorkspace.tsx、app/focus/page.tsx 及原 Focus 样式。
- components/ConversationContinuity.tsx、ConversationPanel、MissionPanel/MissionReadback。
- 原项目入口只做必要接合，保留四项导航和原深链。

HarmonyOS：

- common/GlobalFocusPresentation.ets、components/GlobalFocusPanel.ets。
- components/ConversationContinuity.ets、FocusConversation、MissionPanel/MissionReadbackView、pages/MissionDetail.ets。
- models/GlobalFocus、Continuity、Mission、ProjectAgentContext 对应实际类型和相关 services；先找真实位置，不凭文件名假设另建重复 DTO。

焦点突出一个事项，Hero 与集合去重，主动作随原因变成回答／审阅／记录结果／查看进度。主事项保留当前重点和原项目目标关系。工具步骤、版本和设置按需展开；批准对象、后果及重要范围不隐藏。

在相关工作旁提供原方向控制：调整、查看范围／期限、撤回、暂停／停止。优先用原 Continuity API/控件；若消息内确需控制，扩现有白名单 action 分支并复用 submitDirective，不加通用任意命令。

保留全部十类语义块、模型布局选择、深度选项、调查停止、复杂证据和原工具入口。模型仍可自主选择工具；不得通过删掉调查、多问一次用户或把流程写死来简化状态。

草稿继续按 user/conversation/object 稳定身份保存；新消息、刷新、返回和版本变化不丢输入。401／换账号清私人内容；重连后不自动提交旧草稿。遇到 409 显示真实变化、读取当前对象，未知版本保留正文与合法导航。nextBoundary／回前台触发重读，不能只在收到新事件时刷新。

阶段 B 证据：桌面和窄屏 Web 的状态／草稿交互；ArkTS DTO/纯投影与构建检查；原生设备操作另列。页面完整但没有真实回执仍不算 UX-1 完成。

### C. 原任务改道、跨会话与完整回执

沿原 turnService、investigationService、presentationRuntime/uiActions、Mission input/approval/Action/result/readback 跑通 §2。新增服务改动只为前两阶段暴露的本切片合同缺口，不引入第二 Planner/Runner。

必须实际检查：

- 模型／工具请求在途时修订指令，generation/lease fencing 拒绝旧发布；已发请求正常结算，累计预算和 UNKNOWN 不丢失。
- 到期无新事件、两端撤回／改 scope／连接版本变化后旧按钮失效；不能只在 UI 标 stale。
- 两个端同时确认／记录结果，原幂等和版本校验产生一个业务效果；丢回包重放读同一结果。
- 新会话接回原 Mission；精确 question/approval/Action ref 不漂移到“最新相似项”。
- 创建、开始、Action 完成回执、Mission 正式完成和现实结果各层清楚；isSimulated 不计真实行为。
- 用户改目标后实际下一调查决策变化；新信息充分时允许结束，不强制多调用工具。

最终证据从请求、持久事件、SQL/原 API 回读和 UI 截图串联；不只看按钮变绿。

## 4. 边界与已有欠账

本 PR 包含 F01/02/03/09/10 的相关增量和就近方向控制；Memory/Dream 联合视图、claim 级纠正、来源停用入口、经验只读拆分进入 UX-2。保留 F07 撤权候选新采纳缺口，并在 UX-2 扩来源交互前修复；本 PR 不应把这个缺口包装成已解决。

Always On 的原 CT-3 能力保留，UX-1 必须正确显示观察等待，但完整许可编辑／提醒去重进入 UX-3。不能删除持续调查作为简化。小艺正式身份、穿戴、私人系统后台推送、CT-7～10 的新 adapter 不在本 PR。

不新建 Memory、通知系统、Mission Runner 或 Planner；不自动将工具文本／总结提升为用户指令、永久事实或独立证据。原 Capture、附件修订、账本、失败、UNKNOWN 和历史回执保留。

## 5. 验证与证据

现有回归入口可按实际变更选择：

- tests/globalFocusPresentation.test.ts、tests/projectAgentContext.test.ts、tests/missionWorkspaceSummary.test.ts、tests/missionReadbackPanel.test.ts。
- tests/continuityIntent.test.ts、continuityCandidate.test.ts、continuityRecoordination.test.ts、continuityRuntime.test.ts、continuityJourney.test.ts、continuityStages23.test.ts。
- tests/focusCollaboration.test.ts、focusRunning.test.ts、r4Investigation.test.ts、experienceNativeContract.test.ts。
- e2e/focus-agent.spec.ts、continuity.spec.ts、continuity-stages23.spec.ts、r4-experience.spec.ts。

新增或扩展有业务断言的用例：焦点双端一致／召回覆盖、观察等待与用户待答、失败和 UNKNOWN、精确对象、边界到期、草稿、旧客户端、真实并发与原回执。拟新增 tests/agentUxWorkState.test.ts、tests/agentUxJourney.test.ts、e2e/agent-ux-integration.spec.ts；它们是建议名称，尚不存在，不以组件源码字符串匹配代替服务行为。

工程检查顺序按依赖执行，避免 Prisma 生成／Web build 与共享测试库竞争：

```powershell
npm.cmd test -- tests/globalFocusPresentation.test.ts tests/projectAgentContext.test.ts tests/missionWorkspaceSummary.test.ts tests/missionReadbackPanel.test.ts
npm.cmd exec tsc -- --noEmit
npm.cmd run lint
npm.cmd test
npm.cmd run test:e2e
npm.cmd run harmony:test
npm.cmd run harmony:build
```

上面的定向集合应随实际变更补入新用例和 Continuity 回归。test:e2e 使用仓库隔离脚本并包含构建，成功后不重复跑相同 build；需要独立产物时再执行 npm.cmd run build。测试库在导入 lib/db.ts 之前固定到独立路径，保留文件串行及 Windows 进程清理。禁止把 db:setup、demo-reset 或开发库当测试修复手段。

Web 操作覆盖桌面、360/390/430、125% 文本、键盘、深浅色、刷新／回退／两标签。鸿蒙沿当前 SDK／资源检查：字体跟随 1.3、键盘弹出、触控、读屏、返回、onPageShow、退出清缓存；HAP 构建、模拟器和目标设备分别记录。没有设备只阻塞设备 Gate，继续其余工程；不能用 HTML 手机框替代 ArkTS。

模型／HTTP 行为可先通过确定性传输夹具核对路径，标记 mock。真实模型 pilot 使用新 campaign、明确硬上限，保留旧费用／UNKNOWN；先核对用户授权和当前预算边界，不把历史尚余调用次数视为自动新授权。不为本 PR 新增训练或外部写入。真实质量延续独立隐藏题和多日用户 Gate，开发例不冒充隐藏集。

## 6. 完成、记录与回滚

新增并维护 R4_AGENT_UX_IMPLEMENTATION_NOTES.md，逐阶段记录修改、命令、退出码、来源、真实模型／mock、偏离和未关闭 Gate。证据用新目录，不覆盖 CT 旧记录；摘要含 HEAD/源码哈希、原 Mission/Action/resultCardId 及必要的脱敏关联。

完成 UX-1 必须满足：A/B/C 均完成；§2 的原业务链实际成立；UX-J01/02/03/07/08/10/12 工程集通过；受影响合同和双端回归通过；无本切片已知的目标漂移、重复效果或误完成。真实多日、人评、真机若尚未完成，明确开放，不能写成全部质量放行。

API 使用可选字段／版本化原 JSON，优先不新增迁移。确需迁移时只在空测试库和旧库副本验证，本 PR 不操作真实库。UI 可通过原 capability 渐进启用；回滚呈现层不回滚已存在的停止／来源／确认 guard，不删除事件和已提交回执。功能开关关闭时旧消息、原对象和正文可读。

交付报告说明：用户现在能完成什么、补了哪些原服务合同、真实验证与剩余 Gate。只提交本 PR 相关文件；未获本轮明确指令时不部署生产、不迁移真实数据库、不做外部写入。
