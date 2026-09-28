# 复赛 Web 配图重截证据（2026-09-22）

本目录只保存本次复核产生的 Web 图 11～13，不覆盖 `evidence/` 下的历史截图。鸿蒙图 7～10 按主线程最新安排由用户自行截取，本次不再重复。

## 统一来源与运行边界

- 冻结提交：`bdbb80967b125012d881fef111bec18d59e3e6d6`（`master` / `origin/master`）。
- 数据库：`D:\Projects\hongmen\prisma\projectmemo-e2e.db`，由 `npm.cmd exec tsx -- scripts/setup-e2e.ts` 重建；随后只在该隔离库中准备脱敏演示项目，未清空或写入开发库。
- 脱敏演示项目：`轻量视觉模型复赛项目`；8 张知识卡、5 条真实规则提醒、1 个待办、2 个「作品说明大纲」历史版本；截止日期为运行日后 7 天（2026-09-29）。
- 生成模式：`LLM_MODE=mock`；页面明确显示“Mock 模式 · 离线可演示”。无真实 Token、真实 IP、个人通知或调试控制台。
- Web 服务命令：

  ```powershell
  $env:DATABASE_URL='file:D:/Projects/hongmen/prisma/projectmemo-e2e.db'
  $env:LLM_MODE='mock'
  $env:PROJECT_HEALTH_ENABLED='true'
  $env:PROJECT_EPISODES_ENABLED='false'
  $env:PROJECT_SCHEDULING_ENABLED='false'
  $env:PROJECT_CALENDAR_REMINDER_ENABLED='false'
  $env:DEMO_SCENARIOS='true'
  $env:NEXT_DIST_DIR='.next-e2e'
  npm.cmd run dev -- -H 127.0.0.1 -p 33321
  ```

- 浏览器：Playwright CLI 会话 `competition_refresh`，视口 `1280 × 1000`；截图通过 `npx.cmd --yes --package @playwright/cli playwright-cli -s=competition_refresh screenshot` 生成后复制为本目录的最终文件。

## 最终文件

| 图号 | 文件 | 当前页面与可见证据 | 局限 |
|---|---|---|---|
| 图 11 | `图11_Web项目空间_20260922.png` | `/projects`；显示“轻量视觉模型复赛项目”、7 天后截止、5 条提醒、1 项待办、50% 参赛准备度、8 张卡片和 2 份成果。 | 截图为单项目脱敏工作区，页面右侧留白来自当前项目列表只有一个项目；不代表设备端验收。 |
| 图 12 | `图12_Web主动介入与确认_20260922.png` | `/projects/cmucaw8yy0000ck8og8jrom2s` 的主动提醒区；展开风险提醒依据，显示 `risk_without_completed_action`、方案 A 显存风险引用、建议行动和“接受并创建行动”确认入口。 | 页面保留“演示控制”入口，但没有点击模拟场景；提醒来自隔离库中的真实规则评估。系统日历与通知没有进入画面。 |
| 图 13 | `图13_Web成果文档室_20260922.png` | `/projects/cmucaw8yy0000ck8og8jrom2s/generate?type=competition_outline`；显示当前作品说明阅读预览、方案 A→方案 B、实验与风险内容，以及侧栏“历史版本 · 2”（版本 1、版本 2）。 | 当前 Web 阅读页展示来源卡片内容和历史版本，但没有把 `/artifacts/:artifactId/audit` 的逐句核验面板嵌入页面；数据库中两个版本均保存 8 条 `sourceRefs` 与 8 条模板 `claims`，逐句审计仍需通过审计 API 查看。 |

## 复核记录

- 图 11、图 12 是本轮先前已完成且保留的最终文件；按主线程最新指令未重复截取。
- 图 13 在确认页面滚动位置回到顶部后截取，保证页面标题、成果目录、历史版本与阅读内容同时可见。
- 本轮未修改业务代码，未提交，未 push。目录中的 `.playwright-cli/` 为 Playwright 原始快照/控制台记录，最终提交候选只取上表三张 PNG 与本 README。
