# 自助注册、Resend 邮件与云调用配置

## 服务边界

注册使用现有 User、scrypt 密码存储、AuthSession 与 Cookie，不建立第二套身份系统。新增 AccountSecurity 存放邮箱验证状态和每日云调用额度，AccountToken 仅保存一次性链接的哈希。旧账号无需补邮箱即可继续登录，contest-demo 和配置的演示账号名称禁止公开注册占用。

未配置邮件服务时，官网不显示注册入口，注册、重发与找回密码接口返回 503。已有登录与演示流程保留。新账号必须点击邮件链接完成验证后才可登录；邮件提交失败不会创建会话，用户可重发验证邮件。

## 推荐：Resend HTTPS API

已由用户确认发信域名 `mail.luojiatutor.xyz` 完成验证，发件人使用 `no-reply@mail.luojiatutor.xyz`。统一邮件接口默认选择已配置的 Resend API，固定请求 `https://api.resend.com/emails`，不接受客户端传入服务地址或密钥。每份账号邮件使用对应 Token 记录 ID 作为幂等键。配置示例：

```dotenv
AUTH_MAIL_TRANSPORT="resend"
AUTH_PUBLIC_BASE_URL="https://project.luojiatutor.xyz"
AUTH_EMAIL_FROM="忆程 <no-reply@mail.luojiatutor.xyz>"
RESEND_API_KEY="只在服务器填写真实密钥"
```

不要加 `NEXT_PUBLIC_` 前缀。无需同时配置 SMTP 变量。密钥应限制在对应域名的发信权限范围内。生产 HTTPS、密钥和发件人缺一则保持注册关闭。

接口依据：[Resend Send Email](https://resend.com/docs/api-reference/emails/send-email)、[邮件幂等键](https://resend.com/docs/dashboard/emails/idempotency-keys)。本轮已用进程环境中的密钥发送一封真实测试邮件，并获得收件人确认；密钥未保存到项目文件。此结果证明该次投递，不代表 ECS 已更新或生产注册流程已上线。

## Resend SMTP

先在 Resend 验证自己的发信域名，并建立用于发送邮件的 API Key。以下变量放到服务器环境文件中，不能提交凭证：

```dotenv
AUTH_PUBLIC_BASE_URL="https://project.luojiatutor.xyz"
AUTH_MAIL_TRANSPORT="smtp"
AUTH_EMAIL_FROM="忆程 <no-reply@mail.luojiatutor.xyz>"
SMTP_HOST="smtp.resend.com"
SMTP_PORT="465"
SMTP_SECURE="true"
SMTP_USER="resend"
SMTP_PASSWORD="在服务器填入 Resend API Key"
SMTP_FROM="忆程 <no-reply@mail.luojiatutor.xyz>"
```

465 使用直接 TLS；若使用 587，设 `SMTP_SECURE="false"`，客户端要求 STARTTLS，不允许降级明文。固定的 `AUTH_PUBLIC_BASE_URL` 生成邮件链接，不采用请求中的 Host。生产必须使用 HTTPS 根地址。

配置依据：[Resend 官方 SMTP 文档](https://resend.com/docs/send-with-smtp)、[Nodemailer SMTP 文档](https://nodemailer.com/smtp)。Resend 的 465 / 587 设置和已验证域名要求可在前一链接核对。

## 更新与邮件测试

ECS 使用现有 `/etc/projectmemo/projectmemo.env` 时，只追加上面的四项，不覆盖原有数据库、模型和演示账号配置。通过 `sudoedit /etc/projectmemo/projectmemo.env` 在服务器填写密钥，并保持文件仅服务维护者可读。不要把含密钥的命令发到聊天、提交到 Git 或写入验收日志。

先核对 `systemctl show projectmemo -p ExecStart -p EnvironmentFiles` 与 `node --version`，构建、Prisma、better-sqlite3 和运行进程必须使用同一 Node 24。不要直接用旧部署样例中的 Node 22 路径替换正在运行的服务。

先备份部署库，再沿现有部署流程安装依赖、生成客户端和部署迁移。不要运行含 seed 的 `db:setup`：

```bash
npm ci
npm run db:generate
npx prisma migrate deploy
npm run build
```

使用服务实际运行的 Node 版本，并按原服务管理方式重启。环境变量修改后也要重启进程。以服务用户发送一封到自己控制邮箱的测试邮件：

```bash
npm run auth:mail:test -- --to 自己控制的邮箱
```

这条 npm 命令读取进程环境和可选的当前目录 `.env`，不会自行读取 systemd 的 `/etc/projectmemo/projectmemo.env`。ECS 可用临时 systemd 单元复用同一个环境文件，不在命令行传递密钥：

```bash
# NODE24 填 systemctl show 中核对过的 Node 24 可执行文件绝对路径。
sudo systemd-run --pipe --wait --collect \
  -p User=projectmemo -p Group=projectmemo \
  -p WorkingDirectory=/opt/projectmemo/app \
  -p EnvironmentFile=/etc/projectmemo/projectmemo.env \
  "$NODE24" --import tsx scripts/test-account-mail.ts --to 自己控制的邮箱
```

部署迁移也必须显式使用生产 `DATABASE_URL`，不要让 Prisma 回落到代码目录的开发库。更新 nginx 的账号接口限流与 Token 页面日志规则后先运行 `sudo nginx -t`，通过才 reload。环境和构建就绪后运行 `sudo systemctl restart projectmemo`，再检查 `/health` 与 `/api/auth/capabilities`；后者应为 `registrationEnabled: true`、`passwordResetEnabled: true`，不会返回密钥。

此命令真实发送邮件。成功表示所选邮件服务接受，仍需人工检查收件箱和 Resend 投递记录。它不会注册账号、输出密码或 Token。随后手动验证：注册 → 收信 → 验证 → 登录 → 退出 → 申请重置 → 新密码登录。不得把 API 接受等同于收件箱到达。

## Token、恢复与限流

- 邮箱验证链接 24 小时有效，重置链接 30 分钟有效；用途不可互换。重发会撤销前一链接，使用后不可重放。
- 重置密码与消费 Token、撤销所有旧会话在同一事务中完成。验证页面由用户点击确认，邮件扫描器的 GET 不会消费链接。
- 注册按来源限制 10 分钟最多 5 次；验证、重置和邮件申请也按来源限制。向同一邮箱发送注册、重发、恢复邮件合计 30 分钟最多 3 次。计数持久化，不会因 Node 重启消失。反向代理需覆盖 X-Real-IP，沿用当前登录来源解析约定。
- 恢复请求对存在与不存在的邮箱返回相同说明；不返回 Token、账号信息或 SMTP 细节。旧账号未绑定邮箱时，需由维护者处理，不能通过公开页面认领已有账号。
- 注册到重置的自动验收使用独立测试库与本地 TLS SMTP 收信器。另有一封经用户授权的真实 Resend 接入测试，收件人已确认收到；没有替用户注册生产账号。

## 新账户云调用

默认每日额度为 0。记录、规则回退和基本项目管理可用，云聊天、嵌入、图像提取及委托模型/检索入口在付费调用前检查项目 OWNER 的账户额度。Worker 使用相同检查。失败的外部请求也占额度，防止无限重试。每日按 UTC 日期累计，授权额度代表请求次数，不代表金额或 Token 数。

公开注册账号不能修改服务器模型配置或调用开发探针。旧账号保持原部署约定，未自动限额；不要把旧演示账号公开给无限量访客。

维护者可给已验证的新账号设置有限额度；默认先预览：

```bash
npm run auth:cloud-quota -- --username 用户账号 --daily-limit 20
npm run auth:cloud-quota -- --username 用户账号 --daily-limit 20 --confirm
```

不授予无限额度。执行前检查该进程使用的 DATABASE_URL；设为 0 可停止该账户后续付费调用。已有使用次数不重置。

## 鸿蒙端

`AuthService` 共用 `/api/auth/capabilities`、`register`、`login`、`resend-verification`、`forgot-password`。注册不会保存登录 Token；服务端确认邮箱验证后，登录才能建立原有 SessionStore 会话。403 的邮箱未验证原因和限流原因会原样显示。

客户端检测不到邮件配置时关闭注册与恢复操作，登录仍保留。验证码不是手工粘贴的数字：用户在邮件中打开网站上的验证/重置链接，完成后回到应用登录。当前未新增 App Link，避免假装链接能够直接唤起应用。

后端部署后，重新构建并安装本次鸿蒙包；核对 `Constants.REVIEW_BASE_URL` 指向同一服务。验收顺序：原演示账号登录 → 退出 → 创建新账号 → 验证前登录被拒绝 → 邮件验证 → 原生登录 → 仅看到自己的项目 → 忘记密码 → 浏览器重置 → 原生新密码登录 → 退出。HAP 构建和本地契约测试不代替真机/平台验收。
