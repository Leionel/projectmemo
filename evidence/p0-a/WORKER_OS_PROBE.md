# P0-A 双 OS Worker 验收

运行命令（仓库根目录，Node 24）：

```powershell
node --import tsx evidence/p0-a/worker-os-probe.mjs
```

脚本创建全新的系统临时 SQLite 库，重放当前迁移，并仅在该库建立隔离账户、项目、委托及批准。数据库路径在结果中记录并保留，不读取或清理开发库、生产库、共享 `test-vitest.db`。子进程显式关闭 `.env` 载入，模型端点固定为本脚本在 `127.0.0.1` 创建的 HTTP 服务，使用无价值 fixture key。

每个被测 Worker 都是独立的真实 Node OS 进程，入口为原 `scripts/mission-worker.ts`。Runner、工具、批准提交、租约和数据库事务均使用业务实现；仅模型 HTTP 响应由本地服务预设。**这不是模型能力或真实 Agent 任务成功率测试。**

| 场景 | 断言 |
| --- | --- |
| 两进程并发争抢同一任务 | 两个不同 PID，仅一个 CLAIMED、一次模型请求、一个成功工具步骤 |
| 心跳及过期执行器 fence | 等待真实 10 秒心跳续租；在隔离库显式注入租约过期；新 Worker 获得更大 epoch；旧模型响应迟到时不得创建步骤、批准或行动 |
| kill 后自然到期恢复 | 批准真实提交一项 TODO 后，在下一次模型请求时 SIGKILL Worker；替代 Worker 等待真实 60 秒 TTL 到期（不改时间/不手工过期）；恢复保存一份草稿并完成形式条件；Action/消费回执只保留一个 |
| 结果语义 | 条件通过、草稿 NEEDS_REVIEW、采纳 0、现实 NOT_INFERRED；原 Action 仍 TODO 且没有 resultCardId |

每次运行单独写入 `evidence/p0-a/worker-os/<UTC时间>/result.json` 与各 Worker 日志。结果包含 PID、epoch、真实时间、已实施故障注入、调用数及失败原因；失败不会改写旧回执。自然 TTL 场景约需一分钟，整个脚本通常需要 80–100 秒。

预期断言不是通过回执。实际状态以对应运行目录 `result.json` 的 `passed` 及 `cases` 为准。

## 已执行结果

[`2026-10-23T13-00-05-143Z/result.json`](worker-os/2026-10-23T13-00-05-143Z/result.json)：3 组通过，进程退出码 0，运行约 76 秒。两个竞争 Worker 仅一次领取；旧 epoch 迟到结果没有创建提案；kill 后的新进程在原真实租约到期后约 0.66 秒重新领取，Action 与草稿均只保留一份。

共 7 次本地 mock HTTP 请求、0 次真实模型请求。四个 Runtime 源文件起止哈希一致，所有被测子进程已退出。此回执未覆盖真实模型质量、生产启用或物理设备交互。
