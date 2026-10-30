# CT-7 部署观察实施记录

2026-10-31（UTC+8）。基点 `d3bc339`，独立工作树 `D:/Projects/hongmen-ct7`，分支 `codex/ct7-deployment-observer`。按用户要求收尾后暂停验证；本记录不构成CT-7整体验收放行。

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
