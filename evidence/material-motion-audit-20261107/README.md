# 材质与动效审查证据（2026-11-07）

对应报告：`docs/design/PROJECTMEMO_MATERIAL_MOTION_AUDIT.md`

- 基线：`e0fa08b`，生产构建目录 `.next-e2e`（构建于该提交前 5 分钟，差异仅 `IntakeCoveragePanel`、`ProjectIntakeForm`）。
- 数据：`prisma/projectmemo-e2e.db` 的副本，放在临时目录；原库未改动。
- 模型：mock（`LLM_MODE=mock`，未调用真实模型）。
- 账号：隔离库内的 `e2e-reviewer` 测试身份，凭据来自 `scripts/e2e-env.ts`。
- Agent 富块截图（`screens/agent-*`）：真实组件，接口响应由 Playwright 注入假内容。
- `before-after/`：只在测试浏览器中注入 CSS，没有修改生产代码。
- 渲染器：Chromium + ANGLE（RTX 4060，D3D11）。headless 下 rAF 不受 vsync 限制，帧时间不能判断 GPU 成本，只有主线程指标可用。
- 鸿蒙：本轮未运行构建，报告引用 `docs/FINAL/NewHMUI/` 的既有截图。

`scripts/` 是采集脚本，依赖运行在 `127.0.0.1:33399` 的隔离服务，路径按本机写死，仅用于复核方法。
