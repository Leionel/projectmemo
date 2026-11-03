# CT-5 / CT-6 实施记录 · 2026-10-29

分支 `codex/ct5-ct6-research`，基于 CT-4 `f1256b9`。`4e08e21` 是基础检查点；本轮继续补齐指标文件、Conversation/Mission 工具、获批容器核算、论文调查和双端交互。没有新表、迁移、Runner、Planner 或平行记忆系统。

## CT-5：原实验数据 → 动态调查 → 获批核算 → 行动结果

- 原附件入口支持 UTF-8 CSV/JSON，沿原文件 SHA、附件修订、校对 CAS 和影响队列存储。数据文件不触发模型提炼，不自动生成 Capture/Card 或永久事实。按实际格式固定下载 MIME，忽略上传者伪造的 HTML MIME。
- Conversation Investigation 与原 Mission Runner 共享 `readExperiment`。支持一个文件内及两个文件之间比较；原表先读列名，再让模型选择实际列建立映射。不能用模型常量补单位、时间、方向或实验条件。行选择歧义拒绝，不静默选第一条。
- 比较核对 dataset、split、seed、evaluationCode、environment、phase、batchSize、unit、period、direction；未知/冲突不可比。零值、持平和下降原样保留；结果是原报告的条件核对，非实验复现、显著性检验或方法有效性证明。
- CSV 复用 [node-csv](https://github.com/adaltas/node-csv)（MIT，约4.3k star）。库上限64KB/100行/40列，Mission可引用原文12k字符，Conversation原文5k字符；超出时拒绝完整性虚报。非标准原表的预览明确裁剪。
- `propose_metric_verification` 沿原 Step、Approval、effectKey 和 readSet 产生固定核算预览。确认冻结原输入、映射、镜像和脚本。创建、启动、结果结算均重新校验 owner、lease、版本、指令、审批有效期与原来源。
- Docker 固定官方 Python manifest digest `python@sha256:8bcfa47b04b853a17aaf909362b847b2112fd6ec4105ea553ef9a43bafbb5916`；固定标准库脚本，仅重算差值。无网络、非root、只读根/输入、cap-drop、no-new-privileges、0.5 CPU、64MB、32 PID、8秒进程界限。模型不能提供镜像、命令、路径、网络或训练程序。参考 [Docker安全文档](https://docs.docker.com/engine/security/)。
- 原 Step 持久阶段为 CREATE_DISPATCH_COMMITTED → CREATED → START_DISPATCH_COMMITTED → SETTLED。每个 Mission 核算额度1；UNKNOWN 保留预占，恢复只 inspect 原确定 job，禁止另名创建或再次 start。create 回复丢失但已存在且从未启动的原容器可核实身份后完成原启动。
- 迟到回执可保留为历史；来源变化、撤权或审批过期不允许消费批准。成功回执、批准消费和 Step 状态原子提交。业务执行前检查全部决策 readSet；数学回执的当前有效性只依赖实际冻结指标，避免后续创建行动使旧算术回执假性过期。
- 后续行动仍走原 Action 审批、幂等和 `resultCardId` 结果链；创建、完成与现实效果分开。

## CT-6：公开来源定位 → 单独元数据许可 → 原请求账本

- DOI 只能来自本轮用户公开URL或原 PR-6 已读公开来源；私有 Capture、模型自由字符串不能变成任意外发查询。摘要中提取 DOI 还须原 PUBLIC_SOURCE 类别许可。
- 新增 `researchScope.academicMetadata`，默认false。Web/ArkTS均有独立勾选，旧范围不会自动扩权。工具选择仍由 Goal Reasoning/Investigation 动态决定，全文继续复用 PR-6 与 CT-4。
- 固定 Crossref HTTPS endpoint，禁重定向，30秒界限，响应128KB上限，验证请求/返回 DOI 一致；保留不完整日期、workType、版本关系、更正/撤稿通知，摘要最多1600字符。输出始终标记元数据/非全文/项目结果未知。参考 [Crossref REST 文档](https://www.crossref.org/documentation/retrieve-metadata/rest-api)。
- 复用原 ConversationTurn operation 与 MissionStep HTTP 派发账本；Crossref 与 GitHub/CI 共用累计 metadataRequests 界限，不因更换工具名或 operationId 重发 UNKNOWN。请求前后、提交和消费阶段重新核对范围、来源与指令。
- 元数据观察绑定父公开来源及 scopeRevision。父来源 SUPPRESS_USE 传播到元数据、派生 Artifact、经验与待确认提案的原消费路径；范围撤回/换版使旧元数据即时失效，UI保留为历史。来源链未知不成为独立证据。

## Web 与鸿蒙、接续与验收

- 两端同步 CSV/JSON入口、独立论文许可、持续调查工具许可、固定核算审批预览/真实回执/UNKNOWN/历史状态、来源阅读级别。旧 LOW_RISK 与 BOUNDED 许可不自动扩大。
- 用户可选择正式完成条件 FIXED_METRIC_JOB_RECORDED、PAPER_METADATA_READ、ACTION_RESULT_RECORDED。选择条件不是执行批准；服务端核验原审批/真实容器回执/当前元数据/非模拟 Action 的 DONE+resultCardId。只建草稿或只创建行动不能完成这些条件。
- 真实模型试跑发现创建时的 TODO 快照遮住了后来结果：现在上下文给出原行动最新状态指针，结果正文与引用仍要求 inspect_action 回读。又发现模型重复保存草稿：新增只读 completionReadback，复用正式 verifier 返回逐项验收状态，仍由模型自主决定结束，不新增固定流程。
- 累计预算复核仅在原 Mission PAUSED、owner、expectedVersion、requestId/hash 校验下调整总上限。模型最多24、工具64、活动900秒、累计输出预留48000；不减已用、不清 UNKNOWN、不新增搜索/Fetch或核算额度、不改变价格上限/持续许可/业务审批。委托版本与租约epoch递增后仍保持暂停；预算不是意图变更，不抬高contextVersion，避免误废同一已批准UNKNOWN job，原指令/来源/有效期检查仍即时生效，需另行继续。
- Conversation只将实际可用工具的 schema 送入模型，保留 Goal Reasoning、动态选择和生成式 UI。新的 QUICK 输入预算48k；旧 Turn 不改预算。耗尽时保留已校验的真实读取来源，不能丢弃后伪装通用项目摘要。

## 真实模型旅程与失败记录

所有本地指标、项目、用户报告均为独立测试库中的合成输入。模型、Crossref HTTP 与 Docker 各自按真实/脚本来源标注；没有训练或现实研究效果验收。

1. 第一篇 nnU-Net DOI `10.1038/s41592-020-01008-z` 的真实 Crossref 响应未知。保留原 UNKNOWN 请求和预占，没有换名称、重建任务重发该 DOI。
2. 不同的第二篇 U-Net DOI `10.1007/978-3-319-24574-4_28` 返回真实200；原PR-6搜索定位使用脚本提供的出版方已核实链接，不能当作真实搜索质量通过。模型自主选择元数据、原指标读取、条件比较、核算提案、草稿与行动。
3. 合成 Dice 0.8 → 0.7 被正确识别下降。用户模拟确认后运行真实 Docker，再获批创建人工复核行动，沿原 Action 服务记录合成结果卡。未声明现实复现。
4. 原任务先因旧行动快照与重复草稿耗尽12次模型预算；按原累计预算复核到18次，UNKNOWN和已用不变，继续同一 Mission。模型读回了 DONE+resultCardId，但随后仍重复草稿，触发 NO_PROGRESS。补入正式验收的只读结果后，再继续同一 Mission，一次模型调用正常 finish。最终6项条件通过，状态 SUCCEEDED，草稿内容仍 NEEDS_REVIEW、现实效果 NOT_INFERRED。
5. 同供应商的独立评审调用曾错误地把 UI 的“待批准列表为空”解释成没有批准历史；保留失败评审。补充全部历史后确认两次审批均已消费。最后评审仍给整体 PARTIAL_PASS_WITH_UNVERIFIED_ITEMS：合成用户报告不证明现实研究效果。不得把这些评审称为独立人审或全质量PASS。
6. 总预算协议始终同一 runId、24请求/5元上限，未重置；当前21个真实付费请求、费用上界0.639683元、usage未知0。Crossref共2次（1 UNKNOWN + 1真实200）。原始结果在 `output/r4-experiments/ct56-live-20261029/`，提交证据索引见本批 evidence 目录。

## Docker 本机故障处理

两次启动分别卡在 Docker run/dockerInference 与 docker-secrets-engine/engine.sock：Windows遗留AF_UNIX socket不可访问。参考 Docker [issue531](https://github.com/docker/desktop-feedback/issues/531)、[issue554](https://github.com/docker/desktop-feedback/issues/554)、[issue448](https://github.com/docker/desktop-feedback/issues/448)。确认后台退出后将两个瞬时运行目录改名备份再启动；Secrets目录当时仅有零字节socket。没有 factory reset，没有删除镜像、卷或容器数据。已恢复 Engine 并实际运行固定镜像探针。备份目录保留在用户LocalAppData。

## 最终检查与未关闭验收

本批回执目录：`evidence/r4-experiments/20261029-complete/`。最终检查数字、HAP哈希与源码快照由 `acceptance-summary.json` 记录；较早失败和中间成功回执不覆盖。

尚未完成真实手机安装/触控、真实用户多日使用、复杂论文全文/撤稿样本和真实实验日志的跨协议验证；当前只交付有限的固定算术沙箱，不是训练执行平台。Conversation新工具具备共享读取与撤权回归，但尚无本批完整“真实模型+元数据+指标+生成UI”的独立质量验收。原型中的 revoked GitHub candidate 可采纳问题仍按原UI评审报告保留，未夹带修复。没有生产部署、真实库迁移或外部业务写入。

## 最终收尾验证

- 全量141文件、1189测试通过；最终类型、lint通过。早期面板缺预算字段的兼容失败已修复，另增完成条件实际提交、预算不自动接续、create/start回复丢失与不重复执行回归。预算复核后的同一UNKNOWN job成功结算，保留原预占。
- 完整Web E2E：26通过、2项原有跳过；最终源码再次隔离生产构建与核算交互通过（2通过，含auth setup），审批/回执截图已保存。固定核算通用状态文案改为执行提案，避免误称创建行动。
- 鸿蒙86测试通过，最终HAP构建通过；unsigned HAP SHA256 `8aaa7acdd8b87c2b8c1faa6182735d6f4a29eb1730d9a4333c43070a04a6d87c`，6541353字节；signed开发包哈希也保留。构建不等于真机安装或正式分发。
- 原先4项工作树修改哈希保持不变；本轮没有生产部署或真实库迁移。
