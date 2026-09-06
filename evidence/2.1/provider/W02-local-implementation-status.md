# W02 provider implementation status

日期：2026-08-27

## 状态

`IMPLEMENTED / G2 BLOCKED`

## 已完成

- chat 走统一的 OpenAI-compatible `/chat/completions` 契约。
- DeepSeek 预设为 `https://api.deepseek.com/v1`，模型为 `deepseek-v4-flash`。
- `LLM_PROVIDER`、chat model/base URL 和 timeout 由服务端配置解析；设置页可以编辑模型名称。
- embedding 配置与 chat 分离。DeepSeek chat 配置不会自动冒充 embedding provider。
- 没有真实 embedding provider 时，检索继续使用 keyword/metadata fallback，并标记 `keyword_fallback`。
- provider HTTP 错误只保留状态和脱敏后的短消息，不保存凭据。

## 验证边界

- 全量 `npm.cmd test`：13 个文件、89 个测试通过。
- 类型检查、lint、生产构建：均通过；生产构建保留既有附件存储 NFT tracing warning。
- 真实 DeepSeek chat 探针：一次脱敏请求返回 HTTP 200，响应模型为 `deepseek-v4-flash`，存在 choices；不保存完整响应。
- S03 20 条 Capture、真实 embedding、S04 Hybrid Search benchmark：未运行，不能产生或宣称 Gate 指标。

## 凭据处理

本轮没有将 API key 写入源码、`.env`、日志、证据、Git 或最终回执。
