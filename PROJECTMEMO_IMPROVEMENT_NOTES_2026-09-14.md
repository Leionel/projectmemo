# ProjectMemo 完善实施记录

关联方案：`PROJECTMEMO_IMPROVEMENT_PLAN_2026-09-14.md`。

复赛提交清单：`REMATCH_SUBMISSION_GATE_2026-09-14.md`；提交阻断项 SUB-01 至 SUB-11 独立于功能代码状态，逐项关闭。V1.1 已核对仓库鸿蒙赛道盖章规程，尚未在登录后的提交平台核验最新模板/通知。

本文件记录第一阶段复审及第二阶段 B1–B4 的实际实施结果。2026-09-15 已完成 A1/A2/A3 复审修复、B1–B4 代码修改、独立数据库回归、Web 构建/E2E 和鸿蒙单测/HAP 构建；设备安装、签名、真实评审地址和托管验收仍未完成。

## 状态约定

- NOT_STARTED：本轮完善批次尚未执行，不表示其对应旧能力不存在。
- IN_PROGRESS：已有修改，所需验收尚未完成。
- CODE_VERIFIED：当前批次代码与相关自动化验证通过。
- ACCEPTED：该批要求的设备/外部/交付验收也完成。
- BLOCKED：明确记录外部依赖及未完成范围。

## 批次记录

| 批次 | 状态 | 修改/提交 | 验证证据 | 剩余限制 |
|---|---|---|---|---|
| A1 记录可靠写入与入口 | CODE_VERIFIED；设备验收 BLOCKED | `Capture.requestId/requestHash`、`processCaptureWithRequest`、鸿蒙草稿恢复和统一录入入口；复审修复跨项目 AgentRun requestId 命名空间冲突 | `evidence/phase1-review-20260915-0753/`、`evidence/phase2-20260915-085607/`；针对性 62/62；全量 30 files/225 tests | 未在设备上验证键盘/大字体/断网和重启恢复；无设备目标 |
| A2 会议确认与冲突 | CODE_VERIFIED；设备验收 BLOCKED | 提案基线、`AgentRun.confirmedAt`、事务内执行权和截止日期冲突校验 | `tests/meetingStateDiff.test.ts` 及第二阶段针对性回归；并发/旧截止/部分冲突均有结果 | 未在鸿蒙设备上验证 409 后的交互 |
| A3 依赖原子更新 | CODE_VERIFIED；设备验收 BLOCKED | 最终依赖集合、`dependencyVersion`、事务图校验和当前数据评估 | `tests/actionFeasibility.test.ts` 及第二阶段针对性回归；替换/回滚/环路均有结果 | 未完成设备端完整编辑流程验收 |
| B1 记忆生命周期一致性 | CODE_VERIFIED；设备验收 BLOCKED | 统一时态顶层状态、reason/evidence refs、归档/恢复/历史来源路径 | `evidence/phase2-20260915-085607/`；全量与鸿蒙检查通过 | 设备展示、长文本与真实附件路径未验收 |
| B2 状态历史与新鲜度 | CODE_VERIFIED；设备验收 BLOCKED | 持久 freshness、失败保留旧快照、补偿刷新、并发收敛、规则版本与业务版本分离 | `tests/projectState.integration.test.ts`、`tests/phase2Acceptance.test.ts`；全量与 E2E 通过 | 设备上的刷新失败、游标和重启交互未验收 |
| B3 预算与反馈作用域 | CODE_VERIFIED；设备验收 BLOCKED | 全局预算账本、项目级偏好、反馈/曝光/通知送达分离及稳定键幂等 | `tests/phase2Acceptance.test.ts`；全量与类型检查通过 | 原生通知的实际曝光仍需设备验证 |
| B4 简报/会议/行动交互 | CODE_VERIFIED；设备验收 BLOCKED | 简报证据字段与导航、主动提醒去重、A2/A3 冲突和依赖重评复用 | `tests/projectChangeBrief.test.ts`、`tests/meetingStateDiff.test.ts`、`tests/actionFeasibility.test.ts`；鸿蒙构建通过 | 设备端完整主线未验收 |
| C1 设备与交付 | BLOCKED | 已建立开发/评审地址显式配置和校验；本地 HAP 构建成功 | `evidence/phase2-20260915-085607/results.json`；`npm.cmd run harmony:test` 27/27；`npm.cmd run harmony:build` 退出码 0 | `Constants.BUILD_FLAVOR=development`；评审地址为空；`signingConfigs=[]`；`hdc list targets` 不可用 |
| D1 文件来源闭环 | NOT_STARTED | — | — | 已有上传/纠错基础 |
| D2 阶段记忆整理 | NOT_STARTED | — | — | P2 |
| D3 应用内排程 | NOT_STARTED | — | — | P2 |
| E1 GitHub 只读 | NOT_STARTED | — | — | 授权环境待验证 |
| E2 Calendar 只读 | NOT_STARTED | — | — | 平台待选择 |
| E3 后台与日历写入 | NOT_STARTED | — | — | 依赖外部集成验收 |

## 第二阶段回执 / 2026-09-15

### B1 Memory Lifecycle 一致性

- 统一规则：`lib/memory/temporalLedger.ts` 负责将细分时态映射为 `CURRENT/SUPERSEDED/CONTESTED/UNKNOWN`，并保留细分 reason 与 `TemporalEvidenceRef`。搜索、问答、项目快照、变化简报、成果审计、Web 卡片和鸿蒙记忆/归档页面使用同一状态语义；`UNKNOWN` 不当作 `False`。
- 归档只改变可见性，不改变事实时态；恢复不会复活已取代事实。归档列表、恢复 API、来源/历史导航已补齐；来源纠错、撤销和待确认关系会重新评估当前结论，历史版本仍保留定位信息。
- 证据：`evidence/phase2-20260915-085607/`；`tests/memoryLifecycle.test.ts`、`tests/artifactAudit.test.ts`、`tests/projectChangeBrief.test.ts`、`tests/projectState.integration.test.ts`。

### B2 Snapshot / Diff 与新鲜度

- `ProjectStateFreshness` 持久记录 `FRESH/REFRESHING/STALE/FAILED`，业务写入后的状态刷新统一走 `refreshProjectStateAfterMutation`。刷新失败保留最近快照和失败原因，不显示假 0%；并发刷新按当前版本收敛，规则版本与业务版本分开，已了解游标只推进实际展示的变化。
- 项目目标、交付证据和时态关系等此前漏掉的写入入口已接入补偿刷新；首次、无变化、关闭、来源失效和请求失败的状态均返回明确 freshness 信息。
- 证据：`tests/projectState.integration.test.ts`、`tests/phase2Acceptance.test.ts`、隔离 `test:e2e`。

### B3 预算、反馈和偏好闭环

- 新增持久 `InterventionBudgetLedger`、项目级 `InterventionPreference` 和 `InterventionDelivery`。预算扣减使用条件更新，项目偏好不会串到其他项目；FIRE、实际曝光、用户反馈和系统通知送达分别记录。
- 反馈按稳定键幂等并以最新明确反馈计数，延期/未曝光/无反馈不当作忽略；降频建议须确认，可撤销并恢复。通知回执的 `PUBLISHED` 仅表示系统发布接口接受，不冒充用户曝光。
- 证据：`tests/phase2Acceptance.test.ts`，包括跨项目偏好、并发预算/反馈/送达及重复回执。

### B4 简报、会议和行动交互

- 变化简报保留字段、观察时间和内容哈希，证据可导航到对应卡片；无变化不生成假进展，阅读不创建行动。主动提醒接受用 `dedupeKey` 原子去重。
- 会议与依赖继续复用第一阶段的提案版本、事务冲突、最终依赖集合和当前评估规则；鸿蒙模型、服务、状态面板、记忆时间线和项目变化简报已同步字段。
- 证据：`tests/projectChangeBrief.test.ts`、`tests/meetingStateDiff.test.ts`、`tests/actionFeasibility.test.ts`、`tests/phase2Acceptance.test.ts`。

## 第一阶段回执 / 2026-09-14

### A1 普通记录可靠写入及鸿蒙录入入口

- 原问题：同一记录在并发/响应丢失重试时可能重复创建 Capture/Card；鸿蒙顶部、正文和缺口入口曾不能统一打开正确录入上下文。
- 变更文件与机制：新增 `20260914080000_phase1_reliability` 增量迁移；`Capture` 增加 `requestId/requestHash` 及项目内唯一约束；服务端用 `AgentRun` 持久化占位和短事务原子提交 Capture、卡片及完成回执；同 ID 同内容重放原业务 ID，同 ID 不同内容返回 409；索引/embedding 后处理失败返回“已保存，部分索引更新待重试”。Web `CaptureBox` 持久化草稿和请求 ID；鸿蒙 `DeviceIdentity`、`ProjectHome`、`MemoryService` 同步请求 ID 并在应用恢复后重开草稿，三个入口复用同一 Sheet。
- 验证：`tests/phase1Reliability.test.ts` 4/4；四类针对性回归 40/40；独立探针证明 10 并发为 1 个 201 + 9 个 200、同 ID 冲突 409、不同 ID 生成两条；迁移空库重放和旧库升级均通过。

### A2 会议确认可靠执行

- 原问题：同一提案并发确认可能重复执行；预览后用户修改截止日期时旧提案可能覆盖新事实。
- 变更文件与机制：`meetingStateDiffService` 在预览保存截止日期基线；确认时校验项目归属、hash/version/changeId、澄清状态、非空选择和源字段；事务内条件抢占唯一执行权，并在同一事务中完成变化、结果卡和完成回执；已执行重试返回原业务 ID；截止日期基线冲突返回 `STATE_CHANGED_REPREVIEW`。鸿蒙收到 409 保留原会议文本/日期并回到草稿，不自动确认新版。
- 验证：`tests/meetingStateDiff.test.ts` 纳入四类回归；独立探针显示并发结果共用一个结果卡，旧截止被拒绝且新截止保留；混合冲突不留下部分写入。

### A3 行动依赖原子更新及准确评估

- 原问题：同一目标同时移除并添加依赖时可能先删后丢，导致未完成前置被误判 READY；并发反向依赖可能形成环。
- 变更文件与机制：`ActionItem.dependencyVersion` 增量版本；`actionFeasibilityService` 在事务内读取并计算最终依赖集合，明确 hard/note 替换语义，校验项目归属、自依赖、重复目标和环路，使用 `expectedVersion` 拒绝过期编辑；提交后基于当前数据库重评估，不信任客户端 READY。鸿蒙模型和 `ActionFeasibilityEditor` 已同步版本及预期版本。
- 验证：`tests/actionFeasibility.test.ts` 纳入四类回归；独立探针证明软依赖替换仍保留目标、非法跨项目批次整批回滚、反向并发不能形成环；当前评估结果来自实际数据。

### 数据库与提交预检

- 独立数据库：`evidence/phase1-20260914-1835/probe.ts` 使用独立 SQLite、`LLM_MODE=mock`，未使用开发库、个人登录态或凭据；`results.json` 保留空库迁移重放和旧库副本升级结果。没有运行 `seed`、`demo-reset` 或破坏性迁移。
- SUB-01：已查清鸿蒙地址唯一来源为 `harmonyos/entry/src/main/ets/common/Constants.ets`；开发地址固定标注为模拟器 `http://10.0.2.2:4400`，评审构建必须填 `REVIEW_BASE_URL`，`requireBaseUrl()` 拒绝空地址和回环地址。真实评审域名未提供，非开发网络验收 BLOCKED。
- SUB-02：本轮 `npm.cmd run harmony:test` 退出码 0，27/27；`npm.cmd run harmony:build` 退出码 0，生成 unsigned HAP，大小 2,697,157 bytes，SHA-256 `148182cf6e30fb34f55321a2987cf47290052be16e1ee45d649fc78e4720c27c`。`build-profile.json5` 没有签名配置，`hdc` 不可用，安装/启动/重启验收仍 BLOCKED。
- SUB-07：`npm.cmd test` 退出码 0，30 个测试文件/225 个测试；`npm.cmd run build` 和隔离 `npm.cmd run test:e2e` 已通过；本轮仍未宣称真实设备空安装和重启通过。
- SUB-08：只完成代码和本地隔离检查；没有公开部署、没有上传、没有改变服务器或访问控制，托管/匿名写入/备份恢复验收 NOT_RUN/BLOCKED。

## 命令与退出码

| 命令 | 结果 |
|---|---|
| `npm.cmd test -- tests/phase1Reliability.test.ts tests/meetingStateDiff.test.ts tests/actionFeasibility.test.ts tests/projectState.integration.test.ts tests/artifactAudit.test.ts tests/projectChangeBrief.test.ts tests/phase2Acceptance.test.ts` | 0；7 files / 62 tests passed |
| `npm.cmd test` | 0；30 files / 225 tests passed |
| `npm.cmd exec tsc -- --noEmit` | 0 |
| `npm.cmd run lint` | 0；0 errors，7 个既有 warnings |
| `npm.cmd run build` | 0；Next.js production build passed |
| `npm.cmd run test:e2e` | 0；独立 E2E 环境通过 |
| `npm.cmd run harmony:test` | 0；27/27 |
| `npm.cmd run harmony:build` | 0；unsigned HAP；2,697,157 bytes；SHA-256 `148182cf6e30fb34f55321a2987cf47290052be16e1ee45d649fc78e4720c27c` |

旧 lint warning 和 ArkTS 弃用 warning 未在本阶段扩展为无关重构；本阶段没有生成提交或推送远端。

## Deviations

记录格式：方案原要求 → 实际代码约束 → 采用选择 → 影响的验收项。普通实现调整记录后继续；涉及方案第 19 节边界时只暂停相应工作。

1. 方案要求持久唯一幂等键；实际使用 `Capture` 的项目内唯一约束并以 `AgentRun` 作为跨模型请求的持久执行占位，保留无 requestId 旧客户端路径以兼容旧返回字段。影响：新 API/鸿蒙路径已覆盖；旧客户端主动新建同文记录仍按旧语义创建。
2. 方案要求后处理失败可恢复；实际将模型/检索放在数据库事务外，保存成功后以 `postProcessingPending`/明确消息返回。影响：索引补偿任务仍是后续运维能力，不把它伪装成已完成。
3. 评审构建地址没有真实输入；实际只建立显式 flavor、校验和阻塞记录，没有编造域名或把 `10.0.2.2` 作为交付地址。影响：SUB-01、非开发网络及最终 HAP 仍不能关闭。
4. B1 的统一状态规则复用现有时态账本并保留细分原因；没有把人工确认升级为系统证明。影响：本地代码语义已核验，设备端展示和真实来源链仍待验收。
5. B2 的业务写入采用写后补偿刷新，刷新失败保留旧快照并标记过期；不把同步刷新失败伪装成业务写入失败。影响：状态 freshness 已有服务端证据，设备断网/恢复路径尚未验收。
6. B3 将 `PUBLISHED` 定义为系统通知接口接受发布，实际曝光仍需独立事件；反馈统计只保留最新明确反馈。影响：避免把系统送达或未曝光误计为用户忽略，但原生通知可见性仍需设备验证。
7. 本机 Prisma schema engine 对不存在的 SQLite 文件返回空错误；迁移验证先创建零字节临时数据库，再执行 `migrate deploy`，并用独立旧库副本验证 14→16 迁移。未接触开发库。
