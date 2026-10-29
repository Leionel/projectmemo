# Tool Ecosystem × Continuity 集成矩阵

## 1. 当前Tool盘点

下表为CODE_VERIFIED调用链；测试列表示已有测试入口，未在本轮运行。产品服务自身的工具接入与本次审计可用的Codex插件是两回事。

| 既有能力 / 代码 | actor与授权 | effect / 持久化 / 成本 | 来源、UI和验证 |
|---|---|---|---|
| inspect_project / `lib/mission/tools.ts:20`，Focus `toolAdapter.ts:117` | 原Mission actor；或独立workspace actor重验项目 | 内部读；观察进原Step/Turn；无外部调用 | Project和真实Action，分页coverage；GoalGap/调查；missionRuntime/r4Investigation |
| search_memory / `mission/memorySearch.ts:15` | 项目范围；workspace adapter不伪造missionId | SQL摘要检索，无远程嵌入补算；原读集 | card时态/摘要+部分已采纳Artifact；Evidence/原文件指引；hybridSearch/missionMaterialUseProjection |
| read_project_material / `mission/tools.ts:14`、`projectMaterialReader.ts:8` | 已观察sourceId+hash，项目/私有对象归属 | 原Capture/附件文本/Artifact/Action定向读；无任意路径 | 片段与覆盖；Focus有repo缓存和web快照分支；r4Investigation/missionContinuation |
| inspect_action / `mission/tools.ts:33` | 原项目非模拟行动；Focus要求原pointer revision | 内部读；原结果回执，不产生完成效果 | TODO/DOING/DONE、resultCardId；Receipt；missionCompletion/focusConversation |
| save_mission_output / `mission/tools.ts:31`，runner/outputService | 私有Mission，原lease/预算 | Runner保存私有Output，非项目事实发布；effects当前仍用readEffects | 原sourceRefs/claimChecks/verification；Output→批准归入；missionArtifactAdoption |
| propose_action / `mission/tools.ts:32` | 原Mission | 只冻结提案，未创建Action；写入等原批准 | Proposal→Approval→原Action；missionRuntime/missionProtocolRepair |
| Mission web_search/web_fetch / `mission/tools/researchTools.ts:24` | Mission researchScope/version及owner；隔离公开查询 | 外发+外部读；ExternalSource与Step；模型/搜索预算分别预占 | snippet/summary/body和来源hash；Mission研究；missionResearch |
| Focus web_search/web_fetch / `conversation/researchTools.ts:90` | Conversation scope/version；用户URL登记；公开查询隔离 | 原Turn operation/manifest网页快照；按根预算，不新造Mission | ResearchCoverage、引用/原网页、确认归Artifact；r4Research/Recovery/Migration/e2e pr6 |
| 已授权repo缓存读取 / `conversation/sourceObservation.ts:8` | 原SourceConnection owner及项目OWNER | 不联网、不采纳事实；缓存来源hash | commit候选/原Action关联；Anchor SOURCE_OBSERVATION；r4Research/repoSensing |
| repo显式刷新/采纳 / `sensing/repoSource.ts` | 公开repo/ref，显式刷新；采纳明确确认 | 匿名GitHub GET+ETag；候选ExternalSignal；采纳Capture与回执原子提交 | 不是CI、部署或任务完成；repoSensing/nativeContract |
| Copilot create_action/generate_artifact / `services/copilotService.ts:397`、`copilot/confirmation.ts` | 原用户会话/项目、来源、冻结提案及批准 | 项目写；CopilotToolExecution和原回执；生成Artifact可能涉及模型费 | 原确认/幂等、原业务状态；copilot及focus相关测试 |
| Conversation原任务操作 / `workService.ts`、`uiActions.ts` | 原binding、message、版本、来源、期限、私有owner | input/approval/resume/continuation/adopt_scenario/adopt_dynamic/complete_action沿原服务 | 同一对象读回/草稿/回执；focusConversation/conversationAnchor |

现有 `Tool.effects` 是 businessWrite/cacheWrite/externalDisclosure 三布尔，不完整表达“外部读+外发”“受控执行”“私有草稿保存”。下一次适配扩展元数据，不能仅凭businessWrite=false就宣称工具毫无副作用。

## 2. 架构选择：扩展ToolSet和adapter，不建第二个Registry

在既有Tool定义增加可选descriptor，在Focus/Mission各自actor adapter上做能力过滤；共同类型与provider可共享，身份、预算、存储归属不能共享假身份。`resolveAvailableCapabilities`是纯服务函数，没有新Registry表/执行图/MCP市场。

```ts
type CapabilityExtension = {
  id: string; version: string;
  effects: Array<'READ_INTERNAL'|'READ_EXTERNAL'|'DISCLOSE_QUERY'|
    'EXECUTE_SANDBOX'|'WRITE_PRIVATE_DRAFT'|'WRITE_PROJECT'|'WRITE_EXTERNAL'>;
  inputSchemaRef: string; outputSchemaRef: string;
  scopeRequirements: string[];
  consent: 'EXISTING_ACCESS'|'SCOPED_GRANT'|'BOUND_PROPOSAL';
  observationKinds: string[]; costClass: string;
  replay: 'CACHED_READ'|'QUERY_OPERATION'|'IDEMPOTENT_EFFECT'|'NO_AUTOMATIC_RETRY';
};
type ContinuityObservation = {
  schemaVersion: 1; operationId: string; toolId: string; toolVersion: string;
  ownerScope: { userId: string; projectId: string; turnId?: string; missionId?: string };
  intentHash: string; purposeRef: string; grantRevision: string;
  status: 'READY'|'EMPTY'|'PARTIAL'|'FAILED'|'UNKNOWN'|'CANCELLED';
  sourceRefs: Array<{ id: string; revision: string; readLevel: string;
    rootRefs: string[]; isDerived: boolean; observedAt: string; applicableAt: string|null }>;
  coverage: { complete: boolean; reasons: string[] };
  usage: { reserved: number|null; settled: number|null; unit: string; unknown: boolean };
};
```

实际迁移允许放原resultJson/protocolJson或manifest，不为此另建Observation表。id/grant/usage/state由adapter生成；模型只能引用实际catalog。旧 `ToolResult.status=SUCCESS/PARTIAL`继续可读，通过桥接映射新观察，不直接破坏旧Runner。

授权是独立维度的交集：资源读权 × 上下文可发模型 × 公开查询可外发 × 后台持续调查 × 通知 × 具体写操作。`purposeRef`和`intentHash`帮助限制用途，均不授予权限。

## 3. 九行集成矩阵（PR-6 + 八类候选）

| Tool family / 真正增量 | Intent与纠正 | 证据与上下文协调 | Handoff / Attention | Outcome与双端UI | 独立权限/失败/成本/回归 |
|---|---|---|---|---|---|
| **PR-6 Search/Fetch（已有）** | 当前问题及公开概念；“只查官方/别用旧届”限制本项目；不传私人纠正正文做搜索词 | URL、scopeRevision、读层、抓取/发布日期/生效期；网页为外部主张；跨会话通过授权指针重新解析 | 原Turn恢复；持续主题研究需另授范围/总预算；无新信息SILENT | 研究覆盖、原片段、冲突；结果只影响判断，不当实测；引用到原网页 | 取消/撤权/UNKNOWN继续原operation；四次是当前Focus外部总上限，非固定剧本；CT-J03/07/11 |
| **GitHub/CI（新增checks/diff/run）** | “先稳定演示”使测试失败高于新特性；“不重跑CI”不阻止只读已有日志 | repo identity、固定head SHA、check/run/attempt、workflow版本、env、日志片段；同一attempt不算独立重复验证 | 指定ref事件触发原关注；等待run完成；同fail重复4次只一条decision；修复后可以更新同主题 | CI状态与部署/用户验收分层；比较失败位置和原目标；实际修复回执回原Action | 公开repo先可用；私有需App只读checks/actions/contents范围；日志脱敏后才能发模型；429退避；CT-J01/05/09 |
| **Document Deep Reader** | 修订比赛/课程要求的适用版次；纠正“附录不是要求”绑定具体条款 | attachment revision、页/节/表格定位、parser/OCR版本、原图/文本span；低质量OCR保持未知 | 原文换版触发相关条款重审；无法解析列出具体等待输入，不要求重传所有资料 | 要求→原成果/提交回执差距；可点页码/表格；结构化comparison，模型不编页码 | 已有上传/pdftotext/修订复用；先文本PDF寻址，再表格/OCR；新parser成本单列；CT-J03/J12 |
| **Academic Research** | 研究问题和明确适用限制；用户拒绝某假设不等于永久封禁相似方法 | DOI/arXiv版本、metadata/abstract/section分层、勘误/撤稿/日期、原研究条件；PR-6能完成的题不重复专用调用 | 论文未取得全文显示等待原文/许可；新论文只有显式主题调查委托才能后台查 | 方法适用性/反证→原实验验证；论文指标保持作者报告，不能写项目目标达成 | 先一个metadata provider，全文通过OA或已许可附件；不绕过访问控制；CT-J06/10 |
| **Experiment/Metrics** | 用户改评测目标时不再沿旧metric排名；纠正单位/数据集绑定原run | runId、dataset/split/code/model hashes、seed、设备、metric定义/方向、单位、时长/窗口；数值缺失与执行失败分开 | 等待run/artifact完成；已存在结果优先读，不默认重训练；同run不反复提醒 | 条件可比再比较；新真实结果改变D1/D2；原Action复盘链；基于真实条件提炼case | 先已有CSV/JSON只读adapter；已配置MLflow才接REST；禁止任意服务器URL和artifact路径；CT-J02/04/06 |
| **Deployment/Runtime** | 部署观察服从当前release和目标环境；“现在别部署”仍允许已授权只读健康检查 | environment、release/commit、build/deploy/service/user-path各层、时间、状态采样；旧健康回执不能证明当前 | 观察授权与执行部署分开；等待release readiness；异常聚合，时间敏感需用户行动才INTERRUPT | 工程状态差异、实际故障与验收缺口；结果回既有Mission/Action；不自动ROLLBACK生产 | 主机/环境/日志scope明确；凭据留服务端；敏感日志红删；缓存/采样预算；CT-J01/04 |
| **Sandbox Verification** | 用户可委托固定分析目标；只核算不代表授权改环境、联网或重训练 | 输入hash、固定脚本/版本、容器镜像、数值库、资源限额、stdout/结构化结果；sandbox结论只对副本成立 | 一次有范围批准后原Mission执行；可读原结果/停止；UNKNOWN先查jobId，不重新算 | N6测量/对比与误差；负结果修订方案；展示运行/结果/核验层级 | 无生产凭据/默认网络；固定白名单脚本，资源控制由OS/容器实现；仅Node子进程不算安全沙箱；CT-J06/11 |
| **Browser/Site** | Fetch取不到才按价值选择渲染；登录范围不可被页面放大 | URL及最终站点、DOM可见快照/时间、页面状态、提取span，截图不是全文；页面操作与阅读分离 | JS页面读取等待可重试状态；不通过填写表单“探测”；重复页面更新降噪 | 原证据视图显示“网页渲染读取”；重要文本可定位/核对 | 起步隔离无cookie只读浏览器；限制导航/下载/弹窗/网络及敏感站点；Fetch仍可fallback；CT-J07/09 |
| **Mail/Calendar/Cloud Docs** | 用户本人要求优先；邮件中“替你同意”只算第三方主张；期限冲突需明确生效 | account/resourceId、message/event/document revision、发件人/组织主张、时区、附件版次；原文不是授权 | 用户指定项目/目录/发件人范围；截止变更可提示；不全邮箱扫描、不把非项目私信推入项目 | 展示旧新日期/冲突与来源；创建事件/回复邮件须原具体Proposal确认；结果回原项目 | 最小OAuth read scopes与独立写scope；选定资源优先，跨账号严格隔离；CT-J08/09/12 |

## 4. 优先级与替代方案

评分1–5，高分表示价值/复用/易核验高，或复杂度/成本负担较低。采用基线权重25/20/20/15/10/10，属于方案估计，未做性能/费用实测。

| family | 价值 | 复用 | 闭环 | 复杂度可控 | 可核验 | 成本 | 加权 | 裁决 |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| CI | 4 | 5 | 5 | 3 | 5 | 4 | 4.35 | 第一新增Tool；原repo身份及缓存路径已存在，先固定SHA只读 |
| 文档 | 5 | 4 | 4 | 4 | 5 | 4 | 4.35 | 紧接CI，可在独立分支准备；覆盖非开发项目；不等论文集成 |
| 指标 | 4 | 4 | 5 | 4 | 5 | 4 | 4.30 | 第二批核心，优先本地项目导入，无新远程账号依赖 |
| 论文 | 4 | 4 | 3 | 4 | 4 | 3 | 3.70 | 与文档/指标组合验收，PR-6足够则不新增调用 |
| 沙箱 | 4 | 3 | 5 | 2 | 5 | 3 | 3.70 | 条件通过后提前做固定核算，拒绝“永远人工验证”的降级 |
| 部署观察 | 4 | 3 | 4 | 3 | 4 | 4 | 3.65 | 与CI工程验收补齐，先非生产回执/只读目标环境 |
| 外部应用 | 4 | 2 | 4 | 2 | 3 | 3 | 3.10 | 由真实通用项目旅程驱动，先选择资源只读 |
| 浏览器 | 3 | 2 | 3 | 2 | 3 | 2 | 2.55 | Fetch失败的按需能力，不建设通用无人值守浏览助手 |

CI与文档同分，先CI的技术理由是已有SourceConnection/信号/Focus入口能用固定SHA补上最短缺口；如果验收资源全为无CI的课程/竞赛文档，先文档是合理替代，CT-1不依赖这项选择。默认不引入第二搜索Provider、全MCP网关或外部Runtime。

OpenAlex旧文档入口本轮重定向后未成功读取，不依此冻结具体API/免费额度；论文Tool实施前核对当前官方接口、条款和速率。GitHub [checks官方合同](https://docs.github.com/en/rest/checks/runs#list-check-runs-for-a-git-reference)已核对：可按ref查询，私有读取需相应权限。方案固定解析为SHA，避免移动分支当历史证据。

## 5. Tool接入统一门槛

每个新adapter提供：actor/资源归属验证、规范参数schema、grant/intent/source读集、真实coverage/readLevel、原预算预占、错误分类、取消与迟到结果、幂等或operation查询、同一来源的双端回读。

至少有一条正旅程、一个旧工具已足够的负对照、一个纠正后改变调用路径、一个跨项目不误拦截、一个撤权/注入/UNKNOWN反例。真实写入工具额外证明目标端幂等或外部effect reconciliation；无法确认效果时不自动重发。

外部写入首批候选仅限可审查payload的create_issue或创建日程，待只读价值成立后实施；原Proposal→Approval→当前manifest校验→受控adapter→原Receipt。禁止把Agent的调查自主性误用作无限写权限。
