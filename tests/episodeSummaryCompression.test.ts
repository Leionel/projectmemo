import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * 阶段总结压缩验收（episode.summary_compression.v1）。
 * 写入探针在导入 lib/db.ts 前设置独立 DATABASE_URL；模型一律 mock HTTP。
 */
const isolated = await vi.hoisted(async () => {
  const fs = await import("node:fs"),
    os = await import("node:os"),
    path = await import("node:path");
  const Database = (await import("better-sqlite3")).default;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-episode-compression-"));
  const file = path.join(dir, "episode.db");
  process.env.DATABASE_URL = `file:${file.replaceAll("\\", "/")}`;
  Object.assign(process.env, {
    PROJECT_EPISODES_ENABLED: "1",
    PROJECT_STATE_ENABLED: "1",
    SEMANTIC_MEMORY_ENABLED: "false",
    TEMPORAL_MEMORY_ENABLED: "true",
    // 默认不开在线模型；需要模型压缩的用例会显式开启并 mock fetch。
    LLM_MODE: "mock",
  });
  const sql = new Database(file);
  for (const migration of fs.readdirSync("prisma/migrations").sort()) {
    const migrationFile = path.join("prisma/migrations", migration, "migration.sql");
    if (fs.existsSync(migrationFile)) sql.exec(fs.readFileSync(migrationFile, "utf8"));
  }
  sql.close();
  return { dir };
});

import fs from "node:fs";
import { db } from "@/lib/db";
import { previewProjectEpisode } from "@/lib/services/projectEpisodeService";
import type { EpisodeClaim, EpisodeSection } from "@/lib/types/episode";

type Section = { section: EpisodeSection; text: string };
type ModelBody = { messages: Array<{ role: string; content: string }>; [key: string]: unknown };
type CapturedCall = { url: string; body: ModelBody };

let projectId = "";
const windowStart = new Date(Date.now() - 300_000).toISOString();
const windowEnd = new Date(Date.now() + 300_000).toISOString();
let templateSections: Section[] = [];
let templateClaims: EpisodeClaim[] = [];

beforeAll(async () => {
  const user = await db.user.create({
    data: { username: `episode-compression-${Date.now()}`, displayName: "压缩验收", passwordHash: "unused" },
  });
  const project = await db.project.create({
    data: {
      title: "阶段总结压缩验收",
      description: "验证模型压缩与模板回退",
      goal: "确认模型文本不改变事实",
      scenario: "RESEARCH",
      memberships: { create: { userId: user.id, role: "OWNER" } },
    },
  });
  projectId = project.id;

  // 行动结果卡放在窗口外，避免它同时进入 CONFIRMED_CHANGES；行动本身在窗口内完成。
  const oldCapture = await db.capture.create({ data: { projectId, rawText: "行动结果卡", sourceType: "测试" } });
  const resultCard = await db.knowledgeCard.create({
    data: {
      projectId,
      captureId: oldCapture.id,
      type: "experiment_log",
      title: "行动结果：对照实验",
      summary: "结果已记录",
      keywords: [],
      relatedTasks: [],
      nextActions: [],
      importance: 3,
      createdAt: new Date(Date.now() - 400_000),
    },
  });
  // 显式错开 createdAt，保证模板里的卡片顺序稳定（不依赖同毫秒排序）。
  const cards: Array<[string, string, number]> = [
    ["实验记录 1.5 小时", "耗时 1.5 小时", 10_000],
    ["温度修正 -1 度", "温度偏低 1 度", 9_000],
    ["结果 1e3 次", "共 1e3 次", 8_000],
  ];
  for (const [title, summary, ageMs] of cards) {
    const capture = await db.capture.create({ data: { projectId, rawText: title, sourceType: "测试" } });
    await db.knowledgeCard.create({
      data: {
        projectId,
        captureId: capture.id,
        type: "experiment_log",
        title,
        summary,
        keywords: [],
        relatedTasks: [],
        nextActions: [],
        importance: 3,
        createdAt: new Date(Date.now() - ageMs),
      },
    });
  }
  await db.actionItem.create({
    data: { projectId, title: "完成对照实验", status: "DONE", completedAt: new Date(), resultCardId: resultCard.id },
  });

  // 未配置在线模型时取得模板基线（generationMode=TEMPLATE）。
  const template = await previewProjectEpisode(projectId, { windowStart, windowEnd });
  expect(template.episode.revisions[0].generationMode).toBe("TEMPLATE");
  templateSections = template.episode.revisions[0].summary.sections;
  templateClaims = template.episode.revisions[0].claims;
  // 模板必须同时含数字与「」引用，否则后续数字/引用校验用例失去意义。
  const allText = templateSections.map((section) => section.text).join("\n");
  expect(allText).toMatch(/\d/);
  expect(allText).toContain("「完成对照实验」");
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env.LLM_MODE = "mock";
});

afterAll(async () => {
  await db.project.delete({ where: { id: projectId } }).catch(() => {});
  await db.user.deleteMany({ where: { username: { startsWith: "episode-compression-" } } }).catch(() => {});
  await db.$disconnect();
  fs.rmSync(isolated.dir, { recursive: true, force: true });
});

function enableLlm() {
  Object.assign(process.env, {
    LLM_MODE: "openai-compatible",
    LLM_PROVIDER: "",
    LLM_API_KEY: "unit-fixture-not-a-key",
    LLM_BASE_URL: "http://mock.local/v1",
    LLM_MODEL_NAME: "mock",
  });
}

function modelResponse(content: string, finishReason: "stop" | "length" = "stop") {
  return new Response(
    JSON.stringify({
      id: "chatcmpl-episode",
      usage: { prompt_tokens: 21, completion_tokens: 34 },
      choices: [{ finish_reason: finishReason, message: { content } }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function untrustedSections(body: ModelBody): Section[] {
  const payload = JSON.parse(body.messages[1].content) as { kind: string; data: { sections: Section[] } };
  return payload.data.sections;
}

/** 从模板派生的合法改写：只加语言后缀，不改数字、顺序与「」引用。 */
function compressedFromRequest(sections: Section[]): Section[] {
  return sections.map((section) => ({ ...section, text: `${section.text}（已压缩）` }));
}

function mapSection(name: EpisodeSection, transform: (text: string) => string) {
  return (sections: Section[]): Section[] => {
    let found = false;
    const next = sections.map((section) => {
      if (section.section !== name) return { ...section };
      found = true;
      return { ...section, text: transform(section.text) };
    });
    if (!found) throw new Error(`模板缺少节 ${name}`);
    return next;
  };
}

async function runCompression(options: {
  mutate?: (sections: Section[]) => Section[];
  finishReason?: "stop" | "length";
  rawContent?: string;
} = {}) {
  const calls: CapturedCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as ModelBody;
    calls.push({ url: String(input), body });
    if (options.rawContent !== undefined) return modelResponse(options.rawContent, options.finishReason ?? "stop");
    const requested = untrustedSections(body);
    const sections = options.mutate ? options.mutate(requested.map((section) => ({ ...section }))) : compressedFromRequest(requested);
    return modelResponse(JSON.stringify({ sections }), options.finishReason ?? "stop");
  });
  vi.stubGlobal("fetch", fetchMock);
  const result = await previewProjectEpisode(projectId, { windowStart, windowEnd });
  return { result, calls, fetchMock };
}

async function persistedRevision(episodeId: string) {
  return db.episodeRevision.findFirstOrThrow({ where: { episodeId } });
}

describe("episode.summary_compression.v1 正常路径", () => {
  it("合法改写采用模型文本，并记录 MODEL/provider 与隔离的消息结构", async () => {
    enableLlm();
    const { result, calls, fetchMock } = await runCompression();
    const revision = result.episode.revisions[0];

    expect(revision.generationMode).toBe("MODEL");
    expect(revision.provider).toBe("llm:openai-compatible:mock");
    expect(revision.fallbackReason).toBeNull();
    expect(revision.summary.sections).toEqual(compressedFromRequest(templateSections));
    // 模型只改 summary 文案：服务端事实 claims 原样保留。
    expect(revision.claims).toEqual(templateClaims);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://mock.local/v1/chat/completions");
    const messages = calls[0].body.messages;
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("episode.summary_compression.v1");
    expect(messages[0].content).not.toContain("实验记录 1.5");
    expect(messages[0].content).not.toContain("UNTRUSTED_DATA");
    expect(messages[1].role).toBe("user");
    const payload = JSON.parse(messages[1].content) as { kind: string; data: { sections: Section[] } };
    expect(payload.kind).toBe("UNTRUSTED_DATA");
    expect(payload.data.sections).toEqual(templateSections);
    expect(messages[1].content).not.toContain("episode.summary_compression.v1");

    // EpisodeRevision 持久审计字段从 DB 读回。
    const row = await persistedRevision(result.episode.id);
    expect(row.generationMode).toBe("MODEL");
    expect(row.provider).toBe("llm:openai-compatible:mock");
    expect(row.fallbackReason).toBeNull();
    expect(row.summary).toEqual(revision.summary);
    expect(row.claims).toEqual(templateClaims);
  });
});

describe("episode.summary_compression.v1 失败回退模板", () => {
  it("finish_reason=length 即使 content 是完整 JSON 也不采用，fallbackReason 保留 MODEL_OUTPUT_TRUNCATED", async () => {
    enableLlm();
    const { result } = await runCompression({ finishReason: "length" });
    const revision = result.episode.revisions[0];

    expect(revision.generationMode).toBe("MODEL_FALLBACK_TEMPLATE");
    expect(revision.fallbackReason).toBe("MODEL_OUTPUT_TRUNCATED");
    expect(revision.provider).toBeNull();
    expect(revision.summary.sections).toEqual(templateSections);
    expect(revision.claims).toEqual(templateClaims);

    const row = await persistedRevision(result.episode.id);
    expect(row.generationMode).toBe("MODEL_FALLBACK_TEMPLATE");
    expect(row.fallbackReason).toBe("MODEL_OUTPUT_TRUNCATED");
    expect(row.summary).toEqual(revision.summary);
  });

  it("模型 JSON 无法解析时回退模板并保留可读原因", async () => {
    enableLlm();
    const { result } = await runCompression({ rawContent: "这不是 JSON" });
    const revision = result.episode.revisions[0];

    expect(revision.generationMode).toBe("MODEL_FALLBACK_TEMPLATE");
    expect(revision.summary.sections).toEqual(templateSections);
    expect(revision.fallbackReason).toBeTruthy();
    expect(revision.fallbackReason).not.toBe("MODEL_OUTPUT_TRUNCATED");
    const row = await persistedRevision(result.episode.id);
    expect(row.generationMode).toBe("MODEL_FALLBACK_TEMPLATE");
    expect(row.fallbackReason).toBe(revision.fallbackReason);
  });

  const invalidVariants: Array<{ name: string; mutate: (sections: Section[]) => Section[]; reason: RegExp }> = [
    { name: "重复章节（多加一节）", mutate: (sections) => [...sections, { ...sections[0] }], reason: /节数/ },
    { name: "漏掉一节", mutate: (sections) => sections.slice(0, -1), reason: /节数/ },
    {
      name: "调换章节顺序",
      mutate: (sections) => {
        const copy = sections.map((section) => ({ ...section }));
        [copy[0], copy[1]] = [copy[1], copy[0]];
        return copy;
      },
      reason: /节名或顺序/,
    },
    { name: "删除一个数字", mutate: mapSection("COMPLETED_ACTIONS", (text) => text.replace(/\d+/, "")), reason: /数字/ },
    { name: "数字 1→101", mutate: mapSection("COMPLETED_ACTIONS", (text) => text.replace(/\d+/, "101")), reason: /数字/ },
    { name: "小数 1.5→5.1", mutate: mapSection("CONFIRMED_CHANGES", (text) => text.replace("1.5", "5.1")), reason: /数字/ },
    { name: "负数 -1→1", mutate: mapSection("CONFIRMED_CHANGES", (text) => text.replace("-1", "1")), reason: /数字/ },
    {
      name: "科学计数法 1e3→1000",
      mutate: mapSection("CONFIRMED_CHANGES", (text) => text.replace("1e3", "1000")),
      reason: /数字/,
    },
    { name: "新增数字", mutate: mapSection("CONFIRMED_CHANGES", (text) => `${text}（新增2项）`), reason: /数字/ },
    {
      name: "丢失「」引用的标题",
      mutate: mapSection("COMPLETED_ACTIONS", (text) => text.replace("「完成对照实验」", "完成对照实验")),
      reason: /引用/,
    },
  ];

  it.each(invalidVariants)("$name → 回退模板且原因可读", async ({ mutate, reason }) => {
    enableLlm();
    const { result } = await runCompression({ mutate });
    const revision = result.episode.revisions[0];

    expect(revision.generationMode).toBe("MODEL_FALLBACK_TEMPLATE");
    expect(revision.summary.sections).toEqual(templateSections);
    expect(revision.claims).toEqual(templateClaims);
    expect(revision.provider).toBeNull();
    expect(revision.fallbackReason).toMatch(reason);
    expect(revision.fallbackReason).not.toBe("MODEL_OUTPUT_TRUNCATED");

    const row = await persistedRevision(result.episode.id);
    expect(row.generationMode).toBe("MODEL_FALLBACK_TEMPLATE");
    expect(row.fallbackReason).toBe(revision.fallbackReason);
    expect(row.summary).toEqual(revision.summary);
  });
});
