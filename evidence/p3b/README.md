# P3-B 仓库感知验证证据（2026-10-24）

数据来源：本地隔离测试库；GitHub 响应全部为注入 fixture（开发机到 github.com:443 不通，真实外部请求只发生在 ECS，部署后验收）。零模型调用、零凭据。

- `validation.json`：汇总（870 单测、鸿蒙 83、E2E 14/14、tsc/lint、迁移空库重放、tsc@1280 部署预检）。
- `deploy-preflight/`：typegen 与 tsc 1280MiB 堆探针日志。
- ECS 侧前置实测（用户在服务器执行）：api.github.com 可达、匿名限额 60/h 满额、公开仓库 commits JSON 可读（记录于 validation.json 与 P3B_UPDATE.md）。

关键用例见 tests/repoSensing.test.ts：游标重叠扫描、304/403/429/404、sha 去重、恶意标题只留首行、`../` 路径穿越拒绝、连接数上限、采纳幂等且行动状态不变、错/跨项目/模拟/已完成 actionId 拒绝、忽略零写入、跨用户 404、撤销后零请求、开关关闭拒绝。

## 未验收（保持明确）

- 真实仓库变更→候选→采纳的生产链路：部署后在演示项目执行并回填记录。
- 模拟器/真机操作；PR/CI/私有凭据/周期订阅（路线图后置项）。
