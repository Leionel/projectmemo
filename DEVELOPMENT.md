# ProjectMemo 开发与运行说明

产品体验入口见 [README](README.md)，开发约定见 [AGENTS.md](AGENTS.md)。环境变量以 [.env.example](.env.example) 为准。改版前 README 保留在 [原文留档](docs/development/README_ARCHIVE_2026-10-22.md)，旧能力状态不作为当前验收结果。

## 本地数据与账号

Node.js 24；PowerShell 使用 `npm.cmd`。首次在新目录运行 README 的 `db:setup` 会生成 Prisma Client、应用迁移并导入种子素材。登录不会自动把最早的项目授予演示账号；创建自己的项目即可开始。

已有库先核对 `DATABASE_URL` 和 `ATTACHMENT_DIR`，备份后在副本验证迁移，再使用 `npm.cmd run db:generate` 与 `npm.cmd exec prisma -- migrate deploy`。不使用 setup、seed 或 demo-reset 修复生产数据。`db:demo-reset` 会清空项目，带 confirm 参数也不代表获准删除真实数据。

非生产环境可初始化 `contest-demo` / `contest-demo-2026`，自定义账号与绑定项目用 `.env.example` 的 DEMO 配置。生产须显式配置凭据；不在日志、提交或截图保存私钥和真实令牌。

## 长期委托

设置 `MISSION_ENABLED=true`，并在另一个进程运行：

```powershell
npm.cmd run mission:worker
```

Web、Worker 使用相同代码和数据库。真实执行需要配置 LLM，且用户批准选入的上下文。mock 页面不等于真实模型自主执行。Worker 不在页面进程内运行。

按需开启的开关均见 `.env.example`：研究授权、业务写入、材料接续、预授权自动接续、成果归入、核验与 Judge 分别受控。关闭开关不清除历史。运行过的步骤与保存的草稿不代表现实行动完成。

Web 与鸿蒙共享只读 `GET /api/workspace/focus`，按当前会话成员关系筛选项目；Mission 同时要求 ownerUserId 和 OWNER 成员角色。每类摘要有界，详情和确认留在原项目接口。焦点默认排除归档项目。

## 验证

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd exec tsc -- --noEmit
npm.cmd run build
npm.cmd run test:e2e
npm.cmd run harmony:test
npm.cmd run harmony:build
```

Vitest 与 E2E 使用各自的独立库。E2E 默认端口 33321，可用 `PROJECTMEMO_E2E_PORT` 调整。不要让人工预览与测试共享会被重建的同一个库；预览应使用测试库的独立副本。真实模型与在线检索需另行授权和验收，不以 mock 或单测替代。

## HarmonyOS

DevEco 构建脚本自动探测 SDK/JDK，可用 `DEVECO_HOME` 覆盖安装位置。后端地址唯一来源是 `harmonyos/entry/src/main/ets/common/Constants.ets`，核对实际模式与可达地址后启动 `npm.cmd run harmony:backend`。模拟器回环可达不等于真机或评审设备可达。

unsigned HAP、本地 Hypium、模拟器交互、真机安装与系统通知分别记录。修改设置、深链接和源引用后要在设备核验触摸、返回、大字体、读屏及后台恢复。

## 部署与专项说明

- [ECS 日常更新命令与失败恢复](deploy/alibaba-cloud-linux/README.md#更新发布已部署机器)：使用 root heredoc、`mktemp` 和目标提交中的 `safe-update.sh`。
- [Focus Agent 开关与功能验收](deploy/alibaba-cloud-linux/FOCUS_UPDATE.md)：代码更新后另行启用两个开关、重启并核对；鸿蒙还需安装新版 HAP。
- [ECS、后端、小艺与 HAP 执行手册](docs/competition/projectmemo-ecs-backend-xiaoyi-hap-runbook.md)
- [复赛放行清单](REMATCH_SUBMISSION_GATE_2026-09-14.md)
- [Pre-R4 UX 实施记录](docs/FINAL/实施规划/PRE_R4_UX_IMPLEMENTATION_NOTES.md)
- [本轮 Web、导航与卡片核查](docs/FINAL/实施规划/WEB_UI_REFINEMENT_2026-10-22.md)

部署使用现有持久数据路径、独立 Worker、备份与发布指纹。每次发布核对实际代码和健康响应；本地构建通过不代表线上已更新。
