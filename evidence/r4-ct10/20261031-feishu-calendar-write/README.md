# CT-10 飞书日历事件写入工程证据（2026-10-31）

工作树：`D:\Projects\hongmen-ct8`  
分支：`codex/ct9-browser-read`  
BASE_SHA：`dbb7816`

## 官方协议

- 创建日程：`POST https://open.feishu.cn/open-apis/calendar/v4/calendars/:calendar_id/events`
- 官方支持 `idempotency_key` 查询参数（应用+日历维度唯一），用于避免重复创建。
- 仍需回读 `event_id` 并比对标题/起止/标记；不把 2xx 直接当成功，不宣称 exactly-once。

## 已执行检查

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型 | `npm.cmd exec tsc -- --noEmit` | 通过 |
| Lint | `npm.cmd run lint` | 通过 |
| 全量测试 | `npm.cmd test` | 161 文件 / 1316 项通过 |
| Web 构建 | `npm.cmd run build` | 通过 |
| E2E | `npm.cmd run test:e2e` | 通过（46 条迁移空库重放、seed、生产构建、浏览器 E2E） |
| 鸿蒙单测 | `npm.cmd run harmony:test` | 86/86 通过 |
| 鸿蒙构建 | `npm.cmd run harmony:build` | 通过 |
| HAP | `entry-default-unsigned.hap` | 6,795,697 bytes；sha256 `70c0b04eb356f762a18aea76c50bd5fd732af86dffa0294f7aed5c2724823b53` |

## 测试覆盖（`tests/calendarWrite.test.ts`，10 项）

- 提案不写，批准后才派发并完成原对象回读；创建请求带 `idempotency_key=pm-cal-…`。
- 未批准不入队；批准后重复确认不产生第二次派发。
- 只读连接不能提出写入。
- 批准前连接 authGeneration/calendar/revision 变化不派发。
- 超时/5xx 保持 UNKNOWN；resume 只按原标记查询，不重发。
- 2xx 但对象身份/内容不匹配不确认成功。
- 回读缺失保持 UNKNOWN。
- 明确拒绝/限流为已知失败，不产生 UNKNOWN 重试。
- 取消不伪造外部撤销，也不再派发。
- 模型注入 endpoint/header/token 被 schema 拒绝。
- 外部写预算 `externalWrites` 预占并在成功后保留。

## 真实账号核对（只读）

- 飞书账号：`siuuuuuuuu`；open_id `ou_3fd3f6f2b5f3fc4c669b8d449d02097e`。
- 主日历：`feishu.cn_Ui05JvFljpjNSEvP7OMkBh@group.calendar.feishu.cn`，owner。
- 2026-10-31 至 2026-11-30 无日程。
- 以上仅用 lark-cli 读取；未用 lark-cli 创建事件，未把它当作产品 OAuth 凭据。

## 未关闭 Gate

- 产品侧飞书应用凭据/HTTPS 回调/`calendar:calendar` + `offline_access` 未配置；真实事件 0 次，未假称成功。
- 已获用户授权的建议 payload 尚未执行：`忆程 CT-10 外部写验证`，2026-11-02 10:00–10:30 Asia/Shanghai，主日历，最多 1 次。
- 未实现 Conversation/Copilot 外部写提案；仅 Mission 纵向切片。
- 单日程、定时、无参与人/重复/全天/附件/批量/删除。
- 未在鸿蒙真机/模拟器联调审批弹层。
