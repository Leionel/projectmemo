# CT-8～10 独立审计与本地整合

## 审计范围与版本

- 原实施分支：`codex/ct9-browser-read@bc74e97`，原工作树 `D:\Projects\hongmen-ct8`，未修改。
- 整合基线：本地 `master@d3bc339`；原实现从 UX2 的 `96429cb` 分出，必须保留基线后续的 UX3 修复。
- 审计工作树：`D:\Projects\hongmen-ct8-10-audit`，分支 `codex/ct8-ct10-integration-audit`。
- `4730517` 保存双亲整合与第一批修复；`fcd04a1` 为最终冻结的业务代码与测试。后续文档/证据提交不改变该业务版本。
- 本报告与 `R4_CT8_TO_CT10_AUDIT_CHECKPOINT_2026-10-31.md` 配套；早期 checkpoint 是暂停记录，放行以本报告最终验证结果为准。

本次不新建 Runner、Planner、记忆库或通知系统；继续复用 AgentRun、Mission/Step/Approval、CopilotToolExecution、原 Continuity/Source Policy、预算和事务工具。

## 发现、修复与证据

| 级别 | 可复现问题 | 实际修订 | 验证入口 |
|---|---|---|---|
| P1 | 浏览器 DNS 校验与实际连接解析分离；无 Content-Length 的正文绕过流量统计 | `lib/browser/transport.ts` 固定已验证 IP、保留 TLS 主机校验、流式解压计量；每跳重定向重新校验，等待绑定截止信号 | `browserTransport`、真实 loopback Chromium 的 `browserReader` |
| P1 | CT8 激活状态与命令回执分开提交；事件插入失败仍留下 ACTIVE | `lib/experience/service.ts` 复用原 writeTransaction，状态、迁移与事件同事务；幂等回执保留 | `ct8OutcomeExperience` 触发器故障注入；修复前 `experience-red.log` |
| P1 | 首笔日程派发后 STOP/撤权，后续参与人、批次或补偿请求继续沿用旧许可 | `lib/mission/calendarDispatch.ts` 对每次 HTTP 复核原 lease、approval、来源、指引、连接 binding，预占累计额度；旧请求只结算自己的历史回执 | `calendarEventExtensions` 真实 await 屏障中的暂停、首项创建后撤权 |
| P1 | 失联 DISPATCHING 与 UNKNOWN 无可靠接续入口；存在已创建却不能恢复的情况 | 原 CopilotToolExecution 记录 create 身份；原确认入口识别过期租约、只读核对原对象，禁止重发 POST；服务端生成完整预览 | `conversationCalendarProposal` 的并发确认、过期租约、跨时段 UNKNOWN 回读，POST 恒为 1 |
| P1 | 同一旋转 refresh token 可并发使用；UNKNOWN 后自动重试 | 刷新前持久 CAS 认领，原加密字段记录 IN_FLIGHT/UNKNOWN；使用凭据前读当前 ACTIVE/authGeneration | `calendarFeishu` 刷新屏障竞争与 UNKNOWN 再调用 |
| P1 | 只读恢复遇到过期 access token，会先认领刷新再被只读拦截，污染原旋转凭据 | 增加明确的 allowRefresh 控制；只读核对在认领前拒绝刷新 | `conversationCalendarProposal` 校验 tokenVersion/tokenCipher 完全不变且无新 POST |
| P2 | 重读覆盖旧 calendar observation；已知新版本仍能消费旧记录 | 每次实际观察使用独立 namespace；原 operation 继续回放；Source Policy 检查授权、15 分钟 TTL、已观察的新版本 | `calendarFeishu` 历史记录不变、TTL 越界、新修订即时失效 |
| P2 | 浏览器/日历读取的后续请求未逐次复核运行边界 | 浏览器增加原调用方 beforeRequest 守卫；Calendar 每次 HTTP 重新校验，使用原 Turn/Step 计量 | `browserReader` 停止后子资源请求为 0；`browserMission`、`browserConversation` |
| P2 | 审批只展示参与人/附件数量，UTC 字符串被标为本地时间；补偿未被完整披露 | 双端展示实际账号、资源、时间、重复、人员、文件和外发描述；Copilot preview 由服务端填充；缺预览的旧消息禁止直接创建 | `calendarApprovalUi`、Harmony 编译/单测；设备交互另列 gate |
| P2 | 批次 schema 支持 10 项，原预算复核却不能提高默认 2 项额度 | 扩展原 budget-review 的可选累计上限，双端显示确切变化；不清空已用/UNKNOWN，不自动恢复，不扩大工具许可 | `ux3CumulativeBudget`；`calendarEventExtensions` 十项批次纵向创建，20 次 HTTP / 10 次外部创建 |
| P2 | 参与人只读第一页；取消/未知状态可能冒充有效创建；缺失列表可能被解释为空窗口 | 有界分页，未完成拒绝确认/删除；取消不成功、未知不归为 confirmed；缺失列表报错，达到上限或客户端截断不宣称完整覆盖 | `calendarProviderContract`、`calendarEventExtensions` |
| P2 | 重复规则只做宽泛正则 | 校验支持的 RFC5545 子集、重复键、范围、日期、COUNT/UNTIL 互斥；保留无截止、按周/月/年等合法能力 | `calendarApprovalUi` 规则负例 |
| P2 | 读取同项目他人连接的提案元数据风险 | 冻结 Copilot 日历提案时绑定当前用户与连接 owner，确认/接续继续核查同一身份 | `lib/copilot/confirmation.ts` 冻结与确认路径 |
| P2 | 修改已存在的 p3 migration 来适配重放夹具 | 恢复 master 原 migration 字节，夹具在旧 schema 写入样本后按真实顺序应用全部后续迁移 | `p3ReviewBoundaries` |
| P2 | 设备结果裁到 12 项后仍报告完整 | `DeviceCalendarReadService.ets` 明确截断/不可读，不上传设备结果、不建立服务端记忆副本 | Harmony 编译/单测；系统权限行为待设备验收 |

## 冻结的关键合同

### 原始观察与当前有效性

每次真实读取产生独立观察，历史 observation 的 observedAt/payload 不被重写。同一个原 Turn operation 的重放仍引用原观察，消费时再查 Source Policy；过期、撤权或已知修订后不能因“缓存命中”继续注入。

15 分钟是当前工程时效边界，不能证明窗口内没有新增日程；刚刚读取且覆盖完整也仅代表该次观察。达到 provider 页容量或客户端保留上限时，按不完整窗口处理。该时效阈值仍需真实使用旅程校准。

### 派发与接续

- 重要外部操作继续使用原批准哈希、版本、源集合、幂等键与回执。
- 每次 HTTP 在派发前复核；STOP/撤权之后不再发起后续子操作。已经发出的请求可能在外部完成，保留 UNKNOWN/历史身份，不能伪造撤销。
- `calendarRequests` 记录实际派发或持久预占的所有相关 HTTP；`externalWrites` 记录批准创建对象数。它们不是同一个计数。
- 刷新认领和刷新完成分别推进 tokenVersion；UNKNOWN 的旋转凭据不重用。显式只读恢复不发送凭据刷新 POST，也不提前认领。
- 恢复使用原 provider 身份；缺身份时只能有界查询原标记。没有唯一对象不等于没有写入；有 DELETE 记录的 UNKNOWN 不能仅凭存在某个对象就宣称整个批次创建成功。

### 补偿是明确批准的先读后删

新提案冻结 `RECHECK_THEN_DELETE_CREATED_EVENTS`，用户批准包含本次对象的创建、参与人添加和失败补偿删除。服务端重读对象与参与人，发现变化、STOP、撤权、额度不足或读取不完整就不删除。旧提案没有该策略时不自动增加删除许可。

此协议不保证与飞书的并发编辑原子互斥。其他编辑可能在重读之后、DELETE 之前发生；Web、鸿蒙和 Conversation 提案在批准前明确展示这一边界，不再把它命名或宣传为“仅删除未变更对象”的原子保证，也不宣称全批事务或 exactly-once。删除结果未知仍为 UNKNOWN，不重发创建。

### 授权和证据

网页、论文、GitHub 日志、日历对象及模型总结都不形成用户授权；提案预览、连接授权、工具范围、运行预算和业务执行批准仍分别生效。外部对象 CREATED 不代表 Mission 的现实目标达成，Action DONE 也不证明风险消失。

## 验证记录

证据根目录：`evidence/r4-ct8-ct10-audit/20261031/`。测试使用独立数据库、合成 provider/模型适配器；浏览器安全探针使用真实 Chromium 和本机 loopback fixture，没有真实 OAuth 写入或付费模型调用。

| 检查 | 状态 | 证据 |
|---|---|---|
| 第一轮完整回归 | 173 文件 / 1372 项通过；后续新增修订由冻结回归替代 | full-first.log |
| 最后定向恢复/分页/停止探针 | 6 文件 / 58 项通过 | release-probes.log |
| 原预算与新增子请求保护等定向回归 | 11 文件 / 113 项通过 | final-focused.log |
| 冻结业务版本全量回归 | 175 文件 / 1382 项全部通过，exit 0 | full-frozen.log / .exit |
| 冻结业务版本 Web 构建 | 通过，exit 0 | web-frozen-build.log / .exit |
| 类型 / lint | 通过 | types-release.log / .exit、lint-release-last.log / .exit |
| 隔离 Web E2E | 通过；原有登录/连续性/记忆/委托旅程，不当作真实飞书验收 | e2e-final.log / .exit |
| Harmony 单测 | 88/88 通过 | harmony-release-test.log / .exit |
| Harmony HAP | 构建成功，unsigned，未安装验收 | harmony-release-build.log / .exit |

HAP SHA256：`c88cc119584a2034d7777759aa24c2e4cec6484c9915e1cb93e727a649a68be6`，6,915,745 bytes。

`full-final.log` 是代码仍在修复期间的中间回归，新增过期 token 负例暴露旧路径，之后中止；该日志保留，不能代替冻结版本结果。早期负例、失败夹具和中间检查同样保留，不改写成 PASS。

本次 E2E 截图复制到新 `webshots/`，原 UX1～3 历史截图保持原字节。主目录 AGENTS.md、用户路线文档、Harmony build-profile、tsconfig 的原修改不参与提交。

## 工程放行

冻结业务版本的全量检查通过，允许将本审计分支整合到本地 master。新增能力保留默认关闭的开关；本结论不授权自动开启生产功能、执行真实数据库升级或外部写入。

## 仍未完成的外部验收

1. 产品应用的真实飞书 OAuth、写 scope 与回调，以及经明确授权的一次真实创建/回读/补偿旅程。lark-cli 的登录凭据不代替产品 OAuth。
2. 真实模型对照、隐藏题与独立人评；工程 mock/fixture 结果不证明 Agent 质量提升。
3. 鸿蒙模拟器/真机的新增日历审批、跨端 UNKNOWN 恢复、设备日历权限/长名单旅程；本轮单测和 unsigned HAP 不能算这些旅程通过。
4. 飞书全天日期边界、重复日程展开/例外、组织者/参与人表现、附件权限及幂等有效期的真实环境核对。当前按冻结字段精确回读，有不匹配保留 UNKNOWN，不悄悄归一化成功。
5. 生产发布、真实数据库升级/备份/回滚。此次只对独立测试库执行迁移；没有修改真实库。

浏览器和日历能力默认关闭；`.env.example` 列明浏览器运行时与日历凭据配置。外部验收没有通过前不以本报告为依据自动开启生产开关。CT7 仍留在原独立分支，不顺带合并。

## 公开合同参照

- Playwright：<https://playwright.dev/docs/network>、<https://playwright.dev/docs/api/class-route>。URL 检查不能代替实际 socket 的地址约束；本次另用受控 transport。
- 飞书窗口读取：<https://open.feishu.cn/document/server-docs/calendar-v4/calendar-event/list>。按时间窗口查询不支持直接套用分页游标；达到返回上限不能扩张为全局无冲突。
- 飞书创建：<https://open.feishu.cn/document/server-docs/calendar-v4/calendar-event/create>。
- 飞书参与人列表：<https://open.feishu.cn/document/server-docs/calendar-v4/calendar-event-attendee/list-2>。
- 飞书删除：<https://open.feishu.cn/document/server-docs/calendar-v4/calendar-event/delete>。未把文档未证明的条件删除语义作为实现前提。
