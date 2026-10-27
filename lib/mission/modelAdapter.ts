import { z } from "zod";
import { missionStrategyV2 } from "@/lib/agent/specialistPrompts";
import { isFeatureEnabled } from "@/lib/config/features";
import { AppError } from "@/lib/api";
import { getChatProviderConfig } from "@/lib/config/provider";
import { choiceSchema, type Decision } from "./contracts";
import type { ToolSet } from "./tools";
import { ModelProtocolError, protocolDiagnostic, type ProtocolReason } from "./modelProtocol";
import { DecisionJsonError, parseDecisionJson } from "./decisionJson";
export type DecisionProvider = (context: string, tools: ToolSet) => Promise<Decision>;
export const chooseNext: DecisionProvider = async (context, tools) => {
  if (process.env.LLM_MODE !== "openai-compatible") throw new AppError("MODEL_UNAVAILABLE", "未启用真实模型，委托已暂停；测试脚本不代表真实自主执行", 503);
  const cfg = getChatProviderConfig(); const native = process.env.MISSION_MODEL_PROTOCOL === "native";
  const deepseek = cfg.provider === "deepseek" || new URL(cfg.baseUrl).origin === "https://api.deepseek.com";
  const definitions = Object.entries(tools).map(([name, t]) => ({ type: "function", function: { name, description: t.description, parameters: z.toJSONSchema(t.schema) } }));
  const fullContext=JSON.parse(context) as {outputTokenLimit?:number;protocolRepair?:{reason?:string};observations?:Array<{callId?:string;status?:string}>};
  // Reuse the existing single repair window, with a forced decision function on DeepSeek.
  // This is transport for Choice, not an additional business tool or an extra model call.
  const functionChoice = !native && deepseek && ["INVALID_JSON", "INVALID_CHOICE", "INVALID_TOOL_ARGUMENTS"].includes(fullContext.protocolRepair?.reason ?? "");
  const decisionFunction = { type: "function", function: { name: "select_mission_step", description: "提交下一步决策；不执行业务写入。只能选择给定工具、追问或结束。", parameters: { ...z.toJSONSchema(choiceSchema), type: "object" } } };
  const modelContext=native?{...fullContext,observations:fullContext.observations?.filter(o=>!o.callId||o.status!=="SUCCEEDED")}:fullContext;
  const messages = [
    { role: "system", content: native ? missionStrategyV2.system.split("只返回完整 JSON")[0] + "原生工具可用时直接调用一个给定工具；追问或结束返回符合 responseSchema 的 JSON。" : missionStrategyV2.system },
    { role: "user", content: JSON.stringify({ kind: "UNTRUSTED_DATA", context: modelContext, tools: native ? undefined : definitions, responseSchema: z.toJSONSchema(choiceSchema), response: (native ? "优先调用一个原生工具；若需追问或结束，" : "") + "每次只返回一个符合 responseSchema 的 JSON 对象。工具参数严格遵守 parameters，不附 Markdown 或解释。草稿简明，控制在本次输出预算内。完成前须先保存草稿，finish.outputId 使用已保存的真实 ID。协议错误事件中的 repairHint 是格式修正要求，保留已有成功步骤，不重复读取已充分的资料。", example: native ? {kind:"ask",question:"请补充必要信息",missing:"PRIVATE"} : tools.inspect_project ? {kind:"tool",tool:"inspect_project",args:{},summary:"读取项目"} : undefined }) },
  ];
  if (isFeatureEnabled("MISSION_EVIDENCE_FIT_ENABLED", false)) messages[0].content += "仅对GPU显存测量问题，可附requirements.evidenceFitV1:{schemaVersion:1,domain:TECH_RESOURCE_MEASUREMENT,measurement:{name:GPU_MEMORY,unit:GB或MB,upperLimit:原文明确的预算可选},checks:[{id:SUBJECT或STAGE或CONDITION_1或CONDITION_2,expected:原问题明确主体/阶段/条件,basis:{kind:QUESTION或CONSTRAINT,quote:对应原文}}]}。必须有主体与阶段，阶段写训练或推理，至多两个额外条件。没有明确依据就不附此块；这只是待用户核对的候选，不能推断已验证。绑定观察后的evidenceFitReview独立保留用途、未决项、负结果及原文范围；条件分析不得把未知写成事实，用户提供的论文摘录不得写成本项目实测或系统抓取。";
  if (functionChoice) messages[0].content += "本次必须通过select_mission_step函数参数提交一个完整的Choice对象。";
  if(native){
    const history=(JSON.parse(context) as {observations?:Array<{status:string;tool:string;callId?:string;input:unknown;observation:unknown}>}).observations??[];
    for(const h of history.filter(h=>h.status==="SUCCEEDED"&&h.callId)){
      messages.push({role:"assistant",content:"",tool_calls:[{id:h.callId,type:"function",function:{name:h.tool,arguments:JSON.stringify(h.input)}}]} as unknown as typeof messages[number]);
      messages.push({role:"tool",tool_call_id:h.callId,content:JSON.stringify(h.observation)} as unknown as typeof messages[number]);
    }
  }
  const response = await fetch(`${cfg.baseUrl}/chat/completions`, { method: "POST", signal: AbortSignal.timeout(Math.min(cfg.timeoutMs, 20000)), headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` }, body: JSON.stringify({ model: cfg.model, temperature: 0.2, max_tokens: fullContext.outputTokenLimit === 2000 ? 2000 : 1000, messages, ...(native ? { tools: definitions } : functionChoice ? { tools: [decisionFunction], tool_choice: { type: "function", function: { name: "select_mission_step" } } } : deepseek ? { response_format: { type: "json_object" } } : {}), ...(deepseek ? { thinking: { type: "disabled" } } : {}) }) });
  if (!response.ok) throw new AppError("MODEL_HTTP_ERROR", `模型服务返回 ${response.status}`, response.status >= 500 ? 503 : 409);
  const token = z.number().int().nonnegative().nullable().catch(null);
  const envelope = z.object({ choices: z.array(z.object({ finish_reason: z.string().nullish(), message: z.object({ content: z.string().nullish(), tool_calls: z.array(z.object({ id: z.string().min(1), function: z.object({ name: z.string(), arguments: z.string() }) })).optional() }) })).min(1), usage: z.object({ prompt_tokens: token, completion_tokens: token }).optional() });
  const metadata = { prompt: { id: missionStrategyV2.id, version: missionStrategyV2.version, purpose: missionStrategyV2.purpose, outputSchemaVersion: missionStrategyV2.outputSchemaVersion }, provider: cfg.provider, model: cfg.model, protocol: native ? "NATIVE_TOOL" : functionChoice ? "FUNCTION_CHOICE" : "JSON_CHOICE", usage: { inputTokens: null, outputTokens: null } as Decision["usage"] };
  let raw: unknown;
  try { raw = await response.json(); } catch { throw new ModelProtocolError(protocolDiagnostic("INVALID_RESPONSE", null, 0), metadata); }
  // Usage remains available even if the decision envelope or body is invalid.
  if (raw && typeof raw === "object" && "usage" in raw) {
    const usage = z.object({ prompt_tokens: token, completion_tokens: token }).safeParse(raw.usage);
    if (usage.success) metadata.usage = { inputTokens: usage.data.prompt_tokens, outputTokens: usage.data.completion_tokens };
  }
  const parsed = envelope.safeParse(raw);
  if (!parsed.success) throw new ModelProtocolError(protocolDiagnostic("INVALID_RESPONSE", null, 0), metadata);
  const { message, finish_reason } = parsed.data.choices[0];
  const call = message.tool_calls?.[0];
  const content = call ? call.function.arguments : message.content ?? "";
  const fail = (reason: ProtocolReason, error?: z.ZodError): never => { throw new ModelProtocolError(protocolDiagnostic(reason, finish_reason, content.length, error?.issues.slice(0, 8).map(issue => ({ code: issue.code, path: issue.path.join(".") }))), metadata); };
  if (finish_reason === "length") fail("TRUNCATED");
  if (finish_reason === "content_filter") fail("INVALID_RESPONSE");
  if (finish_reason && !["stop", "tool_calls", "length", "content_filter"].includes(finish_reason)) fail("INVALID_RESPONSE");
  if ((message.tool_calls?.length ?? 0) > 1) fail("MULTIPLE_TOOL_CALLS");
  if (functionChoice && (!call || call.function.name !== "select_mission_step")) fail("INVALID_RESPONSE");
  if (!content.trim()) fail("EMPTY_CONTENT");
  let value: unknown, serialization: Decision["serialization"];
  // Accept only a fence enclosing the entire JSON, never extract or repair fragments.
  const text = content.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, "$1");
  try { const parsed = parseDecisionJson(text); value = parsed.value; if (parsed.escapedControls) serialization = { escapedControls: parsed.escapedControls, responseHash: parsed.responseHash }; }
  catch (error) {
    if (error instanceof DecisionJsonError) throw new ModelProtocolError({ ...protocolDiagnostic("INVALID_JSON", finish_reason, content.length), json: error.diagnostic }, metadata);
    throw error;
  }
  const decision = choiceSchema.safeParse(call && !functionChoice ? { kind: "tool", tool: call.function.name, args: value, summary: "" } : value);
  if (!decision.success) fail("INVALID_CHOICE", decision.error);
  const choice = decision.data!;
  if (choice.kind === "tool") {
    const tool = tools[choice.tool];
    if (!tool) fail("UNKNOWN_TOOL");
    const args = tool.schema.safeParse(choice.args);
    if (!args.success) fail("INVALID_TOOL_ARGUMENTS", args.error);
  }
  return { choice, ...metadata, serialization, callId: functionChoice ? undefined : call?.id };
};
