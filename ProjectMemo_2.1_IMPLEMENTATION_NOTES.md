# 忆程 ProjectMemo 2.1 实施笔记

日期：2026-08-27

## 结论

- W00：`VERIFIED`（本地可重复构建、测试与证据目录已固化）。
- W01 原生 UI：`PARTIAL`（静态审视、代码修复和离线回归完成；目标 AVD 运行矩阵被模拟器环境阻塞）。
- S05 Inbox：`PARTIAL`。
- S06 Deliverable Gap：`PARTIAL`（本地规则回归通过，App 操作矩阵未完成）。
- S07 Notification：`BLOCKED`（AVD 无法通过 hdc 连接）。
- S09：按用户要求未执行；W02 及后续工作包未在本轮提前实现。

## 本轮提交

- 代码批次：`248257a` — `fix: refine HarmonyOS UI states and controls`。
- 证据批次：本文件与 `evidence/2.1/` 的 W00/W01 记录，提交号以包含本文件的 Git 历史为准。
- 未纳入：用户已有的 `ProjectMemo_2.1_PLAN.md` 修改、`next-env.d.ts`、浏览器运行日志、`output/`、`storage/`、`tmp/` 和其他本地运行产物。

## 网页设计优点向鸿蒙端的迁移

本轮没有修改网页代码，只把网页端已验证的交互模式迁移到 ArkUI：

1. `GlobalSettings` 的图标 tile、标题/说明、分组字段和主操作，迁移到 `Index.ets` 设置页；在线 API 与离线确定性引擎的字段边界现在明确。
2. 网页设置页的状态反馈迁移为“当前运行方式”“数据同步”“连通测试成功/失败”，不再用静态“网络正常”暗示实际状态。
3. `CaptureBox` 的标题/说明/来源选择/状态反馈迁移到 `ProjectHome.ets` 的“记录项目碎片”区；图片、PDF、文本沉淀的入口层级更一致。
4. `ActionBoard` 的主次操作和可恢复反馈迁移到行动卡片与完成弹窗；上传、空态、错误态、返回和设置入口补足 44–48vp 触达尺寸。
5. 选中状态不再只靠颜色：筛选、来源和引擎模式同时使用文字/勾号、边框和 `accessibilitySelected`；状态文字也会被无障碍标签播报。
6. 附件提取失败或 `NEEDS_OCR` 时保留真实状态并提供“重试提取”，不生成伪造记忆；重复上传的失败记录也不会被“已复用”成功文案遮蔽。

## 代码变更范围

- `DesignTokens.ets`：提高小字号与底部导航字号，降低极小文字在手机上的阅读负担。
- `AsyncStateView.ets`：错误重试和空态 CTA 统一为 48vp。
- `PMAppBar.ets`：返回与右侧操作统一 44vp 点击区。
- `Index.ets`：设置栏分层、在线/离线配置切换、真实同步状态、筛选/任务操作语义、创建项目和表单尺寸。
- `ProjectHome.ets`：项目设置说明、来源/上传/重试/文本沉淀状态与触达尺寸、项目内底部导航。
- `ActionBoard.ets`、`InterventionDetail.ets`：高影响操作与弹窗确认操作统一触达尺寸。
- `module.json5`：声明 `2in1` 设备类型；折叠屏仍以 AVD profile 抽测，不把它写成已验证的独立布局。
- `vitest.config.ts`：关闭文件级并行，消除测试对 `DATABASE_URL`/SQLite 单例的竞态，使 `npm.cmd test` 可重复。

## 最终回归

| 检查 | 结果 |
|---|---|
| Vitest | 12 files / 85 tests PASS |
| TypeScript | `tsc --noEmit` PASS |
| ESLint | PASS |
| Next.js production build | PASS；保留既有附件存储 NFT tracing warning |
| HarmonyOS Hypium | 23/23 PASS |
| S08 adapter | 8/8 PASS |
| HarmonyOS HAP | BUILD SUCCESSFUL；unsigned；1,565,158 bytes |
| HAP SHA-256 | `e6931284e799481ab03f913da6f570589b2d05c898191292a5ed6ff52820cee9` |
| whitespace check | `git diff --check` PASS |

## W01 验收边界

四个 AVD profile 均存在，但 `Emulator.exe -start "Pura 90" -instancePath ...` 返回退出码 1（`Unable to start the emulator`），随后 `hdc list targets` 为 `[Empty]`。历史 Pura 90 日志还记录主机可用内存低于 3 GB、Guest OS 启动后 hdc 未连接。完整回执见 `evidence/2.1/ui-matrix/W01-emulator-blocked.txt`。

因此本轮不宣称以下项目通过：Phone/Foldable/Tablet/2in1 截图与 `uitest dumpLayout`、大字体、键盘遮挡、慢网/乱序、深色模式、S05 图片/PDF 各 5 份模拟器回执、S06 10 次 App 操作、S07 系统通知权限/点击/冷热启动/Snooze/重启矩阵。深色 token 尚未全面资源化接线，保持未验收。

S05–S07 的离线状态与代码边界见 `evidence/2.1/inbox-gap-notification/W01-s05-s07-status.md`；原生 UI 审视见 `evidence/2.1/ui-matrix/native-ui-audit.md`。

## Deviations

### 2026-08-27｜W01｜目标 AVD 无法连接

- 计划要求：优先在四类目标 AVD 完成截图、布局 dump、无障碍和 S05–S07 手工矩阵。
- 代码实际：AVD 启动失败，`hdc` 无目标；无法取得真实运行回执。
- 采取方案：保留阻塞原始证据；完成不依赖设备的 ArkUI 审视、可恢复 UI 修复、HAP 构建和离线回归；禁止把静态检查写成模拟器通过。
- 影响范围：W01 运行矩阵和 S07 运行验收保持 `PARTIAL/BLOCKED`；不影响本地构建、单测和 2.0 核心闭环代码。
- 验证结果：见 `W01-final-regression.txt`、`W01-emulator-blocked.txt` 和本文件最终回归表。

### 2026-08-27｜W00/W01｜测试文件级并行竞态

- 计划要求：标准 `npm.cmd test` 可保存为可复核回执。
- 代码实际：测试文件修改 `DATABASE_URL` 并共享 Prisma 单例，默认并行会偶发 SQLite 事务超时。
- 采取方案：在 `vitest.config.ts` 固定 `fileParallelism: false`，不改变业务逻辑。
- 影响范围：测试耗时增加，但标准命令变为稳定串行回归。
- 验证结果：`npm.cmd test` 12/12 files、85/85 tests PASS。
