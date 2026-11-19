# Web 玩法与书签精灵 · 实施回执（2026-11-17）

工作树 `D:/Projects/hongmen-worktrees/v2-first-loop`，分支 `codex/v2-first-loop`。接手 HEAD `e2d20ad0`；本片未合并原工作树、未 push、未部署。运行环境 Node.js 24.16.0 / Next 16.4.6。

## 1. 实际改变

### A. 书签精灵素材与组件

- 生成 `character-spec.png`（设计母版）、`avatar.png` 与六个姿态（idle / inspect / thinking / writing / handoff / success）。母版和提示词在 `docs/v2/assets/mascot-concepts/20261117/bookmark-spirit-v1/`（docs 按仓库约定不强制入库）。
- 产品素材：`public/mascot/bookmark-spirit/v1/web/*.png`（512，透明，单张 14–58KB）与 `master/*.png`（1024 母版）；`manifest.json` 记录语义、文件、尺寸、来源、用途。
- `components/mascot/BookmarkSpirit.tsx`：白名单路径、固定占位、安静模式、`prefers-reduced-motion`、点击展开任务提示（不发模型请求）；`BookmarkSpiritAvatar` 只用于角色入口，不替换品牌 Logo。
- `scripts/build-mascot-assets.ts`：蓝幕布色键、去背、溢色抑制、按不透明内容裁切、统一基线；不依赖付费 API。
- 一致性检查：六姿态 512×512、内容底边 471±、水平居中；浅/深底对照见 `review/mascot-sheet-{light,dark}.png`。

### B. 三个玩法（同一 Mission 工作区）

- `components/v2/MissionGames.tsx`：深青绿侧栏、证据侦探/交付彩排/双人冲刺、安静的指标可比性入口、返回成果；离开游戏回到原稿。
- **证据侦探** `components/v2/OutcomeChallenges.tsx`：稿件原句纸卡、点选/拖入多选、取消选择、无引用选项、同屏原文阅读与相关段落定位、服务端 verdict、显式交回、交回回执与同 Mission 新版本入口；刷新恢复已选与已打开来源。
- **严格导师**：依据/边界/改稿三轮，左侧原稿、中央追问与回答、右侧本轮发现；回答可绑定一条本轮来源（服务端校验），交回前显示「原文/建议」预览，明确建议来自用户回答。
- **双人冲刺** `components/v2/ProjectSprint.tsx`：左侧个人小目标与相关记录、右侧真实 Step/Output 回执、新稿保存后才出现打开入口、自述、自然语言改道走原 Conversation 链、结束本轮与暂停原委托分开。
- **指标可比性**：保留原功能，使用同一纸卡语言与角色，不新增第四套引擎。

### C. 服务端契约（均为增量字段，无 Schema/Migration）

- `ChallengeAnswer.evidenceKeys?: string[]`：仅 REHEARSAL 可选，最多 3 条，必须属于本轮冻结 `sourceKeys`；旧客户端不发送时为 `[]`。
- `ChallengeSession.handoffAt?: string | null`：交回回执时间；`handoffSourceId` 语义不变。
- 交回后回答锁定：`ANSWER` 返回 `CHALLENGE_ALREADY_HANDED_OFF`，防止交回后改写；删除本轮回答会撤下回执、逻辑清除派生反馈，并回到可重答状态。
- 交回后的新稿/新材料不再把本轮误判为撤题；来源撤权仍会撤下题面。
- `SprintView.agent` 新增 `latestNewRevision`、`latestNewOutputAt`、`receipts`、`openedSources`、`openItems`；所有统计按本轮开始到结束的持久时间窗计算，结束后的新产物不吸收。
- XLSX 材料：`format: "XLSX_TEXT"`，`plainMaterialFormat` 识别 `.xlsx`；解析在独立 Worker 中完成。

### D. XLSX 读取

- `lib/intake/xlsxWorker.cjs`：fflate 解包，只读 `[Content_Types].xml`、workbook、rels、sharedStrings 与 worksheets；支持共享字符串、富文本片段、内联字符串、数字、布尔、公式缓存值；输出「工作表：名称」+ 制表符分隔文本。
- 不计算公式、不保留样式/图片/合并单元格/日期格式；不执行宏，拒绝 DOCTYPE/ENTITY、externalLink/vbaProject、超限归档；2MB 文件、10 工作表、500 行、50 列、2 万字上限。
- `lib/intake/xlsx.ts`：5 秒超时、内存限制、错误映射；`app/api/projects/[id]/material-extract/route.ts` 与 `components/v2/MaterialInput.tsx` 接通上传与预览文案；`next.config.ts` 将 Worker 加入生产追踪。

## 2. 接口/数据变化

| 位置 | 变化 | 兼容性 |
|---|---|---|
| `POST /api/missions/:id/challenges/:cid` ANSWER | 可选 `evidenceKeys` | 旧请求不受影响；非 REHEARSAL 发送会被拒 |
| `GET /api/missions/:id/challenges` | `handoffAt` | 追加字段 |
| `POST /api/projects/:id/material-extract` | 接受 `.xlsx`，返回 `XLSX_TEXT` | 原 DOCX/TXT 路径不变 |
| `GET /api/missions/:id/sprint` | `agent` 追加 5 个字段 | 追加字段；旧调用方忽略 |
| `prisma/schema.prisma` / 迁移 | 无变化 | 无迁移、无真实库操作 |

## 3. 验证

### 已通过

- 定向回归（Node 24）：`tests/v2Challenges.test.ts`、`v2ChallengeMetricPrivacy.test.ts`、`v2ReentryBrief.test.ts`、`v2ProjectSprint.test.ts`、`v2ChallengePresentation.test.ts`、`bookmarkSpirit.test.ts`、`v2XlsxImport.test.ts` 共 **51 条**通过。
- 素材完整性：白名单与 manifest 一一对应、真实 alpha、四角透明、中心有内容、六姿态同画幅/基线、单张 <120KB。
- XLSX/DOCX：多工作表、共享/富文本/内联字符串、布尔/数字、宏、DOCTYPE、损坏包、超限；DOCX 原路径仍通过。
- 类型：`npx tsc --noEmit` 通过；scoped eslint 0 error（仅有已禁用的本地 `<img>` 规则说明）。
- 生产构建：`NEXT_DIST_DIR=.next-webgames3 npm.cmd run build` 通过（Next 16.4.6）。
- 生产包浏览器验收：`NEXT_DIST_DIR=.next-webgames3 npm.cmd exec tsx -- scripts/verify-web-games.ts`，**31/31** 通过，回执 `browser-receipt.json`，截图 17 张。覆盖：素材 200、XLSX 生产接口、原文定位、拖放/键盘/点选三种选卡路径、服务端 verdict、刷新恢复、交回回执、1280/360 无横向溢出、删除与反馈清除、导师丢包重试与三轮、冲刺真实回执/自述/改道/结束/暂停分离、reduced-motion、来源撤题。

### 全量测试

`npm.cmd test`（Node 24，隔离测试库，文件串行）：**286 文件 / 2210 条全部通过**，耗时 1209 秒（2026-11-17 22:48）。相对接手基线 283 文件 / 2193 条，新增 3 个测试文件与 17 条用例。

## 4. 证据

- 生产回执：`evidence/v2-first-loop/web-games-20261117/browser-receipt.json`
- 页面截图：`evidence/v2-first-loop/web-games-20261117/screens/`（01–16）
- 参考原型 vs 实际页面：`evidence/v2-first-loop/web-games-20261117/review/reference-vs-actual.jpg`
- 角色浅/深底：`review/mascot-sheet-light.png`、`review/mascot-sheet-dark.png`
- 原型与角色参考：`docs/v2/assets/web-game-prototypes/20261117/`、`docs/v2/assets/mascot-concepts/20261117/`

数据边界：全部为隔离 SQLite 合成项目；冲刺步骤/第 2 版由验收脚本直接写入持久表，模拟真实 Worker 回执；无真实模型调用、无外部写入、未操作真实数据库。

## 5. 本地入口

```powershell
cd D:\Projects\hongmen-worktrees\v2-first-loop

# 隔离演示库（会重建 prisma/projectmemo-web-games.db）
$env:DATABASE_URL="file:D:/Projects/hongmen-worktrees/v2-first-loop/prisma/projectmemo-web-games.db"
npx prisma migrate deploy
npm.cmd exec tsx -- scripts/seed-web-games-demo.ts

# 生产包
$env:NEXT_DIST_DIR=".next-webgames3"
$env:MISSION_ENABLED="true"; $env:MISSION_V2_ENABLED="true"; $env:MISSION_CHALLENGES_ENABLED="true"
$env:MISSION_WORKBENCH_ENABLED="true"; $env:MISSION_INVESTIGATION_DELEGATION_ENABLED="true"
$env:FOCUS_AGENT_ENABLED="true"; $env:FOCUS_CONTINUITY_ENABLED="true"; $env:FOCUS_WEB_ENABLED="true"
npx next start -H 127.0.0.1 -p 4320
```

登录 `web-games-reviewer` / `web-games-reviewer-password`，打开 `/v2/workbench?missionId=<seed 输出>`。

## 6. 回退

- 关闭 `MISSION_CHALLENGES_ENABLED` 即隐藏玩法入口；关闭 `MISSION_V2_ENABLED` 冻结 V2 行为，原工作台与旧协议不受影响。
- 代码按切片反向 revert；素材为新增目录，删除不影响旧页面；无 Schema/Migration 回退。
- XLSX 若不需上线，可回退 `plainText`/`projectMaterial`/`MaterialInput`/route 与 Worker，DOCX/TXT 路径不变。

## 7. 未验证与限制

- 真实模型质量、真实 Worker 连续运行、72h 时钟、生产滚动升级、真机/HAP 未验证。
- 原生鸿蒙文件选择器未加入 `.xlsx` 类型；本片 XLSX 仅 Web 上传路径。
- XLSX 不解析公式结果之外的样式、日期显示格式、合并单元格与图片；日期按底层数值呈现。
- 角色素材由内置 ImageGen 生成（约 8 张 + 返工），已做本地色键与一致性检查，但不等于品牌/IP 最终批准。
- 同一 Mission 只展示最新一轮挑战；更早轮次保留在事件账本中，但当前 UI 不提供历史轮次列表。
- 生产验收的冲刺租约与步骤为合成数据；`pauseRequestedAt` 只证明暂停请求，合成 Worker 不会把 RUNNING 收尾为 PAUSED。
