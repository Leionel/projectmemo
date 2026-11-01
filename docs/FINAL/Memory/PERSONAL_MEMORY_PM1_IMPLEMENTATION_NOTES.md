# PM-1 实施记录：账户个人记忆首个纵向切片（2026-11-01）

基线 `1c3b6a5`，分支 `codex/personal-memory-explicit`，独立 worktree `D:/Projects/hongmen-personal-memory`。规划依据 `docs/FINAL/Memory/` 六份文档；本文只记录实际改变与验证，不重复合同条款。

## 用户现在能做什么

用户在 Web `/settings/memory` 或鸿蒙「设置 → 我的记忆」明确保存一条非敏感协作偏好（例如"以后技术讨论先给结论"），原 Conversation 的调查上下文与原 Mission 的上下文构建都会按当前版本带入该条目；用户可查看来源与版本经过，可暂停、恢复、撤回、删除，或整体清空；关闭账户使用或设置项目例外后，新派发与新发布立即不再包含个人正文。原批准创建 Action、原完成服务留下 `resultCardId` 的业务闭环保持原样（旅程测试覆盖）。

## 实际新增（全部在 AgentClaim 统一账本内，无第二个记忆框架）

| 层 | 文件 | 内容 |
|---|---|---|
| 迁移 | `prisma/migrations/20261101170000_pm1_account_memory_scope/` | AgentClaim 重建（`scopeType`，`projectId` 可空 + 两条 CHECK：PROJECT 必有 projectId、ACCOUNT 三字段必空）；ProjectMembership 加 `personalMemoryMode/Version`；新表 `UserMemoryPolicy`（策略与 privacyRevision，不存正文）、`UserMemoryControlReceipt`（owner+requestId 幂等，不存正文） |
| 范围 | `lib/memory/scope.ts` | 判别联合 + 项目查询显式化辅助；项目侧所有 AgentClaim 查询补 `scopeType:"PROJECT"`（claimEffective/claimReadable/claimService/conversationDigest/digestService/hypothesisService/sourcePolicy） |
| 策略 | `lib/memory/userMemoryPolicy.ts` | 策略零初始化（原 User 锁内）、个人内容 hash、读集构建、`assertPersonalMemoryReadSet` 同步失效守卫（抛 `COGNITIVE_RECOORDINATE`，由原 assertTurnCurrent 映射为 TURN_RECOORDINATE） |
| 准入 | `lib/memory/personalAdmission.ts` | 纯规则分类：DIRECT_APPLIED / SESSION_ONLY / PROJECT_GUIDANCE / NEEDS_CLARIFICATION / NOT_USER_MEMORY_COMMAND / REJECTED_FOR_MEMORY（凭据+首批敏感）；不依赖模型分类激活 |
| 写路径 | `lib/memory/personalMemoryService.ts` | ADD_EXPLICIT/ADD_FROM_EXPRESSION/UPDATE/PAUSE/RESUME/WITHDRAW/DELETE/DELETE_ALL；User 写锁、CAS（expectedRevision/expectedPolicyVersion）、payloadHash 幂等、控制回执、删除清除正文（条目+历史事件 userQuote 置空）、DELETE_ALL 推进 `extractionNotBefore`；每类变更同事务推进 `privacyRevision` |
| 失效 | `lib/memory/personalInvalidation.ts` | 账户级扇出：该用户所有活跃 Turn（携带个人读集的）置 INVALIDATED，所有活跃 Mission 走原暂停/废弃/版本推进；未携带读集的旧在途轮次不追溯 |
| 选择 | `lib/memory/personalContext.ts` | 两个 Composer 共用：资格（策略/项目例外/状态/有效期/主题/处理许可）、预算（6 条/2400 字符）、遗漏原因、`nextBoundary`、J29 处理许可（`cloudProcessingEnabled` 或本地 provider） |
| 消费 | `investigationService.ts` / `contextBuilder.ts` / `runner.ts` / `digestService.ts` | Conversation composer 增加 `personalContext` facet + `personalMemoryReadSet`；Mission context 以 hash 绑定同一 facet；runner 模型前/COMMIT/工具派发/结算四处断言读集；综合发布前断言；`activateNextGeneration` 重置该读集 |
| API | `app/api/me/memory(/policy)/route.ts` | GET 列表/详情、POST 命令、PUT 准入预览、GET/PATCH 策略；owner 只来自认证会话 |
| Web | `app/settings/memory/page.tsx` + `components/PersonalMemoryManager.tsx` | 列表、添加（表单+原话判断）、暂停/恢复/删除（次级动作）、来源与版本详情、使用与控制开关（含解释文案） |
| 鸿蒙 | `pages/PersonalMemoryPage.ets` + `services/PersonalMemoryService.ets` + `Index.ets` SettingsTab 入口 + `main_pages.json` | 单列列表、底部弹层添加（失败保留草稿）、44vp 行命中、暂停/恢复/删除、策略开关 |

## 合同变化

- `AgentClaim.projectId` 变为可空并新增 `scopeType`：所有项目侧查询已显式过滤（测试含负例）；旧 `owner+scopeKey+originKey` 唯一性保留，ACCOUNT 行 scopeKey 固定 `ACCOUNT`。
- `AgentClaimEvent` 结构未变；个人事件 `controlSeq` 保持为空，不进入原项目 ClaimCorrection 解释链。
- Turn readManifest / Step protocolJson 新增可选 `personalMemoryReadSet`；`assertTurnCurrent` 对携带该读集的轮次做同步检查。旧轮次无此字段 → 检查直通（兼容）。
- 项目成员级例外默认 `INHERIT`；不改任何既有授权语义。

## 首切片未包含（合同已预留）

- 对话内联自动捕获（本轮提供表单 + 原话判断两种入口，同一准入服务；会话中自动拦截属 PM-2 的提取路径）。
- 候选理解与晋升（`candidateInferenceEnabled` 默认关闭；CANDIDATE 状态、晋升冻结合同见审计 4.2/5 节）。
- 项目派生个人条目（来源根走 SourcePolicy 的消费检查已在读集设计中预留，实现属 PM-2）。
- 使用记录的独立索引（本轮从 Turn/Step protocolJson 有界扫描可核对轨迹；文档 8.5 节允许先留最小轨迹）。

## 验证记录（本 worktree，2026-11-01）

- `npx tsc --noEmit` 通过；`npm run lint` 0 error（2 条历史 warning + 本切片无 warning）。
- `npx vitest run tests/pm1PersonalMemoryScope.test.ts tests/pm1PersonalAdmission.test.ts tests/pm1PersonalConsumption.test.ts`：24/24 通过。覆盖：空库迁移重放（含新迁移 + CHECK 负例）、旧库副本升级回填、范围隔离负例（项目查询/跨 owner/同 scopeKey）、requestId 幂等与换载荷 409、状态机（暂停/恢复/撤回/删除/清空 + 正文清除 + 重放不复活 + extractionNotBefore）、策略 CAS、读集守卫（策略/条目/项目例外/边界）、准入矩阵 12 例、J29 处理许可、Mission/Conversation 上下文注入与排除、在途失效（预算不重置、INVALIDATED、assertTurnCurrent 拒绝旧 generation、旧轮次不追溯）、完整旅程（脚本模型明确标注：个人偏好进上下文 → 原批准 → Action → 原完成服务 resultCardId）。
- 全量 `npm test`、`npm run build`、`harmony:test`、`harmony:build`：见证据目录 validation 记录（退出码逐项保存）。
- 设备与真实模型验收：未执行（本轮无真机连接与真实凭据授权）；旅程与并发均使用隔离库与脚本 provider，不能据此宣称真实模型收益。

## 边界与风险

- 主题匹配为子串级（中英文标签），PM-3 的语义召回会替换该排序；不会造成越权（匹配只影响选择，不影响资格）。
- 删除后的再提取防护：单条删除清除正文 + 事件引文；清空全部推进 `extractionNotBefore`；候选归纳关闭使旧聊天不会进入任何提取管道。导出/向量/夜间整理不在首批，未引入新绕路。
- 未动生产、未迁移真实库、未开启任何后台任务；`AGENTS.md` 未修改。

## PM-2 增补（同日，同工作树）：候选理解、使用控制与完整管理

- **候选生成**：`memorySynthesis` 合同新增可选 `memoryCandidates`（在原推理输出内产生，不新增模型调用）；`publishMissionDigest`/`publishConversationDigest` 在同一事务内调用 `recordSynthesisCandidates`——账户开关 `candidateInferenceEnabled`（默认关闭）决定是否落库；准入规则二次过滤（凭据/引文拒绝）；`statement+rootIds` 归一化为 originKey，同根同表述（任意状态）不重复提议（拒绝后冷却）。
- **确认合同**：`CONFIRM_CANDIDATE` 冻结 `expectedRevision + frozenContentHash(=personalEntryContentHash) + 来源根复验（sourceUse）+ useScope`；支持编辑后确认（confirmedStatement 经准入再核对）；`REJECT_CANDIDATE` 置 REJECTED。两端竞争由 revision CAS 裁决（J08）。候选状态永远不进决策上下文（读集与 facet 均排除）。
- **useScope**：确认时可选 `ALL` 或 `PROJECTS[...]`；`resolvePersonalContext` 对范围外用途按 PROJECT_ONLY 遗漏（J14：新项目不继承）。
- **使用记录**：Turn `personalMemoryReadSet` / Step `protocolJson` 是权威轨迹；`readPersonalMemoryUses` 有界扫描返回最小指针（kind/id/at/INJECTED），条目详情展示。
- **导出**：`GET /api/me/memory/export` 区分 USER_STATED/CANDIDATE/状态标记；已删除只剩无正文状态行；文件不可作导入恢复入口。
- **双端**：Web 候选区（确认/修改后记住/仅本项目/拒绝）+ 导出入口 + 详情使用计数；鸿蒙候选区（按范围记住/仅本项目 Select/拒绝）。同一服务端合同与错误语义。
- **测试**：`tests/pm2PersonalCandidates.test.ts` 4/4（J05 条件候选不激活+开关关闭零候选+敏感拒绝；J08 竞争只激活一次+冻结核对+同根去重；J23 拒绝冷却；J14 仅本项目范围外不继承+跨账号隔离；J16/17 删除正文不回流+owner 绑定）。回归：ux2MigrationUpgrade 适配迁移集合边界（pm1_ 增量），CT4 PDF 用例需 texlive Poppler 路径（环境记录，见 evidence validation.json）。
