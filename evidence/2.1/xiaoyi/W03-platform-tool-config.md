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

## 2026-09-07 本地工作流关联辅助能力

本次只更新仓库代码和验收说明，没有操作 Edge、没有部署 ECS，也没有改变平台插件配置。为解决工作流当前没有稳定请求 ID 的问题，Backend 新增内部辅助路由：

| 辅助能力 | 方法与路径 | 请求 | 返回 | 是否属于 S08 业务能力 |
|---|---|---|---|---|
| `begin_request` | `POST /xiaoyi/v1/requests/begin` | 仅 `Authorization: Bearer <token>`；请求体为空或 `{}` | `ok`、UUID `request_id`、`issued_at` | 否，仅用于一次工作流运行的关联 |

配置到平台时，把 `begin_request` 作为第一个插件节点，只填写 Authorization Header，不让模型传入或覆盖 `project_id`、`request_id`。将它返回的 `request_id` 映射给后续 `record_memory`、`query_memory`、`inspect_project` 和 `create_action`；`create_action` 的预览和确认两阶段复用同一个 ID。`query_memory` 首次使用 `limit=5`，`inspect_project` 首次使用 `refresh=false`。

该辅助路由只生成 UUID，不创建卡片、行动或 `AgentRun`。UUID 在同一次工作流运行内可复用，但整轮工作流重试会重新调用 `begin_request` 并得到新 ID，因此不能把它当作跨整轮重试的幂等键；若平台以后提供稳定的事件/请求 ID，应优先映射那个字段。当前回执中的平台工具仍为四项、辅助节点尚未在平台调试，W03/G3 继续保持 `UNVERIFIED`。

## 安全与验收边界

- `create_action` 的输入描述保留两步协议：`confirmed=false` 只返回提案；确认提交时使用 `proposal_id`，由服务端执行写入校验。
- 本轮没有在平台输入或传输 DeepSeek API key、适配层 Bearer Token 或其他敏感凭据。
- 未点击“上架”或改变插件发布状态。
- 尚未执行平台远程调试、20 轮正常/负向调用、`proposal_id`/`action_id` 对账或 App 同 ID 验证；上述项目保持 `UNVERIFIED`，待配置可用的适配层授权后再验收。
