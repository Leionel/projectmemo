# 给 dsh：实现 Web 小游戏与书签精灵素材系统

你接手忆程 ProjectMemo V2。请阅读下述代码与最终原型，直接实现可交互的 Web 页面，并把书签精灵整理成可复用的产品角色。按独立切片验证、提交，不止交设计说明或静态展示。

## 1. 基线与工作范围

- 工作树：`D:/Projects/hongmen-worktrees/v2-first-loop`，分支 `codex/v2-first-loop`。已核实基线 HEAD 为 `e2d20ad0`；允许有更新，先检查全部差异，不硬重置、不覆盖其他人的修改，不另建 C 盘工作树。
- 先读 `AGENTS.md`、`planning/v2-first-loop/DECISIONS.md`、`REVIEW_M3_M4_20261117.md`、`M3_M4_GATE_STATUS.md`，以及 `docs/v2/07_EXECUTION_PLAN.md` 的实际进度部分。
- 只做桌面 Web。现有挑战、回访、冲刺和后端已经实现；此次深化角色、布局、动作、反馈与真实成果回流。不得把已有功能再建一套，不增加通用 Agent 引擎、游戏框架或 Skills 数量。
- 原工作树 `D:/Projects/hongmen` 不修改。保留 `.env`、真实数据库、签名文件和旧证据。验证使用隔离 SQLite 与本地 fixture/mock，无新增付费调用、外发或部署。
- 核对当前长跑状态，不能把历史 RUNNING 当成当前存活；不停止、重置或复用其测试库。依赖若需要重装，先在独立目录验证。

## 2. 必须打开看的最终参考图

相对上述工作树：

1. `docs/v2/assets/web-game-prototypes/20261117/01-evidence-detective-web-v1.png`
2. `docs/v2/assets/web-game-prototypes/20261117/02-mentor-rehearsal-web-v2.png`
3. `docs/v2/assets/web-game-prototypes/20261117/03-paired-sprint-web-v2.png`
4. 同目录 `PROMPTS_AND_INTERACTIONS.md`
5. 角色参考：`docs/v2/assets/mascot-concepts/20261117/02-bookmark-spirit-v1.png`

只按最终 v2 图实现导师与冲刺。drafts 是修正前版本，不采用其中“正在写入/已保存”冲突或擅自补出的验证结论。

原型中的日期、题数、稿件数量、人物和文字是示例，实施必须取真实授权数据。纸卡质感与角色可以用图片；页面、按钮、编辑器、来源卡、连线、状态和差异必须是实际 DOM 与事件，不能用整张原型做背景再覆盖热点。

## 3. 先把书签精灵做成产品素材

### 统一角色身份

书签精灵是一个项目伙伴，用不同动作表达工作状态。不要为四个 Skills 另造四个精灵。

- 象牙白折页身体、右上折角、深青绿纸质兜帽、铜色长书签带、黑色椭圆眼、小嘴和少量暖色腮红；身体有分层纸页与折纸小脚。
- 温和、认真、可靠，研究时专注，遇到未知时思考，交付时轻快。保持参考图的轮廓、脸部比例、材质与光照。
- 色彩以 `#27685D`、`#1C2E2C`、`#F7F5EF`、`#BC7B4C` 为基准；不要随姿态变脸、变物种或换材质。
- 采用适合 Web 小尺寸的克制纸雕质感；减少碎纹理与过细配件，避免缩小后变成一团。保留轮廓识别，不把角色做成通用白团子或机器人。

### 必须交付的素材

先出一张角色标准板，再以母版生成头像与六个独立姿态。逐张检查一致性，不能把拼贴设定图直接塞进界面。

| 文件 | 内容 | 使用约束 |
|---|---|---|
| `character-spec.png` | 正面、3/4、侧面、颜色与比例参考 | 设计资料，不作为首屏背景 |
| `avatar.png` | 清晰的小头像 | 不替换现有品牌 Logo |
| `idle.png` | 安静抱着项目夹 | 空闲、等待或静态陪伴 |
| `inspect.png` | 看向原记录、持放大镜 | 查看来源与导师核查 |
| `thinking.png` | 轻微疑问、思考 | 未知项、等待回答 |
| `writing.png` | 写稿、整理纸页 | 只在真实处理状态使用 |
| `handoff.png` | 递出项目夹或新纸页 | 展示交回意见、成果交接 |
| `success.png` | 小幅度开心、夹好纸页 | 有对应成功回执后短暂显示 |

独立角色素材使用真实透明背景，无文字、页面、整块底色、棋盘格或烘焙进图里的按钮。保留完整纸带与身体边缘；相同画幅、落脚位置、相机角度和光照，切换时不跳大小。保留高分辨率 PNG 母版，网页按实际显示尺寸优化，首屏不一次加载全套原图。

使用可用的原生生图工具生成、编辑和去背，并保存完整提示词与参考关系。先检查工具能力；没有生图工具时，不擅自接付费 API，不用几何占位、裁剪海报或变色旧图冒充已完成的角色包。可以先完成状态组件与交互接线；角色素材未就绪必须列为 ASSET_PENDING，不能把视觉验收标成完成。

生产素材放 `public/mascot/bookmark-spirit/v1/`，设计母版与提示词留在 `docs/v2/assets/`。建立 manifest，记录语义状态、文件、尺寸、来源与适用场景。不要移动或覆盖现有概念图；只提交确认无私人信息的产品素材，不强制把整个忽略的 docs 目录加入 Git。

### 可复用组件

建立 `BookmarkSpirit` 展示组件及状态映射。建议入口 `components/mascot/BookmarkSpirit.tsx`，最终遵循现有目录约定。

- 图片路径来自白名单 manifest，不接受任意远端 URL。
- 角色动作来自真实挑战、请求、Step、Output 状态；计时结束、hover 或动画播放完不能制造进度和成果。
- 支持安静模式与 `prefers-reduced-motion`；低频呼吸、轻点头、纸带摆动即可，不持续跳跃或抢焦点。
- 设置固定尺寸和预留空间；切换不闪白、不移动正文。装饰性角色不重复播报，相应状态与控件有可访问名称。
- 点击角色可展开一条与当前任务相关的提示；提示不能泄露服务端答案，也不因点击额外调用模型。

## 4. 第一条纵向闭环：证据侦探

优先完成它，再把同一角色与组件语言扩展到另外两种玩法。

主要复用：`components/v2/OutcomeChallenges.tsx`、`OutcomeWorkbench.tsx`、`SourceProvenance`、`lib/challenges/{service,rules}.ts`、`lib/types/challenge.ts`，以及既有 challenges GET/POST 路由。

界面包含原稿短句、来源卡、引用槽、同屏原文阅读区、角色与明确反馈。来源名称、时间、版本来自获准记录；默认不展示 hash/CUID。缺时间则说明未记录，不以当前时间替代。

真实交互：

1. 点选或拖入来源卡，多个引用按实际题目支持多选；也能取消选择。
2. 点击“打开原文”，定位当前版本的相关段落；原文阅读不伪装成事实验证。
3. 点击“核对引用”，以服务端 verdict 展示匹配或需要复核；不能在前端携带 expected 答案或自行判定。
4. 完成后明确显示“引用关系已对上，内容仍待核验”；用户显式点击后才交回原 Mission。
5. 交回后展示接收回执与同一 Mission 的后续稿件入口。区分已接收、正在处理、已保存新稿，旧版本继续可读。

拖放需要明显落点、吸附与取消反馈，同时保留点选、键盘完成路径和可见焦点。角色看向选择、检查来源、递交纸夹等微动效服务这些动作。

前端局部状态可拆成选卡、读来源、核对中、已回答、交回中、完成；持久状态仍使用现有 ChallengeSession。题数和当前轮次来自真实会话，不硬编码原型里的 1/3。

保留停止、删除回答、到期/来源变化撤题、权限撤回、失效稿件保护。网络错误保留选择与输入；不确定回包用原 requestId 重试；迟到 GET 不覆盖提交结果；切账号不能展示旧项目内容。

## 5. 第二条：严格导师 / 交付彩排

复用 REHEARSAL 三轮题、回答与 HANDOFF，做“原稿—追问—本轮发现”同屏体验。优先使用现有问题与回执，不为拟人化新建聊天引擎或强制增加模型调用。

- 步骤按实际题目显示为依据、边界、改稿；支持“这处我还不知道”。
- 回答可以关联原证据。现有 REHEARSAL 不接受 selected 选项，不能把来源 chip 硬塞进旧字段：如需新增证据绑定，使用增量可选字段并在服务端校验本轮 SourceRef、版本与权限，兼容旧客户端。
- 右侧逐渐整理待核对缺口，最终显示“原文 / 建议”，显式交回原委托。开放问题不自动判真假，不发明已验证结论、已批准口径或成绩。
- 语音、附件等图示功能只有确实接通才显示，避免不可用的装饰按钮。

## 6. 第三条：双人冲刺

复用 `components/v2/ProjectSprint.tsx`、`lib/mission/sprintService.ts`、`lib/types/sprint.ts` 与现有 `/api/missions/:id/sprint`。

- 两个工作区：用户的小目标与核查记录；忆程的真实步骤与成果。
- 是否可启动使用服务端 canStart。无实际 Agent 工作时解释原因，不用倒计时演出后台进展。
- 个人勾选是自述；Agent 完成数来自持久 Step/Output。新稿只有保存回执到达后才出现“打开新稿”。
- “结束本轮”与“暂停原委托”保持不同动作；结束后本轮统计不能继续吸收后来产物。
- 自然语言改道走已有 Conversation/Directive 链；反馈以应用结果为准，不能只改本地气泡。
- 收尾展示本轮实际留下的稿件、已打开的来源与待判断项，点击进入原版本/差异。奖励是成果可见，不加积分经济或虚假成就。

## 7. 视觉与工程要求

保留现有应用顶栏与项目上下文。小游戏可在同一个 Mission 工作空间切换，离开后能回原稿。参考纸卡、书页与铜色连线的质感，但优先保证内容、输入和焦点可读。

角色为真实独立图片；其余布局使用 HTML/CSS/React。按钮、文字、资料与版本对照不能烘焙在背景图中。动效以 transform/opacity 为主，不引入重型游戏运行时。需要新依赖时按 AGENTS.md 核查官方源码、许可证、维护与网络行为，优先复用已有能力。

桌面先验收 1440 与 1280 宽度；较窄浏览器仍能完成主要操作。长项目名、长标题、多来源、缺时间、失效来源都要有状态；不要为贴图而截断关键证据。

沿用 V2/挑战的业务开关，并保留界面回退方式。呈现开关不能扩大执行权限。充分复用原 AgentPresentation、来源策略、Mission Runner、Worker、Memory 与四 Skills；不为了动效改写旧 finish/SUCCEEDED/WAITING_INPUT 的语义。

原则上不新增 Schema/Migration。若确需持久字段，先核对现有事件/JSON 能否承载，保持当前唯一 Schema/Migration 负责人统一编排，不能多人各自生成冲突迁移。

## 8. 验收与提交

建议切片：A 角色母版/透明素材与状态组件；B 证据侦探完整闭环；C 导师复用；D 冲刺与整体验证。素材生成与不依赖素材的工程工作可分别推进，但最终视觉验收必须使用正式素材。

必须给出浏览器证据：

- 选卡、拖放、键盘选卡结果一致；原文可定位；多源题与无合适来源不会编答案。
- 丢包后原请求重试、刷新恢复同一会话、重复 handoff 无重复作用。
- 来源变化或撤权及时撤题/隐藏内容，删除回答后不能从反馈副本或缓存重新展示。
- 导师三轮意见交回后，同 Mission 出现有依据的新版本；建议和事实、批准分别处理。
- 冲刺有真实后台任务/回执；自述不推进事实；结束冲刺不暂停 Mission；计时不制造成果。
- 角色姿态一致、透明边缘在浅/深底无白框；加载和状态切换不抖动；reduced-motion 生效。

运行与改动相应的测试，至少覆盖既有 `v2Challenges`、`v2ChallengeMetricPrivacy`、`v2ReentryBrief`、`v2ProjectSprint` 等回归；新增测试聚焦真实交互和异步/权限边界，不写只验证 CSS 常量的镜像测试。运行 tsc、scoped eslint、生产构建和 Playwright 实际流程。若接口改变，核查鸿蒙旧模型/调用方兼容性。

构建成功后必须实际启动生产包验证角色图片、来源阅读和交回，不用开发模式截图替代。不要使用 skip typecheck、改冻结答案或降低断言换绿灯。Vitest 保持文件串行；测试库与现有长跑隔离。

每个切片本地 commit，提交本片代码、必要素材与证据。回执记录：文件、接口/数据变化、测试命令与实际结果、迁移、兼容性、截图/录屏、回退和未验内容。新证据写入新的目录，保存参考图与实际页面截图的对照。

完成时给出可访问的本地入口，说明合成数据/本地模型边界。继续保留 M4 未通过状态：漂亮页面不能代替独立内容核验、真实模型、真机、用户使用价值或 72h 验收。不合并原工作树、不 push、不部署。

非关键选择自行判断；外部工具不足只阻塞相关验收，继续其他可完成工作。不要只留下静态菜单、占位图或下一步计划就结束。

## 附：单张角色素材的生图提示词模板

先附上现有书签精灵参考图与已确定的母版，再将 POSE 替换成目标姿态；每张只生成一个完整角色。

```text
Create one production-ready transparent-background character asset for the ProjectMemo web app. Use the attached bookmark-spirit reference as the strict identity reference. Preserve the same ivory folded-page body, upper-right turned paper corner, dark pine-green folded hood, layered page edges, small folded-paper feet, vertical oval dark eyes, tiny expressive mouth, subtle warm cheek marks, and long copper bookmark ribbon. This is the SAME character in a new pose, not a redesign.

POSE: [insert one precise pose and its single main prop].

Premium restrained 2.5D paper-sculpture illustration, warm capable personality, matte paper, soft upper-left light, restrained texture that remains readable at 96–200 CSS pixels. Palette: pine #27685D, ink #1C2E2C, ivory #F7F5EF, copper #BC7B4C. Full body and complete ribbon inside the frame with generous transparent padding. Match the approved master camera angle, proportions, baseline and scale. Square high-resolution PNG master with genuine alpha transparency and clean antialiased edges.

No text, letters, labels, UI, backdrop, scene, white rectangle, checkerboard, floor slab, extra characters, decorative clutter, watermarks or logos. Do not change face shape, hood shape, materials or lighting. Keep props subordinate to the character. The asset must work on both light and dark UI surfaces.
```

姿态示例：idle 抱项目夹；inspect 持放大镜看来源；thinking 轻托下巴、疑问表情；writing 在小纸页上写字；handoff 向使用者递项目夹；success 将新页夹好、轻微开心，不持“验证全部通过”印章。
