import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { continuityDatabase } from "./helpers/continuityDatabase";

// 独立数据库必须在导入 @/lib/db（路由、鉴权、附件服务共享的 Prisma singleton）之前设置。
const isolated = continuityDatabase("attachment-api");
const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-attachment-api-"));
process.env.ATTACHMENT_DIR = storageDir;

type Db = typeof import("@/lib/db").db;
type CorrectPost = typeof import("@/app/api/projects/[id]/attachments/[attachmentId]/correct/route").POST;
type RetryPost = typeof import("@/app/api/projects/[id]/attachments/[attachmentId]/retry/route").POST;

let db: Db;
let correctPost: CorrectPost;
let retryPost: RetryPost;
let createTestAuth: typeof import("./testAuthHelper").createTestAuth;
let correctAttachmentText: typeof import("@/lib/services/attachmentService").correctAttachmentText;

const projectIds: string[] = [];
const userIds: string[] = [];

beforeAll(async () => {
  db = (await import("@/lib/db")).db;
  correctPost = (await import("@/app/api/projects/[id]/attachments/[attachmentId]/correct/route")).POST;
  retryPost = (await import("@/app/api/projects/[id]/attachments/[attachmentId]/retry/route")).POST;
  createTestAuth = (await import("./testAuthHelper")).createTestAuth;
  correctAttachmentText = (await import("@/lib/services/attachmentService")).correctAttachmentText;
});

beforeEach(() => {
  // 未显式 mock 的网络请求一律失败：本轮不调用真实模型或外部服务。
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    throw new Error(`测试未配置的网络请求：${url}`);
  }));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.EXPERIMENT_OBSERVER_ENABLED;
  for (const id of projectIds.splice(0)) await db.project.delete({ where: { id } }).catch(() => {});
  for (const id of userIds.splice(0)) await db.user.delete({ where: { id } }).catch(() => {});
});

afterAll(async () => {
  await db.$disconnect();
  fs.rmSync(isolated.dir, { recursive: true, force: true });
  fs.rmSync(storageDir, { recursive: true, force: true });
});

async function projectWithOwner(title = "附件 API 错误矩阵") {
  const project = await db.project.create({
    data: { title, description: "附件 correct/retry 路由状态码矩阵合成数据", goal: "验证结构化错误响应", scenario: "RESEARCH" },
  });
  projectIds.push(project.id);
  const auth = await createTestAuth(project.id);
  userIds.push(auth.user.id);
  return { project, auth };
}

async function projectWithoutMember(title = "没有该用户成员关系的项目") {
  const project = await db.project.create({
    data: { title, description: "越权访问统一 404 的合成数据", goal: "验证不泄漏 403 差异", scenario: "RESEARCH" },
  });
  projectIds.push(project.id);
  return project;
}

interface AttachmentOverrides {
  type?: string;
  fileName?: string;
  mimeType?: string;
  storageKey?: string;
  size?: number;
  extractedText?: string | null;
  extractionStatus?: string;
  extractionError?: string | null;
}

async function newAttachment(projectId: string, overrides: AttachmentOverrides = {}) {
  return db.attachment.create({
    data: {
      projectId,
      type: "PDF",
      storageKey: `synthetic-${crypto.randomUUID()}.pdf`,
      fileName: "实验记录.pdf",
      mimeType: "application/pdf",
      size: 128,
      sha256: crypto.createHash("sha256").update(crypto.randomUUID()).digest("hex"),
      extractedText: "机器提取的第一版文本",
      extractionStatus: "SUCCESS",
      extractionError: null,
      ...overrides,
    },
  });
}

function correctRequest(
  projectId: string,
  attachmentId: string,
  headers: HeadersInit,
  body: string,
) {
  return correctPost(
    new Request(`http://localhost/api/projects/${projectId}/attachments/${attachmentId}/correct`, {
      method: "POST",
      headers,
      body,
    }),
    { params: Promise.resolve({ id: projectId, attachmentId }) },
  );
}

function correctJson(
  projectId: string,
  attachmentId: string,
  headers: HeadersInit,
  payload: Record<string, unknown>,
) {
  return correctRequest(projectId, attachmentId, headers, JSON.stringify(payload));
}

function retryRequest(projectId: string, attachmentId: string, headers: HeadersInit) {
  return retryPost(
    new Request(`http://localhost/api/projects/${projectId}/attachments/${attachmentId}/retry`, {
      method: "POST",
      headers,
    }),
    { params: Promise.resolve({ id: projectId, attachmentId }) },
  );
}

/**
 * 本套接字的统一失败契约：HTTP 状态码 + `{ error: { code, message } }`，
 * 而不是旧版附件路由的 `{ error: string }`。message 一律为简体中文。
 */
async function expectStructuredError(
  response: Response,
  expectedStatus: number,
  expectedCode: string,
  messageIncludes?: string,
) {
  expect(response.status).toBe(expectedStatus);
  const body = (await response.json()) as unknown;
  expect(body).not.toBeNull();
  expect(typeof body).toBe("object");
  const error = (body as { error?: unknown }).error;
  expect(typeof error).toBe("object");
  expect(error).not.toBeNull();
  const structured = error as { code?: unknown; message?: unknown };
  expect(typeof structured.code).toBe("string");
  expect(structured.code).toBe(expectedCode);
  expect(typeof structured.message).toBe("string");
  const message = structured.message as string;
  expect(message.length).toBeGreaterThan(0);
  expect(message).toMatch(/[\u4e00-\u9fff]/);
  if (messageIncludes) expect(message).toContain(messageIncludes);
  return body;
}

function withEnv(name: string, value: string | undefined) {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  return () => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  };
}

describe("correct 路由状态码与结构化错误", () => {
  it("401：无 Authorization/Cookie 时统一返回 UNAUTHORIZED", async () => {
    const { project } = await projectWithOwner();
    const attachment = await newAttachment(project.id);

    const response = await correctJson(project.id, attachment.id, {}, { correctedText: "人工校对文本" });
    await expectStructuredError(response, 401, "UNAUTHORIZED", "登录");
  });

  it("401：错误的 Bearer Token 视为登录失效，而不是 400/500", async () => {
    const { project, auth } = await projectWithOwner();
    const attachment = await newAttachment(project.id);

    const response = await correctJson(project.id, attachment.id, {
      "Content-Type": "application/json",
      Authorization: "Bearer not-a-real-session-token",
    }, { correctedText: "人工校对文本" });
    await expectStructuredError(response, 401, "UNAUTHORIZED", "登录");
    expect(auth.token).not.toBe("not-a-real-session-token");
  });

  it("404：附件不存在、不属于本项目时返回 NOT_FOUND（不泄漏跨项目记录）", async () => {
    const { project, auth } = await projectWithOwner("附件归属校验 A");
    const other = await projectWithOwner("附件归属校验 B");
    await auth.bindProject(other.project.id);
    const foreign = await newAttachment(other.project.id);

    const missing = await correctJson(project.id, "no-such-attachment", auth.headers, { correctedText: "人工校对文本" });
    await expectStructuredError(missing, 404, "NOT_FOUND");

    // 用户是 A 与 B 的成员，但附件属于 B：用 A 的路径访问必须 404，而不是修改 B 的数据。
    const crossProject = await correctJson(project.id, foreign.id, auth.headers, { correctedText: "人工校对文本" });
    await expectStructuredError(crossProject, 404, "NOT_FOUND");
    expect((await db.attachment.findUniqueOrThrow({ where: { id: foreign.id } })).extractedText).toBe("机器提取的第一版文本");
  });

  it("404：项目不属于当前用户时统一 PROJECT_NOT_FOUND（不是 403）", async () => {
    const { auth } = await projectWithOwner("攻击者自己的项目");
    const strangerProject = await projectWithoutMember();
    const attachment = await newAttachment(strangerProject.id);

    const response = await correctJson(strangerProject.id, attachment.id, auth.headers, { correctedText: "人工校对文本" });
    await expectStructuredError(response, 404, "PROJECT_NOT_FOUND");
    expect(response.status).not.toBe(403);
  });

  it("422：correctedText 只有一个字符时返回 VALIDATION_ERROR", async () => {
    const { project, auth } = await projectWithOwner();
    const attachment = await newAttachment(project.id);

    const response = await correctJson(project.id, attachment.id, auth.headers, { correctedText: "a" });
    const body = await expectStructuredError(response, 422, "VALIDATION_ERROR", "格式");
    expect(Array.isArray((body as { error: { details?: unknown } }).error.details)).toBe(true);
  });

  it("400：非法 JSON 请求体映射为 INVALID_JSON", async () => {
    const { project, auth } = await projectWithOwner();
    const attachment = await newAttachment(project.id);

    const response = await correctRequest(project.id, attachment.id, auth.headers, "{这不是合法 JSON");
    await expectStructuredError(response, 400, "INVALID_JSON", "JSON");
  });

  it("422：CSV/JSON 附件落到普通校对分支时返回 METRIC_CORRECTION_REQUIRED", async () => {
    const { project, auth } = await projectWithOwner("指标附件路由分支");
    const attachment = await newAttachment(project.id, {
      type: "CSV",
      fileName: "指标副本.csv",
      mimeType: "text/csv",
      extractedText: "指标,数值\n准确率,0.8",
    });

    // 路由先按 (id, projectId) 查 type；若这次查询与记录插入存在竞态（这里用一次性空结果确定性复现），
    // 路由会退回普通 correctAttachmentText，由服务层识别出指标附件并返回 422。
    const spy = vi.spyOn(db.attachment, "findFirst");
    spy.mockResolvedValueOnce(null as never);
    try {
      const response = await correctJson(project.id, attachment.id, auth.headers, {
        correctedText: "指标,数值\n准确率,0.9",
        expectedCurrentText: "指标,数值\n准确率,0.8",
      });
      await expectStructuredError(response, 422, "METRIC_CORRECTION_REQUIRED", "指标");
      // 第 1 次是路由的 type 查询（被 mock 成空），第 2 次是服务层识别附件（真实查询）。
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }

    expect(await db.attachmentRevision.count({ where: { attachmentId: attachment.id } })).toBe(0);
    expect((await db.attachment.findUniqueOrThrow({ where: { id: attachment.id } })).extractedText)
      .toBe("指标,数值\n准确率,0.8");
  });

  it("200 成功返回 attachment/card，且过期 expectedCurrentText 返回 409 ATTACHMENT_TEXT_CHANGED", async () => {
    const { project, auth } = await projectWithOwner("校对版本校验");
    const attachment = await newAttachment(project.id, { extractedText: "第一版机器提取文本" });

    const first = await correctJson(project.id, attachment.id, auth.headers, {
      correctedText: "第二版人工校对文本，确认实验记录内容",
      expectedCurrentText: "第一版机器提取文本",
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      attachment?: { id?: string; extractedText?: string; extractionStatus?: string };
      card?: { id?: string } | null;
      idempotentReplay?: boolean;
      error?: unknown;
    };
    expect(firstBody).not.toHaveProperty("error");
    expect(firstBody.attachment?.id).toBe(attachment.id);
    expect(firstBody.attachment?.extractedText).toBe("第二版人工校对文本，确认实验记录内容");
    expect(firstBody.attachment?.extractionStatus).toBe("SUCCESS");
    expect(firstBody.card?.id).toBeTruthy();
    expect(firstBody.idempotentReplay).toBe(false);

    // 另一端仍持有第一版文本：提交过期快照必须 409，且不能覆盖第二版。
    const stale = await correctJson(project.id, attachment.id, auth.headers, {
      correctedText: "基于旧版本回退的第三版文本",
      expectedCurrentText: "第一版机器提取文本",
    });
    await expectStructuredError(stale, 409, "ATTACHMENT_TEXT_CHANGED", "校对");
    const current = await db.attachment.findUniqueOrThrow({ where: { id: attachment.id } });
    expect(current.extractedText).toBe("第二版人工校对文本，确认实验记录内容");
    expect(await db.knowledgeCard.count({ where: { attachmentId: attachment.id } })).toBe(1);
  });

  it("200：同一文本重复校对返回 idempotentReplay，不重复建卡", async () => {
    const { project, auth } = await projectWithOwner("校对幂等");
    const attachment = await newAttachment(project.id, { extractedText: "已经校对过的实验记录文本" });

    const response = await correctJson(project.id, attachment.id, auth.headers, {
      correctedText: "已经校对过的实验记录文本",
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { idempotentReplay?: boolean; error?: unknown; card?: unknown };
    expect(body).not.toHaveProperty("error");
    expect(body.idempotentReplay).toBe(true);
    expect(await db.knowledgeCard.count({ where: { attachmentId: attachment.id } })).toBe(0);
  });

  it("503：指标附件校对在 EXPERIMENT_OBSERVER_ENABLED=false 时返回 EXPERIMENT_OBSERVER_DISABLED", async () => {
    const { project, auth } = await projectWithOwner("指标校对开关");
    const attachment = await newAttachment(project.id, {
      type: "JSON",
      fileName: "指标副本.json",
      mimeType: "application/json",
      extractedText: "{\"metric\":\"accuracy\",\"value\":0.8}",
    });
    const restore = withEnv("EXPERIMENT_OBSERVER_ENABLED", "false");
    try {
      const response = await correctJson(project.id, attachment.id, auth.headers, {
        correctedText: "{\"metric\":\"accuracy\",\"value\":0.9}",
        expectedCurrentText: "{\"metric\":\"accuracy\",\"value\":0.8}",
      });
      await expectStructuredError(response, 503, "EXPERIMENT_OBSERVER_DISABLED", "指标");
    } finally {
      restore();
    }
  });
});

describe("retry 路由状态码与结构化错误", () => {
  it("401：无凭据返回 UNAUTHORIZED", async () => {
    const { project } = await projectWithOwner();
    const attachment = await newAttachment(project.id, { extractedText: null, extractionStatus: "FAILED" });

    const response = await retryRequest(project.id, attachment.id, {});
    await expectStructuredError(response, 401, "UNAUTHORIZED", "登录");
  });

  it("401：错误的 Bearer Token 返回 UNAUTHORIZED", async () => {
    const { project } = await projectWithOwner();
    const attachment = await newAttachment(project.id, { extractedText: null, extractionStatus: "FAILED" });

    const response = await retryRequest(project.id, attachment.id, { Authorization: "Bearer broken-session-token" });
    await expectStructuredError(response, 401, "UNAUTHORIZED", "登录");
  });

  it("404：附件不存在或属于另一个项目时返回 NOT_FOUND", async () => {
    const { project, auth } = await projectWithOwner("重试归属校验 A");
    const other = await projectWithOwner("重试归属校验 B");
    await auth.bindProject(other.project.id);
    const foreign = await newAttachment(other.project.id, { extractedText: null, extractionStatus: "FAILED" });

    const missing = await retryRequest(project.id, "no-such-attachment", auth.headers);
    await expectStructuredError(missing, 404, "NOT_FOUND");

    const crossProject = await retryRequest(project.id, foreign.id, auth.headers);
    await expectStructuredError(crossProject, 404, "NOT_FOUND");
  });

  it("404：项目不属于当前用户时统一 PROJECT_NOT_FOUND", async () => {
    const { auth } = await projectWithOwner("重试攻击者项目");
    const strangerProject = await projectWithoutMember();
    const attachment = await newAttachment(strangerProject.id, { extractedText: null, extractionStatus: "FAILED" });

    const response = await retryRequest(strangerProject.id, attachment.id, auth.headers);
    await expectStructuredError(response, 404, "PROJECT_NOT_FOUND");
    expect(response.status).not.toBe(403);
  });

  it("503：CSV/JSON 且 EXPERIMENT_OBSERVER_ENABLED=false 时返回 EXPERIMENT_OBSERVER_DISABLED", async () => {
    const { project, auth } = await projectWithOwner("指标重试开关");
    const attachment = await newAttachment(project.id, {
      type: "CSV",
      fileName: "指标.csv",
      mimeType: "text/csv",
      extractedText: null,
      extractionStatus: "FAILED",
      extractionError: "历史提取失败",
    });
    const restore = withEnv("EXPERIMENT_OBSERVER_ENABLED", "false");
    try {
      const response = await retryRequest(project.id, attachment.id, auth.headers);
      await expectStructuredError(response, 503, "EXPERIMENT_OBSERVER_DISABLED", "指标");
    } finally {
      restore();
    }
    expect((await db.attachment.findUniqueOrThrow({ where: { id: attachment.id } })).extractionStatus).toBe("FAILED");
  });

  it("200：已完成附件重试直接复用，不新增修订/卡片也不要求原文件仍在", async () => {
    const { project, auth } = await projectWithOwner("重试复用");
    const attachment = await newAttachment(project.id, {
      storageKey: `deleted-${crypto.randomUUID()}.pdf`,
      extractedText: "已经成功提取的实验记录原文",
      extractionStatus: "SUCCESS",
    });
    const capture = await db.capture.create({
      data: { projectId: project.id, rawText: "【附件导入：实验记录.pdf】\n已经成功提取的实验记录原文", sourceType: "PDF文档" },
    });
    const card = await db.knowledgeCard.create({
      data: {
        projectId: project.id,
        captureId: capture.id,
        attachmentId: attachment.id,
        type: "experiment_log",
        title: "附件提取记录",
        summary: "已经成功提取的实验记录摘要内容",
        keywords: ["实验记录"],
        relatedTasks: [],
        nextActions: ["核对实验结论"],
        importance: 3,
      },
    });

    const response = await retryRequest(project.id, attachment.id, auth.headers);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      attachment?: { id?: string; extractionStatus?: string };
      card?: { id?: string } | null;
      error?: unknown;
    };
    expect(body).not.toHaveProperty("error");
    expect(body.attachment?.id).toBe(attachment.id);
    expect(body.attachment?.extractionStatus).toBe("SUCCESS");
    expect(body.card?.id).toBe(card.id);
    expect(await db.attachmentRevision.count({ where: { attachmentId: attachment.id } })).toBe(0);
    expect(await db.knowledgeCard.count({ where: { attachmentId: attachment.id } })).toBe(1);
  });

  it("409：重试的旧快照被中途校对后拒绝覆盖，返回 ATTACHMENT_TEXT_CHANGED", async () => {
    const { project, auth } = await projectWithOwner("重试旧快照校验");
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    const storageKey = `barrier-${crypto.randomUUID()}.png`;
    fs.writeFileSync(path.join(storageDir, storageKey), png);
    const attachment = await newAttachment(project.id, {
      type: "IMAGE",
      fileName: "实验现场白板.png",
      mimeType: "image/png",
      storageKey,
      size: png.length,
      extractedText: null,
      extractionStatus: "FAILED",
      extractionError: "视觉提取失败（模型 deepseek-flash）：旧的失败原因",
    });

    // barrier：第一次视觉请求进入后暂停，模拟一次很慢的重试；期间另一端完成人工校对。
    let releaseVision!: () => void;
    const visionGate = new Promise<void>((resolve) => { releaseVision = resolve; });
    let visionStarted!: () => void;
    const visionStartedPromise = new Promise<void>((resolve) => { visionStarted = resolve; });
    let visionCalls = 0;
    const draft = {
      type: "experiment_log",
      title: "人工校对记录",
      summary: "人工校对的现场实验记录内容，来自客服端提交",
      keywords: ["实验", "校对"],
      relatedTasks: [],
      nextActions: ["继续整理实验记录"],
      importance: 3,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const body = typeof init?.body === "string" ? init.body : "";
      if (body.includes("image_url")) {
        visionCalls += 1;
        visionStarted();
        await visionGate;
        return Response.json({ choices: [{ message: { content: "合成视觉提取文本：白板记录" } }] });
      }
      expect(url).toContain("/chat/completions");
      return Response.json({
        id: "unit-correct-model",
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify(draft) } }],
        usage: { prompt_tokens: 20, completion_tokens: 20 },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const restoreLlmMode = withEnv("LLM_MODE", "openai-compatible");
    const restoreLlmKey = withEnv("LLM_API_KEY", "unit-fixture-not-a-key");
    try {
      const pending = retryRequest(project.id, attachment.id, auth.headers);
      await visionStartedPromise;
      expect(visionCalls).toBe(1);

      const corrected = await correctAttachmentText(project.id, attachment.id, "人工校对后的实验记录文本，覆盖旧提取", null);
      expect(corrected.idempotentReplay).toBe(false);
      expect(corrected.attachment.extractedText).toBe("人工校对后的实验记录文本，覆盖旧提取");

      releaseVision();
      const response = await pending;
      await expectStructuredError(response, 409, "ATTACHMENT_TEXT_CHANGED", "重新载入");
    } finally {
      releaseVision();
      restoreLlmMode();
      restoreLlmKey();
    }

    // 旧快照不得覆盖较新的校对文本，也不得重复建卡或写入 EXTRACTION_RETRY 修订。
    const current = await db.attachment.findUniqueOrThrow({ where: { id: attachment.id } });
    expect(current.extractedText).toBe("人工校对后的实验记录文本，覆盖旧提取");
    expect(current.extractionStatus).toBe("SUCCESS");
    const revisions = await db.attachmentRevision.findMany({
      where: { attachmentId: attachment.id },
      orderBy: { revisionIndex: "asc" },
      select: { source: true, text: true },
    });
    expect(revisions.map((revision) => revision.source)).toEqual(["MANUAL_CORRECTION"]);
    expect(await db.knowledgeCard.count({ where: { attachmentId: attachment.id } })).toBe(1);
  });
});
