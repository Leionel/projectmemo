# 切片 A：四类合成项目的持续改稿评测

日期：2026-11-16。命令入口：`npm.cmd run eval:v2`（实为 `tsx scripts/eval-v2.ts`）。

## 覆盖的四条旅程与阶段

`lib/evaluation/journey.ts` 定义并在隔离库中依次执行：

1. 开发发布准备（独立开发者）
2. 客户验收交付（自由职业者）
3. 科研阶段汇报（重要对照）
4. 学生课程项目（重要对照）

每条旅程都复用真实 `modelAdapter` / Mission Runner / Worker 扫描器 / 工具守卫 / 成果验收器：

初稿 → 新增材料（既有扫描器唤醒同一 Mission）→ 后台续稿 → “继续整理，但不要联网”限制 →
有限目标改道（同一 Mission）→ 再次交付 → 暂停或取消。

记录项：Mission/Output 版本、来源指纹、Skill 接力事件、provider/model、真实工具调用、token 用量、
失败原因、预算变化、控制前后的派发差异。

## 三种 provider

| provider | 传输 | 本轮状态 | 证明什么 |
|---|---|---|---|
| `fixture` | 进程内确定性注入 | 已运行，退出 0 | 执行器正确性、持久化与管道级内容传播 |
| `http` | 本机 127.0.0.1 OpenAI-compatible mock，走真实 `chooseNext` HTTP/JSON 适配器 | 已运行，退出 0 | 真实模型适配路径（请求构造、JSON 解析、usage 记录）可用 |
| `live` | 真实模型 API | **未运行** | 需要用户明确授权调用范围与上限 |

真实模型命令（待授权）：

```powershell
npm.cmd exec tsx -- scripts/eval-v2.ts --provider=live --confirm-paid --max-models=12 --max-tokens=60000
```

未带 `--confirm-paid` 或缺少 `LLM_MODE/LLM_API_KEY/LLM_BASE_URL` 时命令以退出码 2 结束，不发起任何请求；
`--max-models` 写入有界策略的模型预算（超额由原预算守卫停止），token 上限在运行后核对并记入报告。

## 结果（离线两模式均 64/64 检查通过）

- 协议/持久化 40/40：同一 Mission、三版均有 checkpoint、预算单调不重置、限制先于派发、改道同 Mission 交付、暂停/取消后零派发、无旧 finish、工具只用本地读取与私有稿、provider 留痕。
- 内容管道级 24/24：新增材料确实改变第 2 版且引用新来源、旧依据保留、未知条件未写成事实、改道落到第 3 版、三版正文不重复、引用可回溯。
- 模拟 HTTP 模式 modelCalls=64、记录 token=5760；fixture 模式 token=1080。均为本地注入，无付费调用。

## 解读边界

离线注入/模拟 HTTP 的“内容质量”证明的是：材料、证据、限制、改道与预算确实进入持久草稿，
并且评测能区分协议正确性与内容变化。它**不**证明真实模型的写作质量、事实准确性或成本；
真实模型结果须用 `--provider=live` 单独验收，并与本离线基线分开报告。

## 未验证

- 真实模型连续改稿质量与 token 成本（待授权）。
- 72 小时真实时钟、断电恢复、真机/HAP、生产滚动升级。
- 内容语义判据的独立人工审核。
