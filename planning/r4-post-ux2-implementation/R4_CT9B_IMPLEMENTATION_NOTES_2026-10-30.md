# CT-9B 飞书日历只读连接实施记录（2026-10-30）

## 阶段与基线

- 工作树：`D:\Projects\hongmen-ct8`
- 分支：`codex/ct9-browser-read`（按用户选择不另建分支，CT-9A 提交后接续）
- BASE_SHA：`1b86d2d`（CT-9A 最后提交）
- Provider：按用户选择从 Google Calendar 切换为 **飞书日历**；**华为日历**作为鸿蒙设备侧本地只读补充，不作为服务端云 provider。
- 新增 migration：`20261030220000_ct9b_calendar_connection`（仅新增 `CalendarConnection`、`CalendarOAuthState`、`CalendarObservation` 三表与索引，不改既有表）。

## 官方协议核实

按飞书开放平台当前文档核实并使用：

- 授权页：`GET https://accounts.feishu.cn/open-apis/authen/v1/authorize`，参数 `client_id`、`response_type=code`、`redirect_uri`、`scope`、`state`、`code_challenge`、`code_challenge_method=S256`、`prompt=consent`。
- Token v2：`POST https://open.feishu.cn/open-apis/authen/v2/oauth/token`，JSON body `grant_type=authorization_code`、`client_id`、`client_secret`、`code`、`redirect_uri`、`code_verifier`；响应含 `access_token`、`expires_in`、`refresh_token`、`scope`。
- 用户信息：`GET https://open.feishu.cn/open-apis/authen/v1/user_info`（open_id/name/email）。
- 日历列表：`GET https://open.feishu.cn/open-apis/calendar/v4/calendars`，`data.calendar_list`；首选 `type=primary` 或 owner 日历。
- 日程列表：`GET https://open.feishu.cn/open-apis/calendar/v4/calendars/:calendar_id/events`，`start_time`/`end_time` 为 Unix 秒；官方明确该方式一次性返回、`has_more` 时受 `page_size` 截断且不能与 `page_token`/`sync_token` 混用。
- 权限：用户身份使用 `calendar:calendar:readonly` 与 `offline_access`；scope 实际授予以 token 响应 `scope` 为准，缺少即拒绝连接。

## 实际增量

### 服务端连接与凭据

- `prisma/schema.prisma` + migration：`CalendarConnection`（provider/account/calendar/resource、scope、authGeneration、tokenVersion、sync/window、撤销/状态）；`CalendarOAuthState`（state hash、一次性、10 分钟、PKCE verifier 密文）；`CalendarObservation`（事件快照、revision、窗口覆盖、mission/turn scope）。
- `lib/calendar/crypto.ts`：AES-256-GCM 密封 token/PKCE verifier；`CALENDAR_TOKEN_KEY` 缺失或非 32 字节时 `CALENDAR_NOT_CONFIGURED`，不退化明文。
- `lib/calendar/feishuOAuth.ts`：固定官方端点、PKCE S256、state、JSON token v2、scope 校验、userinfo；不记录/返回 token。
- `lib/calendar/feishuCalendar.ts`：日历列表与日程列表、主日历选择、事件时间/全天/取消/暂定/重复/例外/忙闲归一化、错误码映射（401/99991663、190008、191000/191002/191003、429）。
- `lib/services/calendarConnectionService.ts`：
  - OAuth start/callback：项目 OWNER、state hash 一次性消费、登录账号绑定、防重放/账号混淆、scope 校验、主日历解析、活跃连接上限 3。
  - token 只存密文；刷新 token 单次使用，按 `tokenVersion`/`authGeneration` CAS；网络未知标记 `UNKNOWN`，不自动重试。
  - 读取窗口最多 31 天；飞书 start/end 一次性读取，`has_more` 标记 `truncated`，不把有限页当全局无冲突；存在未展开重复规则时 `complete=false`。
  - 读取事务外调用 provider，返回后重验 ACTIVE/authGeneration/revision 再发布；撤权/切换/迟到结果不写入。
  - 撤回为本地即时失效（authGeneration++、token 清空）；provider token 是否同步撤销未保证，明确记录残余风险。
- 来源：`CalendarObservation` 的 `calendar:<id>` 作为原始外部观察；`sourcePolicy` 新增分支，撤权/换日历/代际变化立即 `SUPPRESSED`。

### 两条原 Agent 入口

- Conversation/Focus：
  - `calendar_read` 工具加入原 `investigationToolCallSchema`，只在项目存在活跃连接且 `CALENDAR_CONNECTIONS_ENABLED` 时向模型开放。
  - `lib/conversation/calendarTools.ts` 复用原 `turnOperation` lease/外部预算/UNKNOWN/回放；最多 2 次不同输入窗口读取，累计 HTTP 上限 6；来源写入原 manifest，可在来源页打开。
  - 事件来源带 `calendar` 元数据：provider/账号/日历/事件状态/起止/全天/时区/重复/例外/窗口覆盖；不新增第二套来源或记忆。
- Mission：
  - `lib/mission/tools/calendarTools.ts` 复用 `fenced` lease、scope 版本、`reserveCalendar`/`settleCalendarUsage` 预算；失败保留预占。
  - 来源 `calendar:<observationId>` 进入原 step readSet/context；`sourceContext` 增加日历摘要；Mission 来源 API 增加日历分支，仅允许该 mission 读取的观察。
  - 并发切片由原 `claimMission` 单执行槽保证只派发一次。

### 双端

- Web：项目 records 页新增“飞书日历只读连接”卡片（连接/状态/scope/断开，GET 不触发 provider 请求）；来源页与 Mission 来源页显示“飞书日历只读”、账号/日历、事件时间/状态/窗口覆盖/未完整读取提示。
- 鸿蒙 ArkTS：
  - `ConversationResearch.ets`/`Conversation.ets`/`ConversationWebSource.ets` 读取同一服务端日历来源与状态。
  - `DeviceCalendarReadService.ets` + `DeviceCalendarReadCard.ets` 在行动安排页读取本机 Calendar Kit 未来 30 天；只在本机显示，不上传、不写入服务端来源/模型上下文，并明确“设备日历不等于飞书云端日历”。已存在 `READ_CALENDAR` 权限声明。

## 验证结果

- `npm.cmd exec tsc -- --noEmit`：通过。
- `npm.cmd run lint`：通过。
- `npm.cmd test`：160 个测试文件、1306 项通过；新增 `tests/calendarFeishu.test.ts` 11 项（OAuth state/PKCE/密文/重放/账号混淆/scope、窗口/全天/取消/重复/缺时间、truncated、429/403、401 刷新、刷新未知、撤权/跨项目、GET 零 provider 调用、会话工具回放、Mission 预算与上下文）。
- `npm.cmd run build`：通过。
- `npm.cmd run test:e2e`：45 条迁移空库重放、seed、生产构建、浏览器 E2E 通过。
- `npm.cmd run harmony:test`：86/86 通过。
- `npm.cmd run harmony:build`：通过；unsigned HAP 6,788,829 bytes，sha256 `e8637bf7ce49ba99fa065caeee947e9ea86d904e4fd07fffe754a9cb50ea202a`。

## 剩余 Gate（未签收）

1. 真实飞书 provider 联调：用户有飞书账号但尚未确认开发者后台可创建自建应用、配置 HTTPS 回调、开通 `calendar:calendar:readonly` 与 `offline_access` 用户权限。当前只使用受控 HTTP fixture 验证协议与状态机，未调用真实飞书。
2. 真实 OAuth 回调与账号身份：需配置 `FEISHU_CALENDAR_APP_ID`、`FEISHU_CALENDAR_APP_SECRET`、`FEISHU_CALENDAR_REDIRECT_URI`、`CALENDAR_TOKEN_KEY`；未在真实浏览器/鸿蒙 WebView 完成授权。
3. 真实日历时间语义：重复规则只保留 master/例外并不展开实例，窗口覆盖会标记不完整；未对真实 DST/全天/重复取消数据做人工核对。
4. 鸿蒙设备日历：只覆盖本应用可见日历（`READ_CALENDAR`），未在真机验证系统全部日历权限、设备时区与全天事件；结果不上传。
5. 未选择多个日历/共享日历；当前只解析主日历，日历 ACL 变化或 token 撤销的 provider 侧同步未验证。
6. CT-10 外部写未开始；本阶段没有获得任何飞书写权限。

## 2026-10-31 独立审计修订

日历观察改为不可变快照，当前消费复核 TTL 与已知新版本；每次 HTTP 复核当前许可并累计计量；旋转凭据刷新在派发前 CAS 认领，UNKNOWN 不复用。缺失列表和截断不作空窗口/完整覆盖。设备本地超过 12 项明确为截断。最终验证与设备 gate 见 [独立审计](R4_CT8_TO_CT10_INDEPENDENT_AUDIT_2026-10-31.md)。
