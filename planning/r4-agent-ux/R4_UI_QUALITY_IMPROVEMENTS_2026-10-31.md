# R4 双端 UI 质量自查与改进记录（2026-10-31）

基线：本地 master `2b0067d`，包含 CT-8～10 独立审查修复；本批在 `codex/r4-ui-quality` 独立工作树实施。按用户两份补充规范及 product-design、apple-design、ui-design、harmonyos-design 执行，保留现有信息架构、品牌色和服务合同。

## 本批已改变

| 可复现问题 | 改动与位置 | 验证 |
|---|---|---|
| 焦点页选择零项筛选后只剩空白卡片 | `components/FocusAgentWorkspace.tsx` 增加按筛选解释及恢复全部入口 | jsdom 点击筛选、恢复并核对事项仍存在 |
| 移动焦点和项目委托表单被悬浮入口覆盖 | Web 焦点移除重复悬浮入口，保留讨论切换和逐项讨论；`ProjectConversationAccess.tsx` 在委托/成果页面提供行内讨论入口；鸿蒙 `GlobalFocusPanel.ets` 改为正常文档流按钮 | 双端截图；原讨论路由和权限保持 |
| 已有 4 项委托，首次打开却展示新用户引导 | `MissionPanel.tsx` 默认读取服务端列表首项；显式深链接优先；失败可重读同一项 | 默认选中、深链接优先、首读失败恢复三项回归 |
| 责任组件与方案组件使用相同 React key | 分别使用 responsibility/scenarios 前缀 | 浏览器原告警可复现；刷新后复查新日志 |
| 用户问题被完整范围/预算面板挤到后方 | 先展示原问题/原提案，再显示运行与接续；完整范围与累计用量按需展开，编辑草稿恢复时直接展开编辑 | Web 原问题可直接操作；责任合同丢回包/草稿回归保留 |
| 非完成阶段首先展示四项负向完成事实，主次不清 | 完成与核验详情在活动委托中折叠，终态默认展示；并未删除草稿、采纳和现实结果的区分 | 原完成语义测试、深浅主题渲染 |
| 责任面板硬编码浅色背景/文字 | 复用现有纸面、墨色、青绿和风险色 token；保留显式 focus 与 44px 操作高度 | 深色/浅色、宽屏/390px 窄屏 |
| 提醒缺口直接显示 paper_note 等内部枚举 | `lib/projectNotice.ts` 只在已知生成句式中映射已知类别；共享焦点 API 与项目概览调用，不改原记录 | 类别翻译、未知类别与英文文件名保持原样 |
| 焦点文字过小且多个装饰层竞争注意力 | 提高局部正文/元数据字号，去除重复眉题、渐变、色条及叠加阴影；状态徽标保留 | 已保存原/新桌面、窄屏截图 |

## 补充建议对账与后续优先级

1. **任务和主次**：本批落在焦点与委托真实问题。下一批统一项目页重复标题与摘要密度，仍以记录变化、调查问题、持续委托三个任务组织。不要把所有操作改为聊天。
2. **状态真实性**：现有真实等待、暂停、过期、未观测后台、部分覆盖继续展示。下一批覆盖观察失败/无变化/来源失效的并排设备场景，不能统一显示“持续守护”。
3. **列表选择与连续性**：首项默认打开、原深链接、失败恢复已补；下一批验收列表翻页、跨项目快速切换和长文本目标，不能用旧项目的详情填充新项目。
4. **Agent 协作入口**：本批调整悬浮与行内位置；下一批检查鸿蒙 ProjectHome 原有悬浮入口在采集和编辑场景的遮挡，及讨论返回后草稿/滚动位置。
5. **信息密度**：范围、预算、完成解释渐进展开；下一批审阅 Memory/Dream 事实/待验证推测的表述，证据、未知条件和撤回控制不能被隐藏成不可达入口。
6. **交互反馈**：保留原幂等、原请求读回和草稿，不新增“已执行”乐观提示。下一批验收网络中断、迟到响应、冲突和回执 UNKNOWN 的双端回退。
7. **原生适配**：鸿蒙本批复用 ArkUI Button/原 DesignTokens，仅调整焦点入口与责任详情层级。折叠/平板、字体放大、读屏、系统安全区及穿戴不在本次设备证明范围。
8. **一致性与视觉**：不替换全局字体/色板、不统一套玻璃卡片、不添加无业务含义动画。保留单一原生下拉指示；本批未发现必须重写所有 select 的依据。
9. **可持续交付**：后续按一条真实旅程交付 UI、状态、错误恢复及回执。未验收场景保留在本文件，不由构建通过推断设备通过。

## 设计裁决与规则

- product-design：`rule/structure-before-containers`、`rule/preserve-mental-model`、`rule/cover-reachable-states`、`rule/empty-state-action`、`rule/error-states-recovery`、`rule/preserve-user-input`、`rule/inline-before-modal`。
- ui-design：Audit/Deslop；规则从 `rules/` 读取。`states-no-empty-state`、`interaction-target-size` 覆盖空筛选和触摸尺寸。独立工程缺陷（重复 key）另列，不用审美分数代替正确性。
- apple-design：即时反馈、克制、稳定位置、保留系统控件；无新增装饰动效。
- harmonyos-design：沿用现有 API/设备环境和 ArkUI，不将 Web 的悬浮结构直接复制到手机。当前记录是项目设计裁决，不冒充新的官方平台规定。
- 已考虑但不判为问题：单独一层渐变未达到 decoration 规则阈值，本批清理属于层级优化；原生 select 单指示器保留；后台未观测提示是必要真实状态，不能为简洁删掉。

已读取的技能材料：product-design/SKILL.md、规则 registry、references/interface-quality.md；apple-design/SKILL.md；ui-design/SKILL.md、references/feature-playbooks.md、ship-readiness.md、output-adapters.md、direction/aesthetic-direction.md、相关规则；harmonyos-design/SKILL.md、references/PRINCIPLES.md；computer-use/SKILL.md 与运行时 API 文档。用户规范仅作为本次审查依据，不形成外部写入授权。

## 验收环境与证据

- 所有数据来自本工作树 E2E 隔离库；`scripts/ui-quality-fixture.ts` 调用原 Mission 服务生成等待输入、等待审批、暂停、待执行四个状态。provider 为 UI_ACCEPTANCE_FIXTURE，非真实模型，没有启动 Worker。
- Web `127.0.0.1:4410`；鸿蒙临时 development 构建连接同一本地后端。构建后 Constants、签名 profile 逐字节恢复，签名材料不纳入提交。
- `evidence/r4-ui-quality/20261031/before` / `after` 为截图。最初 native.png 是模拟器桌面，不能当产品基线；native-focus.jpg 才是原焦点遮挡证据。
- 首次全量运行因新工作树独立 test-vitest.db 未迁移失败，已停止、仅对该测试库执行 migrate deploy 后重跑；原失败日志保留。没有执行 seed/reset 真实数据。
- 全量：176 文件 / 1388 项通过（full-tests-final.log）；Harmony：88/88；类型与 lint 通过。Web 与 HAP 构建通过。后续补充实际 E2E 和原生操作结果。

## 待完成验收（按结果更新）

- Web E2E 最终 30 通过 / 2 跳过 / 0 失败 / 0 flaky；刷新后浏览器 warn/error 读取为空，最终桌面焦点截图已保存。
- 鸿蒙本地包焦点 → 原委托、范围展开/收起、原问题与后台未观测状态已实测，截图为 native-focus / native-mission-collapsed / native-mission-expanded。键盘弹出时输入跟焦仍需单独验证；当前 keyboard 截图捕获于有意停止后端期间，不作为正常联网下的通过/失败依据。
- 正式设备/平台推送、小艺、真实外部审批与真实模型质量不由本轮本地 UI 验收覆盖。


临时构建纠错：第一次 native-final 构建的字符串替换误改了 BASE_URL 条件，不能计入本地双端验收。已改为仅匹配完整 BUILD_FLAVOR 声明、断言 review 条件未变，并重新构建安装；最终有效产物和回执使用 `native-local-*`。此前登录尝试仅使用合成账号，未产生真实业务写入。最终本地包已以原 E2E 身份成功登录，焦点行内入口与无悬浮遮挡已观测。


业务改动已冻结为 `fae6995`。最后一批 JSX 顺序调整已被随后完成的全量回归与 Web 构建覆盖。临时签名 profile、Constants、Next 自动生成配置均不属于业务提交。模拟器上安装的是仅供本地验收的 development 包，不能直接用于正式评审或生产发布。


E2E 首轮：29 通过 / 1 失败 / 2 跳过。失败发生在原责任修订用例未展开新详情，旧标题和 div 选择器也已不适用。用例已改为真实展开入口与具名 region，保留原 PATCH、刷新读回、重点字段和旧版本 409 断言；截图改写到本轮新证据目录。正在重跑完整 E2E，未以单元测试替代此验收。


## 最终收尾

- 完整 E2E 重跑 30 通过、2 跳过、0 失败、0 flaky；跳过项与原注释记录于 validation.json，不视为已验收。
- 末次文字色适配在 E2E 后完成：修订按钮的浅色对比度 6.513:1、深色 7.835:1；原固定白字在深色背景仅 1.918:1。最终 4 文件 / 29 项受影响检查、lint 与生产构建再次通过。E2E 证明交互路径，最终颜色由独立数值与构建检查补充；不重复宣称整站 WCAG 通过。
- 代码与交互用例最终提交 `9316414`；完整回归 176/1388、Harmony 88/88 和本地安装证据见 validation.json。没有改动服务端写入授权或引入新 Runner。
- 原 UX-1/UX-2 的 4 张历史截图已逐字节恢复；本轮 E2E 新截图另存 after/e2e。E2E 完成后恢复了独立预览库快照与 4410 服务，未覆盖任何真实数据库。
- 下一批优先做：鸿蒙输入框随键盘滚动跟焦（正常网络/断网分开验收）；项目标题/重复问题的层级整理；Memory/Dream 的事实与待验证内容视图；大字号、读屏与更大设备。每项按真实任务验收，不能只改颜色和卡片。
