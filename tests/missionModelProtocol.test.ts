import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chooseNext } from "@/lib/mission/modelAdapter";
import { projectTools } from "@/lib/mission/tools";

beforeEach(() => {
  vi.stubEnv("LLM_MODE", "openai-compatible");
  vi.stubEnv("LLM_API_KEY", "test-key");
  vi.stubEnv("LLM_PROVIDER", "deepseek");
  vi.stubEnv("MISSION_MODEL_PROTOCOL", "json");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const decision = { kind: "tool", tool: "inspect_project", args: {}, summary: "读取项目" };
function response(content: unknown, finish_reason = "stop", extra = {}) {
  const mock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason, message: { content, ...extra } }], usage: { prompt_tokens: 120, completion_tokens: 80 } })));
  vi.stubGlobal("fetch", mock);
  return mock;
}
describe("Mission 真实模型响应边界（模拟 HTTP，无付费调用）", () => {
  it("DeepSeek JSON mode 使用实际 Schema 和合法示例，校验完整决策", async () => {
    const mock = response(JSON.stringify(decision));
    expect((await chooseNext("{}", projectTools)).choice).toEqual(decision);
    const body = JSON.parse((mock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.max_tokens).toBe(1000);
    const prompt = JSON.parse(body.messages[1].content);
    expect(prompt.responseSchema.oneOf).toHaveLength(3);
    expect(prompt.example.args).toEqual({});
  });
  it("完整 fenced JSON 兼容；解释文字和残缺 JSON 不做猜测性修补", async () => {
    response("```json\n" + JSON.stringify(decision) + "\n```");
    expect((await chooseNext("{}", projectTools)).choice).toEqual(decision);
    response("这是结果：" + JSON.stringify(decision));
    await expect(chooseNext("{}", projectTools)).rejects.toMatchObject({ code: "MODEL_PROTOCOL_ERROR", diagnostic: { reason: "INVALID_JSON" }, metadata: { usage: { inputTokens: 120, outputTokens: 80 } } });
  });
  it.each([
    ["", "EMPTY_CONTENT"],
    ['{"kind":', "INVALID_JSON"],
    ['{"kind":"finish","outputId":"x","extra":"secret"}', "INVALID_CHOICE"],
    [JSON.stringify({ ...decision, tool: "upload_private_data" }), "UNKNOWN_TOOL"],
    [JSON.stringify({ ...decision, tool: "search_memory", args: { query: 7 } }), "INVALID_TOOL_ARGUMENTS"],
  ])("不合法回复返回安全诊断（%s）", async (text, reason) => {
    response(text);
    const error = await chooseNext("{}", projectTools).catch(e => e);
    expect(error).toMatchObject({ code: "MODEL_PROTOCOL_ERROR", diagnostic: { reason, repairHint: expect.any(String) } });
    expect(JSON.stringify(error)).not.toContain("secret");
    expect(JSON.stringify(error)).not.toContain("test-key");
  });
  it("finish_reason=length 即使 JSON 完整也拒绝执行，受控接续申请 2000 tokens", async () => {
    const mock = response(JSON.stringify(decision), "length");
    await expect(chooseNext('{"outputTokenLimit":2000}', projectTools)).rejects.toMatchObject({ diagnostic: { reason: "TRUNCATED", finishReason: "length" } });
    expect(JSON.parse((mock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).max_tokens).toBe(2000);
  });
  it("原生协议只执行一个完整工具调用，不附加 JSON mode", async () => {
    vi.stubEnv("MISSION_MODEL_PROTOCOL", "native");
    const mock = response(null, "tool_calls", { tool_calls: [{ id: "call-1", function: { name: "inspect_project", arguments: "{}" } }] });
    expect(await chooseNext("{}", projectTools)).toMatchObject({ callId: "call-1", protocol: "NATIVE_TOOL", choice: { ...decision, summary: "" } });
    expect(JSON.parse((mock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).response_format).toBeUndefined();
  });
  it("坏 envelope 保留有效 usage；坏 usage 不伪造零成本", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: null, usage: { prompt_tokens: 5, completion_tokens: -1 } }))));
    await expect(chooseNext("{}", projectTools)).rejects.toMatchObject({ diagnostic: { reason: "INVALID_RESPONSE" }, metadata: { usage: { inputTokens: 5, outputTokens: null } } });
  });
});
