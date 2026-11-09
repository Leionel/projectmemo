import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * 独立测试库：成果降级探针会写 GeneratedArtifact/AgentRun，必须在导入 lib/db.ts
 * 之前切换 DATABASE_URL 并逐个重放 prisma/migrations（同一轮验收成员的统一做法）。
 */
const isolated = await vi.hoisted(async () => {
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path");
  const Database = (await import("better-sqlite3")).default;
  const keys = ["DATABASE_URL", "LLM_MODE", "LLM_PROVIDER", "LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL_NAME", "SEMANTIC_MEMORY_ENABLED", "PROJECT_STATE_ENABLED"];
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-a-llm-outcome-"));
  Object.assign(process.env, {
    DATABASE_URL: "file:" + path.join(dir, "test.sqlite").replaceAll("\\", "/"),
    LLM_MODE: "openai-compatible",
    LLM_PROVIDER: "openai-compatible",
    LLM_BASE_URL: "https://unit.invalid/v1",
    LLM_API_KEY: "unit-fixture-not-a-key",
    LLM_MODEL_NAME: "unit-fixture-model",
    SEMANTIC_MEMORY_ENABLED: "false",
    PROJECT_STATE_ENABLED: "false",
  });
  const file = path.join(dir, "test.sqlite");
  const sql = new Database(file);
  for (const name of fs.readdirSync("prisma/migrations").sort()) {
    const migration = path.join("prisma/migrations", name, "migration.sql");
    if (fs.existsSync(migration)) sql.exec(fs.readFileSync(migration, "utf8"));
  }
  sql.close();
  return { dir, original };
});

import fs from "node:fs";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import {
  chatJsonWithMeta,
  chatPromptWithMeta,
  chatWithLLM,
  chatWithLLMWithMeta,
  generateArtifactWithLLM,
  generateArtifactWithLLMWithMeta,
  structureWithLLMWithMeta,
} from "@/lib/agent/llmAgent";
import { structureCaptureWithMeta } from "@/lib/agent";
import { createMockCard } from "@/lib/agent/mockAgent";
import { captureFidelityV2 } from "@/lib/agent/specialistPrompts";
import { cardToDraft, generateMockArtifactWithClaims } from "@/lib/generators/templates";
import type { CardDraft } from "@/lib/types";
import { generateArtifact, prepareArtifactGeneration } from "@/lib/services/artifactService";
import { requireProject } from "@/lib/repositories/projects";

type ChatStubOptions = {
  finishReason?: string | null;
  content?: unknown;
  id?: unknown;
  usage?: unknown;
  withFinishReason?: boolean;
};

function chatResponse(options: ChatStubOptions) {
  const choice: Record<string, unknown> = { message: { content: options.content } };
  if (options.withFinishReason !== false) choice.finish_reason = options.finishReason ?? null;
  const payload: Record<string, unknown> = { choices: [choice] };
  if (options.id !== undefined) payload.id = options.id;
  if (options.usage !== undefined) payload.usage = options.usage;
  return new Response(JSON.stringify(payload), { status: 200 });
}

function stubChat(options: ChatStubOptions) {
  const http = vi.fn(async () => chatResponse(options));
  vi.stubGlobal("fetch", http);
  return http;
}

const completeDraftJson = JSON.stringify({
  type: "reflection", title: "模型完整标题", summary: "模型完整摘要，覆盖了所有必填字段。",
  keywords: ["模型"], relatedTasks: [], nextActions: ["下一步"], importance: 3,
});

beforeAll(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal("fetch", vi.fn());
});

afterAll(async () => {
  await db.$disconnect();
  fs.rmSync(isolated.dir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(isolated.original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("chatWithLLMWithMeta 结束原因契约", () => {
  it("finish_reason=length 即使 content 是完整 JSON 也返回 FAILED/MODEL_OUTPUT_TRUNCATED，并保留 usage 与请求身份", async () => {
    stubChat({ finishReason: "length", content: completeDraftJson, id: "req-length-1", usage: { prompt_tokens: 120, completion_tokens: 7 } });
    const result = await chatWithLLMWithMeta("请整理这条记录");

    expect(result.status).toBe("FAILED");
    expect(result.fallbackReason).toBe("MODEL_OUTPUT_TRUNCATED");
    expect(result.finishReason).toBe("length");
    // 原始 content 仍随结果返回，但 status 已声明不可采用；调用方必须先看 status。
    expect(result.data).toBe(completeDraftJson);
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 7 });
    expect(result.usageUnknown).toBe(false);
    expect(result.requestIdentity).toBe("req-length-1");
    expect(result.provider).toBe("llm:openai-compatible:unit-fixture-model");
  });

  it("content_filter 返回 FAILED/MODEL_OUTPUT_FILTERED", async () => {
    stubChat({ finishReason: "content_filter", content: "被过滤的内容" });
    const result = await chatWithLLMWithMeta("请回答");

    expect(result.status).toBe("FAILED");
    expect(result.fallbackReason).toBe("MODEL_OUTPUT_FILTERED");
    expect(result.finishReason).toBe("content_filter");
  });

  it("空白或全空白 content（stop）返回 FAILED/MODEL_EMPTY_RESPONSE", async () => {
    for (const content of ["", "   ", " \n\t\r "]) {
      stubChat({ finishReason: "stop", content });
      const result = await chatWithLLMWithMeta("请回答");
      expect(result.status).toBe("FAILED");
      expect(result.fallbackReason).toBe("MODEL_EMPTY_RESPONSE");
      expect(result.data).toBe("");
    }
  });

  it("非字符串 content（对象/数组/数字）返回 FAILED/MODEL_RESPONSE_INVALID", async () => {
    for (const content of [{ ok: true }, [1, 2, 3], 42, true]) {
      stubChat({ finishReason: "stop", content });
      const result = await chatWithLLMWithMeta("请回答");
      expect(result.status).toBe("FAILED");
      expect(result.fallbackReason).toBe("MODEL_RESPONSE_INVALID");
    }
  });

  it("content=null 或缺失且 finish_reason=stop 时按空回复处理（保留兼容行为）", async () => {
    for (const content of [null, undefined]) {
      stubChat({ finishReason: "stop", content });
      const result = await chatWithLLMWithMeta("请回答");
      expect(result.status).toBe("FAILED");
      expect(result.fallbackReason).toBe("MODEL_EMPTY_RESPONSE");
      expect(result.data).toBe("");
    }
  });

  it("异常 finish_reason（tool_calls/insufficient_system_resource/error 等非 stop 字符串）返回 MODEL_RESPONSE_INVALID", async () => {
    for (const finishReason of ["tool_calls", "insufficient_system_resource", "error"]) {
      stubChat({ finishReason, content: completeDraftJson, id: "req-abnormal" });
      const result = await chatWithLLMWithMeta("请回答");
      expect(result.status).toBe("FAILED");
      expect(result.fallbackReason).toBe("MODEL_RESPONSE_INVALID");
      expect(result.finishReason).toBe(finishReason);
    }
  });

  it("finish_reason 缺失（或显式 null）+ 有效 content 目前按兼容成功处理（记录现状，不改行为）", async () => {
    stubChat({ withFinishReason: false, content: "兼容回复" });
    const missing = await chatWithLLMWithMeta("请回答");
    expect(missing.status).toBe("SUCCESS");
    expect(missing.finishReason).toBeNull();
    expect(missing.data).toBe("兼容回复");

    stubChat({ finishReason: null, content: "兼容回复" });
    const explicitNull = await chatWithLLMWithMeta("请回答");
    expect(explicitNull.status).toBe("SUCCESS");
    expect(explicitNull.finishReason).toBeNull();
  });

  it("正常 stop 回复：SUCCESS、data 已 trim、finishReason 保留", async () => {
    stubChat({ finishReason: "stop", content: "  正常回复  \n", id: "req-stop-ok", usage: { prompt_tokens: 9, completion_tokens: 3 } });
    const result = await chatWithLLMWithMeta("请回答");

    expect(result).toMatchObject({
      status: "SUCCESS", fallbackReason: null, data: "正常回复", finishReason: "stop",
      usage: { inputTokens: 9, outputTokens: 3 }, usageUnknown: false, requestIdentity: "req-stop-ok",
    });
  });

  it("失败结果保留 usage；非法 token 值置 null 并标记 usageUnknown", async () => {
    const cases: unknown[] = [
      { prompt_tokens: "120", completion_tokens: -1 },
      { prompt_tokens: 1.5, completion_tokens: 2.5 },
      { prompt_tokens: null, completion_tokens: null },
      undefined,
    ];
    for (const usage of cases) {
      stubChat({ finishReason: "length", content: completeDraftJson, usage });
      const result = await chatWithLLMWithMeta("请回答");
      expect(result.usage).toEqual({ inputTokens: null, outputTokens: null });
      expect(result.usageUnknown).toBe(true);
    }
  });

  it("requestIdentity 只保留字符串，非字符串置 null", async () => {
    for (const id of [42, { id: "x" }, null, true]) {
      stubChat({ finishReason: "stop", content: "正常回复", id });
      const result = await chatWithLLMWithMeta("请回答");
      expect(result.requestIdentity).toBeNull();
    }
  });
});

describe("chatWithLLM / chatJsonWithMeta 失败必须抛 AppError(503)，不能返回 content", () => {
  it("chatWithLLM 在 length 时抛 AppError(code=MODEL_OUTPUT_TRUNCATED, status=503)", async () => {
    stubChat({ finishReason: "length", content: completeDraftJson });
    const error = await chatWithLLM("请整理这条记录").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: "MODEL_OUTPUT_TRUNCATED", status: 503 });
  });

  it("chatWithLLM 在 content_filter 时抛 AppError(code=MODEL_OUTPUT_FILTERED)", async () => {
    stubChat({ finishReason: "content_filter", content: "被过滤的内容" });
    await expect(chatWithLLM("请回答")).rejects.toMatchObject({ code: "MODEL_OUTPUT_FILTERED", status: 503 });
  });

  it("chatWithLLM 在空白回复时抛 AppError(code=MODEL_EMPTY_RESPONSE)", async () => {
    stubChat({ finishReason: "stop", content: "   " });
    await expect(chatWithLLM("请回答")).rejects.toMatchObject({ code: "MODEL_EMPTY_RESPONSE", status: 503 });
  });

  it("chatWithLLM 正常时只返回 trim 后的字符串", async () => {
    stubChat({ finishReason: "stop", content: "  完成  " });
    await expect(chatWithLLM("请回答")).resolves.toBe("完成");
  });

  it("chatJsonWithMeta 在 length 时抛 AppError 且 parse 不被调用", async () => {
    stubChat({ finishReason: "length", content: JSON.stringify({ ok: true }) });
    const parse = vi.fn((value: unknown) => value as { ok: boolean });
    const error = await chatJsonWithMeta("请返回 JSON", parse).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: "MODEL_OUTPUT_TRUNCATED", status: 503 });
    expect(parse).not.toHaveBeenCalled();
  });

  it("chatJsonWithMeta 在 content_filter 时抛 AppError(code=MODEL_OUTPUT_FILTERED)", async () => {
    stubChat({ finishReason: "content_filter", content: "{}" });
    await expect(chatJsonWithMeta("请返回 JSON", (value) => value)).rejects.toMatchObject({ code: "MODEL_OUTPUT_FILTERED", status: 503 });
  });

  it("chatJsonWithMeta 正常时解析并返回 data", async () => {
    stubChat({ finishReason: "stop", content: '{"ok":true}' });
    const result = await chatJsonWithMeta("请返回 JSON", (value) => value as { ok: boolean });
    expect(result.status).toBe("SUCCESS");
    expect(result.data).toEqual({ ok: true });
  });
});

describe("chatPromptWithMeta 返回 FAILED 元数据（不抛错，交由调用方放弃 data）", () => {
  it("把失败原因、prompt 身份、usage 与 requestIdentity 一起返回", async () => {
    stubChat({ finishReason: "length", content: completeDraftJson, id: "req-prompt-1", usage: { prompt_tokens: 11, completion_tokens: 5 } });
    const result = await chatPromptWithMeta(captureFidelityV2, { rawText: "用户只记录了一句话：好像跑通了。" });

    expect(result.status).toBe("FAILED");
    expect(result.fallbackReason).toBe("MODEL_OUTPUT_TRUNCATED");
    expect(result.finishReason).toBe("length");
    expect(result.prompt).toEqual({ id: "capture.fidelity.v2", version: "2.0.3", purpose: "CAPTURE", outputSchemaVersion: 1 });
    expect(result.usage).toEqual({ inputTokens: 11, outputTokens: 5 });
    expect(result.requestIdentity).toBe("req-prompt-1");
    expect(result.data).toBe(completeDraftJson);
  });
});

describe("structureCaptureWithMeta 不采用截断/无效的模型 JSON", () => {
  const project = { title: "记录整理探针", description: "", goal: "验证截断输出不被采用" };
  const rawText = "今天好像跑通了实验，但还没有独立核验。";

  it("finish_reason=length 时 FALLBACK、确定性 mock 数据、失败原因与审计保留", async () => {
    stubChat({
      finishReason: "length",
      content: completeDraftJson,
      id: "req-capture-length",
      usage: { prompt_tokens: 33, completion_tokens: 22 },
    });
    const result = await structureCaptureWithMeta({ project, rawText, historyKeywords: ["实验"] });

    expect(result.status).toBe("FALLBACK");
    expect(result.provider).toBe("mock-fallback");
    expect(result.fallbackReason).toBe("MODEL_OUTPUT_TRUNCATED");
    // data 来自确定性规则整理，不是模型返回的 JSON。
    expect(result.data).toEqual(createMockCard(rawText));
    expect(result.data.title).not.toBe("模型完整标题");
    expect(result.prompt).toMatchObject({ id: "capture.fidelity.v2", version: "2.0.3", purpose: "CAPTURE", outputSchemaVersion: 1 });
    expect(result.usage).toEqual({ inputTokens: 33, outputTokens: 22 });
    expect(result.usageUnknown).toBe(false);
    expect(result.requestIdentity).toBe("req-capture-length");
  });

  it("stop 但内容不符合卡片 schema 时同样 FALLBACK，不采用模型 JSON", async () => {
    stubChat({
      finishReason: "stop",
      content: JSON.stringify({ summary: "缺少必填字段" }),
      id: "req-capture-invalid",
      usage: { prompt_tokens: 17, completion_tokens: 6 },
    });
    const result = await structureCaptureWithMeta({ project, rawText, historyKeywords: [] });

    expect(result.status).toBe("FALLBACK");
    expect(result.fallbackReason).toBe("MODEL_OUTPUT_INVALID");
    expect(result.data).toEqual(createMockCard(rawText));
    expect(result.usage).toEqual({ inputTokens: 17, outputTokens: 6 });
    expect(result.requestIdentity).toBe("req-capture-invalid");
  });

  it("structureWithLLMWithMeta 在截断时抛出带 modelAudit 的 AppError", async () => {
    stubChat({
      finishReason: "length",
      content: completeDraftJson,
      id: "req-specialist-length",
      usage: { prompt_tokens: 8, completion_tokens: 4 },
    });
    const error = await structureWithLLMWithMeta({ project, rawText, historyKeywords: [] })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: "MODEL_OUTPUT_TRUNCATED", status: 503 });
    expect((error as AppError).details).toMatchObject({
      modelAudit: {
        prompt: { id: "capture.fidelity.v2", version: "2.0.3" },
        usage: { inputTokens: 8, outputTokens: 4 },
        usageUnknown: false,
        requestIdentity: "req-specialist-length",
      },
    });
  });
});

describe("generateArtifactWithLLM 失败抛出 AppError", () => {
  const input = { project: { title: "成果探针", goal: "验证截断输出不被采用" }, artifactType: "weekly_report" as const, cards: [] as CardDraft[] };

  it("length 时抛出 AppError(code=MODEL_OUTPUT_TRUNCATED, status=503)，WithMeta 保留 FAILED 元数据", async () => {
    stubChat({ finishReason: "length", content: "# 模型成果\nMODEL_ONLY_MARKER" });
    const error = await generateArtifactWithLLM(input).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: "MODEL_OUTPUT_TRUNCATED", status: 503 });

    stubChat({ finishReason: "length", content: "# 模型成果\nMODEL_ONLY_MARKER", id: "req-artifact-raw" });
    const withMeta = await generateArtifactWithLLMWithMeta(input);
    expect(withMeta.status).toBe("FAILED");
    expect(withMeta.fallbackReason).toBe("MODEL_OUTPUT_TRUNCATED");
    expect(withMeta.prompt).toMatchObject({ id: "artifact.coverage.v2", version: "2.0.0", purpose: "ARTIFACT" });
    expect(withMeta.requestIdentity).toBe("req-artifact-raw");
  });
});

describe("prepareArtifactGeneration 回退 mock 模板且 AgentRun audit 保留 MODEL_OUTPUT_TRUNCATED", () => {
  it("用独立 DB + mock HTTP 走真实调用链：模板内容落库、审计为 FALLBACK 并保留失败原因/用量", async () => {
    const user = await db.user.create({ data: { username: crypto.randomUUID(), passwordHash: "unused", displayName: "A 成果回退探针" } });
    const project = await db.project.create({ data: {
      title: "A 成果回退探针", description: "独立测试库", goal: "验证成果生成不采用截断 JSON", scenario: "RESEARCH",
      memberships: { create: { userId: user.id, role: "OWNER" } },
    } });
    const capture = await db.capture.create({ data: { projectId: project.id, rawText: "用户记录：设备条件尚未独立核验。", sourceType: "UNIT_FIXTURE" } });
    const cardRow = await db.knowledgeCard.create({ data: {
      projectId: project.id, captureId: capture.id, type: "experiment_log", title: "设备条件待核对",
      summary: "用户记录称好像跑通，尚未独立核验。", keywords: ["设备"], relatedTasks: [], nextActions: ["核对条件"], importance: 3,
    } });
    stubChat({
      finishReason: "length",
      content: "# 模型成果\nMODEL_ONLY_MARKER",
      id: "req-artifact-length",
      usage: { prompt_tokens: 321, completion_tokens: 9 },
    });

    const projectRow = await requireProject(project.id);
    const expectedMock = generateMockArtifactWithClaims("weekly_report", {
      project: projectRow,
      cards: [{ ...cardToDraft(cardRow), id: cardRow.id }],
    });

    const prepared = await prepareArtifactGeneration(project.id, "weekly_report");
    expect(prepared.audit.status).toBe("FALLBACK");
    expect(prepared.audit.provider).toBe("mock-fallback");
    expect(prepared.claims.status).toBe("TEMPLATE_BOUND");
    // 成果正文来自确定性 mock 模板，不是被截断的模型 JSON。
    expect(prepared.content).toBe(expectedMock.content);
    expect(prepared.content).not.toContain("MODEL_ONLY_MARKER");
    expect(prepared.audit.fallbackReason).toBe("MODEL_OUTPUT_TRUNCATED");
    expect(prepared.audit.trace.prompt).toMatchObject({ id: "artifact.coverage.v2", version: "2.0.0", purpose: "ARTIFACT" });
    expect(prepared.audit.trace.usage).toEqual({ inputTokens: 321, outputTokens: 9 });
    expect(prepared.audit.trace.usageUnknown).toBe(false);
    expect(prepared.audit.trace.requestIdentity).toBe("req-artifact-length");

    // 真实持久化：GeneratedArtifact 与 AgentRun(FALLBACK) 一并提交。
    const artifact = await generateArtifact(project.id, "weekly_report");
    expect(artifact.content).toBe(expectedMock.content);
    const run = await db.agentRun.findFirstOrThrow({ where: { projectId: project.id, runType: "ARTIFACT" }, orderBy: { createdAt: "desc" } });
    expect(run.status).toBe("FALLBACK");
    expect(run.fallbackReason).toBe("MODEL_OUTPUT_TRUNCATED");
    expect(run.trace).toMatchObject({
      prompt: { id: "artifact.coverage.v2", version: "2.0.0" },
      usage: { inputTokens: 321, outputTokens: 9 },
      requestIdentity: "req-artifact-length",
    });
  });
});
