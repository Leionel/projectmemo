# UX-3 R2：持续责任、发现、唤醒与可信活动

## 1. Responsibility Model

责任是原 Mission 的统一合同，不创建平行任务身份。只读 ResponsibilityView 聚合：

```text
missionId, owner/project, goal, successCriteria, currentWorkingObjective
scope/resources/revisions, deadline/expiry, cumulativeBudget/used/unknownReserved
allowedTools/effects, researchScope, triggers, stopConditions
approvalBoundaries, currentWorkState, pendingOriginalRefs, latestReceiptRefs
lastObservedAt, lastAttemptAt, nextCheckAt, nextBoundary, workerPresence
versionToken(mission/context/plan/constraints/scope/policy/intent/reuse versions)
```

“责任”不新增事实／授权。正式目标、成功标准、当前重点和用户原话分开；模型不能因推测有价值就改目标或验收标准。工具、来源和总包来自原许可，批准的效果仍走原批准服务。

### 1.1 一次可读核对、原子修订

把当前多个编辑入口组织成一份可读预览：办什么、到何时、可读哪些来源、总费用／请求范围、何时找用户、不能做什么。确认绑定合成版本、差异和 requestId，在原 Mission 事务更新必要字段并写原事件，不逐个 PATCH 留半份许可。

工作方向仍经 Directive Admission；新工具／scope／预算扩展不由自然语言模型分类自动生效。已批准范围中的合法读取不重复询问。撤销后到来的旧 wake、审批和模型结果必须按当前合同拒绝新发布。

合成版本是现有版本的规范 hash，不新增一条可独立授权的版本钟：Mission version/contextVersion/planRevision/constraintsVersion/researchScopeVersion、continuation policy hash、相关 intent/reuse hash 与来源授权版本。价格说明或页面排序不进入业务授权 hash，真正作用域／费用边界必须进入。

同 requestId、同 payloadHash 先回原命令回执；不同 payload 拒绝。尚未提交的修订必须在原事务重读全部相关版本、权限与时间边界，一次更新合同、失效原待批方案并写事件；不能先扩工具、再等预算 PATCH。旧客户端仍可用原入口，但不能绕开跨字段不变量。返回同一原 Mission 与合成版本，Web 和鸿蒙各自渲染同一份差异。

预览必须说清 deadline 与 expiresAt：前者是目标时间条件，后者是持续许可的硬到期；目标截止是否同时停止调查由明确的停止合同决定，不能由模型或客户端猜。有效视图在最近相关边界重算，不靠新事件触发。展示内容 hash 排除 heartbeat、generatedAt、单纯 lastAttemptAt，避免每次扫描造成假变化；控制命令仍核对原真实版本，不能为了页面稳定跳过 CAS。

### 1.2 长期总包

总量是该责任的累计值，重启、跨天、replan、子步骤和预算复核不清零。模型／工具／HTTP、已知 usage、未知预占和已批准固定核算分别记录。

当前 pilot 的 24/64/96 上限不作为长期产品能力上限。UX-3 在原 BudgetReview、AccountCloudUsage 和 policy 中版本化支持更长的有限总包，可加日突发上限；不能以每日刷新总账或无限续费实现长期性。具体配置和价格上界先测算再冻结，任何上调均由原明确授权承接。

## 2. Proactive Discovery：三种不同情况

| 情况 | 可以自主做什么 | 不能推导出的许可 |
|---|---|---|
| 已授权具体委托 | 围绕目标检查新观察、读合法来源、形成／验证相关假设、调整调查或结束 | 不自动增加目标、费用、来源或写入范围 |
| 获准只读主动研究 | 一次核对主题、来源、期限、总包后，发现问题并继续研究／建议 | 公开范围授权不等于自动业务写入；不是每次搜索都重新审批 |
| 没有有效执行许可的新线索 | 原确定性影响标记、记录可审计候选、在合适入口提出建议 | 不能因为“可能有用”自动启动新的付费背景循环 |

只读 research watch 推荐仍是一份原 READ_ANALYZE Mission＋有界 policy，以 purpose metadata 区分宽主题观察和具体交付；不创建另一个 Watch Runner。现有用户请求中的合法动态研究可立即推进；新增背景责任只核对一次具体边界。

新观察 → UX-2 Memory Evolution/GoalGap/Hypothesis 的相关性和信息缺口 → 原责任内的调查资格 → 动态工具选择。低价值／重复线索不触发模型；证据充足可直接结束；需要私有材料、真实操作或新授权时才找用户。

假设状态、关注偏好、外部网页建议都不是执行许可。公开检索只用原获准 publicTerms/hosts，不把私有项目摘要自动发作查询词。

## 3. Wake-up & Continuation

### 3.1 唤醒合同

复用原 MissionEvent、planJson 的版本化 wake metadata、nextAttemptAt 和原 worker：

```text
wakeKey = owner/mission + reason + source/claim fingerprint + boundarySegment
reason = SOURCE_CHANGED | OBSERVATION_DUE | INTENT_CHANGED | CLAIM_RECHECK
         DEADLINE_BOUNDARY | QUIET_END | BUDGET_DAY_BOUNDARY | RECOVERY
originRef/version, queuedAt, consumedAt, outcome, continuationBinding
```

事件只使原 Mission 获得运行资格。领取／派发／返回／发布都重验当前 owner、scope、来源 revision、intent/reuse hash、期限、STOP、预算和 lease。相同 wakeKey 合并；多个来源指向同一问题不创建多个 Mission。

origin/version 与有效责任版本参与去重；同内容在新授权代际出现不能误消费旧事件。静默和日期边界使用有效时间段，反复扫描同一边界不生成新通知。恢复旧许可不复活旧批准。

**防止丢唤醒和并发覆盖：**

- 原 MissionEvent 保留来源事件身份／水位，planJson 只存有界 pending/applied 水位与版本，不无限塞入历史队列。扫描发现有变化不等于已经完成接续。
- 在原领取／协调事务中绑定本次消费的水位、context/plan 版本及 lease epoch；只有该绑定成功才推进 applied 水位。事务回滚仍可重扫，不能先标 consumed 再尝试改 Mission。
- RUNNING 时收到新变化，追加事件并走原在途协调；旧执行在返回／发布时重验。释放租约采用 CAS，不得用早读的 planJson 清掉较新的 pending 水位；新变化始终保留后续接续资格。
- PAUSED/STOP 不被事件自动恢复；WAITING_APPROVAL 保留真实批准，WAITING_USER 保留未答 qid。合法独立读取可继续时按原 Runner 能力执行，不能只为后台任务把等待状态改成 READY。
- 在“检查水位—领取”“工具返回—提交”“静默结束—用户撤回”窗口注入竞争。每个有效观察最终对应 APPLIED、NO_CHANGE、HELD 或待恢复事实；不能静默遗失，也不要求网络请求 exactly-once。

### 3.2 语义与动作

| 情况 | 持久处理 | 对用户／费用的表达 |
|---|---|---|
| 有意义的新原观察 | 原事件、水位、context/plan 版本，原过期提案失效；同 Mission 接续 | 说明改变了哪项判断及当前下一步 |
| 已知无变化 | 更新核对时间与下一检查；稳定 fingerprint | 无新模型、无新提醒；必要 HTTP 成本照记 |
| 已知观察失败 | 保留最后已知状态，限次 backoff 和错误事件 | “本次未核对成功”；不能写“没有变化” |
| 来源撤权／修订／无权 | 原 guard 暂停相关派发，认知依赖失效 | 说明需重核的来源及合法恢复条件 |
| 等待真实用户问题 | 保留未解决 qid／责任方，其他合法调查可按许可继续 | 不让后台无变化事件把问题标成已解决 |
| UNKNOWN | 原 operationId／步骤／预占保留；只查原状态或人工结算 | 不能换 UUID、planRevision 或任务重派隐藏未知 |
| 到期／STOP | 停止新派发；已发请求按原结算；旧 wake 不复活 | 显示已做结果和停止原因；不自动加预算 |
| Worker／网络恢复 | 领取原任务，验证已成功步骤可复用；重新核对当前上下文 | 显示恢复的原步骤，不重复外部效果 |

同一内容换版可便宜核对和重绑定，不能跳过新版本／权限校验。时钟跨过边界没有新事件也要协调；条件相同的再次扫描不能制造新变化。

UNKNOWN 的查询、迟到结算和发布分别处理：费用／预占只按原 operationId 结算一次，旧 generation 的返回只能进入原结算或历史记录，不发布当前判断。不可查询的请求按原固定核算／人工结算合同处理；结算前不换任务或请求键重发。合法后续新观察仍须满足当前预算和许可，不能借“新一轮”隐藏旧未知成本。

### 3.3 调度公平和失败隔离

修原 worker 的短路优先级：在已有循环中轮换／保留两种工作领取机会，设置有界 quantum 和 user/project 公平性，不创建新执行器。保证持续 Conversation backlog 下，健康 worker 仍能处理 READY Mission。

扫描、领取、真实执行、模型等待分别计时；不能承诺固定 15 秒完成调查。延迟上界由扫描周期、当前有界 slice、重试和环境实测决定。两个 worker 的原数据库 lease／预算 guard 继续承担互斥。

单个非法来源／坏任务要记录失败并退避，不阻塞其他合法任务；数据库整体故障则显示不可观测，不能伪造独立任务成功。恢复测试覆盖在事务前后、已发 HTTP 后、已存步骤后、发布前退出。

### 3.4 从固定 SHA 到获准分支发现

保留当前固定提交 CI 观察。新“跟踪分支新提交”必须显式写入责任范围，把原仓库 refresh 读取包装进原 MissionStep/HTTP operation 账本，绑定连接 revision、仓库/ref、分页与 ETag、总 metadata 预算及 UNKNOWN。

新 head 只是原观察／候选，不自动采纳为项目事实，不完成 Action。不能绕过 F07 或把手工刷新函数直接放后台无限调用。CT-7 部署观察另增 adapter，不用 CI 代替。

原 SourceConnection.revision 也用于每次刷新提交的 CAS，不能直接当纯授权版本。责任中分别绑定授权身份／scope 和观察水位；普通 304 可以推进核对时间，不制造授权撤销或有意义变化。当前撤销连接不支持原地重开；同 SHA 换连接及未来重授的负例见 UX-2 F07 合同。

## 4. Activity & Trust

ActivityView 从原 AgentRun、MissionStep/Event、观察 manifest、WorkState、Readback 和回执投影，不用模型编一份“我今天做了什么”代替审计。

默认展示：最近完成的有用工作、当前等待原因、最后核对／下一检查、已用总包／未知预占、下一需要用户的原问题／批准。展开才看 provider、失败、版本、原步骤和恢复记录。

花费先以原账本可证明的模型请求／token、工具、HTTP 和未知预占表达；显示货币时须绑定 provider、核算价格版本和估算／已结算标记。缺 usage 不当 0，不把请求上限直接换算成实际账单。

“已排队”“已领取”“请求已发出”“结果已保存”“用户已报告完成”“现实结果已核验”分别来自原事实。运行中状态需有效 lease；无新的 worker 事实就显示最后观察时间。

### 4.1 Worker presence 的必要小增量

先检查部署是否已有可信 worker heartbeat；当前仓库没有足以代表运行健康的用户合同。推荐一个最小、无任务调度语义的 WorkerPresence 记录／现有等价健康存储：workerId、能力、版本、lastScan/lastClaim/heartbeatAt、lease expiry。它只回答最近是否观察到 worker，不存用户正文、不派发任务。

不把每次心跳写成模型 AgentRun 或“完成工作”。状态为 NEVER_OBSERVED/RECENT/STALE，仍不保证某个任务一定进展。若可复用已有部署监控等价数据，避免重复表；实施探针以真实进程退出和恢复验证。

## 5. Attention Intelligence

注意力判断先做确定性资格过滤：来源有效、事项未解决、当前用户能行动、未 STOP、未被同语义处理。再结合目标后果、时间机会、变化幅度、证据适用性、重复成本和用户偏好排序。抓取时间、条目顺序或模型高置信度不产生通知价值。

模型可在已授权调查内说明变化为什么重要；不为每次静默扫描额外跑“通知文案模型”。普通事项进入原私人收件箱／合并摘要；关键事项在原 USER 总预算和明示静默政策内处理。用户主动打开始终能看到当前有效问题。

去重身份是 owner＋原责任／主题＋有效待决对象／来源 fingerprint。Anchor、GoalQuestion、Focus 和私人 Mission 共用映射，不能重复扣打断预算。STOP 不因 source revision 或日期变化解除。

### 5.1 不可合并的事实

AVAILABLE 是应用内可见；PLATFORM_ACCEPTED 是平台接受投递；OPENED/SEEN 是打开／已看到；APPROVED 是原提案批准；EXECUTED/EFFECT_COMMITTED 是实际效果与回执。不得相互推导，也不能用“全部已读”消费审批。

私人 Mission 当前 systemPush=false。现有共享 Intervention 本地通知、Action 提醒和私人后台投递是不同渠道；未来连接系统通知也必须有真实平台回执和账号／设备绑定。

### 5.2 漏报检测

同时测试噪声和 false silence。未解决的关键问题、临近真实截止、因不可观测而错过观察需要被发现；安静时段不等于从收件箱隐藏。静默结束、用户时区／本地预算日边界和授权截止都重新判断，不要求新资料才恢复资格。

预算耗尽时保留排队和原因，不重置账本制造送达；关键事项不能通过全静音获得“低打扰”高分。

## 6. Cross-device Continuity 与有界自主

Web 深入读、比较、核对责任和授权；鸿蒙快答、补结果、暂停／恢复；两端用同一 ID、版本、来源和回执。卡片只带最小导航和核对时间，登录后重新解析；小艺沿现有 inspect/resume 条件，不能发批准令牌。

退出清本地私人内容；有效持久委托按原期限／撤销继续，不以手机常驻为前提。离线页面可读最后已知状态，旧操作恢复后重验，不自动提交。真实后台服务是否已部署、卡片／系统通知是否可达必须分别签收。

外部写未来仍按 CT-10 的具体目标／payload／幂等／效果查询批准；来源授权、研究许可、FOLLOW、假设支持和已读均不等于写入授权。
