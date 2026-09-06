# W03 小艺平台工具配置回执

日期：2026-08-27

## 状态

`PARTIAL / PLATFORM_TOOLS_CONFIGURED`

本回执记录 Edge 中可见且已保存的平台配置，不把工具配置冒充成真实运行闭环。

## 平台配置

- 云插件：`ProjectMemo 记忆记录`
- 插件状态：`已上架`
- API Base URL：`https://project.luojiatutor.xyz`
- 工具总数：4（原有 `Memory_Recorded` + 本轮新增 3 个）
- 三个新增工具的启用开关均为开启。

| 工具 | 方法与路径 | 输入参数 | 输出参数 | 调试状态 |
|---|---|---|---|---|
| `query_memory` | `POST /xiaoyi/v1/memories/search` | `query`、`limit`、`request_id`、Header `Authorization` | `results` Object | 未调试 |
| `inspect_project` | `POST /xiaoyi/v1/projects/inspect` | `request_id`、`refresh`、Header `Authorization` | `result` Object | 未调试 |
| `create_action` | `POST /xiaoyi/v1/actions` | `request_id`、`confirmed`、`proposal_id`、`title`、`description`、`priority`、`due_at`、`source_intervention_id`、`source_card_id`、Header `Authorization` | `result` Object | 未调试 |

## 安全与验收边界

- `create_action` 的输入描述保留两步协议：`confirmed=false` 只返回提案；确认提交时使用 `proposal_id`，由服务端执行写入校验。
- 本轮没有在平台输入或传输 DeepSeek API key、适配层 Bearer Token 或其他敏感凭据。
- 未点击“上架”或改变插件发布状态。
- 尚未执行平台远程调试、20 轮正常/负向调用、`proposal_id`/`action_id` 对账或 App 同 ID 验证；上述项目保持 `UNVERIFIED`，待配置可用的适配层授权后再验收。
