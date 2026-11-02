# S2 独立审查与合并裁决（2026-11-02）

本轮是独立审查，不修改业务代码、不合并、不 push、不部署。原实现者的实施记录作为待核查主张，所有结论以本轮在审查树内的源码阅读、负例复现和实跑检查为依据。

## 0. 冻结的审查对象

| 项 | 实际值 |
|---|---|
| 主目录 / 主分支 | `D:/Projects/hongmen`，`master` = `aea257c46df4656958198f903c18868bf7a819dc` |
| 候选分支 | `codex/s2-product-enhancements`，HEAD = `d51adb7c0fc670ece8cb0e6652485cf512463b9b` |
| merge-base | `aea257c`（= master HEAD，候选比 master 多 24 个提交、少 0 个） |
| 审查树 | `D:/Projects/hongmen-s2-audit`，分支 `codex/s2-independent-audit`，从 `d51adb7` 创建 |
| 差异规模 | `aea257c..d51adb7` 350 个文件、+39,302 / −742；其中业务文件 137 个（docs/evidence/planning 之外） |
| 审查树改动 | 只新增 `tests/auditS2CallCoverageWindow.test.ts` 与 `evidence/s2-independent-audit/`；未改业务文件、未改签名配置 |

提交链分三段（全部未进入 master）：

- S0：`5d3ad3f` 依赖、`784d99a` 权限/隐私/运行状态、`6f559e8` 鸿蒙快速记录栅栏、`29c243a` 变更边界重验会话、`b9c82da` Worker 队列与清理退避、`8da4f05` 原生会话缓存与孤儿文件，文档 `4b2cbd3`。
- S1：`42d934e` 项目前材料建项、`05ea5c3` 历史/来源/责任测试、`5f736c2` 手机接回原问题，文档 `24e58e9`；独立修复 `63e19bb`、`fd4f754`，文档 `afd37e5`、`24004cf`。
- S2：`6a90423` 用量读回与鸿蒙字段修复（文档 `a9ab78c`）、`601f486` 材料覆盖、`cc958be` 调用覆盖、`88383e1` 边界与平台探针（文档 `a0d1bf1`）、`aaf85f6` 撤回同意文案与负例（文档 `d51adb7`）。

## 1. 三个独立裁决

| 裁决 | 结论 | 条件 |
|---|---|---|
| `CODE_MERGE_READY` | **CONDITIONAL** | 先修 P1-1、P1-2（或用一行改动在鸿蒙隐藏该面板）；修完重跑 `tests/s2CallCoverage.test.ts`、`tests/s2IntakeCoverage.test.ts` 与鸿蒙 `S2Coverage` 合同测试（补“真实 JSON 的 `null`”用例）。不因真实模型、真机、自然日或小艺登记未做而阻断合并 |
| `HARMONY_DEVICE_READY` | **NO** | 无签名 HAP：`entry-default-unsigned.hap` 安装被拒 `9568332 install sign info inconsistent`（本轮在用户 DevEco 会话中再次出现，见 §7）。安装、冷启动、登录连通、项目前覆盖页、委托读回均无设备证据 |
| `PRODUCTION_READY` | **NO** | 无真实模型质量/费用验收、无自然日责任轨、无独立用户质量、真实库迁移只做过旧库副本、无部署授权；分享/Intents 未注册；生产依赖 audit 为 0 但开发依赖仍有 16 个 moderate（minimatch） |

## 2. 发现

### P0

无。本轮没有发现新的越权、隐私泄漏、并发破坏或迁移风险；S0 的权限/隐私/删除/外链修复与 S1 的 owner/会话/修订/源 hash/同意/lease/UNKNOWN 栅栏在 S2 增量中未被削弱（§4）。

### P1-1 「可核对调用」把“没检查到”写成 0 次，并同时断言用量一致

- 位置：`lib/mission/readback.ts:137-145`（先按 `projectId` 取最近 20 条 `runType="CHAT"`，再在 `lib/mission/callCoverage.ts:35` 按 `trace.missionId` 过滤）。
- 触发：同一项目里存在 ≥20 条比本委托回执更新的 CHAT `AgentRun`，且这些行 `trace` 里没有 `missionId`。仓库内确实有这样写的生产代码：`lib/decision/reviewPersistence.ts:163`（决策复核，`projectId` + `purpose/reviewProposalId`）、`lib/decision/boundedReview.ts:65`（动态计划采纳）。
- 实际后果：本委托的模型调用全部落在读取窗口外，读回同时输出两组互相矛盾的数：`resourceUsage.summary = 模型 2 次`，`callCoverage.summary = 可核对调用：模型 0 次（成功 0 / 失败 0）`，并附 `模型调用的用量记录与调用次数一致。`（`lib/mission/callCoverage.ts:62`）。用户看到的是“这次委托没有模型调用”，而不是“没有检查到”。
- 复现：`tests/auditS2CallCoverageWindow.test.ts`（本轮新增，仅存在于审查树）。造 2 条带 `missionId` 的回执 + 23 条同项目、更新、无 `missionId` 的 CHAT 回执，`readMissionBack` 返回 `models.total=0`，断言期望 2 失败。日志 `evidence/s2-independent-audit/20261102/logs/audit-call-window.log`：

  ```
  [audit] resourceUsage.summary = 模型 2 次 · 工具 0 次
  [audit] callCoverage.summary  = 可核对调用：模型 0 次（成功 0 / 失败 0）· 工具 0 次（成功 0 / 失败 0）
  [audit] callCoverage.notes    = ["模型调用的用量记录与调用次数一致。", ...]
  [audit] inspected             = {"agentRuns":20,"steps":0,"limit":20,"truncated":true}
  ```

- 与既有声明的偏差：`S2_IMPLEMENTATION_2026-11-02.md` 只承诺“达到上限时 `truncated=true` 并明说计数是下界”。实现确实输出了下界提示，但同时给出“0 次”与“用量记录一致”的肯定句；这与 AGENTS“缺失、未知不填零、UNKNOWN 不作为 False”的规则冲突，也是本增量存在的主要理由（让用户能核对到底发生了什么）。
- 受影响 Gate：G07/G08/G09（结果与成本）、S2「结果与成本」包验收。
- 最小修复（任选其一，均不动 schema 语义）：
  1. 把窗口查询改成按委托取数（`AgentMissionStep.agentRunId` 关联，或对 `trace.missionId` 做 `json_extract` 过滤后再 `take`）；
  2. 或在 `missionCallCoverageOf` 中区分“检查到 0 条”与“窗口未覆盖本委托”，`runs.length === 0 && inspected.truncated` 时输出“未检查到本委托的调用回执”，且不输出“用量记录一致”。

### P1-2 鸿蒙把 `lastSentChars: null` 显示成“已送入 null 字”

- 位置：服务端无轮次时下发 `null`（`lib/intake/coverage.ts:130`），鸿蒙模型用 `-1` 当“从未派发”哨兵（`harmonyos/entry/src/main/ets/models/ProjectIntake.ets:104`），文案函数只判断 `< 0` / `=== 0`（`ProjectIntake.ets:306-309`）。`ApiClient` 用 `JSON.parse(result) as T`（`harmonyos/entry/src/main/ets/services/ApiClient.ets:70`），得到的是普通对象，类字段默认值不参与，`null` 原样保留。
- 触发：草稿已加材料、已同意云处理、尚未点击“理解” —— 这是项目前流程最常见的第一屏。
- 实际后果：`null < 0` 为 false、`null === 0` 为 false，落到末尾分支输出 `已送入 null 字`。用户会以为模型已经读过材料（与 Web 端 `components/IntakeCoveragePanel.tsx:19` 正确区分 `null` 的行为不一致）。
- 复现路径：不需要设备即可判断（JSON 语义），但需要补一个“真实 JSON”合同测试；现有 `harmonyos/entry/src/test/S2Coverage.test.ets` 全部用 `new IntakeCoverageItem()` 手工赋 `-1`，因此测不出该缺陷。
- 受影响 Gate：鸿蒙验收、S2「材料覆盖」跨端一致性。
- 最小修复：在模型层把 `lastSentChars` 声明为 `number | null` 并在文案函数首行判断 `== null`；或在详情映射处把 `null → -1`（与现有哨兵一致），并补一条从 JSON 文本解析的合同测试。

### P2-1 旧后端缺 `coverage` 字段会让鸿蒙项目前页报错

`ProjectIntake.ets:271` 的 `CoverageBlock()` 直接读 `this.preview.coverage.current.items`、`.note`、`.consentGranted`，没有像 `MissionReadbackView.ets:125` 那样先判 `!== undefined`。旧服务端不返回该字段时 `preview.coverage` 为 `undefined`，ArkTS 取值会抛错，整个预览页不可用。跨端滚动升级窗口内会命中；本轮没有真机，未实际触发。

### P2-2 原文分页越界偏移返回最后一个字符

`lib/services/projectIntakeService.ts:693` 把 `offset` 钳到 `text.length - 1`，`offset` 超过文末时返回最后 1 个字并 `hasMore=false`。不会泄漏，但客户端算错偏移时得到的是“看似读完”的错页。

### P2-3 分页按 UTF-16 码元切分

`lib/intake/coverage.ts:100`、`lib/services/projectIntakeService.ts:696` 都用 `String.prototype.slice`。字符上限、`totalChars`、`hasMore` 全部按码元计，单个 emoji 落在页边界时会被切成孤立代理项。影响显示与计数一致性，不影响容量判定方向。

### P2-4 非 `SUCCESS` 的回执一律计为“失败”

`lib/mission/callCoverage.ts:39` `status !== "SUCCESS"` 即算失败。`AgentRunStatus` 含 `PARTIAL`/`FALLBACK`（`prisma/schema.prisma`），降级与部分成功会被展示成失败，且 `failedCodes` 只取 `fallbackReason`。当前项目内 CHAT 回执很少落在 `PARTIAL`/`FALLBACK`（CAPTURE/ARTIFACT 回执被 `runType` 过滤掉），属潜在口径问题；建议把“成功/降级/失败/部分”分成独立计数。

### P2-5 鸿蒙注释与实现不一致

`ProjectIntake.ets:100` 的注释写“草稿内容已变（修订前移）时放弃旧的原文页”，实现只检查材料是否还存在；材料正文被替换（同一 `id`、`revision` 前移）时旧页会保留。属注释与实现不一致 + 轻微陈旧显示。

### 观察（不计缺陷）

- `listProjectDeletions`（`lib/services/projectDeletionService.ts:22-24`）只列 `PARTIAL` 或 24 小时内的回执，已完成且超过一天的清除记录不再出现在列表；`projectDeletions/:id` 仍可查，不算丢失证据。
- 桌面 1280 截图（`evidence/s2-resource-readback/20261102/web-1280.png`）是元素截图，上边缘被固定导航遮住；这属于截图定位问题，不是用户内容不可达，但完整桌面整页布局本轮未独立验收（见 §6）。

## 3. 本轮独立验证（审查树 `d51adb7`）

环境：Node 24、`npm ci` 按 `package-lock.json` 重装依赖、`prisma generate` 指向审查树自己的 `lib/generated/prisma`；所有测试用各自临时库（`tests/helpers/continuityDatabase`），未连接真实库、未复制 `.env`、未发付费模型调用。命令与退出码见 `evidence/s2-independent-audit/20261102/ACCEPTANCE.json`。

| 检查 | 结果 | 与既有声明的对照 |
|---|---|---|
| `npm.cmd exec tsc -- --noEmit` | 退出 0 | 与“类型退出 0”一致 |
| `npm.cmd run lint` | 退出 0，9 条 warning | 与“0 error / 9 warning（既有）”一致 |
| S2 定向 `s2IntakeCoverage` 9 + `s2CallCoverage` 4 + `s2AdaptivePreference` 3 | 16 项通过 | 实施记录写 `s2IntakeCoverage` 8 项；实际 9 项（`aaf85f6` 补的撤回用例），文档未同步 |
| S1 保护回归 `s1IndependentReview` 21 + `projectIntake` 8 | 29 项通过 | 说明 S2 增量未削弱 S1 栅栏 |
| 偏好/注意力 `pm4EvolutionResponsibility` 5 + `ux3AttentionContinuity` 3 | 8 项通过 | 支持“偏好保存在既有 PM 链路、S2 未新建偏好系统”的说法 |
| S0 安全回归 `s0MarkdownNetwork` + `s0ProjectDeletion` + `s0CaptureIsolation` + `s0CapabilityAndCreation` | 20 项通过 | 含真实 Chromium preload canary 断言 |
| `npm.cmd audit --omit=dev` | 0 漏洞（301 个生产依赖） | 与 G21“生产 audit 为 0”一致 |
| `npm.cmd audit`（全量） | 16 个 moderate，全部经 minimatch `GHSA-g3hv-75wg-m249`（影响范围 `<11.0.1`），仅 lint 工具链 | 与记录一致；**无兼容修复路径**：eslint 9 与 `@typescript-eslint` 分别锁定 `minimatch ^3.1.5` / `^10.2.2`，升到 11 会破坏调用方；`npm` 给出的 “fix” 是降级 eslint 4。本仓库 lint glob 来自受控工作树，不接受外部输入，维持风险接受合理 |
| `npm.cmd run build`（生产构建） | 第 1 次 `FATAL ERROR: Zone Allocation failed`，退出 134；空闲后第 2 次退出 0（43 页静态生成） | **复现了作者记录的 OOM**（同一源码、内存压力下失败、重跑通过），并证明 HEAD 能构建 |
| `npm.cmd run harmony:test` | ArkTS 单测目标编译通过（`UnitTestArkTS` 18 s），执行阶段停在宿主 previewer（`VirtualScreenImpl`/`RichPreviewer`，`LocalSocket::WriteData failed: 6`）超过 8 分钟无进展，已终止 | 未复现 105 项；作者日志 `logs/s2-harmony-final.log` 的 105 项仍然有效但属旧证据 |
| 独立负例 `tests/auditS2CallCoverageWindow.test.ts` | 1 项按预期失败（P1-1） | 新增证据 |

审查分支上故意保留了一个失败用例（`tests/auditS2CallCoverageWindow.test.ts`），它复现 P1-1，修好后应转绿。**该分支不用于合并**，合并走 §8 的集成候选。

旧证据没有拼成“最终 HEAD 全跑过”：

- 全量 202 文件 / 1544 项（`logs/s2-full-tests-final.log`）起始于 18:52:04，对应源码 `88383e1`（18:51:46），**不覆盖** `aaf85f6`（19:13:15）。
- 全量 E2E（setup 1 + 业务 36、2 跳过）起始于 11:05Z，源码早于 `a0d1bf1`；`aaf85f6` 之后只有 `e2e/project-intake.spec.ts` 定向重跑。
- 鸿蒙 105 项日志完成于 19:09:50，同样早于 `aaf85f6`。
- `aaf85f6` 只改 `lib/intake/coverage.ts` 与一个测试；本轮已在该提交之后实跑 `s2IntakeCoverage`（9 项）、类型、lint、生产构建，可视为覆盖了该提交的增量，但不等于“全量在新提交上重跑”。

## 4. 整条提交链的审查覆盖

| 段 | 提交 | 本轮审查方式 | 结论 |
|---|---|---|---|
| S0-G21 | `5d3ad3f` | 读 `package.json`/lock、实跑两份 audit、核对 minimatch 引入链 | 生产 0 漏洞；开发 16 moderate 无兼容修复，风险接受成立 |
| S0-G10 | `784d99a`/`6f559e8`/`8da4f05` | 读 `lib/client/captureDrafts.ts`、鸿蒙快速记录栅栏、实跑 `s0CaptureIsolation` | 草稿按 owner+project+scope 分键、换号清理、写入门禁；未见串号路径 |
| S0-G12/G13 | `784d99a`/`29c243a`/`b9c82da` | 读 `lib/services/projectDeletionService.ts`、`app/api/projects/[id]/route.ts`、`app/api/project-deletions/*`、实跑 `s0ProjectDeletion` | OWNER 校验、`X-Project-Delete-Confirmation` + `If-Match` 版本核对、先撤消费资格再清文件、失败保留清单与租约退避，未见可绕过路径 |
| S0-G15 | `784d99a` | 读 `components/MarkdownRenderer.tsx`、实跑 `s0MarkdownNetwork`（真实 Chromium canary） | 仅同项目鉴权附件图可自动加载，远程/协议相对/data 图被替换为文本 |
| S0-G02/03/04 | `784d99a` | 实跑 `s0CapabilityAndCreation`，读 `lib/auth/cloudCapability.ts` 与建项事务 | 并发同请求唯一项目 + 同事务回执；规则/mock 不升级为实模成功 |
| S1 栅栏 | `63e19bb`/`fd4f754` | 读 `lib/auth/cloudQuota.ts`、`lib/services/projectIntakeService.ts` 的 `publishUnderstanding`/`withDraftLock`/`assertOpen`；实跑 `s1IndependentReview`+`projectIntake` | dispatch 不再驱逐（`.slice(-8)` 已移除）、结算在事务内且 SETTLED 不被降级、指引 epoch 在预占与发布处双检、撤回同意递增修订阻断在途结果 |
| S2 结果/用量 | `6a90423` | 读 `lib/mission/resourceUsage.ts`、`components/MissionReadback.tsx`、鸿蒙 `MissionReadback.ets`/`MissionReadbackView.ets`、`tests/s2ResourceReadback` | `reviewProgress.classes` 修复成立（鸿蒙不再读 `divisions`）；用量未知保持 `null`，`0` 保留；读回不写回预算 |
| S2 调用覆盖 | `cc958be` | 读 `lib/mission/callCoverage.ts` + `readback.ts`，新增负例 | **P1-1**；模型/工具分身份计数、费用 UNPRICED 的方向正确 |
| S2 材料覆盖 | `601f486`/`aaf85f6` | 读 `lib/intake/coverage.ts`、`projectIntakeService.ts` 的覆盖轮次与原文分页、`IntakeCoveragePanel`、鸿蒙页面/model；实跑 9 项 | 计划/实际送入一致（用注入模型收到的正文字符反算）、材料变更 `stale`、撤回后“保留事实但不再送入”；**P1-2、P2-1/2/3/5** |
| S2 偏好/平台探针 | `88383e1` | 读 `tests/s2AdaptivePreference.test.ts`、`scripts/probe-platform-capabilities.ts`、`evidence/s2-platform-probe/*` | “少问我/安静一点”不成为生效指令、不改预算与工具；平台探针只读、结论 NOT_RUN 站得住 |

未覆盖：`S0-E` 的 worker presence / 版本指纹（只看文档与源码片段，未跑进程探针）；`S1` 的同步 lease 与 Capture/Attachment 回执全链路（只跑既有回归）；`lib/experience/*` 与失败改进管线（本轮未进入）。

## 5. S2 原五包逐项状态

| 原增强包 | 状态 | 说明 |
|---|---|---|
| 系统分享 FVT04/G11 | **工程缺失** | `module.json5` 无 ShareExtension、无 `sendData`/`system.share` skill；SDK 只有 d.ts 声明。未实现入口，无设备验收 |
| 小艺/Intents G19 | **工程缺失** | 只有 `@ohos.app.ability.insightIntent.d.ts`；无注册、无平台登记。mock adapter 不能当设备能力 |
| Personal/Adaptive FVT03 | **已实现（复用既有能力）** | S2 只加边界回归（`s2AdaptivePreference` 3 项）；保存/局部覆盖/到期/撤回/跨项目由 PM1～4 与 Attention 承担，本轮实跑 `pm4` 5 项 + `ux3AttentionContinuity` 3 项通过。S2 未新增偏好系统，也未新增端到端旅程 |
| 结果与成本 FVT02/05、G07～09 | **部分实现** | 用量读回（已记录/未知/null/0）与调用覆盖已实现；费用 `UNPRICED`、无费率/币种/账单；跨入口任务成本未实现；调用覆盖有 P1-1 |
| 失败改进 FVT07/PM5 | **未开始（平台/用户条件）** | 缺跨用户样本同意与人工脱敏，未导出真实 trace；不宣称真实用户价值。不属工程缺失 |

## 6. 未做与待验证

1. S2 全量 202/1544、全量 E2E 36+1 未独立重跑（耗时与内存压力；本轮用 11 个文件 73 项定向覆盖关键增量）。
2. 鸿蒙 105 项未独立跑通（宿主 previewer 卡住）；真机/模拟器安装、冷启动、登录、覆盖页、读回均未验证。
3. 1280 桌面整页与固定导航遮挡：证据是元素截图，属截图定位；完整桌面布局待重拍后再判。
4. 真实模型质量/费用、自然日责任轨、独立用户质量——按裁决不计通过。
5. 小艺平台登记、系统分享真实投递——条件未具备。

## 7. 设备/签名状态（仅记录，不做处理）

- S2 工程 `harmonyos/build-profile.json5`：`"signingConfigs": []`，但 `products[0].signingConfig = "default"` → 构建产出 `entry-default-unsigned.hap`。
- 模拟器 `127.0.0.1:5555` 上已安装 `xyz.luojiatutor.projectmemo`，`appProvisionType: debug`、`appIdentifier: 6918743533450958047`。
- 用 unsigned 包覆盖安装被拒：`code:9568332 error: install sign info inconsistent`（用户 DevEco 日志与本轮 `hdc` 状态互相印证；模拟器当前 `Connected`）。
- 恢复条件：在 DevEco `Project Structure → Signing Configs` 为 S2 工程启用签名，并**核对签名身份与已安装包一致**。审查期间观察到 S2 工程已写入一套新的自动签名材料（`default_harmonyos_*.{p12,cer,p7b}`，与主工程那套的文件名哈希不同）；不同密钥/描述文件会得到不同 appIdentifier，覆盖安装仍可能被 `9568332` 拒绝。若身份不一致，应改指向主工程正在使用的那套材料，或接受一次卸载重装（会清掉模拟器上该应用数据，需用户同意）。不要用卸载有数据应用的方式掩盖问题。
- 本轮没有读取、输出或复制任何签名私钥/密码，也没有改动主目录或 S2 目录的签名配置。

## 8. 合并方案（本轮不执行）

1. **保护主目录**：`D:/Projects/hongmen` 的 `harmonyos/build-profile.json5`、`next-env.d.ts`、`tsconfig.json` 保持 dirty 原状；不 stash、不 checkout、不提交、不复制签名材料到分支。
2. **建集成候选**：从当前 master `aea257c` 建独立 worktree（例如 `D:/Projects/hongmen-s2-merge`，分支 `codex/s2-integration`），不要复用实现者或用户的树。
3. **合入**：在集成候选里合入 `d51adb7` 的 24 个提交（`git merge --no-ff d51adb7`）。merge-base 就是 master HEAD，预期无冲突；若 master 已前进，重新核对差异与影响，不沿用本轮签收。
4. **先修后测**：在集成候选上先落 P1-1、P1-2（或先在鸿蒙隐藏覆盖块），再按顺序跑：`npm ci` → `prisma generate` → `tsc --noEmit` → `lint` → `npm test -- tests/s2*.test.ts tests/s1IndependentReview.test.ts tests/projectIntake.test.ts tests/pm4*.test.ts tests/s0*.test.ts` → 全量 `npm test` → `npm run build`（内存空闲时）→ `npm run test:e2e` → `npm run harmony:test` → `npm run harmony:build`。
5. **鸿蒙补一条真实 JSON 合同测试**：直接解析含 `"lastSentChars": null` 的响应文本，断言文案为“待送入”，防止 P1-2 复发。
6. **边界**：修完只重跑受影响的检查；不 push、不部署、不迁移真实库。合并动作需用户明确指令。

## 9. 与既有报告的分歧

1. `S2_IMPLEMENTATION_2026-11-02.md` 把调用覆盖记为“读取上限 20、达到上限即提示下界”，实现符合描述；但**没有覆盖“窗口被同项目其它回执占满、本委托回执为 0”**这一情况，且此时仍输出“用量记录与调用次数一致”。这是本轮新增的 P1-1。
2. 实施记录写 `tests/s2IntakeCoverage.test.ts` 8 项，实际 9 项（`aaf85f6` 增补撤回用例后未同步文档）。属文档滞后。
3. 鸿蒙 `S2Coverage` 合同测试只用手工构造对象，未覆盖服务端真实 JSON 的 `null`，因此 P1-2 未被发现；测试通过不等于端到端正确。
4. 构建 OOM 记录属实：本轮在同机同源码复现了 `Zone Allocation failed`，空闲重跑通过。不把历史失败当当前必然失败，也不把重跑通过写成“从未失败”。
