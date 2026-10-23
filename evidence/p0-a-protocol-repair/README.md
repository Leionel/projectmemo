# P0-A 协议与声明分句修复验收

数据来源：`ecs-baseline.json` 是用户提供的 ECS 终端回执摘要；`fixture-results.json` 是本地合成项目与模拟 HTTP，未使用真实模型。

## 本地检查

- `npm.cmd test`：95 个文件，765 项通过。
- 后续定向回归：5 个文件，32 项通过，包含新增的版本续验检查。
- Adapter / Runner / SQLite 回归覆盖连续格式失败、暂停、恢复同一 Mission、保存草稿和完成形式条件；累计 5 次模拟请求，已有步骤与预算未重置。
- `npm.cmd exec tsc -- --noEmit`、`npm.cmd run lint`：通过。
- `npm.cmd run build -- --webpack`：通过。
- `npm.cmd run test:e2e`：14 项通过，0 项失败，摘要见 `e2e-stats.json`。
- 三项合成委托闭环通过；相同代码显式重放仍为累计 17 次模拟请求。
- `bash -n deploy/alibaba-cloud-linux/verify-p0a.sh`、`git diff --check`：通过。

完整本地日志保留在本目录，按仓库忽略规则不纳入提交。此次没有新增真实模型调用，也未部署 ECS。真实失败回复的原文不可用，无法确定原两次 INVALID_JSON 的唯一原因；续验应复用原数据库与累计 17 次调用的账本，命令见 `deploy/alibaba-cloud-linux/P0_AB_UPDATE.md`。
