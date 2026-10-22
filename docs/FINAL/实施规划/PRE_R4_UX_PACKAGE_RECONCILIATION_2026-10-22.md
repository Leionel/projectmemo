# Pre-R4 UX 工作包对账

2026-10-22 自动化复核。主工作树核对起点为 `3c3d577`；关键流程回归在 `D:/Projects/hongmen-r3-release-merge` 的已提交版本 `21d8bf1` 执行。主目录另有活跃聊天正在修改全局导航；本轮只补交付记录，不提交其代码。

依据：[总体方案](ProjectMemo_双端功能曝光与UI优化方案_2026-10-21.md)、[原型](PRE_R4_UX_PROTOTYPES.md)、[衔接契约](R4_UX_INTEGRATION_CONTRACT.md)、[阶段记录](PRE_R4_UX_IMPLEMENTATION_NOTES.md)、[后续复查](PRE_R4_UX_FOLLOWUP.md)，以及 R4 正式架构、路线图和研究裁决。下表区分实现、自动检查和人工验收。

## 阶段提交与集成

| 阶段 | 已有提交 | 内容 |
| --- | --- | --- |
| UX-0 | `bd4215e` | 总体方案、四屏原型、视觉候选与 R4 衔接规格 |
| UX-1 | `33bb416` | 五分组导航、首页焦点与有界 Mission 摘要 |
| UX-2 | `393c8f3` | 明确快照基线、暂停/取消请求与可信任务流程 |
| UX-3 | `bb0b6da` | 双端主题、响应式与关键流程回归 |
| UX-4 | `4da0183` | 未来接缝冻结及验收汇总 |
| F1–F3 | `3a7f327` | 焦点去重、资料到首委托、Ledger 演进 |
| F4 | `21d8bf1` | 同问题保留补料输入、重试及固定成果版本定位 |
| 主目录集成 | `15eb02f` | 上述 Pre-R4 提交合并回 `D:/Projects/hongmen` |

这些提交均已包含在本轮主目录核对起点中。后来的 Web 精细化与全局导航改造单列于 [Web 改造记录](WEB_UI_REFINEMENT_2026-10-22.md)，其未提交状态不计入上述验收。

## P00–P40 逐项结论

| 包 | 已有交付与源码落点 | 实际证据 | 仍开放的验收或依赖 |
| --- | --- | --- | --- |
| P00 盘点 | 三份 UX 规格、旧八路由映射、Mission/State/Ledger 契约；`lib/projectNavigation.ts` | UX-0 文档回执；本轮核对提交、链接与正式 R4 边界 | 安装版本与在线画面待同版本核对 |
| P01 原型 | 桌面、窄屏、鸿蒙工作台、Mission 详情；两套同内容视觉及状态矩阵 | 原型说明和 UX-0 的 12 组对比度计算 | 未见首次正确点击、误解次数及帮助记录；形成性用户走查未通过 |
| P10 导航/首页 | `ProjectNavigation`、项目首页、`ProjectPulse`、鸿蒙 `ProjectHome`；保留原路由、query 和实体锚点 | 本轮导航、工作台、焦点测试；F1 截图及历史 E2E | 鸿蒙实际返回/触摸及新导航未提交版本另验 |
| P11 Agent 主线 | `mission/workspaceSummary`、摘要 API、Web/ArkTS MissionPanel/Detail；有界摘要、分页和按需轨迹 | 本轮摘要及原生契约测试；UX-1/UX-3 回执 | 设备弱网、前后台与实际长任务待验 |
| P20 演进 | `ProjectEvolutionSummary`、`ProjectDecisionTimeline`、`StateDiffView`、鸿蒙 `ProjectEvolutionPanel`；来源、取代和已发布 Episode 入口 | 本轮无基线、真实 from/to、差异故障及授权失败检查；F3 回执 | Snapshot 时间/覆盖缺口仍属 R4 W1；没有任意历史回放 |
| P21 可信命令 | `MissionPanel`、`MissionContinuation`、`MissionArtifactAdoption` 与原服务；保留 requestId、questionId、版本及 proposalHash | 本轮输入保留、重试、401、原生契约、固定成果链接检查；F4 的历史 E2E | 真实设备断网/切身份及真实模型路径待验 |
| P22 起步/接续 | `ProjectStartGuide`、可编辑首委托模板、资料/记忆入口；权限显式确认，回到同 Mission | 本轮起步引导和面板检查；F2 的历史隔离 E2E | 用户找入口与理解状态的小测待执行 |
| P30 视觉收口 | CSS 语义色、浅深主题、业务无衬线、Reduced Motion；ArkUI DesignTokens 与浅深资源 | UX-3 的历史截图、HAP 与原生检查；已提交源码可定位 | 后续 `3c3d577` 及导航 WIP 的最终视觉验收沿 Web 改造记录，不沿用旧截图 |
| P31 交互验收 | Web 键盘/错误/恢复路径与关键任务 E2E；鸿蒙本地契约及构建 | UX-3：615 项、12 项 E2E、60 项鸿蒙检查；F1–F3：632 项、13 项 E2E；均为各自历史版本 | 部分完成：同版本设备、读屏、大字体、真实触摸、前后台及长帧实测仍开放 |
| P40 R4 接缝 | 衔接契约定义宿主、字段、权限、命令、失效与回退；生产不显示无服务的 R4 入口 | `4da0183` 冻结回执；本轮对照 R4 领域所有权、依赖及设备 Gate | Twin/ImpactJob、Lab、Proactive 2.0、Sensing、Experience 按 R4 工作包实施；具体新 schema/读回方式仍待服务冻结 |

## 本轮复验

在稳定工作树 `21d8bf1` 运行以下 11 个文件，57 项全部通过，退出码 0：

```powershell
npm.cmd test -- tests/projectNavigation.test.ts tests/projectWorkspaceOverview.test.ts tests/projectAttention.test.ts tests/missionWorkspaceSummary.test.ts tests/missionNativeContract.test.ts tests/projectEvolutionSummary.test.ts tests/projectDecisionTimeline.test.ts tests/projectStartGuide.test.ts tests/missionPanel.test.ts tests/missionContinuationPanel.test.ts tests/missionArtifactAdoptionPanel.test.ts
```

数据来源为独立临时测试库、组件 mock 和实际 Next route 的原生契约适配；没有真实模型、Search/Fetch 或生产数据调用。日志与核对回执位于 `evidence/pre-r4/20261022-automation-reconcile/`。本轮是记录收尾，不重复构建；历史 E2E、HAP 和截图保留原版本归属。

主目录三份 R4 正式文档核对哈希；本轮未改业务代码、数据库、签名配置或已有证据，未 push、未部署。账户额度查询显示 5 小时窗口使用 49%、周窗口使用 8%，尚有 2 张重置卡；本轮使用 0 张。工具未返回当前模型标识，不记录未经核实的模型切换。

F5 的逐项对账已完成。后续优先完成正在进行的导航版本验收，再用确定版本补 P01/P22 用户走查和 P31 设备证据；Pre-R4 工程实现、人工体验验收和 R4 开发分别记录状态。
