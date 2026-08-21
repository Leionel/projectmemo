# ProjectMemo 2.0 实现记录

> 依据 `ProjectMemo_2.0_EXECUTION_PLAN.md` 第 7 节执行纪律维护。
> 所有偏离计划的地方记录“计划要求、代码实际、采取方案、验证结果”。

---

## S00｜模拟器与外部能力一次性探针

**日期：** 2026-08-21
**执行人：** Claude Code（代理执行；需要人工账号/GUI 的项已标注）

### 探针记录

| # | 探针项 | 状态 | 证据 |
|---|---|---|---|
| 1 | DevEco 模拟器启动、`hdc list targets` 可见 | VERIFIED | 本机已部署 4 个 AVD：Pura 90（phone）、Mate X7（foldable）、MatePad Pro 13（tablet）、MateBook Pro（2in1），均为 HarmonyOS 6.1.1 / API 24（`%LOCALAPPDATA%\Huawei\Emulator\deployed\lists.json`）。CLI 启动方式：`Emulator.exe -start "Pura 90"`（`-m` 参数无效，会报 `Unknown option 'm'`）。`hdc list targets` 返回 `127.0.0.1:5555`。App 已安装并启动到模拟器。 |
| 2 | 调试签名 / DevEco Run 安装流程 | PARTIAL | `harmonyos/build-profile.json5` 中 `signingConfigs: []` 为空，构建提示 `No signingConfigs profile is configured`，产出 unsigned HAP。自动签名需要 DevEco GUI 登录华为开发者账号，无头环境无法完成。验证路径改为“unsigned HAP + `hdc install` 到模拟器”（实测成功）。未把任何证书/密钥写入仓库。 |
| 3 | `/chat/completions` 与 `/embeddings` 最小验证 | NOT AVAILABLE | `.env` 中 `LLM_MODE="mock"`，未配置 `LLM_API_KEY` / `LLM_BASE_URL`。无凭据无法发起真实调用，未伪造结果。需要负责人提供 OpenAI-compatible 端点与密钥后在 S03 前补测。 |
| 4 | 小艺开放平台 Agent/Skill 创建与调试权限 | NOT AVAILABLE（需人工） | 需要浏览器登录华为账号，代理无法执行。S08 仍为条件切片。 |
| 5 | 复赛 Backend 运行位置决策 | DECIDED | 当前阶段固定本机运行（模拟器经 `10.0.2.2` 回环访问宿主）。公网 HTTPS 仅在 S08 小艺切片启用时再配置。 |
| 6 | 附件二进制存储决策 | DECIDED | 本地 Demo 使用仓库外目录（S05 实施）：环境变量 `ATTACHMENT_DIR` 指定，默认 `D:\Projects\projectmemo-storage\attachments`。无状态部署时切换对象存储，该切换点在 S05 保留为可配置项。 |

### 环境发现的机器级问题（重要）

**端口 3000-3100 段被本机安全软件拦截监听。** 原计划固定 `Constants.BASE_URL = http://10.0.2.2:3000`，但本机（Windows 11，装有三方安全软件）拒绝在该段绑定监听 socket（`listen EACCES` / `WSAEACCES`，netstat 显示端口空闲、无 HTTP.sys URLACL 保留、排除端口范围不含 3000）。实测 3005、3100 也失败，4000 及以上正常。

**采取方案：** BASE_URL 单一来源 `Constants.ets` 改为 `http://10.0.2.2:4000`，后端以 `next dev -p 4000` 运行。README 记录该环境差异与改回方法。这是环境适配，不是功能降级。

### STOP 条件对照

- DevEco 模拟器：可用（未触发阻塞）。
- 无真机：确认。Core Vision OCR、小艺系统入口、真机通知一律标记“未验证”。
- 无小艺平台权限：确认。只交付 Backend capability 与接入文档。
- Provider `/embeddings`：无 provider 可测，S04 启动前必须先补 S00-3 探针；不得用关键词冒充 semantic。
- 部署形态：已决定本机，允许进入附件存储设计（S05）。

---

## S01｜仓库可重复构建并产出可安装 HAP

**日期：** 2026-08-21

```text
Task              根构建排障 + 统一命令 + 鸿蒙契约测试 + 基线提交
Priority          P0（G0 前置）
Core Loop Impact  不触碰 Backend 主链；在鸿蒙侧抽取纯逻辑契约层并修复一个 App 崩溃
Files to Change   tsconfig.json、package.json、README.md、scripts/harmony-build.ts（新增）、
                  scripts/harmony-test.ts（新增）、
                  harmonyos/entry/src/main/ets/common/ApiContract.ets（新增）、
                  harmonyos/entry/src/main/ets/services/ApiClient.ets、
                  harmonyos/entry/src/main/ets/services/{Action,Intervention,Memory}Service.ets、
                  harmonyos/entry/src/main/ets/common/Constants.ets、
                  harmonyos/entry/src/test/{List.test.ets,ApiContract.test.ets}
API Changes       无（Backend API 未改动）
Data Migration    无
How to Verify     vitest 38 tests；next build；hvigor assembleHap；Hypium 单测；hdc install + 启动
Demo Impact       ActionBoard 崩溃修复；BASE_URL 端口 4000
Rollback          git revert 基线提交
```

### 执行结果

1. **tsconfig**：从根 TS/Next 范围排除 `harmonyos`、`.hvigor`、`.preview`、`.trae` → `next build` 退出码 0（修复了审计发现的根构建失败）。
2. **统一命令**：`harmony:backend`（`next dev`）、`harmony:build`（hvigor assembleHap + SHA-256 凭证）、`harmony:test`（Hypium 单测）。构建脚本自动设置 `DEVECO_SDK_HOME` 与 `JAVA_HOME`（DevEco 自带 jbr，`PackageHap` 阶段需要 JDK）。
3. **BASE_URL**：单一来源 `Constants.ets` → `10.0.2.2:4000`（端口环境适配，见 S00）。
4. **安装流程**：`hdc install -r <unsigned.hap>` 成功安装到模拟器（绝对路径会被 hdc 拼接错误，需用相对路径）；启动用 `hdc shell aa start -a EntryAbility -b com.example.projectmemo`。签名状态：PENDING（需 DevEco GUI 登录华为账号）。
5. **契约层与测试**：新建 `common/ApiContract.ets`（请求体构造、200/201/204 判定、错误映射、状态枚举），ApiClient 与三个 Service 复用。Hypium 本地单元测试 23/23 通过（覆盖请求体、序列化、成功码、错误映射回退、状态枚举）。

### 验证命令与结果

```powershell
# Backend 单测
node .\node_modules\vitest\vitest.mjs run
#   Test Files  7 passed (7)     Tests  38 passed (38)

# Next.js 生产构建
node .\node_modules\next\dist\bin\next build
#   退出码 0

# HarmonyOS 构建（统一命令，含 SHA-256 凭证）
npm.cmd run harmony:build
#   BUILD SUCCESSFUL
#   HAP: harmonyos\entry\build\default\outputs\default\entry-default-unsigned.hap
#   sha256: da50922e2c3b81d4fc7d93884facc98df3d9c8dc945c8534df2d1e887caadace

# HarmonyOS 本地单测（统一命令）
npm.cmd run harmony:test
#   Tests run: 23, Failure: 0, Error: 0, Pass: 23, Ignore: 0

# 安装与启动（模拟器）
hdc list targets                                        # 127.0.0.1:5555
hdc install -r harmonyos\entry\build\default\outputs\default\entry-default-unsigned.hap
hdc shell aa start -a EntryAbility -b com.example.projectmemo
```

### 基线提交

已创建独立基线提交，包含：后端不动，鸿蒙侧契约层/崩溃修复/测试/构建脚本/文档（见 git log）。

---

## S02｜HarmonyOS 模拟器在真实 Backend 完成 Demo C

**日期：** 2026-08-21

### 计划要求
不打开 Web UI，在 HarmonyOS App 中真实完成 Evaluate → Evidence → Accept → Action → DONE → Reflection → RESOLVED；Accept 重复点击不产生重复 Action；DONE 少于 5 字被拒绝；App 重启后数据仍在；3 分钟内完成；`scenario` 为空。

### 实际执行（DevEco 模拟器 + 本机 Backend `10.0.2.2:4000`）

全流程通过 `hdc shell uitest`（dumpLayout / uiInput）驱动真实 App UI：

1. **Evaluate**：进入种子项目 ProjectHome 时页面渲染自动触发 `evaluateProjectContext`，规则引擎生成非 simulated 介入（DEADLINE_NEAR、MATERIAL_GAP，`scenario` 为空）。
2. **Evidence**：点击"查看依据 →"进入 InterventionDetail，展示触发类型、evidence facts、建议行动。
3. **Accept**：点击"接受建议" → App 发送 `PATCH /interventions/:id {status:ACCEPTED}` → 创建 action `锁定最小可交付版本并列出提交清单`，介入状态 → ACCEPTED。
4. **Action → DONE → Reflection → RESOLVED**：进入 ActionBoard → 点击"完成" → 输入结果"已锁定最小可交付版本并核对完提交清单" → 提交 → Backend 事务内创建 reflection 卡片、行动 → DONE、介入 → RESOLVED。
5. **App 重启后**：卡片数 10→11、ActionBoard 显示"已完成（2）"及"复盘：已锁定..."链接，数据持久。

### S02 通过标准逐项核对

| 标准 | 结果 | 证据 |
|---|---|---|
| Evaluate → Evidence → Accept → Action → DONE → Reflection → RESOLVED 闭环 | PASS | 见上；DB 状态 DEADLINE_NEAR=RESOLVED、action=DONE、reflection 卡片生成 |
| `scenario` 为空 | PASS | 未注入任何 demo scenario |
| Accept 重复点击不产生重复 Action | PASS | 二次 PATCH accept 返回同一 action（后端幂等），actions 数量不增 |
| DONE 少于 5 字由 Backend 拒绝 | PASS | `PATCH {status:DONE, resultText:"完成"}` → HTTP 422 |
| App 重启后数据仍在 | PASS | force-stop + 重启后 Index 统计、ActionBoard 复盘均正确 |
| 数据库状态和 UI 状态一致 | PASS | 接受后 Index"进行中行动 0→1"；完成后"活跃提醒 2→1" |
| 3 分钟内完成闭环 | PASS | 单次闭环操作耗时 < 3 分钟（不含调试阶段） |
| 保存 Demo receipt | PASS | 见下 |

### Demo receipt

```text
模拟器:      Pura 90（phone，API 24，HarmonyOS 6.1.1，OpenHarmony-6.1.1.125，1320x2856，density 560）
HAP:         entry-default-unsigned.hap
HAP sha256:  da50922e2c3b81d4fc7d93884facc98df3d9c8dc945c8534df2d1e887caadace
项目:        人工智能创意赛 忆程 ProjectMemo 作品开发 (cmt0t5eh50000gk8odb1b2tqa)
介入:        cmt0t5emh000bgk8od0yja7u1 (DEADLINE_NEAR)
行动:        cmt2cnnn10001448oin8uaism (DONE)
复盘卡片:    ff76ce31-… (reflection)
开始/结束:   2026-08-21 约 10:40–11:10（本地时间）
截图:        .trae/pm_detail.jpeg / demo_done.jpeg 等（未提交到 Git）
后端:        本机 Next dev，端口 4000（端口 3000 被安全软件拦截，见 S00）
```

### 过程中发现并修复的 App 崩溃 Bug（重要）

**根因：** `ActionBoard.ets` 第 165 行 `action.resultCard.title` 在 `resultCard` 为 `null` 时崩溃（后端对无复盘的行动返回 `null`，而 ArkTS 下 `null !== undefined` 为真，原 `!== undefined` 检查挡不住 null）。打开 ActionBoard 渲染任意 TODO 行动即触发 JS 崩溃，App 退回桌面（`jscrash`，三份日志均同一行）。

**修复：** ActionBoard 的 `sourceIntervention`/`resultCard` 检查与 InterventionDetail 的 `description` 检查改为同时排除 `null` 与 `undefined`。修复后 ActionBoard 正常渲染（这是 Demo C 闭环在 App 内完成的前置条件）。

### 未解决风险

- HAP 无正式签名（`signingConfigs` 为空），模拟器安装 OK，真机安装/上架需要签名（需在 DevEco 登录华为账号，无法无头完成）。
- 真实 LLM / Embedding provider 未验证（无凭据，S03 前需补 S00-3 探针）。
- 真机能力（Core Vision OCR、小艺系统入口、真机通知）一律标记"未验证"。
- 模拟器 `snapshot_display` 在本机会返回滞后帧，UI 自动化以 `uitest dumpLayout` 为准（本机已知环境现象，不影响验收真实性，截图仅作辅助）。
