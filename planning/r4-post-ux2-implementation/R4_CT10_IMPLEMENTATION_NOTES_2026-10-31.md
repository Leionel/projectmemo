# CT-10 飞书日历事件写入实施记录（2026-10-31）

## 阶段与基线

- 工作树：`D:\Projects\hongmen-ct8`
- 分支：`codex/ct9-browser-read`（按用户选择不另建分支）
- BASE_SHA：`dbb7816`（CT-9B 最后提交）
- 操作：**在已连接的飞书主日历创建单个日程**。只实现这一种外部写，不开放邮件、PR、部署、删除、批量或跨账号。
- 新增 migration：`20261031090000_ct10_calendar_write`，仅给 `CalendarOAuthState` 增加 `mode`（READ/WRITE）；其余复用原 Mission Step/Approval/Receipt，不建平行 Runner。
- 未向真实飞书日历写入任何内容。用户已确认账号与主日历并授权建议 payload，但产品侧 OAuth 应用凭据/写 scope 尚未配置，真实写入保留 Gate。

## 官方协议核实

- 创建日程：`POST https://open.feishu.cn/open-apis/calendar/v4/calendars/:calendar_id/events`。
- 官方文档明确支持查询参数 `idempotency_key`：在应用与日历维度唯一，用于避免重复创建资源。
- 因此服务端使用确定性 `pm-cal-<payloadHash前32位>` 作为 `idempotency_key`，并在用户批准的外发描述中附加短操作标记用于效果回读。
- 仍**不宣称 exactly-once**：2xx 不直接当成功，必须按返回 `event_id` 或标记回读原对象并比对身份/标题/起止/标记；回包丢失、回读缺失或对象不匹配保持 `UNKNOWN`，不自动重发。
- 写权限使用独立 scope `calendar:calendar offline_access`；只读连接不会自动升级，必须重新走 OAuth 授权。

## 实际增量

### 提案与冻结内容

- `propose_calendar_event` 工具：只接受已连接日历 `connectionId`、标题、描述、带时区起止、时区；拒绝任意 endpoint/header/token/参会人/跨账号目标。
- Mission constraints 新增 `externalWriteProposal`（默认 false）；未显式勾选的委托不能提出外部写。
- 提案冻结：provider、accountId/email/name、calendarId/summary/timeZone、connection revision/authGeneration/scope、必需写 scope、标题/最终描述（含标记）、起止/时区、`operationId`、`payloadHash`、`readSet`、有效期、planRevision。
- 任何字段修改都生成新 proposal/new hash；批准面对的是同一冻结 payload。

### 批准与派发

- 复用 `AgentMissionApproval`：`PENDING → APPROVED/READY → DISPATCHING → CONSUMED`；已知失败为 `EXPIRED`；UNKNOWN 保留 `DISPATCHING` 供原标记核验。
- 批准提交仍走 `commandMission("approval")`，校验 proposalHash、planRevision、expiresAt、cognitive/experience readSet、原来源 readSet；不会因 OAuth 有写 scope 自动获得本次 payload 批准。
- 派发前事务重新校验 owner/project/连接 ACTIVE/authGeneration/calendarId/revision/写 scope/预算，并将 approval CAS 到 `DISPATCHING`；并发或重复确认只有一个执行者。
- HTTP 在事务外；创建后先持久化 `externalId/phase=SUBMITTED`，再回读；最终事务重验 lease 后落 step result、approval 消费和 mission 状态。
- `externalWrites` 预算默认 2；派发前持久预占，失败/未知不影响已计费用与 UNKNOWN。
- 已知拒绝（400/403/429/无 writer 权限）记 FAILED 且不自动重发；超时/5xx/回读缺失/对象不匹配记 UNKNOWN。
- UNKNOWN 后 resume 运行只做原效果查询（按 externalId 或标记+标题+时间），绝不再次创建；找不到保持 UNKNOWN。
- 取消/停止只停止新派发，不自动删除已创建日程；补偿删除属于另一项明确授权，不实现。

### 双端

- Web：`CalendarEventApproval` 展示账号、日历、标题、完整外发描述（含标记）、起止/时区、有效期和不可自动回滚；批准按钮为“批准创建日程”。Mission 面板展示创建回执/外部 ID/UNKNOWN 状态。
- Web 连接卡片新增“授权创建日程”按钮，只读连接可重新授权写 scope；仍逐项批准。
- 鸿蒙 `MissionApprovalSheet` 展示同一 proposal/target/payload，批准文案和 UNKNOWN/不可回滚提示与 Web 对齐；客户端不保存 provider token。

## 验证结果

- `npm.cmd exec tsc -- --noEmit`：通过。
- `npm.cmd run lint`：通过。
- `npm.cmd test`：161 个测试文件、1316 项通过；`tests/calendarWrite.test.ts` 10 项覆盖：提案不写、未批准不写、只读连接拒绝、连接代际变化、超时 UNKNOWN 后只查询不重发、2xx 错误对象不确认、回读缺失 UNKNOWN、拒绝/限流/5xx、重复确认、取消不伪造撤销、注入 endpoint/token 被 schema 拒绝、native idempotency_key。
- `npm.cmd run build`：通过。
- `npm.cmd run test:e2e`：46 条迁移空库重放、seed、生产构建、浏览器 E2E 通过。
- `npm.cmd run harmony:test`：86/86 通过。
- `npm.cmd run harmony:build`：通过；unsigned HAP 6,795,697 bytes，sha256 `70c0b04eb356f762a18aea76c50bd5fd732af86dffa0294f7aed5c2724823b53`。

## 真实账号核对（只读）

- lark-cli 当前账号：`siuuuuuuuu`，open_id `ou_3fd3f6f2b5f3fc4c669b8d449d02097e`。
- 主日历 `feishu.cn_Ui05JvFljpjNSEvP7OMkBh@group.calendar.feishu.cn`，owner；2026-10-31 至 2026-11-30 空。
- 这只证明账号/日历现状；**没有**用 lark-cli 创建事件，也没有把 lark-cli 的凭据当作 ProjectMemo 应用 OAuth。

## 剩余 Gate（未签收）

1. 真实产品写入：需在飞书开发者后台创建/配置自建应用、HTTPS 回调，并开通 `calendar:calendar` + `offline_access` 用户 scope，配置 `FEISHU_CALENDAR_APP_ID/SECRET/REDIRECT_URI/CALENDAR_TOKEN_KEY`。当前这些未配置，未创建任何真实事件。
2. 用户已授权的建议 payload 尚未执行：标题“忆程 CT-10 外部写验证”、2026-11-02 10:00–10:30 Asia/Shanghai、主日历、最多 1 次。只有在产品 OAuth 写授权完成后才能按该 payload 执行。
3. 未实现 Conversation/Copilot 侧的外部写提案；当前只有 Mission Proposal→Approval→Runner→Receipt 纵向切片。
4. 首个外部写只支持单个定时日程；不支持参与人、提醒、重复、全天、附件、批量、删除/补偿或跨日历。
5. 未在真机/模拟器验证鸿蒙审批弹层；HAP 可编译、单测通过。
6. 飞书原生 `idempotency_key` 降低重复创建风险，但不宣称 exactly-once；一切以回读结果为准。

## 后续扩展（2026-10-31，同分支）

### Conversation / Copilot 提案

- 新增用户发起的 `create_calendar_event` 提案：`POST /api/conversations/[id]/calendar-proposals` 冻结完整 payload（账号/日历/标题/描述/起止/时区/全天/重复/参与人/附件），生成原 Conversation 提案消息；确认仍走原 `/proposals/[executionId]/confirm` 与 `CopilotToolExecution` 事务。
- `confirmConversationProposal` 将 `create_calendar_event` 分派到 `confirmConversationCalendar`；requestId 幂等、conversation version、焦点项目、proposalHash、连接状态/scope 与来源 manifest 均由服务端校验。
- 项目 Copilot 只在 `calendarConnections`（已连接、ACTIVE、含 `calendar:calendar`）中提出日程建议；mock 与模型路径共享同一冻结/确认链，`MemoryCopilot` 支持确认创建日程并显示外部 ID。
- 对话输入面板支持标题、起止、全天、重复、参与人（邮箱或 `ou_` open_id）、附件 `file_token`；提交只生成待确认提案。

### 单日程能力扩展

- 全天：`YYYY-MM-DD` 起止，创建时使用 provider `date` 字段；回读比对日期。
- 重复：有限 RFC5545 `FREQ=...` 形式；创建后回读 `recurrence` 比对。
- 参与人：创建后调用 `POST .../events/:event_id/attendees`（`user` open_id 或 `third_party` 邮箱），再通过 `GET .../attendees` 核对；添加失败或参与人不一致时删除本次创建的日程作为补偿。
- 附件：接受已上传的飞书 `file_token` 列表，随创建请求写入 `attachments`，回读比对 token；产品内不做 Drive 上传，不新增 `drive:drive` scope。
- 批量：仅 Mission 新增 `propose_calendar_events`（2–10 个日程、同一连接）；批准后按顺序创建，逐项回读/参与人核对；任一失败删除本批已创建日程并记录 `compensation { deleted, remaining }`；任一项结果未知时保持 UNKNOWN，但仍删除已确认创建的项。
- 删除补偿：批量失败或参与人核对失败时调用 `DELETE .../events/:event_id`；补偿成功才记已知失败，补偿未确认则保持 UNKNOWN，不宣称全部回滚。

### 验证结果（扩展）

- `npm.cmd exec tsc -- --noEmit`：通过。
- `npm.cmd run lint`：通过。
- `npm.cmd test`：163 个测试文件、1328 项通过。新增 `tests/conversationCalendarProposal.test.ts` 7 项（冻结/幂等/焦点/只读/Copilot/全天重复）与 `tests/calendarEventExtensions.test.ts` 5 项（参与人+附件、参与人补偿、批量成功、批量拒绝补偿、批量未知补偿）。
- `npm.cmd run build`：通过。
- `npm.cmd run test:e2e`：46 条迁移空库重放、seed、生产构建与浏览器 E2E 通过（`[e2e] completed with passing result.`）。
- `npm.cmd run harmony:test`：86/86 通过。
- `npm.cmd run harmony:build`：通过；unsigned HAP 6,804,959 bytes，sha256 `b223e7000f0960431ee1c02d8cd117d3046d2a770d1ff61ffd712b7fd2350d54`。

### 当前仍受限

- 真实飞书 OAuth 写授权与真实事件 1 次仍未执行（产品应用凭据/写 scope 未配置）。
- 附件只接受外部已上传的 `file_token`，未实现 Drive 上传/选择；没有 `drive:drive` scope。
- 批量只在 Mission 纵向切片，Conversation/Copilot 仍为单日程提案。
- 删除补偿仅自动用于失败批次/参与人不一致；没有面向用户的“删除已创建日程”手动操作。
- 未在真机/模拟器验证鸿蒙审批弹层。
