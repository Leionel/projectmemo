# P0-A / P0-B 更新与真实模型验收

本轮 Web 和鸿蒙共用后端，新增 `CopilotToolExecution` 表，状态快照策略升级为 schema 2 / policy 3。旧快照保留为历史。更新后旧的未执行 Copilot 提案没有完整来源清单时返回 409，重新提问即可；已经消费的回执仍可重放。

## 更新线上服务

日常发布使用 [ECS 更新命令](README.md#更新发布已部署机器) 中的 root heredoc 和 `mktemp` 流程。下方保留本阶段迁移、历史故障与真实模型验收说明；Focus 上线另见 [开关与验收](FOCUS_UPDATE.md)。

使用本轮最终提交的完整 40 位 commit。获取 `codex/r3-runtime-research`，不要使用示例中的旧版本 `4b8f706`。

从目标 commit 提取并执行 `safe-update.sh`。它核对 Node 24、服务目录、持久库、附件目录、干净工作区及版本祖先关系。停止 Web / Worker 后备份数据库与附件，保留旧依赖、生成客户端和 `.next`；安装依赖、验证 SQLite 原生模块、生成 Prisma、构建、增量迁移、健康检查，最后启动 Worker。不执行 seed 或 `db:setup`。

脚本在生产库上执行迁移，所以必须先备份。P0-A/P0-B 新增确认回执表；此次协议修复没有新增迁移。自动回退恢复代码、依赖、构建及环境，保留数据库中的增量迁移；服务曾对外开放后不自动覆盖数据库，避免抹掉新写入。依赖、构建或健康检查失败时保留日志和备份。用户提供的 ECS 输出已确认 `bda4da9cecb6ef39de36b5ef0c0717df7a22237f` 部署及健康检查成功；此次修复尚未部署。

固定假设沿用现有部署：`/opt/projectmemo/app`、`/opt/projectmemo/data/projectmemo.db`、`/opt/projectmemo/storage`、Node `/home/projectmemo/.nvm/versions/node/v24.22.0/bin`、EnvironmentFile `/etc/projectmemo/projectmemo.env`、监听 `127.0.0.1:4400`。不符合时脚本停止，先核对实际 unit，不盲目改路径。

### 构建内存

用户提供的第二次更新输出显示：`652dd5b` 编译成功，但 TypeScript 检查触及旧脚本的1024 MiB V8堆上限，发生 `JavaScript heap out of memory`。脚本已恢复 `bda4da9` 的代码、依赖、构建与环境，Web及Worker重新运行；真实模型续验未执行。

当前脚本默认堆上限1536 MiB，可用 `PROJECTMEMO_BUILD_HEAP_MB=3072 bash safe-update.sh COMMIT` 覆盖（允许1024至16384 MiB，只是上限）。停服前要求 `/proc/meminfo` 中 `MemAvailable + SwapFree` 至少为该值加1024 MiB，不足则停止，不修改服务器swap。停服备份后会按 `MemAvailable - 384 MiB` 再次收紧实际堆，下限1280 MiB（2026-10-24 实测独立 `tsc --noEmit` 在 P3-A 代码量下需要约1280 MiB 堆，1024 会 OOM）；空闲swap不足3 GiB且可用内存不足以支撑下限时失败并自动恢复旧版本。

2026-10-24 起，构建拆为 `next typegen`（生成新鲜路由类型）→ 独立 `tsc --noEmit`（失败即回滚）→ 跳过构建内类型检查的 `next build --webpack`（`CIRCLE_NODE_TOTAL=1`）。类型检查仍是发布硬门禁，只是不再与编译主进程并行驻留内存——Next.js 16 的构建内检查会额外启动一个 TypeScript 子进程，两进程合计内存是低内存机器 OOM 的直接原因。仍不要用 `typescript.ignoreBuildErrors` 等手段绕过独立类型检查，也不要自动执行 `npm audit fix --force` 来处理内存失败。

## 真实模型验收（独立于部署）

执行 `verify-p0a.sh COMMIT` 只准备独立工作树并 dry run；增加 `--live --confirm-cost` 才使用服务器现有模型凭据。不读取个人项目，不对线上数据库执行迁移，不向外网研究，不运行线上 Worker。

环境变量沿用：`LLM_PROVIDER`、`LLM_BASE_URL`、`LLM_MODEL_NAME`、`LLM_API_KEY`、`LLM_MODE`。密钥只放在服务器 EnvironmentFile。验收脚本在自己的进程中开启必要功能，不更改线上环境文件。

真实付费累计最多 **60 次模型请求 / 10 元，先触上限就停**，包括协议探针、失败和一次格式纠错。一次请求前按官方上下文上限和峰时未缓存价格预留费用；没有 usage 的失败保留全部预留，不计成零。当前只接受价格已核对的官方 DeepSeek endpoint 与白名单模型；其他供应商/模型会报 `PRICE_NOT_VERIFIED`，须重新核对价格后适配，不能猜价。

固定账本路径是 `/opt/projectmemo/evaluations/p0a-COMMIT/tmp/p0-a-live/budget.json`。协议探针与三次闭环共用账本，普通重复命令不重置次数或重跑失败编号。不要复制目录再执行同一授权；不要删除 `.lock`、账本或失败结果来恢复额度。进程异常退出时应先核对请求与供应商账单。

### 修复版本续验

2026-10-23 的首轮真实验收：协议探针通过；三个内部委托中一次完成工程闭环，两次补料后因 INVALID_JSON 暂停。原账本 runId 为 `8c893117-6de1-414c-9d3e-788fc7217860`，累计17次调用、费用上界0.124676元。该轮失败不删除、不改写成通过。

修复版执行：

```bash
bash verify-p0a.sh 修复版完整COMMIT --live --confirm-cost \
  --continue-from bda4da9cecb6ef39de36b5ef0c0717df7a22237f
```

脚本仍使用原 `p0a-bda4da9...` 目录，先核对工作树、原数据库/结果/账本和锁，再切换测试代码。不会新建预算；发现其他真实账本时停止。新的协议探针和两个失败 Mission 的接续全部计入原60次/10元上限。旧成功项保留；失败项通过正式 resume 恢复同一 Mission，沿用原补料、成功步骤与单任务预算。

`results-archive-<sha256>.json` 保留旧结果的原始字节与来源版本，`attempts` 追加续验记录。`latestTrials` 标出每个结果的版本以及是否沿用历史结果。脚本退出码按最新一次协议探针和每项最新尝试判断；历史失败仍计入 `historicalFailureCount`。相同代码再次执行不会反复消耗模型额度。

修复内容：官方 DeepSeek 地址即使使用旧的通用 provider 配置也启用 JSON / non-thinking；一次格式修复窗口可切换到强制 `select_mission_step` 决策函数，仍经原 Choice/工具参数校验。仅对字符串内未转义控制字符做无损编码处理，不补齐残缺结构；失败只记录语法类别、位置和响应哈希。声明核验升级到 `r33-v2`，跳过纯展示标题、空行与列表编号，保留真实声明的原始文本范围；原文相同仍不自动视为语义已核验。

三个内部委托均为合成项目：实际 Adapter → 实际读取工具 → 观察回传 → 追问私有指标 → 预声明合成补料 → 同 Mission 接续 → 保存带引用草稿 → 调用正式归入服务。服务器结果里的“工程闭环完成”仍需人工阅读草稿，不能据此宣称真实项目效果或实验指标已核验。行动批准/重复消费/宕机恢复另由本地独立库与双 OS 进程测试覆盖。

结果 `results.json` 保存每次尝试、草稿、来源版本、步骤和形式核验；`budget.json` 保存请求哈希、usage 与费用上界，不保存密钥和原始提示词。请回传两份 JSON 的脱敏内容及退出码，用于判定真实协议与内容质量。`FIXTURE_HTTP` 是模拟测试，实际费用为零，里面的费用上界只用于测试预算算法。

## P0-C 收口与 P1-A 统一下一步

P0-C原始真实结果、累计账本与哈希已归档到 `evidence/p0-c/`。原账本累计23次调用、记录费用上界0.188372元；此次实现没有新增付费调用。无需为发布P1-A重新运行真实模型验收。

P1-A新增迁移 `20261023160000_project_agent_focus`，仅给ProjectMembership加可空的个人关注指针。继续使用 `safe-update.sh` 先备份、构建后增量迁移；不执行seed或db:setup。旧代码可忽略新列，回滚保留数据。

`PROJECT_AGENT_CONTEXT_ENABLED` 默认开启；设置false可回退旧页面选择方式。新 `/api/projects/:id/agent-context` 以当前会话读取，只返回授权项目；PATCH只允许OWNER选择本人、同项目、尚未结束的Mission或清除关注，不创建、启动或批准委托。Web概览、Reentry、焦点与ArkTS使用同一投影。新版鸿蒙APK/HAP仍需单独安装验收；更新ECS不等于设备已更新。

## P0-B 核验开关（默认保持关闭）

新增 `COPILOT_CLAIM_JUDGE_ENABLED=false`，默认只做本地规则，不新增付费调用。显式开启后每次回答最多三次共享 Judge，继续受现有账户云调用配额限制。失败保留未核验，不能变成通过。它与 `MISSION_CLAIM_JUDGE_ENABLED` 分别控制；本轮不自动打开任一个。

两端的“引用可用”表示来源准入；“当前有效/历史/争议/未知”来自同一 Ledger；“原文支持/相反/不足/尚未核验”是文本支持轴。原文支持某句话仍不等于现实结果已被独立证实。
