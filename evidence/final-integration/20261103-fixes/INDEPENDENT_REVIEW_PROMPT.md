# 修复后独立审查 Prompt

请独立审查 ProjectMemo 决赛 A/B/C/D 集成候选。先报告可复现问题，不把上一位 Agent 的 PASS 当作结论。本轮只审查和必要的独立测试，不修改业务代码，不合 master、不 push、不部署、不启动付费调用或后台 Worker。不创建 subagent。

## 1. 固定候选与现场保护

- 集成树：`D:\Projects\hongmen-final-integration`，分支 `codex/final-integration`。
- 待审源码提交：`b8028e3ddb84c5b4ab7e11502a1abf042c4b4cf2`。后续若仅追加审查文档/日志，须用 git diff 确认源码一致。不要把历史 485d485、4b69614 或单轨 SHA 的证据签收到新候选。
- 集成父提交 3e5292e；本次修复包含 A 18a741e、B cbe3230、C 2f71e1e、D 72b2cde。
- 主目录 `D:\Projects\hongmen` 的 master 与未提交签名/类型配置保持原样。不得复制签名密钥、.env 或个人数据库；不得替换、重置、清理其他 worktree。
- 先读 AGENTS.md、当前 HEAD/status、`evidence/final-integration/20261103-fixes/RECEIPT.md`，并记录实际 UTC+8、工作树、源码 SHA、dirty、DB/provider、命令和退出码。如有其他人在使用本树，使用新的 codex/ 审查 worktree，避免共享构建目录。

## 2. 重点复核的八项修复

### A：原问题的持久化资格

定位 `lib/mission/missionService.ts`、`tests/finalARequiresGuards.test.ts`。

1. resolved=true 的旧问题不能因最近事件恰是原 QUESTION 而重新获得输入资格。
2. SQL NULL / JSON null / 缺失 waitState 不能 500，也不能重建授权；必须 409，且不新增 Event/Action，不推进 Mission 版本/预算/状态。
3. 必须存在同一 Mission、同一 ID 的真实 QUESTION；观察事件不得冒充问题。原问题未解决时后续追加观察事件，回答仍应合法通过。
4. 检查并发请求、旧版本、重试幂等、旧提案批准、STOP/lease 围栏，不仅验证前端禁用。

### C：工作包新鲜度、原对象与时间

定位 `MissionReadback.tsx`、`MissionWorkPacket.tsx`、`MissionPanel.tsx`。

5. 回答入口必须匹配 primaryAction.target 的 questionId 与 DOM 的 data-mission-question-id；旧包不能跳到当前新问题。入口不可见时请求只读重查，不改焦点、不创建替代任务。
6. 外层 missionVersion/refreshKey 变化、手动重读在途、焦点回归重查时，旧包动作立即停用；迟到旧 GET 不得覆盖最新回包。401/403/404 清理私有快照；网络失败只能保留不可操作的历史视图。
7. 只有时间越过 nextBoundary/authority 的有效边界也应失效并只读重查；测试后台标签页、睡眠唤醒、超过 setTimeout 上限、失败后恢复、已经过期的回包不造成循环请求。区分期限与授权边界，检查是否误禁用只读查看历史结果。
8. 尚未收到成功 GET 时不能出现“已重新读取”。不得通过放宽测试文案断言掩盖功能失败。

### D：来源谱系与原文入口

定位鸿蒙 `models/WorkPacket.ets`、`components/MissionReadbackView.ets`、`pages/ProjectHome.ets`。

9. currentUse.independentEvidence 表达来源谱系资格，不证明现实目标或回执已独立支持。真实 SAVED 原记录不得显示“有独立支持回执”。检查 Web 相同语义。
10. capture: 必须返回原 projectId / captureId，从已授权项目数据按 KnowledgeCard.captureId 精确定位并展开 rawText，不能调用只接受 ExternalSource 的 ConversationWebSource。
11. 无匹配卡时明确未找到，不替换为其他记录，不把未返回推断为删除。特别记录“有 Capture 但无 KnowledgeCard”是否可达，不能将精确定位辅助函数通过当作原文 UI 已验收。
12. 验证跨账号/撤权后清除、返回导航、冷启动与旧后端缺字段；浏览本人原文不能反向恢复 SUPPRESS_USE 或自动注入调查。

### B：视频焦点

定位 `components/home/DemoVideoPlayer.tsx`。

13. 只有用户点击才建立外部 iframe；交接一次焦点。用户 Tab 到关闭/外链后，延迟 onLoad 和时间流逝不得抢回焦点。关闭恢复门面按钮焦点。
14. 官网仍无私人业务写入；媒体加载前无外域请求。浏览器请求观察不能证明服务端模型调用为零。保留 reduced-motion / 小屏 / 键盘行为。

## 3. 必须保留的合同迁移与历史红例

`e-test-migration/CONTRACT_MIGRATION_FS_A04.md` 与 `*.before.txt` 保留迁移理由和旧断言；更早红日志在 `20261103-review/` 与 E 原树。旧 legacy observedAt 原意为读取时间，新成功观察时间为 observation.lastSuccessfulAt。

本次接受 E 原测试作者的合同迁移：原 33 例扩成当前 49 例，不声称“原 33 例未改全绿”。独立验证：读取时间可以推进、无观察仍 null、成功观察时间恒定、失败/停止/无变化各异、GET 零副作用、原身份和历史事实保留。若迁移与真实消费者冲突，应直接报告，不能用约定遮掩产品错误。

## 4. 验证方式与分母

- 先用 Vitest 的独立测试库。禁止执行 db:setup / demo-reset；禁止给测试指向主开发库；不要开启文件并行。
- 定向：`npm.cmd test -- tests/finalARequiresGuards.test.ts tests/missionRuntime.test.ts tests/missionContinuation.test.ts tests/final-e tests/finalCFreshnessGuard.test.ts tests/finalCWorkPacket.test.ts tests/finalBVideoFocus.test.ts tests/finalBHomepageInteraction.test.ts`。
- 加查 A 服务与真实双连接并发合同、Source Policy、旧消费者回退；既有文件按 rg 检索确定，不编造文件名。
- 放行前全量 `npm.cmd test`、tsc、lint、隔离 `npm.cmd run test:e2e`。重任务串行，Windows 用 npm.cmd；Next 构建可设进程级 CIRCLE_NODE_TOTAL=3，不修改业务配置或跳过类型。
- E2E 分开统计 setup 项、业务 expected/unexpected/flaky/skipped，列跳过原因。独立重跑通过不能抹掉首次失败。历史 E checkpoint 的 1702 PASS 不代表本候选。
- 鸿蒙执行 harmony:test 并核对 Tests run / Failure / Error，而不只看脚本退出码；再构建 HAP，记录文件时间/hash/候选归属。unsigned 编译成功不等于 signed 安装与设备交互通过。
- 设备只有可绑定候选签名且获得安装范围授权才继续。无签名、真机、真实 Worker/模型/自然日/独立用户时按各轨 NOT_RUN/BLOCKED 记录，不伪造验收。

## 5. 输出与裁决

输出一份独立审查报告：每项 Issue ID、级别、源码行、真实复现、影响、最小修复建议及对应 Gate。将 Security / Functional / Evidence / Device 分开；明确是否可合主干、阻断项、可延期事项及未验证风险。没有发现问题也只给出本次覆盖范围内结论。

不要为概念完整新增 Runner、Planner、记忆库或通知系统；不要削弱自主调查、授权校验、UNKNOWN 结算、跨项目隔离或累计预算。

## 本轮补充状态

邮箱注册、验证、重发、密码重置已有实现；登录仍仅按 username 查询，尚不支持邮箱作为登录标识。真实 ECS 发信和邮件收取未核实，不计入线上完成。请将账号完整旅程列入剩余问题；不要未经授权发送真实邮件。

本轮首轮 E2E 为 setup 1 + 业务35 PASS、2 SKIP、1 FAIL（stats expected36 包含 setup）。失败是读回 region 名称变更后的旧定位器。9a28dd3 只同步名称，费用与回执断言未删除；重跑结果见回执。

最新补充：b8028e3 修复部分工作包缺 next/authority 的旧消费者兼容；注册测试独立重放迁移。新增40项通过，其中5项与之前重叠。第二轮完整E2E仍失败：Mission已通过，experiments固定核算在批准后进入EXECUTION_FAILED/UNKNOWN。首轮该例通过，不能提前定性为负载；请优先复核并保留根因未定状态。签收前解决此问题及完整回归。

最终补充：最新 b8028e3 的生产构建和 experiments 定向（setup1 + 业务1）通过，不能冲销第二轮完整回归的间歇失败。原始两轮报告保留；最新源码与当前全量绿线尚未闭合，暂不合 master。
