# CT-7 部署观察实施记录

2026-10-31（UTC+8）。基点 `d3bc339`，独立工作树 `D:/Projects/hongmen-ct7`，分支 `codex/ct7-deployment-observer`。初始检查点按用户要求暂停验证；2026-10-31 已恢复并完成下述工程与模拟器核心旅程验收。CT-7 完整工具目标仍受文末未决 Gate 约束。

## 代码落点

- 原 SourceConnection 增加 provider/environmentKey/deploymentConfigJson；GitHub字段允许为空以容纳独立环境，未用repo/ref塞入URL。GitHub读取增加类型隔离。迁移由schema diff生成，未迁移真实库。
- 新只读环境授权、修订、撤销API。授权与原AgentRun回执原子提交，requestId绑定原payload；不在授权时发网络请求。
- 固定HTTPS origin/路径、GET-only、DNS公开地址校验与socket地址固定、TLS默认校验、禁止重定向/凭据、15秒与32KB边界。响应字段在进入原HTTP账本前裁剪、脱敏。
- 原Mission/Turn动态工具接入 inspect_deployment/read_deployment_logs；复用原步骤、generation/lease、累计HTTP预占和UNKNOWN保护。没有增加Runner/Planner/监控执行器。
- 构建、部署、服务自检、公共用户路径分别表达。健康JSON和release匹配只提供自报观察，不冒充部署流水线签收、登录后流程或行动完成。现有CI工具仍可独立补构建证据。
- 原SourcePolicy/来源hash/Artifact和上下文消费链纳入新来源；撤权、时间越界、SUPPRESS_USE及来源正文不一致都会阻断继续复用。
- Web资料页及鸿蒙记忆页增加渐进展开的环境卡片；支持授权/修订/撤销、原讨论入口、观察读回。原持续调查编辑可选择环境、日志、间隔和HTTP限额。
- 原累计预算复核新增可选HTTP总额；显式确认后仍暂停，旧用量/UNKNOWN保留，持续许可仍与原任务预算取交集。

## 已有证据与中止状态

证据目录 `evidence/r4-deployment/20261030/`（沿用开工日期）。所有业务数据为隔离测试数据，模型与部署HTTP为可控fixture；没有付费模型调用、生产探测、生产部署或外部业务写入。

- 运行与原CI/委托定向回归：6文件27项通过。
- 单独旧库增量迁移探针通过；旧P3迁移测试夹具补齐后续迁移的依赖顺序，单独12项通过。
- Web生产构建和部署授权/刷新/讨论/撤销及原接续E2E通过，见e2e-second.log。
- 鸿蒙HAP构建通过，见harmony-last.log；unsigned SHA-256 `6f03072301c462f9b2d880d6dd8063299cc734e3b4db89be0e689e14472e4867`。未签名、安装或设备验收。
- 新纵向追加回归2文件9项通过，包括原提案批准、Action创建/完成/resultCardId幂等、根来源抑制及HTTP预算复核。
- 全量首轮1,266项通过、1项失败，原因是旧测试跳过前置迁移后提前运行CT-7迁移；保留失败日志，相关单测修复后12项通过。
- 最终全量正在运行时用户要求暂不测试，已终止本工作树Vitest进程。该轮不计PASS。后续不再启动任何检查。
- 依赖链接导致的Turbopack构建失败已通过独立安装依赖解决；保留最初失败证据。

## 恢复后的必要事项

1. 最终全量、最新类型/lint、双端构建和浏览器回归统一签收；不以分段通过替代最终全量。
2. 独立覆盖真实TLS传输、在途租约竞争、Scope修订与旧批准竞争、跨会话/跨端请求恢复、UNKNOWN后选择其他合法调查路径。
3. 部署流水线/制品独立回执尚未接入，当前DEPLOY层刻意标为部分证据。不得据此宣称CT-7全部工具目标完成；后续沿同一adapter和来源链补齐。
4. 真实设备、真实环境只读授权目标、自然日委托及独立实模质量评测未验收。只读公共路径不覆盖登录后业务流程。

CT-7本轮仅提交可恢复的实现检查点，不合入master，不push；CT-8/CT-9继续保留在原分支，等待独立审查。


## 2026-10-31 恢复测试、双端 UI 与模拟器核心旅程

基点 `ca94cbf`。只修改 CT-7 独立工作树；主目录仍为 `master@d3bc339`，四项既有修改的 SHA-256 逐一核对未变。CT-8/CT-9 未合并或修改。本轮没有生产探测、部署、真实库迁移、外部写入或付费模型调用。

### 实际修复

- Web 环境观察沿用现有语义颜色、深浅主题、输入框、焦点和按钮；四层证据在桌面并列、窄屏折行。增加 24 小时／7 天许可选择，高级路径渐进展开，操作中／错误／重新读取有明确反馈。
- 鸿蒙资料页增加「当前理解与工程观察」文字入口，复用原 MemoryTimeline。通用入口默认收起仓库表单、展开环境观察，原 GitHub 入口仍保持原行为。表单保留字段名、提供许可时长、中文本地时间和主次按钮；只有真实版本冲突才显示重新核对版本。短内容的滚动页改为顶部对齐，避免内容变短后整组控件垂直居中。
- **模拟器发现并复现**：许可修订返回 200 后，旧 ForEach 行仍捕获原连接 revision，随后撤销返回 409。列表 key 现在绑定连接 revision 和观察来源；写入后强制读回。Web/鸿蒙各自增加读取序号，旧轮询迟到不能覆盖新状态，409 读回不自动重提授权。
- HTTP 账本结果缺少原始观察时间、时间非法或明显来自未来时拒绝发布，不以当前时钟补造新鲜证据。地址过滤补上 192.88.99.0/24，并覆盖负例。

### 当前验证

证据：`evidence/r4-deployment/20261031-acceptance/ACCEPTANCE.json` 及同目录日志、截图、合成数据库回执。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 后端最终全量 | 167 文件、1,272 项通过 | unit-final.log |
| 部署运行与传输定向 | 2 文件、11 项通过 | affected.log |
| Web 全量 E2E | 31 通过、2 个既有跳过、0 失败／flaky | web-e2e-results.json |
| 最终部署 E2E | 4 通过、无跳过／失败／flaky（含 setup） | web-readback-race-results.json |
| TypeScript、全量 lint | 通过 | types-readback.log、lint-readback.log |
| 鸿蒙本地单测 | 88 通过，0 失败／错误／忽略 | harmony-unit-readback.log |
| Web 生产构建 | 通过（最终部署 E2E 前重建） | web-readback-race.log |
| 最终正常配置 unsigned HAP | 构建通过，SHA-256 45fbcc3df0225a72f8ae43018cb86e1621983ac04f84fc324932f5f55c8caacf | harmony-review-layout.log |
| 模拟器验收包 | 安装并操作，SHA-256 4aacbd046a68b2e142d11aa70fbbbbdea27df680877c842c520d33d7dcee6a71 | harmony-device-layout.log、native-*.png |

模拟器使用独立包名 `xyz.luojiatutor.projectmemo.ct7acceptance`、临时 development/4401 配置，连接全新临时数据库和合成模型／HTTP。登录由用户手动完成；原 App 和真实数据库保留。构建后 Constants.ets 与 AppScope/app.json5 按原字节恢复，正常配置包另行重建。初始化与服务入口见 `scripts/ct7-device-fixture.ts`；本地后端保留运行供用户查看，不启动 Mission Worker。

真实 ArkUI 操作包括：冷启动后会话保留 → 项目 → 资料文字入口 → 环境卡 → 观察已过期按历史展示 → 修订 24 小时许可（200）→ 原讨论接续与范围读回 → 返回 → 旧回调缺陷复现（409）→ 修复版本重新安装 → 再次修订（200）→ 撤销（200）→ 调查／修订入口消失。Web 随后读回同一连接「已撤销」。隔离库回执确认 revision=4、REVOKED、原授权／两次修订／撤销 AgentRun 与原 Conversation 均持久存在。

最终部署 E2E 另覆盖两个真实竞争：另一端修订后旧 CAS 被拒绝且用户输入保留，必须明确核对新版本；旧 GET 先发后返，不能覆盖写入后取得的新许可，随后的撤销使用新 revision。

### 失败记录及证据保留

- 首轮全量与地址过滤补强并行，出现 192.88.99.1 的旧模块快照失败；新进程定向 11 项与稳定源码最终全量 1,272 项全部通过。首轮日志保留，不覆盖为成功。
- 鸿蒙 UnitTestArkTS 首两轮 Previewer 无法加载模块，未产生结果；保留 coverage 失败日志。CT-7 的 Harmony oh_modules 原先链接主工作树，改为独立 ohpm 安装后完成测试；锁文件未改。最后再跑 88 项通过。
- 新 E2E 初版遗漏原认证头，夹具在读取 me 时失败；沿原认证方式补齐后竞争用例通过。未调整业务断言以规避失败。
- 旧验收截图被原 E2E 固定路径重写后，先另存至本轮 recaptured 目录，再逐字节还原历史版本。正常构建配置与自动生成的 TypeScript 路径不进入产品改动。
- 截图核对发现 HDC 复用远端输出路径会读回旧截图，早期 Revise/Revoke 图片不计入验收。已改用唯一远端路径，最终布局包复核撤销读回与顶部对齐，撤销依据为新拍的 native-VerifyRevoked.png、各阶段真实 UI layout 及数据库回执；重复图片保留本地 interim-screenshots，未作为验收证据提交。

### 结论与未决 Gate

**本轮工程与模拟器核心旅程有条件通过。** 已验收的是原服务执行链、事务／权限回归和上述双端操作；界面判断依据是当前源码、实际浏览器和 ArkUI 截图。44vp 控件与配色为项目现有约定，不冒充平台强制值。未验证的鸿蒙深色／大字体／读屏／长帧不计通过。

CT-7 完整目标仍需补齐部署流水线／制品独立回执；当前服务自报的 DEPLOY 层仍只有部分证据。真实 TLS 传输、目标真机、多自然日委托及独立真实模型质量没有在本轮验证，不用合成 HTTP、模拟器或 HAP 构建替代。保留前述在途租约／修订与批准竞争、UNKNOWN 动态改道等独立探针 Gate。本轮不宣称 CT-7 全目标完成，不合入 master、不 push、不部署。
