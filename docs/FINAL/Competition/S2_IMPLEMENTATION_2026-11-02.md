# S2 实施记录

起点 `24004cf91800635e179c651a0599a16e586019f8`，工作树 `D:/Projects/hongmen-s2`，分支 `codex/s2-product-enhancements`。用户在 S1 修复及指南完成后同意开始 S2。本阶段首先交付原第 5 节的结果/成本读回增量，不修改原执行器或计价账本。

## 第一批：原委托的进展依据和本次用量

用户是离开后回来核对委托的学生，想知道任务实际留下了什么、已知用了多少资源及费用为什么仍未知。原读回已有六类依据和 Action/resultCardId，原责任已有累计预算；费用字段固定 null，读回没有直接消费用量。鸿蒙还存在真实字段错配：后端发送 `reviewProgress.classes`，客户端读取 `divisions`，ApiClient 没有转换。

本批目标：在原结果页读回同一 Mission 的依据与累计计数，明确“已记录 token”及 UNKNOWN，不把缺失记录补零。缺少绑定费率/账单时继续报告不能核算费用。只读操作不改变目标、授权、预算、结果或执行状态；没有新增权限。范围仅当前 Mission 的已有累计计数，不合并所有项目、Intake 或独立 Conversation 的成本。

产品裁决（本地项目建议，不是平台强制规则）：

- 复用原读回中的内联展开，保留原 Action/成果跳转，不建新页：`rule/smallest-intervention`、`rule/inline-before-modal`。
- 缺失、未知、历史结果和不支持计价分别说明；不显示“总费用 0”：`rule/cover-reachable-states`。
- 修复鸿蒙真实 JSON 字段映射，避免用户已有结果区域不可用；保持原 token/session/generation 栅栏：`rule/preserve-mental-model`。
- 不用模型再写一次成果总结，不引入新调用、费率猜测或现实成效推断。成功信号是同一原回执＋累计计数两端一致，未知未被藏掉。

真实设备、计价覆盖、跨入口任务成本、分享和 Intents 仍沿原 S2 条件推进。

## 本批结果

业务提交 `6a9042396f3cbfaa2b2b5e83b977cf2720012d51`。复用 `/api/missions/:id/readback`，只增加 `resourceUsage` 投影；没有 schema、Runner、模型请求或外部写入。直接读原 `budgetUsedJson`，重复读取不重新按事件加总、不清零预算。非法/缺失 token 保持 null，已有 token 为 0 时保留 0；费用仍为 null/UNPRICED，明确未绑定费率和账单。

Web 入口：长期委托 → 执行详情与回执 → 本次用量。鸿蒙沿原结果与回执区域展开，不新增页面。新客户端把用量字段设为 optional，旧后端无该字段时继续读原结果；`reviewProgress` 改为消费后端已有的 `classes`，不保留另一套别名。

| 验证 | 结果 | 边界 |
|---|---|---|
| 定向单元/集成 | 4 文件 / 28 项通过 | 原鉴权与读回、重复读取无业务写入、未知费用、Web 展开与原接续回归 |
| 类型/lint | 退出 0；9 条既有 warning | 未添加 ignore |
| Web 生产构建及任务纵向 E2E | setup 1＋业务 1 通过，0 跳过/失败/flaky，retries=0 | 原任务创建→问题→材料→批准→成果→用量→再次复用，属于定向旅程；没有声称 S2 全量 E2E 已跑 |
| Web 1280 / 390 | 已生成并查看截图，390 无水平溢出 | 桌面元素截图上边缘受到原固定导航遮挡，不能当完整桌面页面验收；本批用量内容可见 |
| 鸿蒙单测 | 103 通过，0 失败/错误/忽略 | 新增实际 JSON 字段、未知价格、旧服务兼容合同；不等于设备 UI 操作 |
| HAP | unsigned 构建通过 | 7,914,013 字节；SHA-256 `31b69c6a4f11307d4abc083b401c0bad448e8d10e7bf7f838f3a51748a132e20`；未安装 |

证据：`evidence/s2-resource-readback/20261102/`。本批没有付费调用，没有部署、推送、合并 master 或迁移真实库。原主目录的三项 tracked 修改和其他 worktree 保留。

## 第二批：项目前材料实际送入范围

用户上传一份 40 页 PDF，看到“已保存”就以为模型读了全文；实际每份最多 20,000 字、总计 24,000 字，按顺序截取。本批把“实际送入”变成可见事实，并给出按页原文核对入口。

- `lib/intake/coverage.ts` 确定性切分：每份 `availableChars/plannedChars/lastSentChars/lastSentTruncated/reason`；区分“已送入/截取/未送入/没有可读文本/之后新增”。
- 预览 `coverage` 同时给出 `lastSent`（上一轮真实送入，含 `understandingPublished=false` 的失败轮）与 `current`（当前材料下次会送入）；材料变化后 `stale=true`，旧轮次不再冒充当前。
- 新增 `GET /api/intake/:draftId/materials/:materialId`：owner+开放草稿、分页上限 4000 字；确认建项后返回 409（由项目内深读承接），撤回/到期不再返回副本。
- Web 新增“模型实际读到的范围”面板（逐份状态 + 原文分页）；鸿蒙预览新增同源摘要、逐份状态与原文分页；未同意时明确“材料不会被送入模型”。
- 验证：`tests/s2IntakeCoverage.test.ts` 8 项（用注入模型实际收到的消息反算字符，与覆盖逐份对齐）；`tests/projectIntake.test.ts` 8 项、`tests/s1IndependentReview.test.ts` 21 项回归通过；鸿蒙 105 项；intake E2E 断言覆盖面板与原文核对。

## 第三批：可核对的调用与仍未知的费用

原“本次用量”只有累计计数。用户看不出哪些调用有回执、哪些失败或用量未知，也看不出为什么仍不能估价。本批只读原 `AgentRun`/`AgentMissionStep`：

- 模型调用按 `trace.missionId` 归属并按 AgentRun 去重；工具调用按 Step 计数，两者不相加冒充调用次数。
- 用量记录要求 `inputTokens/outputTokens` 都是安全非负整数，否则计入 `usageUnknown`；失败码保留。
- 读取上限 20，达到上限时 `truncated=true` 并明说“计数是下界”。
- `pricing.state=UNPRICED`、`estimate=null`、费率来源/适用时间/币种为空；不把次数换算成金额。
- Web/鸿蒙在原“本次用量”内联展开里呈现同一摘要与边界，不新增页面。
- 验证：`tests/s2CallCoverage.test.ts` 4 项；missions E2E 断言调用摘要与“费用与估算保持未知”，截图写入新目录 `evidence/s2-usage-coverage/20261102/`，不覆盖第一批截图。

## 第四批：Adaptive 偏好的边界（核对既有能力，不新增偏好系统）

核对结论：明确偏好的保存/局部覆盖/暂停/纠正/删除/到期与跨项目作用域已由 PM-1～4、Continuity 与 Attention 覆盖（`tests/pm1*`、`pm3*`、`pm4*`、`ux3AttentionContinuity`）。本批只把 S2 要求的边界固定为回归：

- “少问我/安静一点/以后少打扰我”经原 `admitDirective` 都不是已生效指令；走原 `submitDirective` 也不产生指令事件、约束，Mission 的 `constraintsJson/budgetJson/planJson` 不变。
- 静默时段（原 `InterventionPolicy`）只抑制提醒派发（`QUIET_HOURS`），Mission 必答问题仍 `WAITING_INPUT`，约束与预算不变。
- 验证：`tests/s2AdaptivePreference.test.ts` 3 项。没有新增画像或平行偏好系统。

## 第五批：系统分享与 Intents（平台条件探针：NOT_RUN）

用只读探针核对真实条件，不构造假入口：

- 已装 SDK（OpenHarmony ets 6.1.1.125，API 24）有 `@ohos.app.ability.ShareExtensionAbility.d.ts` 与 `@ohos.app.ability.insightIntent.d.ts` 声明。
- 本仓 `module.json5` 没有分享扩展、没有 `sendData`/`system.share` skill、没有 Intents 注册；`build-profile.json5` 的 `signingConfigs` 为空（不得复制主目录私钥）。
- HDC 目标 `127.0.0.1:5555` 是 **emulator**（API 24，shell 可达）。unsigned HAP 安装返回 `9568332 install sign info inconsistent`。
- 因此：系统分享与 Intents 的设备/平台验收为 NOT_RUN；应用内文本/PDF/图片入口继续可用，URL 只作为文本材料、不自动 Fetch。恢复条件：具备签名配置/受权调试签名与已完成平台登记后，先跑设备探针再实现入口。
- 证据：`evidence/s2-platform-probe/20261102/`（probe JSON、HAP 构建、安装失败日志）；`scripts/probe-platform-capabilities.ts` 可复跑。

## 第六批：失败改进（样本同意 Gate 未满足：NOT_RUN）

原 trace/Experience/评测能力已存在（`lib/experience/*`、`tests/ct8OutcomeExperience`、`r4ExperienceContract`），但跨用户失败样本与独立标签需要用户明确同意与人工脱敏。本轮没有获得该同意，因此不导出真实 trace、不构造“真实用户价值”结论。合成负例只由既有 Experience/评测测试证明工程行为。恢复条件：用户提供脱敏样本与使用同意、冻结开发/留出划分后，再按原协议做条件匹配的 Experience 开/关/拒用配对。

## 本批验证（源码 `601f486`/`cc958be`/`88383e1`，之后只补文档与证据）

| 检查 | 退出码 | 结果 | 证据 |
|---|---|---|---|
| `npm.cmd test`（全量） | 0 | 202 文件 / 1544 项通过，638.21 秒 | `evidence/s2-resource-readback/20261102/logs/s2-full-tests-final.log` |
| `npm.cmd exec tsc -- --noEmit` | 0 | 无错误 | `logs/s2-types-final.log` |
| `npm.cmd run lint` | 0 | 0 error / 9 warning（既有） | `logs/s2-lint-final.log` |
| `npm.cmd run test:e2e`（全量） | 0 | setup 1 + 业务 36 通过，2 原有跳过，0 失败/flaky/重试，210 秒 | `logs/s2-e2e-full-final.log`、`logs/s2-e2e-results-final.json` |
| `npm.cmd run harmony:test` | 0 | 105 通过，0 失败/错误/忽略 | `logs/s2-harmony-final.log` |
| `npm.cmd run harmony:build` | 0 | unsigned HAP 7,958,933 字节，SHA-256 `fc30da49…7f44` | `logs/s2-hap-final.log` |
| 平台只读探针 | 0 | SDK 有声明、未注册、模拟器可达、无签名 | `evidence/s2-platform-probe/20261102/platform-probe.json` |
| unsigned 安装尝试 | — | `9568332 install sign info inconsistent`（失败，如实保留） | `evidence/s2-platform-probe/20261102/logs/unsigned-install-attempt.log` |

失败与重跑分开记录：E2E 第一次运行在构建阶段崩溃（`0xC0000409`，紧接 10 分钟全量回归后的内存压力），同一源码空闲后重跑通过；没有调超时、加跳过或改断言。该次日志被随后成功的同一命令覆盖，失败事实保留在本记录与 `CONTINUATION_ACCEPTANCE.json` 的 `webE2e.firstAttempt`。

未签收：真实模型质量/费用、模拟器或真机安装与交互（unsigned 被签名校验拒绝）、系统分享与 Intents（未注册、无签名）、自然日、失败样本独立评审、独立复核、生产部署与真实库迁移。

## 下一批与未完成范围

- 结果与成本包还需要绑定工具/模型版本和费率来源后才可估价；当前只交付可核查用量、调用覆盖和未计价状态，不声称完整任务账单。Intake、Conversation 与其它独立讨论的跨入口成本关联仍待沿原身份核对。
- 分享与 Intents 的恢复条件见第五批；Personal/Adaptive 与失败改进见第四、六批。
- 真实模型、设备与自然日轨继续按用户指南独立留证据；原 S1 全量检查不能替 S2 全量或这些真实轨签收。


本批设计采用 product-design 的 shape，Web 采用 ui-design 的既有样式增量实现，鸿蒙采用 harmonyos-design 的现有工程实现模式。读取了产品规则/判断/表面状态、Web aesthetic-direction/design-guidelines/general/typography/section-layout/colors；沿原 Token，无主题或动效重绘。
