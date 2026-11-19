import { afterEach, expect, test, vi } from "vitest";
import { chooseNext } from "@/lib/mission/modelAdapter";
import { projectTools } from "@/lib/mission/tools";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
test.each(["json", "native"])("await_event negotiates only v2 over %s transport", async protocol => {
  vi.stubEnv("LLM_MODE", "openai-compatible"); vi.stubEnv("LLM_API_KEY", "fixture-only");
  vi.stubEnv("LLM_PROVIDER", "deepseek"); vi.stubEnv("MISSION_MODEL_PROTOCOL", protocol);
  const choice = { kind: "await_event", outputId: "server-output", reason: "DELIVERABLE_READY", subscriptionIds: ["project-materials"] };
  const fetcher = vi.fn(async () => Response.json({ choices: [{ finish_reason: "stop",
    message: { content: JSON.stringify(choice) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
  vi.stubGlobal("fetch", fetcher);
  expect((await chooseNext(JSON.stringify({ runtimeProtocolVersion: 2 }), projectTools)).choice).toEqual(choice);
  const body = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
  expect(JSON.parse(body.messages[1].content).responseSchema.oneOf).toHaveLength(4);
  await expect(chooseNext("{}", projectTools)).rejects.toMatchObject({ code: "MODEL_PROTOCOL_ERROR", diagnostic: { reason: "INVALID_CHOICE" } });
});
