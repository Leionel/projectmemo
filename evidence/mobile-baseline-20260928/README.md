# 移动端 UI 基线真机（模拟器）核对回执 · 2026-09-28

## 环境与数据来源

- 设备：Huawei Emulator "Pura 90"（hdc 127.0.0.1:5555），HarmonyOS NEXT 模拟器，非真机。
- 后端：本机 `npm run harmony:backend`（127.0.0.1:4400），数据库为 `tmp/emu.db` —— 由 `prisma/dev.db` 复制后 `migrate deploy` 的临时副本，**未触碰真实开发库**；截图完成后临时库与脚本已删除。
- 演示数据：用 API 向临时库写入（项目「忆程 ProjectMemo 复赛准备」、4 条 capture、1 条 DONE+resultCardId 行动、1 条待开始行动、1 份 competition_outline 成果、2 条真实规则提醒）。**LLM 为 rules/mock 模式，未调用真实模型。**
- 为让提醒在凌晨可出现，临时库里把该演示账号的静默窗口设为空（start==end）；真实评审包策略不受影响。
- HAP 为 development flavor 临时包（指向 10.0.2.2:4400）；提交库中的 `Constants.BUILD_FLAVOR` 已恢复为 `review`。

## 截图清单

| 文件 | 内容 | 对应改动 |
|---|---|---|
| 00-launch.jpeg | 登录页 | 基线 |
| 01-after-login.jpeg / 05-index.jpeg / 20-restart.jpeg | 项目列表：准备项命名「项目内准备项 N/M 项已形成」 | 重点 2 |
| 06-workbench-top.jpeg / 10-workbench-again.jpeg | 工作台顶：指标卡 + 「本阶段重点」（依据浅色行 + 查看依据/创建行动） | 重点 3 |
| 07-workbench-mid.jpeg | 状态与变化：「未知项：本阶段检查点尚未确认」+ 建议下一步 | 重点 4 |
| 08/11/12-workbench*.jpeg | 项目体检诚实标注关闭的能力；当前状态卡「计算口径」与缺口/已具备 | 重点 2 |
| 13-scroll-c.jpeg | 「最近闭环」：DONE 行动 → 完成回执 → 「完成回执已写入项目记忆」→ 查看回执与来源 | 重点 5 |
| 21-inproject-memory.jpeg | 项目内记忆：范围说明 + 时态徽章 + 原始采集碎片 | 重点 1 |
| 22-readiness-sheet.jpeg | 准备项弹层：3/6、逐项计算口径、「不代表复赛材料已通过提交验收」 | 重点 2 |
| 23-action-confirm.jpeg | 项目内待办：DONE 卡「已闭环沉淀为项目记忆」 | 重点 5 |
| 30-new-header.jpeg / 41/50-*.jpeg | 新顶栏：搜索图标 + 居中品牌 + 新增图标；筛选条收窄 | 本轮 UI 调整 |
| 51-search-open.jpeg | 搜索展开行（按页签占位文案） | 本轮 UI 调整 |
| 54/56-capture-*.jpeg | 全局「记录项目碎片」：归属项目 Select + 类型 + 内容 + 底部确认 | 本轮全局新增 |
| 55-todo-bar.jpeg | 全局待办窄栏 | 本轮 UI 调整 |
| 60/61-memory-fixes.jpeg | 全局记忆：筛选单行左对齐、删除重复「已选」行、标签改「尚无佐证来源」 | 反馈修复 |
| 62-memory-dedup.jpeg | 摘要与标题重复时不再复述，只留标题完整结论 | 反馈修复 |

## 已发现并修复的真机崩溃（模拟器 jscrash 证实）

1. `TextFormatters.isUnreadableText` 对服务端 `null` 调 `.includes` → 工作台整页崩溃（faultlog 00:13:51）。修法：展示层 falsy 兜底 + 19 处 `!== undefined` 判空补 `!== null`。
2. `.next` 路由表损坏导致 `/decisions/timeline`、`/interventions/exposures` 等既有路由 404、项目页整页 404。修法：停后端、清 `.next` 重启（未改业务代码）。

## 环境事故说明（需用户知悉）

- 2026-09-28 09:26，一次 `prisma migrate deploy` 未显式传 `DATABASE_URL`，落到了 `.env` 指向的真实开发库 `prisma/dev.db`（此前落后 3 个迁移）。该操作仅应用 DDL、未删除或改写业务数据，结果是 dev.db 与仓库迁移对齐；因变更前未做快照，无法用迁移回滚。后续所有迁移均显式指定临时库。

## 尚未完成的验收（需真机/后续）

- 真机：衬线品牌字体（模拟器不应用 `font.registerFont` 自定义字体，已保留注册代码与 3KB 子集字体，真机复核）、200% 字体放大、深色主题、底部安全区、快速连点/反向打断、弱网旧快照。
- 全局「新增待办」弹层与创建行动确认弹层在模拟器未逐屏截图（代码路径与项目内表单一致，静态字符串已在 modules.abc 中核对）。
- 衬线字体为 Noto Serif SC（思源宋体）子集，SIL OFL 1.1；随包分发需附许可证全文，当前仅在回执注明，提交包前请补 OFL 文本或改回系统字体。

复核补记（2026-09-28）：已在 `harmonyos/entry/src/main/resources/rawfile/fonts/OFL.txt` 补入与字体内 Adobe 2017–2023 版权信息对应的 SIL OFL 1.1 全文，并确认该文件与字体一起进入本轮 unsigned HAP。上述缺项是原始截图与回执形成时的状态；开发配置 HAP 的模拟器复核见 `../mobile-recheck-20260928/README.md`，评审配置 HAP 与真机仍未安装验收。
