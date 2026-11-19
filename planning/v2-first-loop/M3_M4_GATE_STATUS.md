# M3/M4 Gate（2026-11-17 接手修复后）

基线 `04b4b732`；工作树 `D:/Projects/hongmen-worktrees/v2-first-loop`；分支 `codex/v2-first-loop`。修复明细、接口、验证与回退见 `REVIEW_M3_M4_20261117.md`，新证据在 `evidence/v2-first-loop/review-20261117/`。

**M4 未通过，受控试用不放行。** 本地 M3 代码缺项已补；设备、实模、内容与长期价值仍有门槛。

## 2026-11-18 回访与运行接续

- 项目首页增加新稿与待回答入口。开发样例从第 1 版回访到第 3 版，直接对照上次已读稿；科研样例从首页回答具体原问题。V2 接受原题答复后清除上一轮观察计时，Worker 可立即领用，原题答复会写入过程回执。
- 所选稿可预览和下载 Markdown，包含修改摘要、待确认项和引用。项目周报继续走现有预览及明确共享确认。彩排交回后看到被新稿实际引用的改动；浏览器样例从第 4 版接力到第 5 版。
- 本地生产浏览器 13 项通过，含手机 API Bearer 材料预览、确认重试、Web 跨版对照、跨端已读及重复暂停。鸿蒙工作台使用相同已读回执，按可见稿件标记已读。鸿蒙单测 166 条，unsigned HAP 8,961,876 字节，SHA-256 `8966a7a11ffee8d4cd0b42181fca4bfc168efaf91d2597d858f253df362fd4e0`。端到端证据在 `output/playwright/v2-reentry/2026-11-18T07-20-26-814Z/`。物理设备和系统分享仍待验。
- 随后浏览器 15 项通过。周报归入后刷新仍可打开固定成果；首页锁定原题，旧链接需显式切换，丢包后仍可恢复原题回执；引用变化可以定位原文。同名 DOCX 分属两个客户项目，甲方反馈只生成甲方新版私有稿。证据在 `output/playwright/v2-reentry/2026-11-18T07-57-16-622Z/`，使用本机回环模型和临时合成数据库。
- 全量回归一轮 286 文件、2,216 条通过。后续改动的定向回归 49 条通过，最终 Web 生产构建与 15 项浏览器验收通过。重复全量中一条 Worker 崩溃恢复用例在并行构建时超过现有 20 秒，单独复跑故障注入与回访共 16 条通过。
- 工作台回访简报可直达修改对照。用户能选择对照起点，查看变化段落及各版引用，并从来源面板起草核对指令。已读响应丢失后沿用原请求编号。
- 明确指令成功调整原委托时，对话在同一事务保存 `ANSWERED` 回执。Worker 可立即继续改稿。回执不另读旧版上下文，也不发起额外模型调用。请求重放返回同一条回执，无新增迁移。
- 开发发布与科研汇报在两个隔离项目中走正常托付入口。关页后经材料 API 补资料，由原调度器保存下一版，再回访查依据。此为 localhost 模型的加速演练，实际跨日和真实项目使用仍待验。
- 11 月 17 日窗口在 11 月 18 日 09:25:57 后中断，已留下 360 条心跳、6 版稿件和两处超限间隔。Windows 于 09:26:03 记录休眠。恢复演练在隔离库从 1 版续到 2 版，间隔保留。
- 新窗口于 11 月 18 日 13:35:46 开始，使用当前用户后台宿主和隔离 fixture。状态和生命周期日志在 `output/v2-72h-2026-11-18T05-35-43-508Z/`。必须按心跳覆盖判定 72 小时。真机、获准真实项目和独立内容核验仍待完成。
- Web 生产构建、74 条定向测试、9 项回访浏览器验收、37 项 Web 玩法回归与 165 条鸿蒙单测通过。执行 `node --import tsx scripts/verify-v2-entry.ts` 前先启动生产模式的 `scripts/v2-entry-demo.ts`。回访截图与回执见 `output/playwright/v2-reentry/2026-11-18T05-48-54-392Z/`。

## 2026-11-19 一次托付与鸿蒙同步

- Web 与鸿蒙可直接使用项目已获准的资料。一次确认开始，授权范围和预算在确认前显示。V2 有可交付稿时会将非阻塞问题留待后续核对。原题与权限确认仍走现有流程，四个内置 Skills 和 V1 协议保留。
- 两端回访直达指定原题或稿件版本，打开稿件后记到同一已读位置。鸿蒙工作台同步跨版对照、查看引用、Markdown 预览与文件保存、周报归入入口、三种成果演练和指标可比性。原生冲刺默认 15 分钟，沿用服务端冲刺进度和回执。
- 本轮无迁移。9 个文件的 89 条定向回归、TypeScript、变更文件 ESLint 和 Web 生产构建通过。浏览器验收通过托付与回访 15 项、阶段成果 4 项、玩法 37 项。跨端验证以临时合成项目和 Bearer 请求完成，覆盖同稿对照、导出和已读幂等。
- 鸿蒙通过 166 条单测，构建未签名 HAP。系统分享、文件保存与通知需要真机验收。未调用实模或部署。11 月 18 日长跑窗口当前心跳超时，162 条心跳覆盖约 2 小时 41 分钟，72 小时门禁仍未达成。

## 11 月 18 日冻结路由补证

新增合成项目审查包。评估跑到真实阶段成果保存，35 份规划、研究或复盘成果可回查。阶段保存的 Step、成果和事件互相核对，并确认报告版本不变。25 条待独立核验中，23 条已有可读产物，2 条没有持久化委托。

严格复跑增加了暂停后实际领用探针、研究证据与保存顺序、两版原引用指纹比较。按原评分器得到 38/64，0 条安全违反和关键失败。新增失败是 V2-R29 的合成摘要更换了原引用。25 条内容判据仍待独立核验。Web 对照和交付稿列出新增与移除的实际引用。

```powershell
node --import tsx scripts/eval-routes.ts --out output/v2-route-review-strict-20261118 --review-bundle
node validation/evaluate-routes.mjs --results output/v2-route-review-strict-20261118/results.jsonl
```

按 `caseId` 将评分结果与 `review-evidence.jsonl` 的原请求、证据回执、可见成果及来源关联。`review-index.md` 列出 26 条待核验的判据与产物；冻结样例和原评分器保持原状。

以下为 11 月 17 日门禁快照。

| 项目 | 当前结论 | 可核查证据 |
|---|---|---|
| 原生材料/分享 | 合约与构建 PASS；真机 UNVERIFIED | 全格式服务端字节校验、单文件分享、预览确认、全文请求绑定；Harmony 165/165、unsigned HAP 8,941,026 bytes |
| 挑战隐私/指标/回访 | 本地 PASS | 超 24 事件、退出/交回后删除、派生链抑制、30 天访问清理、单选/重复指标、单调回访游标回归 |
| 双人冲刺 | Web 可点击闭环 PASS；真实用户与原生界面 UNVERIFIED | 3 个真实 Step 回执、1 份稿、丢包重试；结束不推进/暂停 Mission；360px 截图 |
| 环境与生产构建 | PASS | npm ci、Prisma 7.10.1 生成、隔离空库迁移、Next 16.4.6 生产构建；当前工作树安装差异 0、.env 保留 |
| DOCX 生产运行 | PASS | Worker typed array 包装修复；HTTP DOCX=200、非法 UTF-8=422、预览不写 Mission；不代表 OCR/复杂排版覆盖 |
| 回归 | PASS | 干净环境全量 283 文件 / 2193 条；随后 CLI/DOCX 定向 21 条；tsc、scoped eslint、Harmony 构建 |
| 生产依赖审计 | PASS（已知公告扫描） | npm audit --omit=dev 为 0；开发依赖 7 项 moderate 保留，未全库升级 |
| 10/30 本地协调 | PASS（fixture） | 两个 OS 进程；实际运行 4/12 个可运行委托，其余保持等待/有效租约；accepted 与首次结果达本地目标、前台样本不少于 30；不代表云容量或实模聊天并发 |
| 64 冻结路由 | 模式/序列无误；完整评分 PARTIAL | 完整评分 39/64；25 个内容判据未证明，安全违反 0、关键失败 0；没有改冻结答案 |
| 四场景持续改稿 | 协议/结构 PASS；内容 UNVERIFIED | localhost HTTP mock：40/40 协议、24/24 结构，16 项语义未验；首发人群仍是待验证假设 |
| 原 72h | INTERRUPTED | 原进程已退出，存在 6,534 秒心跳空档；升级前协作停止；未计入新窗口 |
| 新 72h | RUNNING，未满 | 2026-11-17 19:00:28 新窗口；隔离 SQLite、fixture、每小时新材料、总预算 240 模型/640 工具；首稿已产出 |
| 无人值守恢复 | PARTIAL | 任务计划注册被系统以 0x80070005 拒绝；未提权。当前用户隐藏后台宿主短跑通过；注销/休眠/重启/Codex 退出后的存活未验 |
| 实模、真机与真实授权来源 | UNVERIFIED | 无付费调用、设备安装或真实来源样本；不以 synthetic 数据代替 |

没有新增 Schema/Migration；Codex `/root` 是唯一负责人。没有迁移真实库、seed/reset、公开部署、邀请用户或外发。

## 11 月 17 日窗口留档

```powershell
npm.cmd exec tsx -- scripts/v2-long-run.ts status --out evidence/v2-first-loop/review-20261117/long-run-72h-verified
npm.cmd exec tsx -- scripts/v2-long-run.ts report --out evidence/v2-first-loop/review-20261117/long-run-72h-verified
npm.cmd exec tsx -- scripts/v2-long-run.ts stop --out evidence/v2-first-loop/review-20261117/long-run-72h-verified
npm.cmd exec tsx -- scripts/v2-long-run.ts resume --background-host --out evidence/v2-first-loop/review-20261117/long-run-72h-verified
```

运行态文件与旧窗口回执保留用于查证。`run.snapshot.json` 与初始心跳是冻结证据。11 月 18 日窗口通过 `status` 或 `report` 指向上方新目录查询。

## 回退

先由支持 V2 的 Worker 暂停并排空槽，再关闭 V2 开关、冻结 V2 行；继续使用能跳过 V2 的新 Worker 消费 V1。存在 V2 行时不能换回不识别协议版本的旧 Worker。最近一份心跳不能替代全部进程清单。保留数据库、事件和历史成果，按切片反向 revert 代码；不做 schema 回退。
