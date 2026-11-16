# V2 实施前裁决（2026-11-16）

- 用户假设：开发者、自由职业者优先验证，科研/学生项目为重要对照；依据持续改稿、回访、成果采纳和成本比较，不预设最优首发。
- 基线：00e250bb7c11da24807b74b6239ff7aa3b46b07c。原工作树1364项待提交：1项鸿蒙构建配置、1363项未跟踪资料，保留原处；只复制V2规划和本地依赖到独立工作树。
- 独立分支：codex/v2-first-loop。本轮执行者是唯一Schema/Migration负责人；所有新增迁移由此分支生成和验证。
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
