# 邮箱账号使用链路实施记录（用户名或邮箱登录 / 注册 / 验证 / 重置）

- 日期：2026-11-03（UTC+8，Asia/Shanghai）
- 工作树：`D:/Projects/hongmen-final-auth`（从集成分支 `codex/final-integration` 的 `6f75c8b8a188f083b7f8f1bb33920fc7e1e5b3ae` 新建独立 worktree）
- 分支：`codex/final-auth-email-login`
- **候选源码提交：`bf5b1a0b6c1d00ee50d062b77a53e3564d38ecf0`**（13 文件，+829/−43；父提交 `6f75c8b`）
- 本记录与 `evidence/final-auth/20261103/**` 作为同一候选的后续证据提交
- 未 push、未合 master、未部署、未迁移真实数据库、未向任何真实收件人发信、无付费模型调用
- 未改 `prisma/schema.prisma` / 迁移：本任务无 schema 变化

## 1. 实现内容

### 1.1 服务端：一个字段承载“用户名或邮箱”

新增 `lib/auth/loginIdentity.ts`：

- 兼容策略：登录请求字段仍是 `username`（Web / HarmonyOS / 旧客户端协议不变），其值可传用户名或已绑定邮箱；未新增 `identifier` 字段。
- 用户名：沿用改动前的 `User.username` 精确匹配，不改变历史账号大小写规则。
- 邮箱：沿用注册/验证/重置的规范化（trim + 小写）；查询用 `COLLATE NOCASE`，兼容历史数据可能保留的原始大小写。
- 不引入 Gmail 去点号、删除 `+tag` 等别名合并，不绑定/合并/接管旧账号。
- 歧义：同一输入可能同时命中一个历史用户名（历史数据允许 `@`）和一个账号邮箱；候选去重后由密码唯一匹配决定。若密码同时匹配多个账号，按统一失败处理，不 `findFirst` 任选。
- 时间侧信道：候选为空时执行一次固定 scrypt 校验（`LOGIN_TIMING_EQUALIZER_HASH`），缩小“账号不存在/密码错误”的响应差异。

`app/api/auth/login/route.ts`：

- 保留原请求字段与响应结构（`user{id,username,displayName}`、`accessToken`、`expiresAt`、`projects`、`set-cookie`）；不返回密码哈希、验证 token、账号安全字段。
- 密码校验、邮箱验证要求（`EMAIL_NOT_VERIFIED` 403）、会话创建、项目成员关系读取两条标识路径共用同一实现；未验证邮箱通过用户名或邮箱登录都不能绕过。
- 未知账号/错误密码统一 `401 AUTH_FAILED / 账号或密码错误`。
- legacy/demo：没有 `AccountSecurity` 行的历史账号仍可按用户名登录；`ensureDemoUser` 原机制保留。
- 限流（`lib/auth/guard.ts` 增补多键接口）：
  - 标识键 `ip:规范化标识`（大小写/首尾空格变化不再换桶）；
  - 账号键 `ip:user:<id>`（同一账号用用户名或邮箱切换尝试仍累计）；
  - 键都带客户端 IP，不引入跨 IP 账号锁死；分布式多 IP 暴力破解仍需网关/代理层限流（本次不新建风控服务，列为残余）。
  - 429 附带 `Retry-After`。
- 登录 schema 增加标识最大长度 254；密码校验仍只要求非空（历史密码兼容）。

### 1.2 Web（`components/AuthScreen.tsx`）

- 登录标签与占位改为“用户名或邮箱 / 输入用户名或邮箱”；输入框 `type="text"`（不用 `type=email` 拒绝用户名），`autocomplete="username"`、`autocapitalize="none"`、`spellCheck=false` 保留；密码 `current-password`/`new-password` 与显示切换保持。
- 错误码区分并给恢复入口：未验证邮箱 → “重新发送验证邮件”；验证/重置链接过期 → 重发验证或重新申请重置；邮件服务不可用 → 明确“暂不可用”，不出现 SMTP/Resend/环境变量等实现词。
- 登录失败保留已输入标识；提交中禁用与 loading 状态保持。
- 成功页：注册“请查收验证邮件”；验证“邮箱已验证”并提示返回登录（不会自动建立会话）；重置“密码已更新”并提示旧密码/旧会话失效。
- 未重做登录页视觉；未新增账号中心。

### 1.3 HarmonyOS（ArkTS）

- `components/LoginView.ets`：登录标签/占位改为“用户名或邮箱”，注册仍为“账号”（注册规则不变）；错误映射走 `common/AccountContract.ets` 新增的 `loginIdentifierError` / `loginErrorMessage`：
  - 未验证邮箱 → 明确提示并显示“重新发送验证邮件”入口；
  - 限流 → 服务端重试文案；邮件服务不可用/网络失败 → 各自提示，不统一成“密码错误”；
  - 登录失败保留输入；提交中/成功状态与原实现一致。
- `models/Auth.ets`：`LoginInput.username` 注释说明兼容字段承载两类输入；请求体、`AuthService`、`SessionStore`、退出与账号切换行为未改。
- 邮件链接在系统浏览器打开，完成后需手动返回 App 登录；App 不自动登录、无深链回跳——UI 文案与本文档明确，不声称小艺/Intents/系统浏览器回跳已可用。
- 新增 `harmonyos/entry/src/test/LoginIdentifier.test.ets`（4 项）并注册到 `List.test.ets`。

## 2. 实际命令、退出码与测试分母

| 检查 | 命令 | 退出码 | 结果 | 证据 |
|---|---|---|---|---|
| 类型 | `npm.cmd exec tsc -- --noEmit` | 0 | 无诊断 | 本记录 §4 |
| Lint | `npm.cmd run lint` | 0 | 0 error / 26 既有 warning（不含本次新增文件错误） | 本记录 §4；定向 eslint 亦 0 |
| 定向测试 | `npm.cmd test -- tests/loginIdentity.test.ts tests/registration.test.ts tests/accountMail.test.ts tests/auth.test.ts tests/sessionCookie.test.ts tests/pageAuth.test.ts tests/harmonyAttachmentAuth.test.ts tests/projectWorkspaceAuth.test.ts` | 0 | **8 files / 82 tests PASS**（含新增 13 项） | `targeted-tests.log` |
| 注册/发信/认证既有回归 | 同上（含 registration 14、auth 19、accountMail 8、pageAuth 12 等） | 0 | 通过；未删除/skip/放宽既有断言 | `targeted-tests.log` |
| Web E2E（login） | `npm.cmd run test:e2e -- login.spec.ts` | 0（第二次） | **5 expected / 0 unexpected / 0 skipped / 0 flaky**（4 个登录旅程 + auth setup） | `e2e-login.log`、`test-results/e2e-results.json` |
| HarmonyOS 本地测试 | `npm.cmd run harmony:test` | 0 | **Tests run 139 / Failure 0 / Error 0 / Pass 139 / Ignore 0** | `harmony-test.log` |
| HarmonyOS 构建 | `npm.cmd run harmony:build` | 0 | BUILD SUCCESSFUL；unsigned HAP `8,290,641 B`，`SHA-256 1bdd771fcf01c5fbc1b1ac1d17b90b7536e2be23b3f01e5725dececd4114d96d`；hvigor 明确 `No signingConfigs profile is configured` → **unsigned 非签名证据** | `harmony-build.log` |

测试数据边界：

- `tests/loginIdentity.test.ts` 使用 `tests/helpers/continuityDatabase.ts`：在导入 `lib/db.ts` 前设置独立临时 SQLite（`%TEMP%/pm-continuity-login-identity-*/test.db`），从 `prisma/migrations` 顺序重放，结束后校验路径前缀并删除；不使用主开发库、不运行 demo-reset、`vitest.config.ts` 的 `fileParallelism: false` 未改。
- 邮件仅 mock `lib/auth/mail.sendAccountMail`（模拟投递），登录/注册/验证/重置/读回均调用真实路由与真实隔离数据库；未 mock 登录服务本身。
- 原集成树已知的固定指标核算 E2E 间歇失败：本次只运行 `login.spec.ts`，未扩展到该用例，也未删除/skip/归因；其状态维持原样，不属于本任务已解决项。

### 2.1 E2E 失败留痕（如实记录）

- 第一次 `npm.cmd run test:e2e -- login.spec.ts` 退出码 1：2 failed / 3 passed。原因是我新增的测试定位器 `getByRole("alert")` 同时匹配页面错误框与 Next.js route announcer（测试自身缺陷，不是产品错误）。
- 修改定位器为 `#auth-error`（未放宽任何断言）后重跑：2026-11-03 18:22 左右，退出码 0，5 expected / 0 unexpected / 0 flaky。首次失败原始日志未落盘（终端输出），此段按实际发生记录，不作为产品失败证据。

## 3. Mock 发信与真实投递的区别

- 工程验证全程为 **mock 投递**：`sendAccountMail` 被 mock，只证明“服务端接受了发送调用/链接与 token 状态正确”，**不证明真实邮件到达**。
- 真实投递、真实收件箱链接打开、生产 HTTPS 公网地址、部署版本与数据库状态：**NOT_RUN**。本树无 `.env`、无发信凭据；未读取/打印任何密钥。真实收件人未授权。
- 代码层已有的发信约束（未改）：`lib/auth/mail.ts` 要求 `AUTH_PUBLIC_BASE_URL` 为无凭据/查询/路径的 http(s) origin；`NODE_ENV=production` 必须 https；Resend HTTPS API 或 SMTP 二选一；失败统一映射 503 且不回显 provider 细节；`scripts/test-account-mail.ts` 可向维护者自己的邮箱做发信自检（不会创建账号/验证/改密）。
- 真实投递恢复条件（需明确授权后执行，当前不执行）：
  1. 授权测试收件人（维护者本人邮箱，不猜测/不使用他人邮箱）；
  2. 可用发信服务与发件身份：`AUTH_MAIL_TRANSPORT=resend` + `RESEND_API_KEY` + 已验证域名的 `AUTH_EMAIL_FROM`，或 SMTP 配置；
  3. 正确公开 HTTPS：`AUTH_PUBLIC_BASE_URL=https://<公开域名>`（不得 localhost/模拟器地址）；
  4. 部署版本与该候选源码一致、数据库可写；
  5. 测试账号数据范围：仅合成/测试账号（如 `e2e-...@example.invalid` 不可收信，必须使用授权真实邮箱）。
  6. 分步记录：服务端接受发送 → 邮件实际到达 → 链接打开验证成功 → 邮箱/密码登录成功 → 重置密码且旧会话失效。发送接口成功 ≠ 邮件已送达。

## 4. 静态检查与变更文件

- 变更：`app/api/auth/login/route.ts`、`lib/auth/loginIdentity.ts`（新增）、`lib/auth/guard.ts`、`components/AuthScreen.tsx`、`scripts/e2e-env.ts`、`scripts/seed-e2e-auth.ts`、`e2e/login.spec.ts`、`harmonyos/.../common/AccountContract.ets`、`harmonyos/.../components/LoginView.ets`、`harmonyos/.../models/Auth.ets`、`harmonyos/entry/src/test/List.test.ets`、`harmonyos/entry/src/test/LoginIdentifier.test.ets`（新增）、`tests/loginIdentity.test.ts`（新增）。
- 兼容合同：请求字段 `username` 不变；响应字段不变；`MissionWidgetSnapshot` 等无关模块未动；无后端 schema/迁移；旧 Web/HarmonyOS 客户端无需改协议即可继续用用户名登录。
- 未改：`prisma/`、部署配置、官网、公共构建脚本、签名配置；`next-env.d.ts` 被 E2E 构建改写后已恢复为基线，未提交。

## 5. 状态分账（Web / HarmonyOS 工程 / 设备 / 线上）

| 轨道 | 状态 | 说明 |
|---|---|---|
| Web 工程 | **PASS（本候选）** | tsc 0、lint 0、登录 E2E 5/5；注册/验证/重置/重发相关服务路由由定向测试覆盖 |
| Web 浏览器真实旅程 | **PASS（login.spec.ts）** | 用户名登录、已验证邮箱登录（大小写+空格）、未验证提示+重发入口、统一失败且保留输入 |
| HarmonyOS 工程 | **PASS（本候选）** | `harmony:test` 139/139（Failure/Error 均为 0）、`harmony:build` exit 0、unsigned HAP 记录在案 |
| HarmonyOS 设备（签名安装/系统交互/浏览器回跳/键盘/账号切换） | **NOT_RUN** | 无受权签名（`signingConfigs: []`）、未连接设备；unsigned HAP 不等于安装验收 |
| 真实邮件投递（服务端接受/到达/链接/登录/重置） | **NOT_RUN** | 无授权收件人、无凭据、未部署；恢复步骤见 §3 |
| 线上/部署验收 | **NOT_RUN** | 未 push、未部署；生产 HTTPS 公开地址未配置到本候选环境 |
| 模型调用 | **0（未执行）** | 邮件与登录链路不调用模型 |

## 6. 残余风险与未决问题

1. **分布式多 IP 暴力破解**：限流仍是进程内、按 IP 分桶；不同 IP 可绕过单机桶。生产需在代理/网关层做全局限流（本次不新建风控服务）。
2. **歧义账号**：同一输入命中多个账号且密码都匹配时统一失败，不提供“选择账号”入口（避免枚举与诱导）；历史账号含 `@` 的极端情况需用户改用可唯一定位的标识或联系维护者。
3. **邮箱历史大小写**：查询使用 NOCASE 兼容历史数据；`AccountSecurity.email` 的 unique 索引仍是大小写敏感，如需强约束需另立 schema 迁移任务（本任务无迁移）。
4. **真实邮件与 HTTP 发信路径未执行**：Resend/SMTP 真实调用、退信/垃圾箱、HTTPS 公网链接均未验证。
5. **HarmonyOS 无端内注册/验证/重置页面**：复用系统浏览器打开 Web 链接，返回 App 后需手动登录；未实现深链回跳，不声称可用。
6. **完整 Web E2E 套件未跑**：只跑 login spec；集成树既有间歇失败与本任务无关，未改动/未归因。
7. 登录限流响应文案包含剩余秒数；429 头已补 `Retry-After`，但 Web 只展示文案不解析秒数（可接受）。
8. 演示账号在非生产环境自动初始化（原机制）；生产需显式 `DEMO_USER_ENABLED` + 密码配置，未改动。

## 7. 最终回答

- **能否直接使用邮箱登录？** 能：已绑定且已验证邮箱的账号可用同一密码通过邮箱登录，Web 与 HarmonyOS 请求路径均已适配，服务端返回同一用户身份与项目权限；未绑定邮箱的历史账号继续用用户名登录。
- **原用户名和历史账号是否保持兼容？** 是：请求字段与响应结构未变；用户名仍按原精确匹配规则；无 `AccountSecurity` 的历史账号/演示账号仍可登录；不改变历史用户名大小写规则、不合并或接管旧账号。
- **注册、验证、找回密码哪些经过工程验证？** 注册→模拟发信→验证→登录闭环、重发替代、链接到期/单次使用/用途混用拒绝、找回密码与重置（新密码生效、旧密码失效、旧会话撤销）、未验证不可登录、统一失败、legacy/demo、歧义处理、账号级限流、注入拒绝：均用真实路由 + 独立临时库验证（邮件仅 mock 投递）。
- **真实邮件和双端闭环哪些实际跑过？** 真实邮件投递与真实收件箱：NOT_RUN（无授权收件人/凭据）；Web 浏览器登录旅程：PASS；HarmonyOS 工程测试与 unsigned HAP 构建：PASS；HarmonyOS 签名安装与设备交互：NOT_RUN。
- **是否具备提交集成审查的条件？** 具备：本地已提交（`bf5b1a0`），定向测试/类型/lint/原生测试与构建/相关 E2E 均有退出码与分母证据，未 push、未合 master；真实邮件、signed 设备与线上验收作为未决项按上表分账。
