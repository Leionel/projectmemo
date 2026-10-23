# P0-A / P0-B 更新与真实模型验收

本轮 Web 和鸿蒙共用后端，新增 `CopilotToolExecution` 表，状态快照策略升级为 schema 2 / policy 3。旧快照保留为历史。更新后旧的未执行 Copilot 提案没有完整来源清单时返回 409，重新提问即可；已经消费的回执仍可重放。

## 更新线上服务

使用本轮最终提交的完整 40 位 commit。获取 `codex/r3-runtime-research`，不要使用示例中的旧版本 `4b8f706`。

从目标 commit 提取并执行 `safe-update.sh`。它核对 Node 24、服务目录、持久库、附件目录、干净工作区及版本祖先关系。停止 Web / Worker 后备份数据库与附件，保留旧依赖、生成客户端和 `.next`；安装依赖、验证 SQLite 原生模块、生成 Prisma、构建、增量迁移、健康检查，最后启动 Worker。不执行 seed 或 `db:setup`。

脚本在生产库上执行迁移，所以必须先备份。本轮迁移只新增确认回执表。自动回退恢复代码、依赖、构建及环境，保留数据库中的增量迁移；服务曾对外开放后不自动覆盖数据库，避免抹掉新写入。依赖、构建或健康检查失败时保留日志和备份。脚本本地做了语法和受控故障验证，尚未在 ECS 执行。

固定假设沿用现有部署：`/opt/projectmemo/app`、`/opt/projectmemo/data/projectmemo.db`、`/opt/projectmemo/storage`、Node `/home/projectmemo/.nvm/versions/node/v24.22.0/bin`、EnvironmentFile `/etc/projectmemo/projectmemo.env`、监听 `127.0.0.1:4400`。不符合时脚本停止，先核对实际 unit，不盲目改路径。

## 真实模型验收（独立于部署）

执行 `verify-p0a.sh COMMIT` 只准备独立工作树并 dry run；增加 `--live --confirm-cost` 才使用服务器现有模型凭据。不读取个人项目，不对线上数据库执行迁移，不向外网研究，不运行线上 Worker。

环境变量沿用：`LLM_PROVIDER`、`LLM_BASE_URL`、`LLM_MODEL_NAME`、`LLM_API_KEY`、`LLM_MODE`。密钥只放在服务器 EnvironmentFile。验收脚本在自己的进程中开启必要功能，不更改线上环境文件。

真实付费累计最多 **60 次模型请求 / 10 元，先触上限就停**，包括协议探针、失败和一次格式纠错。一次请求前按官方上下文上限和峰时未缓存价格预留费用；没有 usage 的失败保留全部预留，不计成零。当前只接受价格已核对的官方 DeepSeek endpoint 与白名单模型；其他供应商/模型会报 `PRICE_NOT_VERIFIED`，须重新核对价格后适配，不能猜价。

固定账本路径是 `/opt/projectmemo/evaluations/p0a-COMMIT/tmp/p0-a-live/budget.json`。协议探针与三次闭环共用账本，重复命令不重置次数或重跑失败编号。不要复制目录再执行同一授权；不要删除 `.lock`、账本或失败结果来恢复额度。进程异常退出时应先核对请求与供应商账单。

三个内部委托均为合成项目：实际 Adapter → 实际读取工具 → 观察回传 → 追问私有指标 → 预声明合成补料 → 同 Mission 接续 → 保存带引用草稿 → 调用正式归入服务。服务器结果里的“工程闭环完成”仍需人工阅读草稿，不能据此宣称真实项目效果或实验指标已核验。行动批准/重复消费/宕机恢复另由本地独立库与双 OS 进程测试覆盖。

结果 `results.json` 保存每次尝试、草稿、来源版本、步骤和形式核验；`budget.json` 保存请求哈希、usage 与费用上界，不保存密钥和原始提示词。请回传两份 JSON 的脱敏内容及退出码，用于判定真实协议与内容质量。`FIXTURE_HTTP` 是模拟测试，实际费用为零，里面的费用上界只用于测试预算算法。

## P0-B 核验开关

新增 `COPILOT_CLAIM_JUDGE_ENABLED=false`，默认只做本地规则，不新增付费调用。显式开启后每次回答最多三次共享 Judge，继续受现有账户云调用配额限制。失败保留未核验，不能变成通过。它与 `MISSION_CLAIM_JUDGE_ENABLED` 分别控制；本轮不自动打开任一个。

两端的“引用可用”表示来源准入；“当前有效/历史/争议/未知”来自同一 Ledger；“原文支持/相反/不足/尚未核验”是文本支持轴。原文支持某句话仍不等于现实结果已被独立证实。
