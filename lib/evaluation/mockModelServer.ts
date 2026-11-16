import http from "node:http";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { readProjectMaterial } from "@/lib/mission/sourceSignals";
import { textHash } from "@/lib/research/sourceRepository";

/**
 * Local OpenAI-compatible test model used by the evaluation/demo commands only.
 * It is bound to 127.0.0.1 and selected through the same environment configuration a product
 * deployment uses; it never becomes a selectable provider inside the product API.
 */

type MockContext = {
  contextVersion?: number; goal?: string; sourceInput?: { projectId?: string };
  continuity?: { workingObjective?: string | null };
  skillExecution?: { stage: string; outputId?: string; evidencePack?: { sources: Array<{ id: string; text: string }>; unknowns?: Array<{ column?: string }> } };
};

async function latestPointers(projectId: string): Promise<Array<{ sourceId: string; sourceHash: string }>> {
  const captures = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Capture" WHERE "projectId" = ${projectId} ORDER BY rowid DESC`;
  const pointers: Array<{ sourceId: string; sourceHash: string }> = [];
  for (const capture of captures) {
    const source = await readProjectMaterial(projectId, "capture:" + capture.id);
    if (source) pointers.push({ sourceId: source.id, sourceHash: source.hash });
  }
  return pointers;
}

export async function startMockModelServer(options: { model?: string } = {}) {
  const readThisCycle = new Set<string>(), model = options.model ?? "mock-local-model";
  const server = http.createServer(async (request, response) => {
    if (request.method !== "POST" || !request.url?.endsWith("/chat/completions")) { response.writeHead(404).end(); return; }
    let body = "";
    for await (const chunk of request) body += chunk;
    let context: MockContext | null = null;
    try {
      const parsed = JSON.parse(body) as { messages?: Array<{ content?: string }> };
      const envelope = JSON.parse(parsed.messages?.[1]?.content ?? "null") as { context?: MockContext } | MockContext | null;
      context = (envelope as { context?: MockContext } | null)?.context ?? (envelope as MockContext | null);
    } catch { context = null; }
    const skill = context?.skillExecution;
    let choice: Record<string, unknown>;
    if (!skill) {
      choice = { kind: "ask", question: "请补充本轮工作目标", missing: "PRIVATE" };
    } else {
      const scopeKey = String(context?.sourceInput?.projectId ?? "") + ":" + String(context?.contextVersion ?? 0);
      if (skill.outputId && (skill.stage === "deliverable-creation" || readThisCycle.has(scopeKey + ":" + skill.stage))) {
        choice = { kind: "await_event", outputId: skill.outputId, reason: "DELIVERABLE_READY", subscriptionIds: ["project-materials"] };
      } else if (skill.stage !== "deliverable-creation") {
        readThisCycle.add(scopeKey + ":" + skill.stage);
        // The newest readable source is the material change that woke this mission; reading it
        // keeps the previous evidence pack (retained in the skill cursor) alongside the new one.
        const newest = (await latestPointers(context?.sourceInput?.projectId ?? ""))[0];
        choice = newest
          ? { kind: "tool", tool: "read_project_material", args: newest, summary: "读取当前获准资料" }
          : { kind: "tool", tool: "inspect_project", args: {}, summary: "读取项目概况" };
      } else {
        const pack: Array<{ id: string; text: string }> = (skill.evidencePack?.sources ?? []).slice(-4);
        if (!pack.length) {
          choice = { kind: "ask", question: "当前证据包为空，请补充资料", missing: "PRIVATE" };
        } else {
          const blocks: Array<Record<string, unknown>> = pack.map((source, index) => {
            const text = source.text.slice(0, 900);
            return { blockId: "source-" + (index + 1), kind: "PROJECT_OBSERVATION", text: "项目资料记载：" + text, sourceIds: [source.id],
              citations: [{ sourceId: source.id, start: 0, end: text.length, excerptHash: textHash(text) }] };
          });
          blocks.push({ blockId: "working-note", kind: "INFERENCE",
            text: "本轮工作重点：" + (context?.continuity?.workingObjective ?? context?.goal ?? "") + "。尚缺条件按原资料保留为未知。私有工作稿不代表现实工作已经完成。", sourceIds: [] });
          choice = { kind: "tool", tool: "save_mission_output", summary: "依据证据包更新私有工作稿", args: { blocks } };
        }
      }
    }
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
      id: "mock-" + randomUUID(), object: "chat.completion", created: Math.floor(Date.now() / 1000), model,
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(choice) } }],
      usage: { prompt_tokens: 120, completion_tokens: 40 },
    }));
  });
  return new Promise<{ baseUrl: string; close: () => void }>(resolve => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ baseUrl: "http://127.0.0.1:" + port, close: () => server.close() });
    });
  });
}
