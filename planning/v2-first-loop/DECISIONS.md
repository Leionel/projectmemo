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
