# CT-8～10 独立审计进度与接续合同（未放行）

日期：2026-10-31。用户要求审计、有问题直接修复，验证通过后再合入主分支；本次因五小时额度已用 94% 保存进度。**本文件不是完成验收报告，不能据此合并或部署。**

## Git 与工作区

- 主目录 `D:\Projects\hongmen`：`master@d3bc339`，用户未提交文件保留。
- 原实现 `D:\Projects\hongmen-ct8`：`codex/ct9-browser-read@bc74e97`，未改动。
- 审计目录 `D:\Projects\hongmen-ct8-10-audit`：`codex/ct8-ct10-integration-audit`，以 master 为基线整合 bc74e97，保存为进度合并提交，**不代表已合入 master**。
- 原实现基于 UX2 的 96429cb。整合时保留 master 的 UX3 `onClaim`、上下文重新协调、每日额度等待及 `metadataRequests`。
- CT7 在独立 worktree/分支，当前没有合入；不顺带整合。
- 未 push、未部署、未迁移开发/生产数据库、未调用付费模型、未发起真实日历写入。

## 已定位与修订的代码

以下为已写入代码的修订；尚未全部完成独立验收，不应一律表述为已关闭缺陷。

1. **浏览器网络边界**：原实现 DNS 检查后 `route.continue()`，实际连接再次解析；字节预算信任 Content-Length。新增 `lib/browser/transport.ts`，固定已验证 IP、保留 HTTPS 主机校验、流式统计解压后的正文；每跳重定向重新验证，关闭直接 WebRTC/WebTransport/WebSocket 入口，DNS 等待绑定取消信号。隐藏 heading 不再作为可见页面定位证据。
2. **CT8 状态与回执原子性**：`actOnExperience` 原先更新状态后单独写事件。SQLite 触发器注入事件写失败时，出现 SHADOW 已变 ACTIVE 的可复现错误；现使用原 `writeTransaction` 将状态与事件一并提交，迁移/幂等路径保留事件。
3. **刷新凭据竞争**：`calendarAccessTokenFor` 重新读取当前授权；刷新前 CAS 认领 tokenVersion，在原加密字段保存 IN_FLIGHT/UNKNOWN，禁止复用结果未知的旋转凭据自动重试。成功轮转包含认领和完成两次 tokenVersion 增长。
4. **原始日历观察不可变**：每次实际读取使用独立 observation scope namespace，避免 upsert 改写旧 observedAt/payload；同一 Turn operation 仍回放原观察。Source Policy 为当前消费增加 15 分钟时效边界；此数值需产品/长旅程验收。
5. **逐 HTTP 请求复核**：Mission 日历写入复用原 lease/approval/readSet/continuity，逐请求占用累计 calendarRequests，保存 DISPATCHING/RECEIVED/UNKNOWN 原请求回执。STOP、撤权、到期阻止后续子请求；已观察到 create 身份后不能简单归类为未发生的 FAILED。
6. **只读日历也逐请求保护**：读取服务对每次 HTTP 再核对连接 binding；Mission 逐次预占，Conversation 在原 operation 累计 requestUnits，UNKNOWN 不退还。缓存观察回放再过 Source Policy。
7. **补偿权限**：新 frozen proposal 明确包含补偿策略；DELETE 需要原批准，补偿前重新读取标题/时间/完整描述/附件/重复规则及参与人变化。含 DELETE 的 UNKNOWN 不再仅凭 GET 报完整创建成功；停止或撤权后不再补偿写入。
8. **Copilot/Conversation UNKNOWN 恢复（重点待补测）**：持久化 provider create 身份；过期 DISPATCHING 和 UNKNOWN 使用原对象只读核对，不重发 POST，GET 使用原累计 HTTP 额度。核对冻结历史载荷不再要求事件仍在未来，发布前再查当前授权。保存失败停止后续外部写入。
9. **审批信息**：Web/鸿蒙显示冻结的账号、日历、实际参与人/附件、重复规则及外发描述，披露补偿与无通知语义；时区显示修正。Copilot 由服务端生成 calendarPreview，旧消息缺完整预览时禁用创建按钮；不信任模型填入的预览。
10. **预算复核**：沿原 budget-review 增补可选的 browserRequests/browserBytes/calendarRequests/externalWrites 累计总上限与双端展示，防止 schema 支持十项批次却永远受默认二项额度阻塞。复核保持暂停，不扩大工具授权，不清空已用/UNKNOWN。
11. **迁移历史**：撤回 incoming 对已存在 p3 migration 的改写，保留 master 原校验内容；旧库测试改为真实按时间顺序升级，不为适配错误夹具修改历史 migration。

## 当前证据

目录：`evidence/r4-ct8-ct10-audit/20261031/`。全部为独立临时库、合成 provider/测试适配器；Chromium 测试访问本地 loopback fixture。没有真实模型、真实 OAuth/飞书写入或本轮模拟器审批证据。

| 检查 | 当前结果 | 证据 |
|---|---|---|
| CT8 事件写故障负例 | 修复前稳定复现 ACTIVE 残留 | experience-red.log |
| 最初浏览器定向回归 | 4 文件 / 61 项通过 | browser-first.log |
| 浏览器新增分块/重定向/隐藏标题等＋日历定向 | 8 文件 / 94 项，93 通过；仅旧快照覆盖断言失败 | trust-second.log |
| 更新不可变快照断言、刷新竞争/UNKNOWN、历史升级及日历/CT8 | 6 文件 / 60 项全部通过 | trust-third.log |
| TypeScript | exit 0 | types-sixth.log / .exit |
| ESLint | exit 0 | lint-first.log / .exit |
| Harmony unit | 88 项通过、0 失败 | harmony-test.log / .exit |
| Harmony HAP | 构建成功，unsigned；非设备审批验收 | harmony-build.log / .exit |

HAP SHA256：`026a44fd4ee9e5c16118946daa3529ba426ca3fbe8a458c397e1f53b4644f83e`。构建保留 SDK 原 warning，不能当作手机功能已验收。

## 下次必须继续的工作（先审修订，再放行）

1. **补齐新增高风险路径测试**：Copilot 创建后丢回包、crash 后过期 DISPATCHING、多日 UNKNOWN 只读恢复、原 POST 次数保持 1；并发确认；晚到撤权/目标修订；readback 结束与最终提交之间撤权；刷新失败与额度不足。核查核对路径是否仍正确执行 Source Policy、认知/经验来源保护及原审批边界。
2. **STOP/租约真实竞争**：在实际子请求 await 期间暂停/撤权/lease 换代，保证后续 POST/DELETE 为 0、旧请求仅结算自己的回执，不重新协调掉 externalEffect。现已有首项创建后撤权负例，不能替代全套竞争验证。
3. **补偿与部分批次**：测试用户修改日程/新增参与人时禁止删除，补偿中断保存每个已删除和未确认项，UNKNOWN 不恢复成全批 CREATED；审核相应 UI 与恢复方式。当前含 DELETE 的 UNKNOWN 保守保持待核对，尚缺更完整的部分结果读回体验。
4. **提供商契约**：独立确认全天结束日期语义、RFC5545 规则合法性、参与人分页/组织者字段、附件授权、原生幂等键有效期。现 recurrence 校验仍较宽，不能宣称完整验证了所有重复规则。GET 后 DELETE 存在提供商侧修改竞争窗口，需检查条件删除支持；若无原子前置条件，应明确真实接入放行策略，不能声称已保证未变更删除。
5. **新预算合同**：增加遗漏字段不扩权、不能减少原上限/已用、跨进程并发与 request replay 的测试；核查双端上限展示和默认值，覆盖 2～10 项批次实际费用/HTTP 路径。
6. **完整集成回归**：只在审计 worktree 的 `prisma/test-vitest.db` 初始化迁移，不使用 db:setup/seed 开发库。运行全量 npm test、Web build、隔离 E2E；本轮仅定向绿，**未执行这三项，不满足合并门槛**。按受影响修改重跑类型/lint/鸿蒙检查。
7. **Web/鸿蒙审批实机或模拟器**：长描述、多附件/参与人、全日/重复/批次、过期、断网与 UNKNOWN；确认滚动布局和真实时区，无误导成功。保留 CT7 4401 隔离服务和已登录验收包，不覆盖或终止。
8. 核对原实施报告与新审计报告的差异，补充独立验收结论。全部满足工程门槛后，才将本审计分支 fast-forward 合入本地 master。保留主目录用户脏文件与无关 untracked，CT7 仍分开；未经后续明确指令不 push 或部署。

## 参考公开合同（并非实接证据）

- https://playwright.dev/docs/network
- https://playwright.dev/docs/api/class-route
- https://open.feishu.cn/document/server-docs/calendar-v4/calendar-event/create
- https://open.feishu.cn/document/server-docs/calendar-v4/calendar-event/list

主目录需保护的已知 SHA256：

```
AGENTS.md DBFF8A9D83193830B2FD06C5C131B9324C0A8E472BE2C8AA2F66DEFF990E2750
docs/FINAL/AGENT_REVIEW/AGENT_EVOLUTION_ROADMAP.md 7328E70A94CBD17F400C23EF418D0A62F396A408EA9A1926C9D1F057F211F631
harmonyos/build-profile.json5 442618A372BD9A74D204E7162FFE6844B6FC49DBF4C09B8CC5BC58C6709A1924
tsconfig.json AF1B4FBD345A0D2B7E23394ACA3540B524A3D4826FCA6A51169B13B2A325EE4A
```
