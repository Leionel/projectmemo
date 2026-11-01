# 交接文档 — 问忆程对话 / 焦点 / 委托 / 资料行动 UI 精修（2026-11-01）

本文件记录本轮多批次 UI/UX 改造的完成状态、验证结果与一个**未解决的编译阻塞点**，供下一次接手直接继续。

## P0 阻塞点：Index.ets 记忆页三处改动触发 ArkTS 编译失败（未合入）

为全局「项目记忆档案」页做了三处小改动，但合入后 `harmony:build` 在 `Index.ets` 尾部（约 3201-3212 行的嵌套 `Column` 收尾属性区）报 `arkts-no-any-unknown` 与 `Declaration or statement expected`。**已验证与缓存无关**（清空 `harmony/entry/build` 与 hvigor 缓存后仍复现），且：

- `git checkout HEAD -- Index.ets` 后单独构建：**通过**；
- HEAD + 三处改动（任意组合整体合入）：**失败**，错误行号始终落在尾部收尾属性；
- 三处改动本身括号平衡，均不触碰尾部。

三处改动内容（从 HEAD 基线重新应用即可复现，用于定位）：

1. 顶栏放大镜对记忆 Tab 生效：删除 `if (this.currentMainTabIndex !== 1) {` 包裹（约 2660 行）。
2. `GlobalMemoryTab()` 内常驻 `TextInput` 搜索框改为：收起态「搜索：xx 清除✕」提示条 + 顶栏放大镜展开（约 1342 行）。
3. 记忆卡摘要 `.constraintSize({ minHeight: 40 })`（约 1523 行）——解决「记忆 / 随手记录卡片不一样大」。

**已回退**：`Index.ets` 当前保持在 HEAD 基线（可编译），三处改动未包含在本次提交中。接手后建议逐条二分定位触发者（怀疑与 Builder 内 `if` 顶层条件渲染 + 尾部嵌套收尾的组合有关），修复合入即可完成全局记忆页与项目资料页的搜索/卡片统一。

## 已完成并验证（`harmony:test` 88/88、`harmony:build` 通过、模拟器实测）

- **对话页两轮**：气泡自适应；纠正理解改轻量入口 + Dialog/Drawer（Web）与底部弹层（鸿蒙），精确偏移/contentHash/CAS/草稿/409 协议全部保留；引用资料收敛为「资料 N」入口 + 独立来源面板；委托轻卡片；「为什么这样建议」替代原始字段堆叠；输入框自适应高度 + 更多菜单；独立历史讨论页（鸿蒙）与抽屉（Web）。
- **焦点页**：问忆程胶囊悬浮入口（`FocusAgentLauncher` 重构，去「忆」方块）；「为什么提醒我」收进行内；统计压成「待办/提醒」chips；PAUSED/FAILED 技术细节收进详情；归档/刷新移顶部菜单；提醒时间人性化。
- **委托模块**：列表按状态分组去重复入口；新建表单四段式 + 完成要求折叠 + 提交前确认；详情四视图（概况/进展/方案/设置）；进展 JSON 适配层 `MissionProgressPresentation.ets`（原始 JSON 只进折叠技术诊断）；运行额度卡（复核与继续是两个操作）；方案对比点选卡（陈旧禁用采用）；回执改摘要 + 展开入口。
- **资料/行动页**：行动卡状态驱动主操作（TODO=开始、DOING=完成并回执、次操作轻量化）；资料/行动页右上角放大镜搜索（行动为本地标题+描述过滤，与状态筛选相与，深链不受影响）；「安排时间」迁入更多菜单；资料卡类型标签中性化（不再红）、CURRENT→「当前有效」；预期结果去灰框 2 行截断；演示口径文案澄清；全局记忆卡摘要 2 行等高（**该改动因上述阻塞点暂缓**）。

## 用户 WIP 修复记录（保留语义的最小修复）

- `ProjectHome.ets` `getRecentActivities()`：误挂 `@Builder` 导致编译失败 → 移除注解（数据函数）。
- `WidgetDataService.ets` `formatDeadlineState`：对象字面量类型违反 arkts 规则 → 抽出 `DeadlineState` 接口。

## 遗留与建议

- `Index.ets` 阻塞点见上；修复后需补截图（全局记忆默认/搜索展开/卡片等高对比）。
- `tests/documentReader.test.ts` 2 个失败为本机 pdftotext（Git mingw64 版）与测试要求不符，环境基线，与本轮改动无关。
- 评审环境（review 包连生产后端）下部分只读视图报 HTTP 404（如委托「运行与接续」、纠正面板），按约定本轮未处理。
- 用户未提交 WIP 备份：`.zcode/Index.ets.user-wip-backup.ets`（含通知路由改动与全局记忆页 WIP，均在可编译基线之外的中间状态）。
- 截图证据：`evidence/agent-conversation-ux/`（对话、焦点、委托四视图、资料/行动、任务全部轮次）。
