# M3：真实成果挑战与原生工作台

基线 `97d2c15`，工作树 `D:/Projects/hongmen-worktrees/v2-first-loop`。

## 本片交互裁决

使用者已有私有稿，希望交付前找出真实缺口，并在换设备后继续核对同一成果。旧界面的玩法仅改变本地组件状态；本片将回答、来源定位与核查请求保存为既有 Mission 事件，显式交回原委托后才产生待核对反馈。成功信号为同一 Mission 新修订包含核查意见，旧稿不改写。

- `rule/value-before-interruption`：成果先可读，挑战仅作可选内联入口。
- `rule/inline-before-modal`、`rule/smallest-intervention`：复用原工作台、事件账和 AgentPresentation；新增接口不引入游戏引擎。
- `rule/name-object-scope-consequence`：答题仅保存本轮；“把核查缺口交回原委托”才追加待核对反馈，不改变项目事实或执行权限。
- `rule/cover-reachable-states`、`rule/preserve-user-input`：加载、稀疏、过时、撤权、停止与不确定回包均有出口；重试保留原请求与输入。
- 证据侦探首片使用可确定的引用追溯，支持多来源选择；引用命中不等同事实得到核验。指标可比性题留待稳定指标对照数据。
- 严格导师为三轮开放核查，不自动给真假分；新材料/来源变化/撤权/改道/新稿/24h 到期撤题。手机继续读取同一 session。
- 玩法状态在独立命名的 Mission 事件中投影，避免与 Runner 并发覆盖 planJson。每轮来源最多 16 个、回答最多 3 次；事件读取有界。未增加 Schema/Migration。

参考 [Anki reviewer 源码](https://github.com/ankitects/anki/blob/main/qt/aqt/reviewer.py) 的问题/回答/过渡分离及失效后刷新思路；Anki 为 [AGPL-3.0-or-later](https://github.com/ankitects/anki/blob/main/LICENSE)，本片未复制代码、未安装依赖。ProjectMemo 仍使用自己的身份、来源和 Mission 协议。

## 实施与验收

### 切片 A：成果挑战

- 代码：`lib/challenges/{rules,service}.ts`、`lib/types/challenge.ts`、两个 `missions/[id]/challenges` API、`OutcomeChallenges`；旧 `OutcomeWorkbench` 保留 AgentPresentation，真实模式替换本地样例玩法。
- 状态：ACTIVE → COMPLETED → 显式 HANDOFF；STOPPED 独立退出；STALE 按当前原稿/来源/输入/上下文投影。每个写操作在原 Mission 写锁下检查并持久化幂等键；同编号改内容拒绝。
- 反馈与回执同事务提交，复用 `addMissionMaterialInTx` 和原扫描器；不会恢复已暂停或结束的委托。派生 Capture 标记 `CHALLENGE_FEEDBACK`，由原 `sourcePolicy` 沿 handoff → 原 Output → 原来源检查撤权，不把反馈副本算独立证据。
- 旧事件接口只返回挑战 ID，不外露题面/答案/判定键；模型上下文不消费挑战私有事件。原生旧事件客户端继续收到已有事件结构，未知类型沿既有降级显示；无新增 AgentPresentation wire kind。
- 开关：`MISSION_CHALLENGES_ENABLED=false`，加入 Worker 身份指纹；关闭只撤下挑战入口，不影响原成果和持续委托。
- 无新增 Schema/Migration，无新依赖；唯一 Schema/Migration 负责人仍是 Codex 主代理。

```powershell
npm.cmd test -- tests/v2Challenges.test.ts tests/v2MaterialsJourney.test.ts tests/continuitySuppression.test.ts tests/v2SkillArtifacts.test.ts tests/s0WorkerIdentity.test.ts
npm.cmd exec tsc -- --noEmit
# 对本次改动的 TS/TSX 执行 scoped eslint，日志见 lint.log。
$env:NEXT_DIST_DIR='.next-m3-build'
npm.cmd run build -- --webpack
```

定向 5 文件 / 34 条通过；类型、scoped ESLint、Web 生产构建通过。新挑战测试 17 条，覆盖多来源/非事实推断、幂等与并发重试、重载、跨项目/失权、材料与版本失效、结束后不接新回合、暂停不恢复、派生来源缺失、真实 Runner 新修订。未修改既有冻结路由 oracle。

```powershell
$env:V2_ENTRY_PORT='4440'
$env:NEXT_DIST_DIR='.next-m3-build'
$env:V2_ENTRY_PRODUCTION='true'
$env:MISSION_CHALLENGES_ENABLED='true'
npm.cmd exec tsx -- scripts/v2-entry-demo.ts
# 新终端；每次使用全新 demo 实例。
$env:M3_EVIDENCE_DIR='evidence/v2-first-loop/m3-experience-20261117/browser-final'
npm.cmd exec tsx -- scripts/verify-v2-m3.ts
```

生产构建浏览器五组检查通过：三轮彩排/来源阅读/刷新恢复 → 两次丢回包幂等重试 → 同 Mission 第二版；依据原引用的多选追溯；360px；原生格式的同对象暂停/补反馈 HTTP 请求；来源撤销后原文与派生反馈均不再出现在工作台。使用合成 SQLite 与 localhost HTTP mock，不是物理手机验收。

证据在 `evidence/v2-first-loop/m3-experience-20261117/`。`browser-final/` 为最终截图；`browser-production/` 为此前同样通过的生产验收，`browser-dev.log` 记录了验收脚本误把正常 202 当错误的首次失败，随后已修复。截图滚动位置修正后再跑完整流程，并未改变业务代码或判据。

本片未验证真实模型质量、真实用户玩法价值、容量/72h 或生产部署。指标可比性题、独立尝试删除/保留策略、回访胶囊和双人冲刺仍未落为正式功能；原生适配另记下一切片。
