# 2026-09-15 暂定最终版：登录闪退修复与复查

结论：已修复已登录重启闪退、底栏浮起、附件上传漏 Token、弹层双关闭按钮和部分设置伪交互。模拟器实际覆盖安装、保留会话冷启动、断网错误态及提醒策略保存已验证。仍有发布阻断，不能标记为 READY_TO_SUBMIT。

## 1. 闪退根因与修复

模拟器 6.1.0.126，x86_64。Hiview 崩溃日志 22:20:04：

```text
Reason: TypeError
Error message: Cannot read property deadline of undefined
at anonymous entry (entry/src/main/ets/pages/Index.ets:694:33)
at projectItem entry (entry/src/main/ets/pages/Index.ets:588:39)
```

登录改动将 GET `/api/projects` 改为查询 membership 后直接返回原始 Project，丢失原先 `listProjects()` 提供的 `dashboard` 和 `_count`。鸿蒙 JSON 类型断言不会执行 Project 类的字段初始化，首页读取 `project.dashboard.deadline` 时崩溃。已有会话启动会立即获取项目并触发此路径；不是密码错误或模型 API 故障。

修复：

- `lib/repositories/projects.ts` 为列表查询增加可选 userId，在数据库查询中按 membership 过滤，同时保持 dashboard/count 完整契约。
- `app/api/projects/route.ts` 鉴权后调用完整列表用例，不先读取全部项目再在客户端过滤。
- `ProjectService.ets` 在渲染前校验关键概览字段。遇到旧后端/不完整响应时显示更新后端提示，不填造假的 0% 状态，也不让渲染崩溃。
- 补充登录凭据重复读取列表的回归测试，同时验证其他用户项目不出现在结果中。

另行防护：将 LoginView 从带 @Entry 的 LoginPage 拆到 components；首页使用稳定根容器；注销会话监听器避免销毁页面残留。上述结构问题不是本次崩溃日志确认的根因。

## 2. UI 与功能修复

| 问题 | 本轮处理 | 验证 |
|---|---|---|
| 加载/错误时底栏浮起 | 所有内容状态共享 layoutWeight(1) 的内容容器 | 模拟器断开后端后的错误截图确认贴底；恢复后可重新加载 |
| 登录后附件上传 401 | multipart 上传补 Bearer；401 广播会话失效；不覆盖 multipart Content-Type | 执行真实服务代码、mock 原生 HTTP 的两项测试通过；未上传用户文件 |
| API 与记录弹层两个叉重叠 | 两个 bindSheet 设置 showClose:false，保留可访问的自定义关闭按钮 | HAP 编译通过；API 弹层截图确认一个叉 |
| 免打扰/强度没有点击事件 | 新增 ReminderSettingsView，接现有策略 GET/PATCH，支持时间和每日预算输入校验、错误和保存反馈 | 模拟器真实打开并保存当前值；服务端返回 200 |
| 风险/截止开关只改 @State | 移除不生效的独立开关，标明按提醒策略执行 | 源码与模拟器界面核查 |
| 证据/确认策略像可编辑项 | 去掉箭头，明确固定规则，不开放违反业务不变量的选项 | 源码核查 |
| 小艺假连接和假权限 | 已连接改为待验证；未接通的权限开关改为暂未接入 | 模拟器界面核查 |

提醒策略当前为服务端共享作用域，编辑器明确说明其影响范围；不是新增用户级隔离设置。本轮模拟器保存保持原值：每日 3 次、23:00–08:00，仅产生一次策略保存/版本更新。没有修改模型凭据或执行付费模型探针。

## 3. 尚未解决的最终版问题

### P0：Web 服务端页面仍绕过登录与项目归属

`app/projects/page.tsx` 直接调用无 userId 的 `listProjects()`；`app/projects/[id]/page.tsx` 直接读取详情并调用 evaluateProjectContext；`app/projects/[id]/generate/page.tsx` 直接读取项目和成果。未发现保护这些页面的 middleware/proxy 或项目 layout。保护 `/api` 不等于保护服务端渲染的数据。

影响：未登录访问 Web 页面可能看到项目资料；登录隔离尚未贯通 Web。修复方向：页面从 Cookie 恢复可信会话，列表按用户过滤，详情/生成页先校验项目 membership，再查询或评估。补匿名和跨用户页面回归。

### P0：默认演示账号自动获得最早项目的 OWNER

`app/api/auth/login/route.ts` 在校验密码前调用 `ensureDemoUser()`；后者默认创建公开演示账号，并在未配置 DEMO_PROJECT_ID 时查询最早项目、建立 OWNER membership。

影响：把现有项目库用于演示时，真实项目可能自动授权给演示账号。修复方向：仅显式演示环境允许初始化；必须明确指定隔离演示项目；取消自动绑定最早项目；生产禁止默认密码。不能直接删除已有账号或成员关系，需先审计数据归属。

### P1：Web E2E 仍有 6 项失败

本轮隔离 E2E：2 passed / 6 failed。现有脚本直接打开项目页面，未建立登录会话；页面仍能渲染，后续受保护 API 写入无法完成。失败涉及行动、成果、标注等交互。不能把该结果等同为六个独立业务实现故障，也不能直接修改断言让其通过：先完善页面鉴权，再为 E2E 建立独立测试身份及项目授权。

### P1：模型设置与探针没有用户鉴权

`app/api/settings/route.ts` 在开发模式允许所有来源修改；生产模式用 URL hostname 判断本地请求。`app/api/settings/probe/route.ts` 生产禁用，但开发模式未鉴权且接受外部地址。复赛公网不能暴露开发服务器；应建立管理权限并在生产拒绝运行时写配置，不能仅依赖 Host 字段。

### P1：交付条件仍未完成

当前 HAP 未签名，模拟器允许安装不代表评审设备接受。地址仍为开发模拟器 `http://10.0.2.2:4400`。正式签名方式、评审 HTTPS 后端、真实设备安装及小艺平台联调仍需独立验收。

## 4. 验证记录

- 全量 Vitest：33 files / 243 tests 通过，独立测试数据库。
- 针对登录列表契约与 dashboard：19 tests 通过，已计入全量结果。
- 新增入口隔离与附件请求回归：4 tests 通过，已计入全量结果。
- TypeScript：通过。
- lint：0 errors / 7 warnings，均保留为现有未使用符号警告。
- 鸿蒙 Hypium：38/38 通过；最终 UI 修改后重跑。
- HAP 构建：通过；最终包 3,082,773 bytes，SHA-256 `dff683012856eceb6969e721fff025edffa477cc1d0ae54a3adf58ef27fe6415`。
- 模拟器：覆盖安装成功，没有卸载或清除原登录数据；多次 force-stop/start 后显示项目，旧崩溃未再重现。
- 模拟器：后端停止时展示可恢复错误，底栏贴底；后端重新启动后点击重新加载恢复。
- Web 隔离生产构建成功；E2E 未通过，见上文。

截图与日志：`evidence/final-review-20260915/`。原有崩溃记录未删除。后端保留在 4400 运行，仅作为本地模拟器开发服务。

## 5. 收口顺序

1. 当前模拟器继续验收记录、行动、附件等实际主流程。
2. 修复上述 Web 页面鉴权和演示数据授权两个 P0，再恢复 E2E 全绿。
3. 确认签名和评审网络，重建最终交付 HAP。
4. 小艺只有真实测试态调用完成后才能从待验证改为已接入。
