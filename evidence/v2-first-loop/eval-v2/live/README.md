# 真实模型连续改稿评测（授权执行回执）

日期：2026-11-16。执行人：root/lead。分支 `codex/v2-first-loop`。

## 授权与执行

- 用户授权范围：4 条合成旅程，每条**≤12 次模型调用 / ≤60k tokens**，合计**≤48 次 / ≤240k tokens**。
- 命令（密钥来自原工作树 `.env`，仅通过 `node --env-file` 载入，未复制、未写入证据）：
  `node --env-file="D:\Projects\hongmen\.env" --import tsx scripts\eval-v2.ts --provider=live --confirm-paid --max-models=12 --max-tokens=60000`
- 模型：DeepSeek `deepseek-flash`（`LLM_MODE=openai-compatible`），零成本预检通过：`/models` 可用、余额 CNY 37.85。

## 实际用量（含超限说明）

| 项目 | 授权上限 | 实际 | 结论 |
|---|---|---|---|
| 模型决策调用 | ≤48 | **31** | 未超 |
| tokens（AgentRun/预算账） | ≤240,000 | **327,567**（输入 319,760 + 输出 11,807） | **超出 87,567（+36.5%）** |
| 余额变化 | — | CNY 37.85 → 37.63（**约 ¥0.22**） | 已记录 |

超限原因：评测脚本的“派发前 token 守卫”因 Windows CRLF 补丁未匹配而**未实际挂载**，导致只有事后 `TOKEN_CEILING_EXCEEDED` 记录，没有在派发前阻止。该缺陷已修复：`runMissionSlice` 现在接收 `beforeDecision`/`onDecisionUsage` 钩子，fixture 测试断言守卫在第 3 次派发前抛错、成功决策仍被计数；离线 fixture/http 复跑通过。**在获得新的授权前，未再发起任何真实模型调用。**

## 真实模型结果

- 协议/持久化维度：**34/40**；内容维度：**16/24**。
- 四条旅程都完成：初稿 → 新材料唤醒 → 限制落库 → 改道（至少档案/许可/工作重点持久化）→ 暂停/取消；工具边界全部私有（无外部读/写/业务写）。
- 主要真实失败与归因：
  1. **developer**：v1 成功；新材料唤醒后模型在证据未就绪时尝试保存，触发 `SKILL_GATE_NOT_MET`，后续一次模型格式错误/协调后停在 PAUSED，没有 v2/v3。
  2. **freelancer / course**：v1 成功（但首稿主要引用 inspect_project 的项目概况，而不是导入文本），新材料后 v2 正确引用新材料；改道后模型选择 `await_event` 复用上一版 Output，被 `SKILL_OUTPUT_REQUIRED` 拒绝（新周期必须先保存新版本），因此没有 v3。
  3. **research**：三版齐全；v2/v3 正确保留“未独立复现/单位口径未知”，改道后的 v3 实际围绕“限制条件”展开；仅因离线判据要求字面命中“工作重点：”而误判，判据已改为改道关键词命中。
- 内容质量观察：新材料确实改变第 2 版并保留旧依据（freelancer/research/course 通过）；未知条件没有被写成事实；引用可回溯。首稿过度依赖项目概况、改道后不再产出新版本，是需要在提示与门槛上修正的真实问题。

## 基于真实结果做的修复（离线验证）

- `completionReadback` 与持久 SkillCursor 对齐：新周期无当前成果时必须返回 `canCheckpoint:false / CURRENT_VERSION_REQUIRED`，不再让模型误以为可等待旧版本。
- Runner 新增一次受控“方法门槛重试”（`SKILL_REPAIR_REQUESTED` + `skillRepair` 提示）：被门槛拒绝后保留资料与用量，提示先读材料、再保存新版本；每 contextVersion 最多一次。
- `skills/builtins/evidence-research|deliverable-creation/SKILL.md` 明确：导入材料必须用 `read_project_material` 读原文（inspect_project 只是概况）；上下文变化后必须先保存新版本再 `await_event`。
- 评测 `USER_REDIRECT_APPLIED` 改为改道关键词命中，不再依赖离线 fixture 的字面措辞。
- 预算守卫修复并有回归测试；离线 fixture/http 仍为协议 40/40、内容 24/24。

## 未完成与建议

- 上述修复**尚未经真实模型复验**（授权 token 已超限，主动停止付费调用）。
- 建议再次授权一个小范围复验：2 条旅程（developer + freelancer），每条 ≤8 次调用、≤20k tokens，合计**≤16 次 / ≤40k tokens**；守卫已生效且会在派发前停止。确认后我可执行并单独出回执。
- 本报告不含模型原文全文，只保留评测记录与结论；全部数据为合成项目。
