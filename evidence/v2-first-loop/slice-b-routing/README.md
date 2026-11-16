# 切片 B：四 Skills 真实路由与 64 条冻结评测执行器

日期：2026-11-16。分支 `codex/v2-first-loop`，基线 `f538e7d`。

## 交付内容

- `lib/skills/router.ts`：确定性请求路由。先区分 ANSWER/CONTROL/CLARIFY/DENY 与 RUN；RUN 内按中文分句与能力动词选择四个内置 Skill 的有序序列，并从负向指令提取限制（不联网、不改稿、不研究、只做计划、只复盘、注意偏好、来源停用、外发需批准）。路由只收窄权限（`toolAuthority: UNCHANGED`），不返回工具集、不加来源、不产生业务写。
- `lib/skills/routingContext.ts`：把持久 Mission/项目/来源/成果/许可投影成路由输入；证据状态按“本 Mission 实际读过什么”计算，不按项目里是否存在材料推断。
- `lib/skills/evidence.ts` + `runtime.ts`：持久 SkillCursor（方法序列、阶段、版本摘要、证据包与确定性未知项）;创作前必须有证据包；新资料唤醒后先重读再改稿；`save_mission_output` 在只做计划/只复盘时被拒绝。
- `lib/mission/runner.ts`：v2 步骤 readSet 合并当前证据包，使创作阶段只使用本 Mission 真实读过（或经路由种子化并通过 `validateSources`）的来源。
- `lib/evaluation/*`：冻结 fixture → 隔离库真实 Project/Capture/Mission/Step/Output/Connection/Artifact 映射；真实派发 trace 采集；31 条确定性断言。
- `scripts/eval-routes.ts` + `npm.cmd run eval:routes`：64 条案例执行器。运行真实 `routeSkillRequest`、`runMissionSlice`、`installRequestRoute`、`complete/commandMission`、Directive、注意力偏好；不读取冻结 expected。
- `tests/skillRouter.test.ts`：限制提取、复合分句、模式区分、权限不收窄，以及 64 条路由回归（真实隔离库）。

## 运行与结果

```powershell
npm.cmd exec tsx -- scripts/eval-routes.ts --out evidence/v2-first-loop/slice-b-routing
node docs/v2/validation/evaluate-routes.mjs --results evidence/v2-first-loop/slice-b-routing/results.jsonl
```

- 执行器：64/64 案例产出结果；54 案例发生真实工具派发（126 次），全部为本地读取或私有草稿；外部读/外部写/业务写派发 0；CONTROL/CLARIFY/DENY/ANSWER 案例派发 0。
- 冻结评分器：模式/主能力/序列 64/64 一致；`safetyViolations` 0；`criticalFailed` 0（16 条安全反例全部通过）。
- 完整 64 条通过 39 条。其余 25 条失败原因均为 `CHECK_NOT_PROVEN` 的内容语义判据（是否真正保留未知、比较边界、历史原因等），离线注入模型不能据此判真，本轮按要求报告失败，没有修改 oracle 或将模型自评当证据。
- 确定性断言覆盖：Mission 复用、暂停先于新派发、限制先落库、跨范围拒绝、未受信来源不当指令、外发需精确批准、来源停用、仅复盘/仅计划不触发创作、证据门槛、引用保留、已采纳成果不变、缺单位数值列为未知等。

## 模型与数据

- 全部为注入确定性 provider；真实模型调用 0，付费调用 0。
- 数据为 OS 临时目录中的新建 SQLite，逐案重放迁移；未触碰开发库/个人数据。
- 执行器不读取冻结 `expected`；评分由 `docs/v2/validation/evaluate-routes.mjs` 独立完成。

## 未验证

- 25 条内容语义判据需要真实模型或独立人工审核；真实模型评测命令待授权额度和范围后执行。
- HarmonyOS/HAP 未构建；本切片无跨端契约变化。
- 生产滚动升级、旧 Worker 混跑未验证，V2 仍保持关闭。
