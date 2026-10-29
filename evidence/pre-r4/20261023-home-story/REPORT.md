# 首页、账号与鸿蒙接入验收（2026-10-23）

## 修改结果

本轮先完成公开首页事实核查，随后按用户追加要求实现正式账号页、自助注册、邮件验证与恢复、云调用限制及鸿蒙客户端接入。工作区既有功能和登录/退出契约保留。未修改或部署线上数据库。

| 原来 | 现在 |
| --- | --- |
| 抽象定位和重复功能卡主导首页 | 一段参赛项目经历贯穿记录、依据、判断、确认行动和填写回执 |
| 定位是顶部很小的字 | 品牌区与下方工作区展示栏同宽，最大 1040px、左右边界对齐；桌面 Logo 约 187px、应用名 104px、定位 32px，并随容器缩放；390px 手机 Logo 约 94px、应用名约 31px，中文名与英文名分行、定位 16px；下方呈现 slogan、说明和按钮 |
| 标题全部使用黑体 | 自托管宋体用于主标题和章节标题，操作、正文保留黑体；延续暖白和青绿 |
| Logo 是平面图片 | 保留原图，增加表面柔和高光、接触阴影和渐隐倒影；效果随 Logo 大小缩放，不增加循环动画 |
| 示意卡片样式趋同 | 记录列表、依据缺口、行动提案、回执和委托进度分别采用适合的信息层级 |
| 首页图片偏装饰、交互解释抽象 | 内置示例项目的实际工作区截图；原文可打开、依据可展开，用户填写模拟结果后才出现回执 |
| 登录仍写“复赛演示空间”、技术性安全描述 | 正式登录、注册、验证、找回和重置页面，输入标签、自动填充、显示密码、错误和等待状态清晰 |
| 没有公开注册与邮件恢复 | 复用 User / scrypt / AuthSession，新增账户安全、Token、持久限流和额度表 |
| 鸿蒙只能登录，403 丢失具体原因 | 原生注册、重发与找回入口共用后端；邮箱验证原因及限流原因保留；注册不保存会话 |

原文事实修正和模块取舍见 [AUDIT.md](AUDIT.md)。原记录来自 prisma/seed.ts 的“人工智能创意赛 忆程 ProjectMemo 作品开发”。首页建议为预设演示，回执为访问者本页输入；不会调用模型或写个人项目。

## 页面截图

| 页面 | 修改前 | 修改后 |
| --- | --- | --- |
| 桌面首屏 | [before-desktop.png](before-desktop.png) | [after-desktop.png](after-desktop.png) |
| 手机首屏 | [before-mobile.png](before-mobile.png) | [after-mobile.png](after-mobile.png) |
| 完整首页 | [before-full.png](before-full.png) | [after-full.png](after-full.png) |
| 登录 | [before-login.png](before-login.png) | [桌面](after-login-desktop.png) / [手机](after-login-mobile.png) |
| 注册 | 原无此页面 | [桌面](after-register-desktop.png) / [手机](after-register-mobile.png) |

故事的 [依据](story-evidence.png)、[确认行动](story-confirmation.png)、[模拟回执](story-receipt.png)；[手机来源阅读](mobile-source.png)、[深色主题](dark-mobile.png)。

产品截图由独立 E2E 库中的内置项目直接截取。模型为 mock，没有个人项目数据。注册页图片使用本地 TLS SMTP 验收环境，最终首页图片使用未配置邮件的生产预览，因而不显示注册入口；服务端配置邮件后入口才出现。

## 账号与权限

- 新账号需要邮箱验证才能登录；原有账号和 contest-demo 不强制补邮箱，注册不得占用默认或配置的演示账号名称。
- 验证链接 24 小时、恢复链接 30 分钟；仅存哈希、用途隔离、单次消费，重发撤销前一链接。重置与撤销旧会话原子完成。
- 注册与恢复等入口按来源、收件地址持久限流；恢复响应不透露邮箱是否存在。仅接收受限 JSON，不信任请求 Host 来生成邮件链接。
- 新账号默认没有项目 membership、会话或云调用额度。邮箱验证后方能登录，云额度仍默认为 0。聊天、嵌入、视觉、委托与公开研究入口在外部调用前检查项目 OWNER 的额度。失败调用也占次数；有本地规则回退时保留真实降级原因。
- 模型配置与开发探针对公开注册账号关闭。项目、记忆、行动、委托和成果的跨用户读取与修改经过隔离检查。
- 统一邮件接口支持 Resend HTTPS API 和 SMTP。没有生产日志发信或模拟成功模式。接口不向浏览器发送密钥。

## 验证结果

| 检查 | 结果 / 证据 |
| --- | --- |
| Web 单元 / 集成 | 84 文件、680 测试通过：[unit-final.log](unit-final.log) |
| 账号与邮件专项 | 41 测试通过：[auth-tests.log](auth-tests.log) |
| Web E2E / 生产构建 | 14 通过：[e2e-final.log](e2e-final.log)；含安全登录回跳和原比赛演示流程 |
| 首页浏览器 | 43 项检查；1440 / 768 / 390 / 320 宽度及 320px 放大字号无横向溢出，品牌区与工作区边界对齐；品牌区顺序和字号、原文阅读、焦点返回、键盘切换、确认门槛、空回执、重置、锚点、深色、减少动态效果通过：[browser-qa-final.log](browser-qa-final.log) |
| 首页写入边界 | 故事完整操作无 POST / PATCH / PUT / DELETE，没有实际模型调用 |
| 完整账号链 | 本地真实后端 + TLS SMTP 收信器，注册 → 验证前拒绝登录 → 邮件验证 → 登录 → 独立项目/记录 → 退出 → 恢复 → 重置 → 新密码登录；Token 重放被拒绝：[验证](account-browser-verify.json)、[重置](account-browser-reset.json) |
| Resend 真实投递 | 发送一封经用户授权的接入测试邮件，用户确认已收到：[resend-live-test.json](resend-live-test.json)；未替用户创建生产账号 |
| 鸿蒙契约测试 | 74 通过：[harmony-tests-final.log](harmony-tests-final.log) |
| HAP | 构建通过：[harmony-build.log](harmony-build.log)，unsigned HAP SHA-256 `6eadc0a35bdc8483d3cf5d7384fa83fa2e8c99e401bc62292e78242a028b6184` |
| 类型 / lint | 日志见 types-final.log、lint-final.log；最终构建记录另见 build-final.log |

早期调试日志保留在本目录；上表所列 final 日志与专项 auth-tests.log 是交付判据。真实密钥只进入发送测试的子进程环境，没有写入仓库、图片、日志或本机 .env。

## 部署与仍需完成的验收

环境变量、迁移、Resend / SMTP 发送测试和 ECS 操作见仓库根目录 [ACCOUNT_EMAIL_SETUP.md](../../../ACCOUNT_EMAIL_SETUP.md)。还需在 ECS 环境文件填写 Resend 密钥，部署本次代码和增量迁移、构建并重启，再执行生产注册至重置流程。nginx 模板新增邮件限流和 Token 页面访问日志保护，目标机器必须先 nginx -t。

鸿蒙邮箱链接由系统浏览器打开 Web 验证/重置页，完成后回应用登录。本轮完成编译和契约验证；后端上线后还需设备登录/注册验收。没有声称已通过物理设备、系统 App Link 或平台提交验收。

这是本轮账号与初版首页的验收记录；后续 Hero 精修见相邻目录 `20261023-hero-refinement/README.md`，其中的截图和浏览器结果对应当前首页。Git 提交状态以提交日志为准；未推送或执行 ECS 更新。保留了用户已有的鸿蒙签名配置改动，未将它纳入本轮变更。
