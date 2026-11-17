# V2 实施前裁决（2026-11-16）

- 用户假设：开发者、自由职业者优先验证，科研/学生项目为重要对照；依据持续改稿、回访、成果采纳和成本比较，不预设最优首发。
- 基线：00e250bb7c11da24807b74b6239ff7aa3b46b07c。原工作树1364项待提交：1项鸿蒙构建配置、1363项未跟踪资料，保留原处；只复制V2规划和本地依赖到独立工作树。
- 独立分支：codex/v2-first-loop。Codex /root（codex/v2-first-loop）是唯一Schema/Migration负责人；所有新增迁移由此分支生成和验证。
- 范围：PR-00裁决与冻结样例；PR-01a显式v2协议/观察等待兼容；PR-01b研究→创作→checkpoint→新材料唤醒→同委托改稿；交互PoC复用AgentPresentation，游戏仅作成果入口实验。
- 状态决定：v1 choiceSchema与finish保持原义；v2必须显式登记且已有有界许可。WAITING_INPUT中的OBSERVATION不能被当作QUESTION或发催答通知。保留单槽、预算、租约、source/read-set与控制代次。
- 已检索：WAITING_INPUT 96文件/266行，SUCCEEDED 134文件/341行，finish/协议24文件，自动接续与Worker14文件；完整清单在evidence/v2-first-loop/。这些是检索覆盖，兼容性结论须由后续回归支持。
- 四Skill：固定规划/研究/创作/复盘ID；先实现研究→创作的服务端持久接力，使用原ToolSet，不新增Agent引擎。
- 工期重估：原PR-01的4–6人日低估调用方审查；协议2–3、纵向集成4–5、回归联调1–2，合计7–10人日；可点击交互PoC另在原PoC-B预算中。按切片交付，不等待完整事件平台。
- 已验证：64条冻结案例及评分器存在，--self-check通过；这只验证数据和评分器，不是router准确率。新实现、迁移、实模、真机结果按切片追加。
- 交互采用：使用现有AgentMessageBlocks和领域API，先实现真实可点的成果/版本/证据/过程/改道；第三方聊天库不作为首片前置。

## PR-01a 协议切片回执

- 改动：新增显式runtimeProtocolVersion列（默认1），v2 Choice单独扩展await_event；checkpoint只接受当前有界许可内的订阅和经原verifier核对的Output；释放原槽，不写finishedAt。v2持续委托的finish不能自行结束责任。
- 调用方：屏蔽观察等待的催答邮件、历史问题回退、材料补答与GoalQuestion；沿原WorkState区分观察/用户等待；鸿蒙原生分组按WorkState投影。Worker对v2用户问题不因材料变化自动解答；v1保持原自动接续语义。
- 迁移：20261116093000_mission_runtime_protocol_v2，仅新增默认1列。隔离临时库空库重放、旧表增量测试通过；未触碰开发或生产库。
- 验证：protocol-tests 4文件55条；compatibility-tests 5文件38条；model-protocol-tests 3文件13条；tsc --noEmit通过。全部注入/模拟HTTP，无真实模型或外部发送。
- 环境：复用原本地依赖（Next16.2.11/Prisma7.8.0/Vitest4.1.10），与package.json声明版本存在既有差异；没有升级原node_modules。生成客户端仅写独立工作树。
- 待验：真实模型质量、72小时真实时钟、真机/HAP、锁定声明依赖后的干净构建。研究→创作接力与可点击原型进入下一切片。

## PR-01b 纵向集成回执

- 已实现：四个内置Skill注册、只读方法加载与指纹，持久化接力游标；真实项目原文经原ToolSet读取后交给创作，私有Output经原verifier核对后进入checkpoint。新资料由现有扫描器唤醒同一Mission，保留历史稿、预算、租约与控制代次。四类合成项目（开发/客户交付/科研/课程）复用同一条链路。
- 修复：有界委托release覆盖事务内新plan的问题；v2完成上下文不再建议finish；观察等待不复活历史问题、GoalQuestion、锚点催答或证据前提，工作区计数扣除观察等待。旧协议finish及旧自动接续不变。
- 自然改道：只对当前、明确、Mission级的V2字面指引接续，旧绑定必须仍有效。先使旧步骤/提案失效，再绑定新限制；有限工作目标触发重新研究与改稿。许可、预算、送云授权不扩张；暂停、停止、过期、模糊输入不自动恢复。
- 新只读接口：GET /api/missions/:id/workbench，原身份/Owner校验，最近5稿和24事件；按每稿来源指纹定位，当前来源使用许可改变时隐藏相关全文与推断，不推进业务状态。
- 验证：final-regression.log记录19文件/174条全部通过，含注入模型、真实隔离SQLite、旧协议、Worker、通知、并发晚到、来源抑制、Web/ArkTS契约及锚点。tsc和新增模块/控制服务scoped eslint通过。无付费模型或真实外部写入。
- 迁移：本片无新增迁移；仍仅PR-01a默认1的协议版本列。没有修改原开发库/生产库。唯一Schema/Migration负责人仍为本轮执行者。
- 构建：Next webpack生产构建通过，四份SKILL.md均在文件追踪清单。原browser/reader.ts存在createRequire静态解析警告，未验证生产浏览器工具路径。独立工作树现用依赖副本，版本仍与声明有既有差异。
- 64条案例：冻结数据/评分器自检通过；当前首片是Mission内的四方法调度与R→D接力，不等于64条跨对话Router实测通过。
- 发布门槛：这里证明新服务对旧协议请求/记录的兼容，不证明旧Worker二进制能处理v2行。上线必须先保持V2关闭，完成迁移并升级全部API/Worker后再开启；混跑旧Worker的同库环境不能创建v2委托。当前独立演示全部为同一代码版本，生产滚动升级尚未验收。

## 交互PoC回执

- 可点击页面：/v2/workbench，默认关闭，使用MISSION_WORKBENCH_ENABLED；真实委托由missionId定位，不会在读取失败时偷偷回落到样例。渲染复用AgentMessageBlocks/AgentPresentation，提供版本、差异、来源、事件与原Conversation输入链。
- 浏览器已验：版本与证据切换、科研对照、三个成果相关玩法、离页后新资料生成第3版、自然改道生成第4版并回到await_event；模拟回包丢失后原请求重试不重复产稿；360px无横向溢出。browser/receipt.json与截图为注入模型合成数据证据。
- 本地演示：npm.cmd exec tsx -- scripts/v2-local-demo.ts。仅127.0.0.1，自动建立新临时库，控制台入口4416、工作台4415；注入provider仅由独立CLI传入，产品API没有选择测试provider的开关。停止进程即停止演示，临时库保留以便核对。
- 复验：npm.cmd exec tsx -- scripts/verify-v2-workbench.ts（先启动全新的演示）。验证脚本会新增合成资料、输入限制与有限目标，不操作个人项目。游戏目前是导师追问/引用辨认/手动分工入口，不含多人同步或游戏引擎。
## 切片 B 回执：真实路由与 64 条评测执行器

- 路由不再由 goal 关键词简单追加创作：先区分 ANSWER/CONTROL/CLARIFY/DENY 与 RUN，再按用户本次分句选择规划/研究/创作/复盘的有序序列；负向限制（不联网、不改稿、不研究、只做计划、只复盘、注意偏好、来源停用、外发需批准）先于方法执行提取。路由只收窄原权限（toolAuthority=UNCHANGED），不返回工具集、不新增来源/送云/业务写。
- 持久化：SkillCursor 记录方法序列、阶段、方法版本摘要、证据包与确定性未知项；创作前必须有证据包；新资料唤醒后先重读受影响来源再改稿；“只做计划/只复盘”时 `save_mission_output` 被拒。证据状态按本 Mission 实际读过的内容计算，不按项目里存在材料推断。
- 评测执行器：`scripts/eval-routes.ts` 把冻结 fixture 物化为隔离库真实 Project/Capture/Mission/Step/Output/Connection/Artifact，运行真实 Router、Runner、暂停/指令/注意力服务；工具 trace 来自真实 AgentMissionStep，checks 来自确定性断言与持久结果；不读取冻结 expected。命令：`npm.cmd exec tsx -- scripts/eval-routes.ts --out evidence/v2-first-loop/slice-b-routing`。
- 结果：64/64 模式/主能力/序列一致，安全违规 0，关键失败 0（16 条安全反例全过）；54 案例真实派发 126 次，外部读/外部写/业务写 0。完整通过 39/64；25 条失败均为内容语义判据在注入模型下 `CHECK_NOT_PROVEN`，按要求判失败，未改 oracle、未采用模型自评。
- 验证：4 文件 25 条测试通过；tsc 与 scoped eslint 通过；无新迁移、无真实模型、无付费调用。证据在 `evidence/v2-first-loop/slice-b-routing/`。
- 待验：25 条内容语义判据需真实模型/人工审核；真实模型路由与质量评测待授权；HarmonyOS 未构建；V2 保持关闭。

## 切片 A 回执：四类合成项目的持续改稿评测

- 新增 `scripts/eval-v2.ts`（`npm.cmd run eval:v2`）与 `lib/evaluation/journey*.ts`：开发发布/客户交付/科研汇报/学生课程四条旅程，均走真实 modelAdapter、Mission Runner、既有 Worker 扫描器、工具守卫与成果验收器；流程为初稿→新增材料唤醒→后台续稿→限制联网→有限目标改道→再次交付→暂停/取消。
- 记录 Mission/Output 版本、来源指纹、Skill 接力、provider/model、真实工具调用、token 用量、失败原因与预算变化；协议正确性（40 项）与内容质量（24 项）分开报告。
- provider：`fixture` 进程内注入已跑通 40/40+24/24；`http` 为 127.0.0.1 OpenAI-compatible mock，经真实 chooseNext HTTP/JSON 适配器跑通 40/40+24/24（64 次调用、5760 token，本地无付费）。`live` 命令已实现但未执行：缺 `--confirm-paid` 或密钥时退出 2，不发请求；待用户明确授权范围与上限后执行 `--provider=live --confirm-paid --max-models=12 --max-tokens=60000`。
- 验证：5 文件 27 条测试、tsc、scoped eslint 通过；无新迁移。证据在 `evidence/v2-first-loop/eval-v2/`。
- 未验：真实模型连续改稿质量与真实成本；72 小时时钟/断电/真机/HAP/生产滚动升级；内容语义判据的独立人工审核。

## 切片 C 回执：闭环接入正常产品入口

- 正常入口：项目页新增 `V2DelegationStarter`（仅 V2/持续许可/工作台三开关均开时渲染）。导入文本材料 → 只读预览有界范围（本项目资料、私有稿更新、有效期、模型/工具上限；明确排除联网、公开研究、业务写入、自动外发）→ 一次确认 → 跳转既有成果工作台。
- 原子确认：`POST /api/projects/[id]/v2-delegation/confirm` 在同一事务创建材料 Capture、v2 Mission、BOUNDED_INVESTIGATION 许可与 `V2_DELEGATION_CONFIRMED` 回执；`requestId` 幂等；预览不写业务状态。`editContinuationPolicy` 支持传入原事务；确认接口不接受任何 provider 参数，测试模型只通过部署环境变量接入。
- 工作台：沿用版本/差异/原始依据/过程事件；新增暂停与结束跟进，控制绑定当前持久 version（非轮询快照），暂停后不再派发且已交付版本保留。
- 浏览器验收（本机 127.0.0.1 回环模型，全新临时库）：导入材料→预览→确认→第 1 版→新材料唤醒同一 Mission→第 2 版→自然改道→第 3 版回到 await_event→暂停生效→360px 无横向溢出，六项检查全过。证据 `evidence/v2-first-loop/slice-c-entry/`。
- 验证：22 文件 185 条定向回归（上轮 19 文件 174 条 + 新增 3 文件 11 条）、tsc、scoped eslint、Next webpack 构建均通过；无新迁移、无真实模型付费调用。
- 未验：真实模型完整托付质量、HarmonyOS/HAP、生产滚动升级与旧 Worker 混跑；V2 仍保持关闭。隔离演示 CLI 未改动。

## 真实模型评测回执（用户授权后执行）

- 授权：4 条合成旅程，每条 ≤12 次调用/≤60k tokens，合计 ≤48 次/≤240k tokens；模型 DeepSeek `deepseek-flash`，密钥仅经 `node --env-file` 从原工作树载入，未复制入证据。
- 实际：31 次决策调用（未超）；预算账 327,567 tokens（输入 319,760/输出 11,807），**超出 token 上限 87,567**；余额 CNY 37.85→37.63（约 ¥0.22）。超限原因是评测派发前 token 守卫因 CRLF 补丁未匹配而未挂载，只有事后记录；发现后立即停止所有付费调用。
- 结果：协议/持久化 34/40，内容 16/24。四条旅程均完成初稿→新材料→限制→改道/暂停的持久化；工具边界全私有。真实失败：developer 在续稿时越过证据门槛后停住；freelancer/course 改道后模型复用上一版 Output 被 `SKILL_OUTPUT_REQUIRED` 拒绝，未产出新版本；research 三版齐全但离线判据用字面“工作重点”误判改道。首稿过度依赖 inspect_project 概况而不是导入原文。
- 修复（离线验证，未再付费）：runner 增加派发前预算钩子（守卫已有回归）；`completionReadback` 只对当前周期成果 canCheckpoint，新周期返回 `CURRENT_VERSION_REQUIRED`；门槛拒绝后一次受控重试并注入 `skillRepair` 提示；SKILL.md 要求导入材料必须 `read_project_material` 读原文、上下文变化后先保存新版本再 await；改道判据改为关键词命中。离线 fixture/http 仍 40/40+24/24；22 文件 188 条回归、tsc、lint 通过。
- 待办：以上修复需真实模型小范围复验；已向用户提出新授权建议（developer+freelancer，≤8 次/条、合计 ≤16 次/≤40k tokens），未获新授权前不发起付费调用。完整回执见 `evidence/v2-first-loop/eval-v2/live/`。

## 真实模型修复复验回执（用户指示继续、不怕上限）

- 用户明确授权继续复验后，按真实失败逐项修复并重新执行，共 4 轮真实模型评测（DeepSeek `deepseek-flash`）：live 31 次/327,567 tokens（守卫缺陷，已如实记录）、live2 40 次/481,010、live3 35 次/401,699、live4 **38 次/440,918**。累计 144 次调用、1,651,194 tokens，余额 CNY 37.85→36.57（约 ¥1.28），全部为合成项目。
- 真实失败驱动并已验证的修复：① `settleUsage` 结算时释放每次调用的 `reservedOutputTokens`，修复长期连续 Mission 被累计预留误判 `BUDGET_EXHAUSTED`；② v2 单次决策输出上限 2000→3000（截断修复仍 4000），`modelAdapter` 直接使用上下文上限；③ v2 允许第二次协议修复；④ 方法门槛拒绝后一次受控引导重试（`skillRepair` 带 `requiredTool=read_project_material` 与可用的 sourceId/sourceHash）；⑤ 内容与来源完全相同的连续私有稿去重为 `OUTPUT_UNCHANGED`；⑥ deliverable-creation SKILL 要求改道/受限后的新版本首段写出当前工作重点原话。
- 最终结果：四条旅程协议 **40/40**、内容 **24/24**，真实模型 v3/v4 正文首段均写明本轮工作重点，未知条件与未验证项保留，工具边界全私有。developer/freelancer 3 版，research/course 4 版（中途保存经去重或为多稿版本），改道后同一 Mission 均产出新版本，暂停/取消后零派发。
- 验证：离线 fixture/http 仍 40/40+24/24；全量测试、tsc、lint 结果见 `evidence/v2-first-loop/eval-v2/live4/`。证据：`eval-v2/live4/`（README、checks、report、journeys、测试日志）。
- 边界：单次通过不等同于所有场景稳定（模型仍有随机性）；预算展示口径变化但实际模型/工具总量限制未放宽；72h 时钟/断电、真机/HAP、生产滚动升级仍未验证，V2 保持关闭。

## 2026-11-17 三位一体回执（修复 + 非创作交付 + 质量评分）

- `c1b185b` 修复 confirmV2Delegation 幂等绑定：确认事务先按 `ownerUserId+createRequestId` 查原 Mission，再从 `planJson.v2DelegationReceipt` 校验项目/目标/材料/预览/期限并返回原回执；一致重试优先于期限与预览校验（过期后仍返回原回执），同编号换任何一项均 `409 DELEGATION_IDEMPOTENCY_CONFLICT`；并发确认经唯一键/写冲突重试收敛为一个 Mission；Capture/Mission/许可/事件/回执仍单事务。6 条回归 + 原入口 4 条通过。
- `d403734` 补齐非创作 Skill 交付：终态规划/研究/复盘把 `save_mission_output` 解释为阶段成果，写入 `planJson.skillArtifacts`，不写报告 Output、不创建行动；必须经原输出/来源校验（至少一段真实来源，引用可解析）。交付后 `PAUSED + SKILL_DELIVERABLE_READY`，工作台显示阶段成果/依据/未知项；恢复进入 `WAITING_INPUT+OBSERVATION`，不重复跑同一阶段。路由修正否定动作（“不开始写报告”）与研究动词。单测 4/4、正常入口浏览器 4 项、全量 268 文件 2099 条、构建通过。
- 质量评分：新增 `lib/evaluation/contentQuality.ts`；替换宽松的“出现工作重点即算落实改道”，加入差异率/新增来源/来源与引用相关性/旧依据保留/复制用户要求/关键未知等确定性判据；语义四项固定 `UNVERIFIED/HUMAN_REVIEW` 并单独报告。负例 7/7（复制要求、标题伪装、无关引用、改几个字、遗漏未知全部失败）。冻结 64 条指纹 `1b7145…` 由测试锁定，未修改 oracle。
- 离线评测：fixture/http 均协议 40/40、结构内容 24/24、语义未验证 16；路由 64/64、安全 0、关键 0。无新增迁移；无真实模型付费调用；V2 仍关闭。

## 2026-11-17 持续运行可靠性（第二轮）

- 相同内容重传不再唤醒：`investigationInputHash` 增加忽略来源 id 的集合化内容指纹；结构哈希变化但内容指纹相同只记一次 `INVESTIGATION_DUPLICATE_IGNORED` 并顺延检查，不派发模型、不改预算。检查点同时持久化 `inputHash/contentHash`。
- Worker 崩溃恢复：真实子进程在读取后、产稿提交前、检查点提交后退出，新进程沿用同一 Mission/租约/证据包续跑；产稿前崩溃留下 RUNNING 步骤，租约过期后重跑且只提交一个 revision。两进程竞争 READY 恰好一个认领。
- 控制竞态：新材料与暂停/取消/改道/撤权/许可到期并发时，停止后不派发；改道绑定新工作重点；许可到期与撤权在派发前 hold 且保留草稿。
- 摘要优先级：项目摘要用 SQLite JSON 谓词先取用户需判断的行（兼容 `waitStateJson` 为 NULL 的历史行），观察等待不再挤掉用户问题。
- 混合升级防护：`claimMission`/过期 RUNNING 清理按允许协议版本过滤，关闭 V2 时 v2 行完全不被认领或改写；Worker 版本号升级为 `r4-ux3-worker-v2`，启动时检查迁移列和“关闭开关但存在 v2 行”；新增只读 `scripts/v2-rollout-check.ts`（四种状态证据：V1_ONLY_SAFE / V2_ROWS_DISABLED / MIXED_WORKER / V2_READY）。
- 长时运行：新增 `scripts/v2-long-run.ts`（start/status/material/stop/report，独立 SQLite、真实 Runner 循环），本轮冒烟 10 周期、3 版、预算单调、预留归零；明确不是 72h 证明。
- 验证：全量 272 文件/2124 条、故障注入 8/8、控制竞态 7/7、运行可靠性 5/5、去重回归 5/5、tsc/lint/Web 构建通过、Harmony 合约 155/155（本地补齐 oh_modules，未改 ArkTS）；无新增迁移、无付费调用、未改真实数据库。V2 仍默认关闭。

## 2026-11-17 复查修复

- 统一 Worker 心跳版本，启用 V2 前核对 Worker 活性及完整环境身份；关闭 V2 的新 Worker 仍处理 V1，冻结 V2。
- 阶段成果复用报告的来源校验；来源停用时同步隐藏检查与未知元数据；评分不再接受泛化未知替代具体条件。
- 两进程竞争测试使用显式屏障保证真正重叠。定向 5 文件/24 条与故障注入 8 条通过，无新增迁移。
- 完整回执：[REVIEW_FIXES_20261117.md](REVIEW_FIXES_20261117.md)。M2 材料闭环及全量结果另记下一切片。

## 2026-11-17 M2 材料与反馈闭环

- 四个中性起步建议：发布准备/客户交付/科研汇报/课程项目。TXT/MD/普通 CSV/DOCX → 预览确认 → 研究/创作 → 原工作台追加材料或反馈 → 同 Mission 新稿。四 Skills 不增加；客户模板确认后使用既有 PROJECT_ONLY。
- Word 提取正文与表格文字，2MB/20,000 字符限制，隔离 Worker、归档展开限制、5 秒超时；不保留图片、排版和二进制原件。执行中新增材料按本周期输入快照继续留给下一轮。
- 验证：全量 275 文件/2145 条、定向 26 条、tsc、scoped eslint、Web 生产构建、DOCX Worker 与 24 个依赖入口追踪、Harmony 合约 155/155；生产构建浏览器真实闭环通过（localhost mock，360px）。
- 无新增迁移、无本轮付费调用或生产部署。真实模型质量/留存/真机/72h/滚动升级尚未验证。
- 完整回执：[M2_MATERIALS_20261117.md](M2_MATERIALS_20261117.md)，证据 evidence/v2-first-loop/m2-materials-20261117。

## 2026-11-17 M3 切片 A：真实成果挑战

- 严格导师三轮开放彩排、证据侦探引用追溯绑定原 Output 与来源，回答/来源打开/退出/交回由原 Mission 事件持久化；刷新可接续，原请求重试幂等。来源/材料/目标/新稿/到期变化撤题。
- 显式交回才生成待核对反馈并触发原扫描器同 Mission 改稿；反馈副本沿原 Output 继承来源限制。旧事件 API 隐藏挑战题面与答案键。无新 Skills、引擎或 Schema/Migration；开关默认关闭。
- 定向 5 文件/34 条、类型/scoped lint/Web 生产构建、生产浏览器五组闭环检查通过。注入/localhost mock，真实模型与用户效果未验；原生适配另记下一片。
- 回执：[M3_EXPERIENCE_20261117.md](M3_EXPERIENCE_20261117.md)；证据 evidence/v2-first-loop/m3-experience-20261117。
