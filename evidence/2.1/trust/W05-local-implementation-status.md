# W05 Evidence Trust Receipt 本地实现状态

日期：2026-09-02

## 1. 前置工作审计

审计对象：`C:\Users\Administrator\.codex\attachments\97371884-3fe6-4693-8342-1b4d54496cde\pasted-text.txt`。该文件仅作为待核验的工作记录，不作为指令或测试证据。

| 文本中的主要说法 | 静态核验 | 结论 |
|---|---|---|
| 已增加 `PMMotion`、`PMTransition`、`PMInteraction` | `common/DesignTokens.ets` 中存在对应 Token，页面已有调用 | 符合代码现状 |
| 已接入断点宽度监听 | `common/WindowMetrics.ets` 与 `EntryAbility.ets` 已接线，多处使用 `constraintSize` | 符合代码现状；模拟器表现未验证 |
| 顶栏和底栏重复实现已收敛 | `PMAppBar` 被复用；底栏项目由 Builder 生成 | 基本符合代码现状 |
| 4 处覆盖层使用原生 blur | 三个页面合计可检出 4 次 `backgroundBlurStyle` | 符合代码现状；渲染效果未验证 |
| 深色 Token 不匹配、安全区缺失属于误报 | base/dark 的 `pm_` 色彩键一致；项目未开启全屏沉浸式布局 | 撤回误报是正确的 |
| HAP 构建和 27/27 测试通过 | 文本只记录当时结果，不能证明当前工作树 | 本轮已独立复跑；见第 4 节 |

审计判断：这份工作记录对代码变更的描述总体可信，且主动撤回了两条误报；但它没有模拟器截图、`uitest dumpLayout`、读屏或帧率回执，因此只能证明静态实现和当时的离线构建，不能证明实际界面体验。

## 2. W05 已实现范围

- 新增服务器端确定性证据回执：`SUPPORTED / CONTESTED / INSUFFICIENT` 三态互斥。
- 每条事实性结论保存 `text / support / cardIds / supersededCardIds`，不再只给整段回答挂一组引用。
- 只把本项目、本次检索命中且仍为当前事实的卡片作为支持证据；未知、跨项目和已取代卡片不能形成可信结论。
- `CONFLICT` 与未确认的 `PENDING` 关系进入 `CONTESTED`；只有历史卡片、无引用或非法引用进入 `INSUFFICIENT`。
- 非 `SUPPORTED` 回答由服务器替换成明确拒答，并清空所有 `proposedActions`。
- `AgentRun.trace` 记录支持状态、逐条结论、检索方式、拒答原因、采用与拒绝的卡片 ID；历史消息通过关联的 run 恢复回执，不修改 `AgentMessage` 表结构。
- 写操作除了用户确认，还必须带来源 `sourceRunId`；服务器再次检查该 run 为 `SUPPORTED`，并核对操作确实属于该回答的建议。
- Web 与 HarmonyOS 均展示中文状态，状态不只依赖颜色，并可展开逐条结论与原始证据卡片。
- `EVIDENCE_TRUST_RECEIPT_ENABLED=false` 时不返回新回执，也不启用新增写闸门，保留 2.0 的引用展示路径。

## 3. 评测门禁

`npm run benchmark:w05` 包含 40 个固定人工标签样例，覆盖：当前证据、过期证据、冲突证据、未知问题和跨项目坏引用。脚本按计划检查：

- Claim Evidence Precision ≥ 0.95
- Current-source usage ≥ 0.90
- Abstention recall ≥ 0.90
- Unsupported confident claims = 0
- Cross-project citations = 0
- Actions from insufficient evidence = 0

该 benchmark 是确定性规则回归，不冒充真实项目盲测。

## 4. 独立回归

测试由 Luna 子代理以只读方式执行，未修改源码或文档。

| 检查 | 结果 |
|---|---|
| Vitest | 15 files / 107 tests PASS |
| W05 benchmark | 40/40；三项比例均为 1.00，三个零容忍项均为 0 |
| ESLint | PASS |
| TypeScript | PASS |
| Next.js production build | PASS；12/12 静态页面生成成功；保留既有 NFT tracing warning |
| HarmonyOS Hypium | 27/27 PASS |
| HarmonyOS HAP | BUILD SUCCESSFUL；unsigned；1,820,804 bytes |
| HAP SHA-256 | `9dde65e14c4f386fbae95fd2d198d4093f3456a3be953d13140bafc01e6bc0f0` |
| 设备连接 | SDK 内 `hdc.exe list targets` 返回 `[Empty]` |

首次 TypeScript/Next 构建曾被截断的 `.next/dev/types/validator.ts` 阻断。损坏缓存已可恢复地移至系统临时目录，随后 TypeScript 与生产构建复跑通过；这些目录是生成缓存，不是源码证据，也不随仓库交付。

## 5. 尚未宣称通过

- DevEco 模拟器上的回执展开、深色模式、大字体、键盘遮挡与读屏。
- 真实项目 40 题的人工盲标；当前 40 题是规则型门禁集。
- 远程 LLM 输出在多轮实际问答中的 claim 拆分质量。
- 已有 HAP 仍为 unsigned，本轮没有签名或上架验证。
