# CT-9A 隔离浏览器只读调查实施记录（2026-10-30）

## 阶段与基线

- 工作树：`D:\Projects\hongmen-ct8`
- 分支：`codex/ct9-browser-read`（按用户选择在原分支继续，未另建工作树）
- BASE_SHA：`108bbeb`（CT-8 最后提交，工作树 clean）
- 本阶段无 Prisma migration；只新增 JSON/DTO 字段与 `ExternalSource` 的 `resolvedUrl` 复用。
- CT-9B/CT-10 未在本阶段实现，也未开放外部写能力。

## 实际增量

### 隔离浏览器运行时

- `lib/browser/contracts.ts`：受限只读观察 DTO；固定 `maxRequests=24`、`maxBytes=4MB`、`maxRenderMs=12s`、`maxScrolls=2`。
- `lib/browser/policy.ts`：
  - 统一校验顶层导航、重定向、iframe、脚本/图片/XHR 等所有请求的 HTTPS、端口 443、无 userinfo、无 IP 字面量、域名范围与敏感 query/path。
  - DNS 解析要求全部地址为公开地址；拒绝 loopback、私网、link-local、metadata、CGNAT、保留段、IPv4-mapped 私有地址、NAT64/6to4 等。
  - 测试环回来源只在 `VITEST`/`NODE_ENV=test` 且显式配置 `BROWSER_TEST_ALLOW_ORIGINS` 时生效，且只接受 loopback 精确 origin。
- `lib/browser/reader.ts`：
  - `playwright-core` 启动临时 Chromium，无用户 profile、storageState、cookie、扩展、剪贴板或本地文件。
  - BrowserContext 关闭下载、阻止 service worker；页面弹窗关闭、dialog dismiss、download cancel。
  - `context.route` 对全部请求套用同一策略；非 GET/HEAD 请求（表单、fetch POST 等）阻断；WebSocket 通过 `routeWebSocket` 关闭。
  - 只允许固定声明式动作：读取可见正文、最多展开 3 个原生 `<details>`、固定滚动；不存在模型自由 JS/evaluate、CDP 或 shell。
  - 读取上限后再截断正文；保留 heading、可见文本 hash、body 定位、覆盖、请求/拦截/字节、截图 hash（不持久化截图字节）。
  - 状态区分 `RENDERED`、`PARTIAL`（异步未完成/超时/预算）、`EMPTY`、`BLOCKED`、`FAILED`；重定向到未获准地址或私网地址标记 `BLOCKED`。
- 能力开关：`BROWSER_READ_ENABLED` 默认关闭；运行时需 `playwright-core` 与 Chromium（可用 `BROWSER_CHROMIUM_EXECUTABLE` 指定）。不可用时工具不进入模型工具集，调用返回 `BROWSER_UNAVAILABLE`，不伪造成功。

### 两条原执行入口

- Conversation/Focus：
  - `researchToolSchemas` 新增 `browser_read`（只能引用本轮已观察网页 sourceId/revision，不接受任意 URL）。
  - `readConversationResearchTool` 在 `turnOperation` 原外部 operation/lease/预算内执行；新增 `beforeReserve` 事务钩子用于“每轮最多 2 次不同输入渲染 + 累计请求上限 60”的累计检查；重复输入走原 operation 回放，不重复启动浏览器。
  - 结果写入原 `ConversationSource/webSources`：`readLevel=BROWSER_RENDER`、`retrievalMethod=ISOLATED_BROWSER`、`resolvedUrl`、`browser` 元数据；沿用 `SourcePolicy`/`validateWebSource`、scopeRevision、来源抑制与迟到结果校验。
  - 模型只有在 Fetch 不足以获得当前问题所需可见正文且渲染有明确价值时才会看到/选择该工具；Fetch 足够时不会自动调用（负对照测试覆盖）。
- Mission：
  - `lib/mission/tools/browserTools.ts` 新增 `browser_read` ToolSet，复用 `fenced` lease、scopeRevision、`externalSource` 来源与 `persistObservations`。
  - 渲染前在 Mission 账本事务预留最坏请求/字节额度；返回后按实际请求/字节结算；失败保留预占（崩溃/未知不静默清零）。
  - 每次渲染是独立快照：`externalSource` id 绑定 observedAt/finalUrl；同 URL 旧快照标记 `SUPERSEDED`，不把旧截图当当前页面。
  - `Source`/`sourceContext` 增加 additive `browser` 摘要（status/finalUrl/observedAt/complete/failureCode），模型可区分完整/部分/失败。

### 双端

- Web：`/focus/source/...` 显示“网页渲染读取”、最终站点、快照时间、实际覆盖、请求/拦截与失败原因；正文仍是保存的可见片段。
- 鸿蒙 ArkTS：`ConversationResearch.ets` 增加 `browser`/覆盖/定位模型；`researchReadLevelLabel` 增加“网页渲染读取”；`ConversationWebSource.ets` 读取同一服务端来源与快照状态，不新建第二套 token/浏览器或本机系统浏览器冒充受控 adapter。

## 明确边界

- 不导入真实浏览器 profile、cookie、扩展、剪贴板、云账号或生产凭据。
- 不登录、不提交表单、不购买/发送/确认/同意、不上传、不绕过验证码/付费墙；不点击“下一页/查看”等未审查控件。
- 页面文字、DOM 与截图均是数据，不改变权限、工具、scope 或预算。
- PDF 下载不走浏览器下载通道；原 PDF 仍走 Fetch/附件/CT-4 链。
- 供模型/API/证据的内容不含 cookie、响应头、token 或私有地址。

## 验证结果

- `npm.cmd exec tsc -- --noEmit`：通过。
- `npm.cmd run lint`：通过。
- `npm.cmd test`：159 个测试文件、1295 项通过，其中 CT-9A 新增：
  - `tests/browserPolicy.test.ts` 38 项（URL/私网/端口/敏感 query/DNS 混合/测试 seam）。
  - `tests/browserReader.test.ts` 7 项（真实 Chromium：JS 渲染、EMPTY、异步 PARTIAL、注入/弹窗/表单/WebSocket/私网 iframe 与图片、私网重定向、原生 details、子请求预算）。
  - `tests/browserConversation.test.ts` 10 项（来源/operation/回放/部分/阻断/UNKNOWN/停止/撤权/跨账号/Fetch 负对照/能力关闭）。
  - `tests/browserMission.test.ts` 6 项（来源/预算/上下文/部分/阻断/跨 Mission/scope 变更/预算不足/并发切片单派发）。
- `npm.cmd run build`：通过。
- `npm.cmd run test:e2e`：隔离库迁移重放、seed、生产构建与浏览器 E2E 通过（`[e2e] completed with passing result`）。
- `npm.cmd run harmony:test`：86/86 通过。
- `npm.cmd run harmony:build`：通过；unsigned HAP `entry-default-unsigned.hap`，6,751,363 bytes，sha256 `8aa75cab90075835405ad6cf9bf26eddd4ce99447be075a01ae79959bb24bc9a`。

## 剩余 Gate（未签收）

1. 真实模型在公网受控 JS 页面上的动态选择与 GoalGap 改变：本阶段用受控本地站点 + 测试 Provider/Logger 验证工程路径，未使用付费真实模型。
2. 真实公网站点（非本地受控站点）隔离读取：未在本阶段执行公网 campaign；本机 Chromium 与本地受控站点只作为浏览器运行证据。
3. 鸿蒙真机/模拟器页面联调：HAP 可编译、单元测试通过，未声明设备联调完成。
4. 网络隔离残余风险：每次请求均检查 URL/DNS 并要求全部解析地址公开，但 Node 检查与 Chromium 实际连接之间仍存在 DNS TOCTOU 窗口；未宣称等同于网络级强制沙箱。
5. 截图只保存内容 hash 作为出处，不持久化截图字节；需要人工截图复核时另行提供证据。
6. CT-9B（真实 provider OAuth 只读）与 CT-10（外部写）未开始，不能由本阶段能力推断其权限。
