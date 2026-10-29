import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseDecisionJson } from "@/lib/mission/decisionJson";
import { chooseNext } from "@/lib/mission/modelAdapter";
import { projectTools } from "@/lib/mission/tools";

beforeEach(() => {
  vi.stubEnv("LLM_MODE", "openai-compatible"); vi.stubEnv("LLM_API_KEY", "FIXTURE_NOT_A_KEY");
  vi.stubEnv("LLM_PROVIDER", "deepseek"); vi.stubEnv("LLM_BASE_URL", "https://api.deepseek.com"); vi.stubEnv("MISSION_MODEL_PROTOCOL", "json");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function mockResponse(message: Record<string, unknown>, reason = "stop") {
  const transport = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [{ finish_reason: reason, message }], usage: { prompt_tokens: 50, completion_tokens: 20 } })));
  vi.stubGlobal("fetch", transport); return transport;
}
const ask = { kind: "ask", question: "请补充实验\n数据划分和版本", missing: "PRIVATE" };
const broken = JSON.stringify(ask).replace("\\n", "\n");
describe("bounded protocol repair without guessing decisions", () => {
  it("literal CR/LF/tab/null inside strings are escaped losslessly, without an additional call", async () => {
    const text = '第一行\r\n第二行\t第三行\u0000';
    const wire = '{"text":"' + text + '"}';
    expect(parseDecisionJson(wire)).toMatchObject({ value: { text }, escapedControls: 4 });
    const fetch = mockResponse({ content: broken });
    const result = await chooseNext("{}", projectTools);
    expect(result.choice).toEqual(ask); expect(result.serialization?.escapedControls).toBe(1);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it.each(['{"kind":', '{"text":"PRIVATE_SECRET"', '{"text":"PRIVATE_SECRET"} explanation', '{"text":"\\qPRIVATE_SECRET"}', '{"text":"PRIVATE_SECRET"}{"kind":"finish"}'])
    ("structural/escape/trailing errors stay rejected with private parser content absent: %s", async wire => {
      mockResponse({ content: wire });
      const error = await chooseNext("{}", projectTools).catch(error => error);
      expect(error).toMatchObject({ code: "MODEL_PROTOCOL_ERROR", diagnostic: { reason: "INVALID_JSON", json: { issue: expect.any(String), responseHash: expect.stringMatching(/^[a-f0-9]{64}$/) } } });
      expect(JSON.stringify(error)).not.toContain("PRIVATE_SECRET"); expect(JSON.stringify(error)).not.toContain("FIXTURE_NOT_A_KEY");
    });
  it("a structurally repaired JSON cannot bypass tool/schema validation", async () => {
    mockResponse({ content: '{"kind":"tool","tool":"delete_everything","args":{},"summary":"第一行\n第二行"}' });
    await expect(chooseNext("{}", projectTools)).rejects.toMatchObject({ diagnostic: { reason: "UNKNOWN_TOOL" } });
  });
  it("existing one-retry context selects forced Choice transport; it does not execute its function as a tool", async () => {
    const fetch = mockResponse({ content: null, tool_calls: [{ id: "choice-1", function: { name: "select_mission_step", arguments: JSON.stringify(ask) } }] }, "tool_calls");
    const result = await chooseNext('{"protocolRepair":{"reason":"INVALID_JSON"}}', projectTools);
    expect(result).toMatchObject({ protocol: "FUNCTION_CHOICE", choice: ask }); expect(result.callId).toBeUndefined();
    const body = JSON.parse(fetch.mock.calls[0][1]!.body as string);
    expect(body.tool_choice.function.name).toBe("select_mission_step"); expect(body.thinking.type).toBe("disabled");
    expect(body.response_format).toBeUndefined(); expect(fetch).toHaveBeenCalledOnce();
  });
  it("legacy generic provider selection on official DeepSeek still enables its JSON/non-thinking capabilities", async () => {
    vi.stubEnv("LLM_PROVIDER", "openai-compatible"); const fetch = mockResponse({ content: JSON.stringify(ask) });
    await chooseNext("{}", projectTools);
    const body = JSON.parse(fetch.mock.calls[0][1]!.body as string);
    expect(body.response_format.type).toBe("json_object"); expect(body.thinking.type).toBe("disabled");
  });
  it("length truncation is never accepted even with encoding normalization", async () => {
    mockResponse({ content: broken }, "length");
    await expect(chooseNext("{}", projectTools)).rejects.toMatchObject({ diagnostic: { reason: "TRUNCATED" } });
  });
  it.each(["aborted", "insufficient_system_resource"])("interrupted response never executes a complete-looking decision: %s", async reason => {
    mockResponse({ content: JSON.stringify(ask) }, reason);
    await expect(chooseNext("{}", projectTools)).rejects.toMatchObject({ diagnostic: { reason: "INVALID_RESPONSE" } });
  });
});
