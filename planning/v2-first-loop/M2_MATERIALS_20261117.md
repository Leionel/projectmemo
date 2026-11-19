# M2：四场景材料与反馈闭环

工作树：`D:/Projects/hongmen-worktrees/v2-first-loop`，分支：`codex/v2-first-loop`。上一切片的审查修复见 [复查回执](REVIEW_FIXES_20261117.md)。

## 已实现

- 项目页提供发布准备、客户交付、科研汇报、课程项目四个起步建议；目标可改写，未增加 Skills 或 Agent 引擎。四类人群仍是待验证假设，合成旅程不作为市场证据。
- 导入 TXT、Markdown、普通 CSV、DOCX。CSV 保留字符串、引号、前导零，不复用实验数据解析。DOCX 提取正文和表格文字，确认前只做解析；不保存 Word 二进制，确认后保存提取原文和文件名。
- 预览 → 一次确认 → 原 Mission 研究/创作接力 → 私稿；工作台追加资料/反馈 → 原扫描器唤醒 → 同一 Mission 新版本。可定位命名来源，旧版本不改写。
- 反馈显式标为待核对意见，不当作已确认要求。客户交付模板在预览声明关闭本项目个人上下文，确认事务设置既有 `PROJECT_ONLY` 模式；其他模板不改变原记忆模式。
- 模型/工具/来源/到期限制沿用原许可；添加材料不会恢复已暂停或结束的任务。自然语言改道沿用 Conversation 控制链。严格导师、证据侦探、双人冲刺入口保留为独立探索，不依赖游戏引擎。
- 修复执行中反馈丢失：SkillCursor 保存本周期输入指纹；检查点只确认该快照。期间新增材料继续保持待处理，原扫描器立即接续。V1 检查点按旧逻辑运行。
- 请求回包丢失时，前端保留原请求编号和内容；服务端通过 Capture 唯一键及事务收敛，确认重试也返回原 Mission。

## 代码与迁移

| 层 | 入口 |
|---|---|
| 起步建议、文本与 CSV 解析 | `lib/intake/projectPresets.ts`、`projectMaterial.ts` |
| Word 隔离解析 | `lib/intake/docx.ts`、`docxWorker.cjs` |
| 提取接口 | `POST /api/projects/[id]/material-extract` |
| 委托与材料保存 | `lib/mission/v2DelegationService.ts`、`materialService.ts`；`POST /api/missions/[id]/materials` |
| 输入快照和接续 | `lib/skills/runtime.ts`、`lib/mission/runtimeStore.ts` |
| 原产品界面 | `V2DelegationStarter`、`MaterialInput`、`MissionMaterialForm`、`OutcomeWorkbench` |

无新增 Schema/Migration；使用既有 Capture、成员记忆模式、Mission JSON 与事件。唯一 Schema/Migration 负责人仍为 Codex 主代理。新增接口与可选元数据不要求 HarmonyOS 改变旧请求；V2 默认关闭。

## DOCX 依赖与边界

研究了 [Mammoth 官方源码与安全说明](https://github.com/mwilliamson/mammoth.js)、[原始文本读取实现](https://github.com/mwilliamson/mammoth.js/blob/master/lib/raw-text.js) 和 [fflate 官方源码](https://github.com/101arrowz/fflate)。使用 Mammoth 1.13.0（BSD-2-Clause）与 fflate 0.8.3（MIT）。本次调用 `extractRawText`，不渲染 HTML。

文件 ≤2MB，文本 ≤20,000 字符/64KB；ZIP ≤512 项、单项展开 ≤4MB、总声明展开 ≤8MB；仅有限 XML 送入解析器。拒绝宏、实体声明、损坏/加密文档；不支持旧 `.doc`、`.docm` 或扫描图文字。解析在独立 Worker 内执行，5 秒超时，设置 V8 堆限制；外部文件读取未开启。接口先核对登录与项目 Owner，上传流有总量限制，解析不写项目、不调模型。

现有环境的 Next/Prisma/Vitest 安装版本与仓库声明版本原已不一致；本次仅安装固定版本的新解析依赖并保留原锁项。当前安装环境构建通过，按声明版本全新 `npm ci` 的环境尚未复验。

## 验证与复现

```powershell
npm.cmd test
npm.cmd test -- tests/v2MaterialsJourney.test.ts tests/v2DocxImport.test.ts tests/v2Journey.test.ts tests/contentQuality.test.ts
npm.cmd exec tsc -- --noEmit
# 对 git diff/new files 中的 TS、TSX、CJS 执行 scoped eslint，见 CHECKS.json。
$env:NEXT_DIST_DIR='.next-m2-build'
npm.cmd run build -- --webpack
npm.cmd exec tsx -- scripts/verify-docx-trace.ts
npm.cmd run harmony:test
```

定向 4 文件 / 26 条通过，覆盖四条合成旅程、并发幂等、跨项目拒绝、暂停不唤醒、执行中反馈、Word 正文/表格和异常归档。类型、变更范围 ESLint、Web 生产构建通过；Harmony 合约 155/155，通过本地 testbuild。

全量 275 文件 / 2145 条全部通过，耗时 522.36 秒，见 `evidence/v2-first-loop/m2-materials-20261117/full-final.log`；首轮两个失败及修复前浏览器截图保留在历史证据中。Web 构建仍有既存 `lib/browser/reader.ts` 的 createRequire 解析警告。

浏览器实测：普通 CSV → 客户记忆范围确认 → 丢失确认回包后重试 → 第一稿 → 损坏 Word 拒绝 → 有效 Word 反馈 → 丢失保存回包后幂等重试 → 同一 Mission 第二稿 → 命名证据定位；360px 无横向溢出。数据来自新临时 SQLite，模型为 localhost HTTP mock。本轮没有付费调用、真实数据库变更或部署。

```powershell
$env:V2_ENTRY_PORT='4430'
$env:NEXT_DIST_DIR='.next-m2-build'
$env:V2_ENTRY_PRODUCTION='true'
npm.cmd exec tsx -- scripts/v2-entry-demo.ts
# 另开终端；每次验收使用全新 demo 实例。
npm.cmd exec tsx -- scripts/verify-v2-m2.ts
```

入口 `http://127.0.0.1:4431/open`。浏览器截图、命令结果与数据边界见 `evidence/v2-first-loop/m2-materials-20261117/`。

仍待验证：M2 新入口的真实模型质量与成本、真实用户留存、跨端文件选择与真机 HAP、72 小时运行和生产滚动升级。整项目场景枚举尚未解耦，当前四模板仅作用于委托入口。
