# CT-2 仓库与 CI 观察实施记录

2026-10-29：第一阶段检查点接续后的第二阶段底层实现；尚未完成纵向交付。

分支：`codex/ct2-repository-ci`；基于第一阶段收尾提交 `0289755bf4d2c934cd2aa7424902510d0797f0a7`。

### 第二阶段：CT-2 首批底层代码

`lib/sensing/repoCi.ts` 复用原 SourceConnection 与 Continuity scope，默认关闭 `REPO_CI_OBSERVER_ENABLED`，没有新增表、Runner 或 Planner。第一批只实现固定 SHA 的公开 CI 元数据读取：先核对该仓库的原提交，再读 latest checks 和固定 head_sha 的 workflow runs，最多三次请求，保留 attempt、coverage、观察时间及连接版本。新指令、撤权、角色变化和连接变化在每次请求前后重验；不自动重试。

CI 状态只属于外部观察，`goalImpact=UNKNOWN`，没有自动完成 Action。工具名称等不可信文本仍保留资料身份，不能成为指令。响应有字节、条数和时间限制；日志、token、移动 ref、UI 和动态调用都尚未接入，不能宣称 CT-2 纵向完成。本批负例覆盖迟到撤权／指令、错误 SHA、覆盖不全、attempt 变化及无业务效果。

实现参考比较：[Octokit REST.js](https://github.com/octokit/rest.js)（MIT，超过 500 stars，近期仍维护）提供端点映射、分页和通用客户端；[GitHub Checks API](https://docs.github.com/en/rest/checks/runs) 与 [Workflow Jobs API](https://docs.github.com/en/rest/actions/workflow-jobs) 定义身份、attempt 和权限。当前只接三个 GET，沿用原生 fetch 更容易冻结响应体和次数上限，不为此新增 SDK 依赖，也不复制外部代码。后续日志需要单独绑定 run/attempt/job，处理日志跳转、隐私和部分读取。


验证：本轮完整工作树 134 文件 / 1146 项通过；其中 CI 观察 3 项测试覆盖固定 SHA、attempt、覆盖、迟到撤权/指令和无业务效果。最终受影响回归见 evidence/r4-continuity/20261029-resume/affected-fixed.log。

授权增补：旧连接的 `signalKind=COMMITS` 不授予 CI 读取权限。底层只接受明确的 `COMMITS_AND_CI`，前后重验该字段；将来由原连接控制合同提供授权交互，不能通过 feature flag 或模型解释升级。新增授权负例后，4 项底层测试另行通过，见 `ct2-grant-tests.log`；目前没有给真实连接升级授权。

后续按原 CT-2 路线接入原 Investigation/Turn 账本、固定 attempt/job 的有界日志、GoalGap 与双端交互，不新增并行执行或记忆系统。

## 2026-10-29 第二批：动态调查与双端控制

已把 `read_repository_ci`、`read_ci_jobs`、`read_ci_log` 加入原 Focus Investigation 和 Mission 工具集合。固定 SHA 来自该用户连接的原提交观察；任务和日志只能沿原 STATUS→JOBS 来源选定 run/attempt/job。Agent 仍自主决定读哪种资料及何时停止，工具没有固定串行工作流。

- CI 元数据与日志分别由 Web/ArkTS 原资料页授权，CAS 绑定连接 revision，AgentRun 保存原授权回执；旧 COMMITS 不自动升级。无 schema 迁移。
- 每次 HTTP 复用原 Turn operations 或 MissionStep.protocolJson；元数据预算与模型/Search-Fetch 分开，原 Mission 累计。UNKNOWN 不能靠改名、换步骤、换 generation 自动重发；失去租约的迟到结果不能发布。已知缓存保留原观察时间。
- 日志只读已观察到的失败任务，重新核对当前 attempt；读取和重定向有时间、字节与域名上限。凭据、私钥和签名查询参数在持久化前脱敏；临时签名下载 URL 不进入账本。脱敏不等于已验证日志没有任何隐私，真实日志质量仍需独立审查。
- 原始 CI 来源保存在原 Turn/Step，派生 Artifact/经验追到原连接；撤权/版本变化后停止复用。CI 绿不自动完成原 Action，也不提升为部署或实验验收。Web 增加观察和日志展开，ArkTS 沿原来源渲染与授权控制。

新证据：`evidence/r4-continuity/20261029-ct2-ct3/`。本批全量服务测试 135 文件 / 1151 项通过；随后受影响保护 11 项、调度公平性探针 4 项通过。最终类型、Web/HarmonyOS 与 E2E 状态见该目录回执，不沿用早期底层的结论。

仍待签收：真实公开仓库 API 与不同日志下载域名探针、私有 OAuth 连接、独立模型质量、必要的有界 diff、模拟器/真机旅程。本批不能据此宣称 CT-2 全部产品验收完成。
