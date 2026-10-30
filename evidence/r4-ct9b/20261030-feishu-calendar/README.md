# CT-9B 飞书日历只读工程证据（2026-10-30）

工作树：`D:\Projects\hongmen-ct8`  
分支：`codex/ct9-browser-read`  
BASE_SHA：`1b86d2d`  
Provider：飞书日历（用户选择）；华为日历仅设备侧本地只读补充。

## 协议与安全证据

- 官方文档核实：授权页 `accounts.feishu.cn/open-apis/authen/v1/authorize`、token v2 `open.feishu.cn/open-apis/authen/v2/oauth/token`、日历列表 `calendar/v4/calendars`、日程列表 `calendar/v4/calendars/:id/events`、scope `calendar:calendar:readonly offline_access`。
- OAuth state 只存 SHA-256 hash；PKCE verifier 与 token 使用 AES-256-GCM 密文；`CALENDAR_TOKEN_KEY` 缺失时不连接、不退化明文。
- 回调绑定登录用户与项目 OWNER；state 一次性消费；重放/账号不符/scope 不足均拒绝且不建连接。
- token 刷新按 `tokenVersion`/`authGeneration` CAS；刷新网络未知标记 `UNKNOWN`，不自动重试。
- 读取窗口最多 31 天；飞书 start/end 一次性读取，`has_more` 标记 truncated；重复规则未展开时 complete=false；不把有限窗口当全局无冲突。

## 数据与平移

- migration `20261030220000_ct9b_calendar_connection` 只新增 `CalendarConnection`、`CalendarOAuthState`、`CalendarObservation` 三表与索引。
- `npm.cmd run test:e2e` 在隔离库空库重放 45 条迁移成功；未对真实开发库执行迁移。
- token/refresh token/授权码不出现在 API、模型上下文、ArkTS 模型、日志或本证据目录。

## 已执行检查

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型 | `npm.cmd exec tsc -- --noEmit` | 通过 |
| Lint | `npm.cmd run lint` | 通过 |
| 全量测试 | `npm.cmd test` | 160 文件 / 1306 项通过 |
| Web 构建 | `npm.cmd run build` | 通过 |
| E2E | `npm.cmd run test:e2e` | 通过（45 迁移空库重放、seed、生产构建、浏览器 E2E） |
| 鸿蒙单测 | `npm.cmd run harmony:test` | 86/86 通过 |
| 鸿蒙构建 | `npm.cmd run harmony:build` | 通过 |
| HAP | `entry-default-unsigned.hap` | 6,788,829 bytes；sha256 `e8637bf7ce49ba99fa065caeee947e9ea86d904e4fd07fffe754a9cb50ea202a` |

## 测试覆盖（`tests/calendarFeishu.test.ts`，11 项）

- OAuth state/PKCE/密文/重放/账号混淆/scope 缺失。
- 窗口读取：全天、时区、取消、暂定、重复、例外、缺时间覆盖、truncated。
- 429/403、401 单次刷新、刷新网络未知、撤权后来源失效、跨项目/账号隔离。
- GET 连接列表零 provider 请求。
- Conversation 工具原 operation/来源/manifest 回放。
- Mission 工具原 step/预算/context 接入。

## 未关闭 Gate

- 真实飞书开发者账号/应用/HTTPS 回调和 `calendar:calendar:readonly`、`offline_access` 权限未联调；用户仅有飞书账号且权限未确认。
- 真实 DST/全天/重复取消/共享日历 ACL 未人工核对。
- 鸿蒙真机 Calendar Kit 只读未联调；当前只读取本应用可见日历，不上传。
- 撤回仅本地即时失效，provider 侧 token 撤销未验证。
- CT-10 未开始，本阶段无写权限。
