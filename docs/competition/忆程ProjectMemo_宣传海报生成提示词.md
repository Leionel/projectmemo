# 忆程 ProjectMemo 宣传海报生成提示词

> 状态：仅完成 Prompt，不生成图片  
> 更新日期：2026-07-16  
> 用途：初赛展示页、答辩封面或宣传物料的视觉底图；不作为已上线产品或官方合作证明。

## 1. 海报定位

- 品牌：忆程 ProjectMemo
- 宣传语：**沉淀每一步，推进下一程。**
- 产品定位：面向大学生项目制学习的知识资产沉淀与主动推进 Agent。
- 核心叙事：项目碎片沉淀为长期记忆，Agent 基于证据主动介入，用户确认行动后将结果回写为可复用知识资产。
- 视觉方向：延续网站的“编辑部式项目档案”气质——温暖纸张、深靛蓝知识底座、青绿色主动行动，而非通用科技蓝或赛博风。

## 2. 一键直出完整成品海报 Prompt

> 适用于支持高质量中文排版的图像模型。生成时建议同时上传 [`public/logo.png`](../../public/logo.png) 作为品牌标识参考；以下 Prompt 已包含完整画面、文字、版式和负面约束，可直接整体复制。

```text
请生成一张可直接用于中国高校计算机大赛人工智能创意赛初赛材料的竖版中文产品宣传海报成品，A4 纵向构图，2480×3508 px，300 dpi 视觉品质，比例约 1:1.414。作品品牌为“忆程 ProjectMemo”，定位为面向大学生项目制学习的知识资产沉淀与主动推进 Agent。整张海报必须是完成排版的最终成品，不是空白底图、UI 截图拼贴或样机展示。

核心创意：把大学生在课程、科研和竞赛项目中产生的零散笔记、实验结果、代码问题、会议结论和材料要求，转化为可关联、可追溯的长期项目记忆；Agent 根据截止日期、风险、停滞和材料缺口主动介入，展示依据，等待用户确认后创建行动，行动结果再沉淀为复盘记忆，并可生成周报、作品说明、答辩 PPT 和 README。用一条从左下向右上自然延伸的“记忆旅程”作为视觉主线：深靛蓝记忆节点出发，经过半透明纸张卡片、证据引用、主动提醒和确认行动节点，最后汇聚为青绿色成果文档。路径应像一条平静、连续、有人陪伴的前进轨迹，不要画成火箭、增长曲线或无限符号。

视觉语言：高级中文编辑设计、知识档案与温暖纸张质感，克制、可信、人本、具有高校创新竞赛作品气质。背景为米白色档案纸 #F7F3EA，带极轻微纸纹和低对比项目网格；知识底座使用深靛蓝 #162A4A；主动行动使用青绿色 #2C9B82；辅助色为柔和薄荷绿 #DDF3EA；仅少量使用暖沙色 #D4B78A。几何卡片、细连接线、圆角标签和轻微纸层叠构成信息设计，不使用霓虹光、赛博朋克、玻璃拟态、夸张 3D 或通用科技蓝紫渐变。

版式从上到下分为四个清晰层级：
1. 顶部约 15%：左上放置小型原创品牌 Logo（若提供参考图则忠实沿用其造型），旁边准确排版品牌名“忆程 ProjectMemo”；右上放置小标签“MEMORY AGENT”。
2. 上中部约 25%：主标题大字“沉淀每一步，推进下一程。”其中“推进下一程”使用青绿色，其余使用深靛蓝；主标题下方排版副标题“面向大学生项目制学习的知识资产沉淀与主动推进 Agent”。
3. 中部约 45%：展示完整记忆旅程视觉，并以五个简洁节点准确标注“碎片记录”“项目记忆”“主动介入”“行动闭环”“成果生成”。在主动介入附近加入小型证据卡片意象，体现“有依据、需确认、不越权”；在成果端展示周报、PPT、README 三种抽象文档卡片，不放真实软件截图。
4. 底部约 15%：用一句较小正文“将散落的项目过程，变成会主动推动交付的长期记忆。”收束；最底部保留一行小字“Agent 创新 · 本地 Mock 可离线演示”，表达参赛方向与可信演示边界。

中文文字必须逐字准确、清晰可读，不得出现错别字、乱码、伪汉字、重复字或被截断文字。品牌名必须严格写作“忆程 ProjectMemo”，不得写成“项忆”“记程”或拆散 ProjectMemo。主标题必须严格写作“沉淀每一步，推进下一程。”所有文字使用专业现代中文字体风格：主标题可采用有编辑感的中文宋体或现代衬线体，说明文字使用清晰的无衬线黑体；层级明确，留白充足，对齐严谨。

禁止出现：华为、小艺、HarmonyOS、赛事主办方 Logo 或任何未经授权的官方标识；人物照片、手机样机、机器人、机械大脑、灯泡、聊天气泡、芯片电路板、股票增长箭头、二维码、水印、虚构用户数量、效率提升百分比、获奖标识、合作背书。不得暗示已接入小艺或已获得官方认证。最终效果应像成熟的产品发布海报与竞赛设计稿首页，既有辨识度又能在 A4 PDF 和答辩大屏中清晰阅读。
```

## 3. 生成前准备

1. 生成时可将 [logo.png](../../public/logo.png) 作为**品牌参考图**附上，但不要求模型在画面中生成任何文字或 Logo。
2. 先生成纯视觉底图，再在 Figma、Canva 或 PPT 中叠加文字与真实 Logo；这样可避免中文文字失真。
3. 不使用华为、小艺、鸿蒙或赛事官方 Logo，除非后续已取得相应素材与使用授权。

## 4. 纯视觉底图 Prompt（便于后期人工排字）

```text
Use case: ads-marketing
Asset type: vertical A4-like competition poster background for a Chinese university AI project named 忆程 ProjectMemo.

Primary request: Create a premium, editorial, visual-only poster background that communicates “memory becomes a forward journey”. Show one small deep-indigo memory node near the lower left, from which a calm continuous ribbon-path grows through several elegant, translucent project-memory cards and evidence fragments, then gently resolves into a subtle teal forward motion near the upper right. The visual should imply the complete path: capture fragment → project memory → proactive intervention → confirmed action → reusable outcome.

Scene/backdrop: warm ivory archival paper #F7F3EA, extremely subtle fine paper grain and a barely visible modular project-grid, never dark or noisy.
Style/medium: sophisticated editorial information-design illustration; vector-friendly geometric forms mixed with soft paper-cut layers; calm, intelligent, human-centered, suitable for a university innovation competition.
Composition/framing: portrait 3:4 ratio. Reserve the top 24% as clean negative space for a title and logo. Put the visual journey in the middle 56%, with a balanced empty lower 20% for a slogan and short description. Use a stable diagonal from lower-left to upper-right, but do not create a finance-growth chart or a rocket.
Color palette: deep indigo #162A4A as the knowledge foundation, teal #2C9B82 as the proactive-action accent, soft mint #DDF3EA as supporting layers, small warm sand #D4B78A accents only, and ivory background #F7F3EA. Use flat or very subtle paper-like tonal changes; no neon and no glossy 3D effects.
Materials/textures: crisp paper layers, refined card edges, fine connecting lines, generous whitespace, soft tactile archival texture.
Typography: render absolutely no text, no letters, no Chinese characters, no numbers, no logos, no watermarks. Leave clean areas for later manual typography.
Constraints: one coherent visual system; modest and credible rather than futuristic; no people, no phones, no robots, no brains, no chat bubbles, no circuit-board pattern, no generic lightbulb, no infinity symbol, no official competition branding, no Huawei or Xiaoyi trademarks.
Avoid: cyberpunk, blue-purple gradients, startup finance charts, stock AI imagery, over-dense dashboard UI, mockups, photographic scenes, shadows that look like product advertising, clutter.
```

## 5. 后期人工叠加文字

建议采用左对齐排版，使用网站同类的深靛蓝标题与青绿色重点词。不要让模型渲染以下文字，应在后期排版中准确加入：

```text
忆程 ProjectMemo
沉淀每一步，推进下一程。
面向大学生项目制学习的知识资产沉淀与主动推进 Agent
碎片记录 → 项目记忆 → 主动介入 → 行动闭环 → 成果生成
```

## 6. 交付验收

- 视觉中心应清晰表达“从一个记忆节点到下一程”的路径，而非简单上升箭头。
- 在缩小到手机屏幕或 PPT 缩略图时，靛蓝节点、纸卡层和青绿色前进方向仍可识别。
- 画面必须预留足够的文字区，后期叠加品牌名、宣传语和产品定位后不拥挤。
- 不出现不可证实的数据、用户规模、真实小艺接入、官方合作或赛事背书。
