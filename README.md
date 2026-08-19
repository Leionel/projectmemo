# 忆程 ProjectMemo

> 沉淀每一步，推进下一程。

忆程 ProjectMemo 是一个面向大学生项目制学习的知识资产沉淀与主动推进 Agent。它把论文笔记、代码报错、实验记录、会议结论、灵感和比赛要求沉淀为结构化知识卡片，关联历史记忆，并以可追溯的提醒、行动闭环和成果生成推动下一步交付。

## 当前可演示能力

- 项目创建、编辑、搜索、截止日期与项目总览。
- 文本碎片捕获、草稿恢复、Agent 结构化、原文追溯与人工纠错。
- 关键词记忆检索、相关卡片跳转与知识资产流。
- 截止逼近、风险未处理、项目停滞、实验缺口和材料缺口的主动介入。
- 接受、稍后、忽略提醒；行动项完成后自动生成复盘卡片。
- 决策依据、Agent 运行记录、内部准备度与效果面板。
- 带具体知识卡片引用的记忆副驾驶；一切写操作都需要用户确认。
- 六类成果：项目周报、作品说明大纲、答辩 PPT 大纲、README、简历描述和下周行动计划；支持 Markdown 渲染预览、源码编辑切换、草稿预览和版本留存。

默认使用完全离线的确定性 Mock，真实模型调用失败会自动回退，因此现场演示不依赖网络或密钥。

## 本地启动

要求：Node.js 24。Windows PowerShell 若限制 `npm.ps1`，请使用下面的 `npm.cmd`。

```powershell
copy .env.example .env
npm.cmd install
npm.cmd run db:setup
npm.cmd run dev
```

打开 <http://127.0.0.1:3000>。`db:setup` 会生成 Prisma Client、应用迁移并导入种子演示项目；它不会删除其他本地项目。

### 演示数据

```powershell
npm.cmd run db:seed
```

上述命令只重新导入“人工智能创意赛 忆程 ProjectMemo 作品开发”种子项目。若需要让演示环境只保留该项目，请显式确认后执行：

```powershell
npm.cmd run db:demo-reset -- --confirm
```

该命令会清空本地所有项目后重新导入种子数据，不可恢复。

## 模型配置

`.env` 默认配置为离线 Mock：

```env
LLM_MODE="mock"
```

如需连接 OpenAI-compatible 服务：

```env
LLM_MODE="openai-compatible"
LLM_BASE_URL="https://api.openai.com/v1"
LLM_API_KEY="your-key"
LLM_MODEL_NAME="gpt-4.1-mini"
LLM_TIMEOUT_MS="15000"
```

本机开发环境的“设置”可临时切换运行方式：API Key 不会回显、不写入文件，仅保留在当前运行进程；需要长期保存时请修改 `.env`。线上环境禁用该设置写入接口。

## 验证命令

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd exec tsc -- --noEmit
npm.cmd run build
npm.cmd run test:e2e
```

E2E 会使用独立数据库和 `3321` 端口，不影响开发数据库。

## 三分钟演示建议

1. 首页：说明“碎片输入 → 可追溯记忆 → 主动介入 → 行动回写 → 成果生成”的闭环。
2. 进入种子项目：展示项目状态、知识资产、相关卡片与准备度。
3. 启用一个演示情境或处理现有提醒：展开触发依据并接受建议。
4. 在行动板完成行动并填写结果：展示自动生成的复盘记忆和指标变化。
5. 打开记忆副驾驶或成果文档室：展示有卡片引用的回答，以及 PPT/README/作品说明的生成结果。

## 目录

```text
app/                    页面与 Route Handlers
components/             中文 UI 与交互组件
lib/agent/              Mock/LLM Provider 与 prompts
lib/services/           捕获、上下文、行动、成果等用例编排
lib/repositories/       Prisma 数据访问
prisma/                 SQLite schema、迁移与种子数据
tests/、e2e/            单元、集成与端到端测试
docs/competition/       初赛草案、迭代蓝图、海报提示词与演示截图
```

## 比赛材料

- [初赛作品说明 Markdown 草案](docs/competition/ProjectMemo_初赛作品说明文档草案.md)
- [竞赛增强与迭代蓝图](docs/competition/ProjectMemo_竞赛增强与迭代蓝图.md)
- [宣传海报生成提示词](docs/competition/忆程ProjectMemo_宣传海报生成提示词.md)

小艺 Workflow、语音/图片输入、鸿蒙客户端、真实后台推送、embedding 和记忆图谱均属于后续路线，当前版本不声称已接入。
