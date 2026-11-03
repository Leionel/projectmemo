# Track C 最终回执：Web 工作包、依据纠错与结果回执闭环

- 日期：2026-11-03（UTC+8）
- 工作树：`D:/Projects/hongmen-final-c-workspace-ux`，分支 `codex/final-c-workspace-ux`
- 固定同步检查点：`4b696141435825a3582816e8e449c0e0cf013f29`（主控 final-integration，A/B 合同已修订后的源码为准）
- 最终代码候选：`2d61578dd001cd6c3f556f546ca4bd6c5d24ae83`（短 `2d61578`），产品代码最后变更为 `50b4213`
- 性质：仅 Web 客户端消费已冻结 `final-a-workpacket-v1` 只读工作包，不新增服务端 DTO/SourcePolicy、不改 ArkTS/官网、不改 schema/依赖；未 push、未合 master、未部署、未迁移真实库、未复制 `.env`/签名私钥、0 付费调用/外部写入。
- 提交链（相对 4b69614）：
  `e3b2176` 脚手架（读回置顶+子面板拆分）→ `c0ca241` C3 → `01f7ce8` C2 → `7897156` C1 → `1446401` C3-fix（消除双口径）→ `5b89ecf` C1-fix（旧服务缺 workState）→ `e9f8be1` 409/401 恢复测试 → `21cb961` 按钮/readAt polish → `50b4213` C1 状态枚举中文化 → `2d61578` 测试对齐。
- 变更规模：13 个文件，+3844/−160（8 个产品文件 + 5 个测试文件；另有本证据目录与 `scripts/final-c/` 工具）。

## 1. 用户行为改善（实际交付）

| 段 | 用户可见结果 | 关键实现 |
|---|---|---|
| C1 | 回到原 Mission 详情，**顶部第一屏**直接看到四问：做到哪 / 依据是什么 / 为何停下 / 现在等谁；只有一项主操作，点它是**页面内定位或重新读取**，不产生新任务、不替用户批准；技术步骤、责任边界、完整预算、查询覆盖按需展开。 | `components/MissionWorkPacket.tsx` + `MissionWorkPacket.module.css`；`components/MissionPanel.tsx` 仅加 4 个稳定锚点；`MissionReadback` 置顶（原地才有同一份只读快照）。复用原 `workState`/`workPhaseLabel`、`MissionContinuation`、原审批、`MissionResponsibilityPanel` 与 Focus 的 `primaryContext`（`FocusAgentWorkspace` 核对后无需改动，证据行号见提交回执）。 |
| C2 | 在“依据”展开区逐项看到：当前使用资格（ALLOWED/SUPPRESSED/UNKNOWN/资格未知）与修订状态（CURRENT/CHANGED/UNAVAILABLE/未知）**分两行**；历史 facts/摘录保留但被抑制/来源链未知的资料明确“不作为当前推荐”；只有文件级定位时明说“未记录页码/段落，不编造精确位置”；`EXACT_QUOTE`/用户核对不等于独立证实；可从原草稿版本打开原纠正入口，纠正后重新读取。 | `components/MissionBasisEvidence.tsx` + module CSS；复用原 `ClaimCorrection`（`MISSION_OUTPUT`）、`materialUseSummary`、`missionNavigationHref`；不新建判断/来源数据库，**未改** `AgentMemoryPanel`/`ClaimCorrection`（服务端缺判断级可用性字段，记为待 A 缺口）。 |
| C3 | 结果区先讲“支持上限”再讲细节：草稿/已执行/用户报告/独立支持/反例/未知沿用服务端 `reviewProgress` 原分类；行动逐项给出原 Action 与 `resultCardId` 复盘回执链接，`isSimulated` 标“演示不计真实”，无回执时指向原行动板且不自动写入；Intake 建项成功后给出“核对目标/查看材料与未知/开始原调查”，材料同步失败保留同一 `projectId` 与原重试、不二次建项。 | `components/MissionResultReceipts.tsx`、`components/ProjectIntakeForm.tsx`；`MissionReadback` 容器保留 409/VERSION_ADVANCED 与 401/403/404 清缓存；`ActionBoard` 经复核无需改动（既有复盘回链即原回执，无第二确认）。 |

## 2. 合同与并发语义（按 4b69614 源码）

- 只读：新组件渲染不发起任何业务写；`primaryAction` 仅 `#mission-question`/`[data-mission-approval-id]`/`#mission-error-block`/`#mission-results` 定位或 `onReload`（只重新 GET readback），无 fetch/POST。
- 时间：`observations.readAt` 标“读取于”；`lastSuccessfulAt`/`lastFailedAt`/`lastNoNewInformationAt` 分开；刷新只推进读取时间；`NOT_OBSERVED`/`FAILED_LAST` 不显示“无变化”；用户暂停、预算、模型格式错误不写成观察失败。
- 并发：`snapshot.consistency=VERSION_ADVANCED` 显示 `role=alert`“读取期间版本已推进，提交前必须重新核对”，主操作改“重新读取”；`RETRIED` 说明已重读采用同一快照；读回 409 `WORK_PACKET_AUTHORITY_CHANGED` 保留上次结果、提示重新核对且“不会自动沿用旧资格”，401/403/404 清空私有读回；草稿/请求身份仍在原组件，不由读回重绘破坏。
- 旧后端：缺整个 `workPacket` 时只显示“当前摘要暂未提供（旧服务或构建失败）…不据此推断成功或无变化”，并用 `readState` 只读展示原状态；缺 `workState` 更旧响应有防御（`5b89ecf`）；缺 `currentUse/availability` 显示“资格未知/未应用策略”，不推断允许；金额/累计用量 `null` 显示未知，不补 0。
- 不越权：`requires`、owner/项目/版本/来源/权限/租约/预算/幂等仍由原 command/continuation/adoption/Action 服务端提交时复查；前端禁用不作安全结论。

## 3. 验证（实际命令与退出码，候选 2d61578）

| 检查 | 命令 | 退出码 | 结果 |
|---|---|---|---|
| 全仓类型 | `npm.cmd exec tsc -- --noEmit` | 0 | 无诊断（生产构建前后各跑一次，均 0） |
| Track C 新增测试 | `npm.cmd test -- tests/finalCWorkPacket.test.ts tests/finalCBasisEvidence.test.ts tests/finalCResultsReceipts.test.ts tests/finalCIntakeNextStep.test.ts tests/finalCReadbackRecovery.test.ts` | 0 | 5 files / **49 tests passed** |
| 受影响既有回归 | `npm.cmd test -- tests/missionPanel.test.ts tests/missionReadbackPanel.test.ts tests/missionContinuationPanel.test.ts tests/missionArtifactAdoptionPanel.test.ts tests/focusUiQuality.test.ts tests/agentUxControls.test.ts tests/intakeOriginalPages.test.ts tests/projectStartGuide.test.ts tests/projectNavigation.test.ts tests/r4PresentationClient.test.ts` | 0 | 10 files / **58 tests passed** |
| 定向 lint | `npm.cmd exec eslint -- <8 个产品文件 + 5 个测试文件>` | 0 | 无 error/warning |
| 全仓 lint | `npm.cmd run lint` | **1** | 1 error + 23 warnings，**全部位于本轮未改文件**（`scripts/final-a/probe-fs-a07-concurrency.ts` 的 `prefer-const` 自 4b69614/A 提交 f267aec 起原样存在；其余为既有 warning）；C 改动文件无 lint 问题 |
| 生产构建 | `npm.cmd run build` | 0 | `✓ Compiled successfully in 30.7s`；`Generating static pages (43/43) in 3.7s`；日志 `logs/next-build.log` |
| 隔离库种子 | `npm.cmd exec -- tsx scripts/final-c/seed-web-fixture.ts` | 0 | 1 用户 / 2 项目 / 10 Mission / 15 事件 / 10 步骤 / 2 审批 / 2 草稿 / 1 回执 / 1 行动，仅隔离库 |
| 读回合同审计 | `npm.cmd exec -- tsx scripts/final-c/inspect-fixture.ts` | 0 | **148/148 PASS**：四问/主操作/currentUse+revisionAvailability/回执/旧问题旧审批/读取无副作用 |
| 浏览器端到端 | `node scripts/final-c/capture-web-evidence.mjs --base-url http://127.0.0.1:34112 --label final` | 0 | **68 checks / 68 PASS / 0 FAIL / 0 NOT_RUN**，18/18 用例，`manifest.exitCode=0` |

> 说明：全量 Vitest、完整 E2E、hvigor/HAP、设备与真实模型/Worker/自然日不在本 Track 资源槽内执行，见第 7 节；未用历史 PASS 签新候选。

## 4. 证据目录与内容

`evidence/final-c/20261103/`：

- `manifest.json`：候选 SHA/dirty、环境、fixture 身份、逐用例 checks、请求审计分类、截图清单、构建、限制、`exitCode=0`。
- `notes.md`：18 用例逐条说明、请求审计、实际回执身份、证据方法与数据来源标注、4 轮迭代记录（attempt1-4 与历史失败均保留，不删不美化）。
- `fixture-identity.json`、`fixture-readback-audit.json`（隔离库状态与真实 readback 审计）。
- `logs/`：seed/读回审计/开发服务器/逐用例请求审计/capture 日志/`next-build.log`/各轮 manifest；`logs/iteration-*` 与 `screenshots/history/` 保留旧迭代。
- `screenshots/normal/`（20 张）：Focus 与 Mission 四问/依据/结果，1280 与 390、light 与 dark；`basis-suppressed-item-1280-light.png` 同时可见“当前使用资格=当前许可已被撤回 / 修订状态=原修订匹配”；`results-receipts-*` 显示分类与 Action/resultCardId 链接；`keyboard-motion-1280-light.png` 覆盖 Tab/焦点返回与减弱动效。
- `screenshots/abnormal/`（16 张）：旧后端缺包、VERSION_ADVANCED、409、401/403/404 清缓存、停止在途、取消、UNKNOWN+终态、失败、旧问题、旧审批、长文案（1280/390）。
- 所有应展示工作包的截图均在 `[data-mission-primary-action]` 与“做到哪”可见后拍摄；reload 切换主题后重新等待，不在加载态截图。

**数据来源必须区分**：`REAL_ISOLATED_DATABASE`（真实隔离库种子，真实服务读回）、`INTERCEPTED_A2_SAMPLE`（旧后端缺包用 A2 真实序列化样本回填 readback）、`REAL_RESPONSE_MUTATED`/`INTERCEPTED_RESPONSE`（VERSION_ADVANCED、409、401/403/404 为截获变体，不是真实并发/权限变化）。页面其它区域仍显示未截获的 `/api/missions/:id` 原详情真实事实。

## 5. 实际回执身份（页面实拍与 fixture 一致）

- 主项目：`cmw0f3qg90001rk8ovncx1f99`；本地隔离账号 `final-c-reviewer`（仅隔离库，非真实用户）。
- 主线原操作：`POST /api/missions/cmw0f3qgq0005rk8oxiheeivm/input`，`requestId=febe0fd8-087e-4b33-80a0-e9eeee1604cd`，`questionId=cmw0f3qha0008rk8ox90vydxu`，HTTP 202，mission → READY v2；仅写隔离库。
- 结果回执：`outputId=cmw0f3qj7000srk8oacp6tqxb`(rev1)、`receiptId=cmw0f3qjl000yrk8o7wa57pet`、`artifactId=cmw0f3qjj000xrk8o3rahnqhs`、`actionId=cmw0f3qj4000rrk8ond429bwc`、`resultCardId=cmw0f3qj1000qrk8o39vb8plu`；页面链接 `/knowledge#card-…`、`/actions#action-…`、`/generate?artifact=…&type=weekly_report` 与身份一致。
- 请求审计：`EXPECTED_TEST_WRITE=1`（主线回答原问题，仅隔离库）；`UNEXPECTED_C_INTERACTION_WRITE=0`；外部域请求 0；provider=mock；`PRE_EXISTING_PAGE_BEHAVIOR=10`（GoalQuestion 挂载与 Focus 锚点同步，属既有页面行为，非本轮新增，已单列并引用源码依据）。

## 6. 兼容、回滚与集成

- 兼容：旧后端缺 `workPacket`/`readAt`/`observation`/`workState` 均有降级路径；本客户端只新增消费，服务端/ArkTS/DTO 零改动；无 schema/迁移/依赖变化；暗色沿用现有 CSS 变量，390 单列、无横向溢出检查通过。
- 回滚：按提交粒度独立回退即可，互不牵连——
  - 只回退视觉/工作包：`git revert 7897156 50b4213 21cb961`（保留 409/旧服务防御与结果分类）；
  - 回退依据/纠正：`git revert 01f7ce8`；
  - 回退结果/Intake：`git revert c0ca241 1446401`；
  - 回退结构脚手架须三者都回退（`e3b2176` 为拆分前置）。
  回退不涉及库、不 seed、不丢原业务对象/回执/用户草稿；读回只 GET，回滚后原详情继续可用。
- 集成建议：本 Track 只改 Web 消费方；主控按 A 合同→C 消费顺序合入；D（ArkTS）与 E（独立验收）应各自复跑并独立记账，不因本回执自动签收。

## 7. 剩余限制与未验项（不得当作通过）

1. 全量 Vitest、完整 E2E、hvigor/HAP、签名安装与真机/模拟器复查：NOT_RUN（资源队列归集成/E）；本回执只覆盖受影响定向 107 项（49+58）与浏览器 68 检查。
2. 真实模型质量、真实 Worker、自然日、陌生用户试用：NOT_RUN；mock 环境，浏览器无法证明服务端→provider 调用数。
3. 旧后端缺包、VERSION_ADVANCED、409/401/403/404 为截获/注入变体，不是真实旧服务、真实并发或真实权限撤销。
4. 全仓 lint 仍为 exit 1，唯一 error 是 A 提交 `scripts/final-a/probe-fs-a07-concurrency.ts` 的既有 `prefer-const`（4b69614 起原样），非本轮引入；本轮未改该文件以守边界，建议由 A 或主控统一清理。
5. 合同缺口（交 A/主控裁决，客户端未编造）：`ActionItemData`/prisma `ActionItem` 无 `missionId`，结果回执只能回链原 Action/复盘卡，无法从 Action 反向定位原委托；`AgentMemoryPanel` 摘要缺判断级来源版本/当前许可字段；既有 `GoalQuestion`/Focus 同步会在读取页发既有 POST（INFO_RISK，非本轮新增）。
6. 个别异常态截图可能含 dev Turbopack “Compiling…” 指示器（dev-only，不是产品 UI）；正式构建已通过。
7. 未做完整无障碍认证；键盘/焦点/减弱动效为定向浏览器检查，不宣称 WCAG 全项达标。

## 8. 复现入口

```powershell
Set-Location D:\Projects\hongmen-final-c-workspace-ux
git rev-parse HEAD   # 2d61578dd001cd6c3f556f546ca4bd6c5d24ae83
npm.cmd exec tsc -- --noEmit
npm.cmd test -- tests/finalCWorkPacket.test.ts tests/finalCBasisEvidence.test.ts tests/finalCResultsReceipts.test.ts tests/finalCIntakeNextStep.test.ts tests/finalCReadbackRecovery.test.ts
npm.cmd run build
# 证据（隔离库/mock，端口 34112；先确认无占用）
npm.cmd exec -- tsx scripts/final-c/seed-web-fixture.ts
npm.cmd exec -- tsx scripts/final-c/inspect-fixture.ts
& .\tmp\final-preparation\Start-Track.ps1   # 另开终端
node scripts/final-c/capture-web-evidence.mjs --base-url http://127.0.0.1:34112 --label final
```

本回执与 `manifest.json`/`notes.md` 是候选 `2d61578` 的实际证据；不代表最终放行。
