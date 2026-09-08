# W03 公网部署漂移审计

日期：2026-09-04

## 结论

公网 HTTPS 与最早的 `record_memory` tracer bullet 已上线，但 ECS 没有部署本地仓库中的另外三条工具路由。W03 当前状态为 `PARTIAL / DEPLOYMENT_DRIFT`，不能进入 20 轮平台对账。

## 只读探针结果

探针没有使用真实 Token。写接口使用缺失或确定无效的 Bearer Token，因此按契约只能返回 401，不应产生数据。

| 检查 | HTTP | 响应 | 判断 |
|---|---:|---|---|
| `GET /health` | 200 | `status=ok`、`service=projectmemo` | HTTPS、Nginx 与 Next.js 在线 |
| `POST /xiaoyi/v1/memories` | 401 | JSON `XIAOYI_UNAUTHENTICATED` | 路由存在，鉴权生效 |
| `POST /xiaoyi/v1/memories/search` | 404 | HTML 页面 | 公网版本缺少 `query_memory` 路由 |
| `POST /xiaoyi/v1/projects/inspect` | 404 | HTML 页面 | 公网版本缺少 `inspect_project` 路由 |
| `POST /xiaoyi/v1/actions` | 404 | HTML 页面 | 公网版本缺少 `create_action` 路由 |

复核时公网 `/health` 返回时间：`2026-09-03T16:24:53.325Z`。`verify:w03-public` 以退出码 1 阻止继续做真实写入，符合预期。

同一脚本随后对本地 production build 做反向验证：`schema_version=2.1`、版本指纹、四项能力和四条路由鉴权共六项检查全部为 `true`。这证明预检能够区分“本地新版完整”和“公网仍为旧部署”，但不能替代真实 Token 的 20 轮业务对账。

## 已补的防漂移措施

- `/health` 新增 `schema_version`、`release` 和四项 `capabilities`，不公开 Token、固定项目 ID 或其他环境变量。
- `npm run verify:w03-public` 核验 HTTPS、版本指纹、能力列表和四条路由的鉴权边界，不产生写入。
- `npm run verify:w03-live` 只有在显式提供 Token 并使用写入命令时才运行 20 轮真实对账；它会创建 5 张测试卡片和 5 条测试行动。

## 解除阻塞

1. 把包含四条路由和新版 `/health` 的已验证提交部署到 ECS。
2. 设置 `PROJECTMEMO_RELEASE` 为该提交号并重启服务。
3. 运行 `npm.cmd run verify:w03-public`，要求六项检查全部为 `true`。
4. 在固定测试项目运行 `npm.cmd run verify:w03-live`。
5. 用 DevEco 模拟器核对回执中的 `card_id` 和 `action_id`。
6. 最后从小艺平台各调用一次，替换手工网络诊断证据。

## 2026-09-07 本地后续修复

为解决小艺工作流当前无法产生稳定关联 ID 的问题，本地仓库新增 `POST /xiaoyi/v1/requests/begin`。它沿用 Bearer 鉴权、适配层开关、固定测试项目和限流，只生成一次性 UUID，不接受请求体中的 `project_id`/`request_id`，不创建卡片、行动或 `AgentRun`。`/health` 保留四项 S08 业务能力，并另列 `workflow_helpers: ["begin_request"]`。

`verify:w03-public` 现额外对该辅助路由做无效 Token JSON 401 预检；四项业务能力数量不变。`verify:w03-live --confirm-writes`（本轮未运行）会在每个循环先获取一个 `request_id`，再让 record/query/inspect/create 两阶段复用它。该 UUID 只保证单次工作流运行内的关联；整轮重试会生成新 UUID，不能替代跨整轮重试幂等键。

以上是未部署的本地变更，不会改写本节 2026-09-04 对公网旧版本的历史结果。ECS、平台真实调试、20 轮对账和真机小艺入口仍为 `UNVERIFIED`；上线前需部署包含该辅助路由的提交，并重新运行公网预检。
