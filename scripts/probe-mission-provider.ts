import { getChatProviderConfig } from "../lib/config/provider";
const live = process.argv.includes("--live");
if (!live) {
  console.log(JSON.stringify({ mode: "DRY_RUN", modelVerified: false, cases: ["仅内部查询", "外部方法研究", "缺少私有指标需要提问"], liveRequires: "--live --confirm-cost" }));
} else {
  if (!process.argv.includes("--confirm-cost")) throw new Error("真实探针需明确授权额度并传入 --confirm-cost");
  const cfg = getChatProviderConfig();
  for (const question of ["只查询项目已记录的状态", "检索最新公开技术方法", "项目没有记录实验指标，请决定下一步"]) {
    const response = await fetch(`${cfg.baseUrl}/chat/completions`, { method: "POST", signal: AbortSignal.timeout(20000), headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` }, body: JSON.stringify({ model: cfg.model, messages: [{ role: "user", content: question }], tools: ["inspect_project", "web_search", "ask_user"].map(name => ({ type: "function", function: { name, description: name, parameters: { type: "object", properties: {} } } })), ...(cfg.provider === "deepseek" ? { thinking: { type: "disabled" } } : {}) }) });
    const value = await response.json();
    console.log(JSON.stringify({ question, status: response.status, toolCalls: value.choices?.[0]?.message?.tool_calls, usage: value.usage }));
  }
}
