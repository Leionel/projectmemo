import { afterAll, describe, expect, it, vi } from "vitest";
const isolated = await vi.hoisted(async () => {
  const fs = await import("node:fs"),
    os = await import("node:os"),
    path = await import("node:path");
  const Database = (await import("better-sqlite3")).default;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "projectmemo-p1bc-"));
  const file = path.join(dir, "confirmations.db");
  process.env.DATABASE_URL = `file:${file.replaceAll("\\", "/")}`;
  Object.assign(process.env, {
    MISSION_ENABLED: "true",
    MISSION_UI_ENABLED: "true",
    COPILOT_CONTINUATION_ENABLED: "true",
    PROJECT_AGENT_CONTEXT_ENABLED: "true",
  });
  process.env.LLM_MODE = "mock";
  process.env.SEMANTIC_MEMORY_ENABLED = "false";
  process.env.EVIDENCE_TRUST_RECEIPT_ENABLED = "true";
  process.env.TEMPORAL_MEMORY_ENABLED = "true";
  const sql = new Database(file);
  for (const migration of fs.readdirSync("prisma/migrations").sort()) {
    const migrationFile = path.join(
      "prisma/migrations",
      migration,
      "migration.sql",
    );
    if (fs.existsSync(migrationFile))
      sql.exec(fs.readFileSync(migrationFile, "utf8"));
  }
  sql.close();
  return { dir, file };
});

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import {
  answerProjectQuestion,
  getProjectChat,
} from "@/lib/services/copilotService";
import {
  isExplicitProjectTask,
  previewCopilotMission,
  confirmCopilotMission,
} from "@/lib/copilot/continuation";
import { createMission, missionDetail } from "@/lib/mission/missionService";
import { readMissionBack } from "@/lib/mission/readback";
import { event } from "@/lib/mission/repository";
import { failedReadState, mayApplyRead } from "@/lib/client/readState";
import { missionNavigationHref } from "@/lib/mission/navigation";
import {
  GET as chatGet,
  POST as chatPost,
} from "@/app/api/projects/[id]/agent/chat/route";
import { POST as previewRoute } from "@/app/api/projects/[id]/agent/continuation/preview/route";
import { POST as confirmRoute } from "@/app/api/projects/[id]/agent/continuation/confirm/route";
import { GET as readbackRoute } from "@/app/api/missions/[id]/readback/route";
afterAll(async () => {
  await db.$disconnect();
  fs.rmSync(isolated.dir, { recursive: true, force: true });
});
async function fixture() {
  const p = await db.project.create({
    data: {
      title: "汇报接续",
      description: "隔离验收",
      goal: "准备阶段汇报",
      scenario: "RESEARCH",
    },
  });
  const u = await db.user.create({
    data: {
      username: crypto.randomUUID(),
      displayName: "验收",
      passwordHash: "unused",
    },
  });
  await db.projectMembership.create({
    data: { projectId: p.id, userId: u.id, role: "OWNER" },
  });
  const session = await createSession(u.id);
  return {
    projectId: p.id,
    actor: { userId: u.id, sessionId: session.session.id },
    token: session.token,
  };
}
async function suggested(f: Awaited<ReturnType<typeof fixture>>) {
  const a = await answerProjectQuestion(
    f.projectId,
    "请帮我整理本项目阶段汇报材料，不要联网，不创建行动",
    f.actor,
    crypto.randomUUID(),
  );
  expect(a.continuationSuggestion?.kind).toBe("CREATE_MISSION");
  return a;
}
async function preview(
  f: Awaited<ReturnType<typeof fixture>>,
  run: string,
  goal = "根据已有材料整理阶段汇报，不编造实验结果",
) {
  return previewCopilotMission(
    f.projectId,
    { sourceRunId: run, goal, llmContextApproved: false },
    f.actor,
  );
}
function confirm(
  f: Awaited<ReturnType<typeof fixture>>,
  run: string,
  hash: string,
) {
  return confirmCopilotMission(
    f.projectId,
    {
      sourceRunId: run,
      previewHash: hash,
      requestId: crypto.randomUUID(),
      confirmed: true,
    },
    f.actor,
  );
}
function request(url: string, token: string, body?: object) {
  return new Request(`https://fixture.invalid${url}`, {
    method: body ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
describe.sequential("P1-B durable dialogue handoff", () => {
  it("pure question stays a question; request replay returns the original answer without another run", async () => {
    const f = await fixture(),
      key = crypto.randomUUID();
    const a = await answerProjectQuestion(
      f.projectId,
      "当前进展如何？",
      f.actor,
      key,
    );
    const b = await answerProjectQuestion(
      f.projectId,
      "当前进展如何？",
      f.actor,
      key,
    );
    expect(b.runId).toBe(a.runId);
    expect(a.continuationSuggestion?.kind).toBe("ANSWER_ONLY");
    expect(await db.agentRun.count({ where: { projectId: f.projectId } })).toBe(
      1,
    );
    expect(
      await db.agentMission.count({ where: { projectId: f.projectId } }),
    ).toBe(0);
    await expect(
      answerProjectQuestion(f.projectId, "不同问题", f.actor, key),
    ).rejects.toMatchObject({ code: "REQUEST_ID_REUSED" });
  });
  it("preview is editable without creating a task; confirmation retry and races create exactly one original Mission", async () => {
    const f = await fixture(),
      a = await suggested(f),
      p = await preview(f, a.runId);
    expect(
      await db.agentMission.count({ where: { projectId: f.projectId } }),
    ).toBe(0);
    const edited = await preview(
      f,
      a.runId,
      "根据项目资料准备答辩汇报，缺失的指标列为缺口",
    );
    await expect(confirm(f, a.runId, p.previewHash)).rejects.toMatchObject({
      code: "COPILOT_PREVIEW_CHANGED",
    });
    const [x, y] = await Promise.all([
      confirm(f, a.runId, edited.previewHash),
      confirm(f, a.runId, edited.previewHash),
    ]);
    expect(x.missionId).toBe(y.missionId);
    expect(
      await db.agentMission.count({ where: { projectId: f.projectId } }),
    ).toBe(1);
    const m = await missionDetail(f.actor.userId, x.missionId);
    expect(m.constraints).toMatchObject({
      executionBoundary: "READ_ANALYZE",
      llmContextApproved: false,
    });
    expect(m.researchScope).toMatchObject({ enabled: false });
    expect(
      await db.agentMissionEvent.count({
        where: { missionId: m.id, type: "COPILOT_HANDOFF" },
      }),
    ).toBe(1);
    await db.project.update({
      where: { id: f.projectId },
      data: { goal: "更新目标" },
    });
    expect((await confirm(f, a.runId, edited.previewHash)).missionId).toBe(
      m.id,
    );
    const back = await readMissionBack(f.actor.userId, m.id);
    expect(back.sourceConversation?.sourceRunId).toBe(a.runId);
  });
  it("rejects additional confirm fields, changed sources and unreviewed previews", async () => {
    const f = await fixture(),
      a = await suggested(f),
      p = await preview(f, a.runId);
    await expect(
      confirmCopilotMission(
        f.projectId,
        {
          sourceRunId: a.runId,
          previewHash: p.previewHash,
          requestId: "tamper",
          confirmed: true,
          goal: "替换目标",
        },
        f.actor,
      ),
    ).rejects.toThrow();
    await expect(
      confirmCopilotMission(
        f.projectId,
        {
          sourceRunId: a.runId,
          previewHash: p.previewHash,
          requestId: "false",
          confirmed: false,
        },
        f.actor,
      ),
    ).rejects.toThrow();
    await db.project.update({
      where: { id: f.projectId },
      data: { goal: "依据变化" },
    });
    await expect(confirm(f, a.runId, p.previewHash)).rejects.toMatchObject({
      code: "SOURCE_CHANGED",
    });
    expect(
      await db.agentMission.count({ where: { projectId: f.projectId } }),
    ).toBe(0);
  });
  it("a newer explicit user turn invalidates the old prefill", async () => {
    const f = await fixture(),
      a = await suggested(f),
      p = await preview(f, a.runId);
    await answerProjectQuestion(
      f.projectId,
      "先不要创建委托，只核对日期",
      f.actor,
      crypto.randomUUID(),
    );
    await expect(confirm(f, a.runId, p.previewHash)).rejects.toMatchObject({
      code: "COPILOT_CONVERSATION_CHANGED",
    });
  });
  it("links the existing task and blocks a stale new-task preview after another task is created", async () => {
    const f = await fixture(),
      a = await suggested(f),
      p = await preview(f, a.runId);
    const m = await createMission(f.actor.userId, {
      projectId: f.projectId,
      goal: "准备阶段汇报",
      requestId: crypto.randomUUID(),
    });
    await expect(confirm(f, a.runId, p.previewHash)).rejects.toMatchObject({
      code: "COPILOT_MISSION_EXISTS",
    });
    const b = await answerProjectQuestion(
      f.projectId,
      "请帮我整理项目汇报",
      f.actor,
      crypto.randomUUID(),
    );
    expect(b.continuationSuggestion).toMatchObject({
      kind: "OPEN_MISSION",
      mission: { id: m.id },
    });
  });
  it("keeps chat history and continuation receipts private to their actor, including revoked sessions", async () => {
    const f = await fixture(),
      a = await suggested(f),
      other = await fixture();
    await db.projectMembership.create({
      data: {
        userId: other.actor.userId,
        projectId: f.projectId,
        role: "OWNER",
      },
    });
    expect(await getProjectChat(f.projectId, other.actor.userId)).toHaveLength(
      0,
    );
    await expect(
      previewCopilotMission(
        f.projectId,
        { sourceRunId: a.runId, goal: "准备汇报" },
        other.actor,
      ),
    ).rejects.toMatchObject({ status: 404 });
    await db.authSession.update({
      where: { id: f.actor.sessionId },
      data: { revokedAt: new Date() },
    });
    await expect(preview(f, a.runId)).rejects.toMatchObject({ status: 401 });
  });
  it("bounded recent history excludes legacy unowned and foreign messages", async () => {
    const f = await fixture();
    await db.agentMessage.create({
      data: {
        projectId: f.projectId,
        role: "USER",
        content: "legacy secret",
        citations: [],
        proposedActions: [],
      },
    });
    for (let n = 0; n < 23; n++)
      await db.agentMessage.create({
        data: {
          projectId: f.projectId,
          ownerUserId: f.actor.userId,
          requestState: "ANSWERED",
          role: "USER",
          content: `不要联网 ${n}`,
          citations: [],
          proposedActions: [],
        },
      });
    const history = await getProjectChat(f.projectId, f.actor.userId);
    expect(history).toHaveLength(20);
    expect(history.every((m) => m.ownerUserId === f.actor.userId)).toBe(true);
    const a = await answerProjectQuestion(
      f.projectId,
      "当前进展如何",
      f.actor,
      crypto.randomUUID(),
    );
    const run = await db.agentRun.findUniqueOrThrow({ where: { id: a.runId } });
    const manifest = (
      run.trace as { dialogueManifest: { messageIds: string[] } }
    ).dialogueManifest;
    expect(JSON.stringify(manifest)).not.toContain("legacy secret");
  });
  it("disabling the handoff flag stops pending confirmations", async () => {
    const f = await fixture(),
      a = await suggested(f),
      p = await preview(f, a.runId);
    process.env.COPILOT_CONTINUATION_ENABLED = "false";
    try {
      await expect(confirm(f, a.runId, p.previewHash)).rejects.toMatchObject({
        code: "COPILOT_CONTINUATION_DISABLED",
      });
    } finally {
      process.env.COPILOT_CONTINUATION_ENABLED = "true";
    }
  });
  it("HTTP chat → preview → confirmation → readback returns the same ids and no-store responses", async () => {
    const f = await fixture(),
      ctx = { params: Promise.resolve({ id: f.projectId }) };
    const response = await chatPost(
      request(`/api/projects/${f.projectId}/agent/chat`, f.token, {
        message: "请帮我整理项目阶段汇报",
        requestId: "web-native-turn",
      }),
      ctx,
    );
    expect(response.status).toBe(200);
    const a = await response.json();
    const p = await previewRoute(
      request("/preview", f.token, {
        sourceRunId: a.runId,
        goal: "整理项目阶段汇报",
      }),
      ctx,
    );
    expect(p.status).toBe(200);
    const v = await p.json();
    const c = await confirmRoute(
      request("/confirm", f.token, {
        sourceRunId: a.runId,
        previewHash: v.preview.previewHash,
        requestId: "confirm-native",
        confirmed: true,
      }),
      ctx,
    );
    expect(c.status).toBe(200);
    const r = await c.json();
    const back = await readbackRoute(
      request(`/api/missions/${r.receipt.missionId}/readback`, f.token),
      { params: Promise.resolve({ id: r.receipt.missionId }) },
    );
    expect(back.status).toBe(200);
    expect(back.headers.get("cache-control")).toContain("no-store");
    expect((await back.json()).readback.sourceConversation.sourceRunId).toBe(
      a.runId,
    );
    const history = await chatGet(request("/chat", f.token), ctx);
    expect(
      (await history.json()).messages.at(-1).continuationSuggestion.sourceRunId,
    ).toBe(a.runId);
  });
});
describe.sequential("P1-C precise readback and failure states", () => {
  it("reads an older exact output without switching to latest and marks old questions historical", async () => {
    const f = await fixture(),
      m = await createMission(f.actor.userId, {
        projectId: f.projectId,
        goal: "阶段汇报",
        requestId: crypto.randomUUID(),
      });
    for (let revision = 1; revision <= 7; revision++)
      await db.agentMissionOutput.create({
        data: {
          missionId: m.id,
          revision,
          contentJson: {
            blocks: [
              {
                blockId: "b",
                text: `草稿${revision}`,
                kind: "INFERENCE",
                sourceIds: [],
              },
            ],
          },
          kind: "RESEARCH",
          sourceRefsJson: [],
          claimChecksJson: [],
          verificationStatus: "UNVERIFIED",
        },
      });
    const q = await db.$transaction((tx) =>
      event(tx, m.id, "QUESTION", { question: "原来的问题" }),
    );
    const back = await readMissionBack(f.actor.userId, m.id, {
      revision: 1,
      questionId: q.id,
    });
    expect(back.selected.output?.revision).toBe(1);
    expect(back.selected.question?.historical).toBe(true);
    expect(back.realityOutcome).toBe("NOT_INFERRED");
    expect(back.actionReceipts).toEqual([]);
    await expect(
      readMissionBack(f.actor.userId, m.id, { revision: 99 }),
    ).rejects.toMatchObject({ status: 404 });
    const other = await fixture();
    await expect(
      readMissionBack(other.actor.userId, m.id),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("rejects output/receipt mismatch and reports actual action receipt separately from successful task status", async () => {
    const f = await fixture(),
      m = await createMission(f.actor.userId, {
        projectId: f.projectId,
        goal: "阶段汇报",
        requestId: crypto.randomUUID(),
      });
    await db.agentMission.update({
      where: { id: m.id },
      data: { status: "SUCCEEDED" },
    });
    const output = await db.agentMissionOutput.create({
      data: {
        missionId: m.id,
        revision: 1,
        contentJson: { blocks: [] },
        kind: "RESEARCH",
        sourceRefsJson: [],
        claimChecksJson: [],
        verificationStatus: "UNVERIFIED",
      },
    });
    const artifact = await db.generatedArtifact.create({
      data: {
        projectId: f.projectId,
        artifactType: "weekly_report",
        content: "版本一",
      },
    });
    const receipt = await db.missionArtifactReceipt.create({
      data: {
        projectId: f.projectId,
        missionId: m.id,
        outputId: output.id,
        outputRevision: 1,
        outputHash: "h",
        artifactId: artifact.id,
        artifactType: "weekly_report",
        sourceManifestJson: [],
        blockMapJson: [],
        verificationSnapshotJson: {},
        createdByUserId: f.actor.userId,
        requestId: "adopt",
        payloadHash: "h",
      },
    });
    await expect(
      readMissionBack(f.actor.userId, m.id, {
        receiptId: receipt.id,
        revision: 2,
      }),
    ).rejects.toMatchObject({ status: 404 });
    const back = await readMissionBack(f.actor.userId, m.id, {
      receiptId: receipt.id,
      outputId: output.id,
      revision: 1,
    });
    expect(back.adoptions[0]).toMatchObject({
      artifactId: artifact.id,
      outputRevision: 1,
    });
    expect(back.actionReceipts).toEqual([]);
  });
  it("distinguishes stale reads, private-data revocation and late identity responses", () => {
    expect(failedReadState(true, 503)).toBe("lastKnown");
    expect(failedReadState(false, 0)).toBe("unavailable");
    for (const status of [401, 403, 404])
      expect(failedReadState(true, status)).toBe("unavailable");
    expect(mayApplyRead(1, 2, "user-a", "user-a")).toBe(false);
    expect(mayApplyRead(1, 1, "user-a", "user-b")).toBe(false);
    expect(mayApplyRead(1, 1, "user-a", "user-a")).toBe(true);
    expect(
      missionNavigationHref("p", "m", {
        outputId: "o",
        revision: 1,
        receiptId: "r",
      }),
    ).toContain("outputId=o&revision=1&receiptId=r");
  });
});

// Run the actual ArkTS service modules against authenticated Next routes.
function nativeModule(
  relative: string,
  cache = new Map<string, Record<string, unknown>>(),
): Record<string, unknown> {
  const file = path.resolve("harmonyos/entry/src/main/ets", relative);
  const found = cache.get(file);
  if (found) return found;
  const exports: Record<string, unknown> = {};
  cache.set(file, exports);
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const require = (name: string): unknown => {
    if (name.endsWith("/ApiClient")) return { ApiClient: class {} };
    if (name.endsWith("/SessionStore"))
      return { SessionStore: { isTokenValid: () => true } };
    if (name.endsWith("/models/Project")) return { ApiError: Error };
    return nativeModule(
      path.relative(
        path.resolve("harmonyos/entry/src/main/ets"),
        path.resolve(path.dirname(file), name + ".ets"),
      ),
      cache,
    );
  };
  vm.runInNewContext("(function(require,exports){" + output + "})", {})(
    require,
    exports,
  );
  return exports;
}
it("Web dialogue → actual ArkTS preview/confirm/readback → Web preserves source run, Mission and pinned output", async () => {
  const f = await fixture(),
    a = await suggested(f);
  const dispatch = async (method: string, url: string, body?: object) => {
    const req = request(url, f.token, method === "POST" ? body : undefined);
    const ctx = { params: Promise.resolve({ id: f.projectId }) };
    const r = url.includes("/readback")
      ? await readbackRoute(req, {
          params: Promise.resolve({ id: url.split("/")[3] }),
        })
      : url.endsWith("/preview")
        ? await previewRoute(req, ctx)
        : await confirmRoute(req, ctx);
    const v = await r.json();
    if (!r.ok)
      throw Object.assign(new Error(v.error.message), { status: r.status });
    return v;
  };
  const client = {
    get: (url: string) => dispatch("GET", url),
    post: (url: string, body: object) => dispatch("POST", url, body),
  };
  interface NativeCopilot {
    previewMission(
      p: string,
      b: object,
    ): Promise<{ preview: { previewHash: string } }>;
    confirmMission(
      p: string,
      b: object,
    ): Promise<{ receipt: { missionId: string } }>;
  }
  interface NativeMission {
    readback(
      id: string,
      target: object,
    ): Promise<{
      readback: {
        missionId: string;
        sourceConversation: { sourceRunId: string };
        selected: { output: { id: string; revision: number } };
      };
    }>;
  }
  const Copilot = nativeModule("services/CopilotService.ets")
    .CopilotService as new (c: object) => NativeCopilot;
  const Mission = nativeModule("services/MissionService.ets")
    .MissionService as new (c: object) => NativeMission;
  const n = new Copilot(client),
    p = await n.previewMission(f.projectId, {
      sourceRunId: a.runId,
      goal: "整理项目阶段汇报",
      llmContextApproved: false,
    });
  const receipt = await n.confirmMission(f.projectId, {
    sourceRunId: a.runId,
    previewHash: p.preview.previewHash,
    requestId: "native-retry",
    confirmed: true,
  });
  const m = receipt.receipt.missionId;
  const output = await db.agentMissionOutput.create({
    data: {
      missionId: m,
      revision: 1,
      kind: "RESEARCH",
      contentJson: { blocks: [] },
      sourceRefsJson: [],
      claimChecksJson: [],
    },
  });
  // 经真实 ArkTS 模型构造读取目标：字段初始化与 App 内一致（新字段不会再被漏掉）。
  const ReadbackModel = nativeModule("models/MissionReadback.ets");
  const readTarget = new (ReadbackModel.MissionReadTarget as new () => {
    questionId: string; approvalId: string; outputId: string; revision: string; receiptId: string; sourceId: string;
  })();
  readTarget.outputId = output.id;
  readTarget.revision = "1";
  const native = await new Mission(client).readback(m, readTarget);
  expect(native.readback).toMatchObject({
    missionId: m,
    sourceConversation: { sourceRunId: a.runId },
    selected: { output: { id: output.id, revision: 1 } },
  });
  expect(
    (
      await readMissionBack(f.actor.userId, m, {
        outputId: output.id,
        revision: 1,
      })
    ).selected.output?.id,
  ).toBe(output.id);
  const reads = nativeModule("common/ReadState.ets");
  for (const status of [0, 401, 403, 404, 503])
    expect(
      (reads.failedReadState as (has: boolean, s: number) => string)(
        true,
        status,
      ),
    ).toBe(failedReadState(true, status));
});

it("明确否决不提示新委托，局部只读限制不被当作整项任务否决",()=>{for(const text of ["请不要创建长期委托","请不要帮我整理项目报告","暂不委托，只回答进度"])expect(isExplicitProjectTask(text)).toBe(false);expect(isExplicitProjectTask("请帮我整理项目报告，不要联网，不创建行动")).toBe(true);});

it("中断的旧问答不会自动重发模型；过期后允许用户另起一次明确请求",async()=>{
 const f=await fixture();await db.agentMessage.create({data:{projectId:f.projectId,ownerUserId:f.actor.userId,requestId:"interrupted",role:"USER",content:"项目进展如何",citations:[],proposedActions:[],requestState:"PENDING",createdAt:new Date(Date.now()-11*60000)}});
 await expect(answerProjectQuestion(f.projectId,"项目进展如何",f.actor,"interrupted")).rejects.toMatchObject({code:"COPILOT_TURN_FAILED"});expect(await db.agentRun.count({where:{projectId:f.projectId}})).toBe(0);
 const a=await answerProjectQuestion(f.projectId,"项目进展如何",f.actor,"new-explicit-request");expect(a.runId).toBeTruthy();
});

it("确认后冷启动的历史建议读回同一个原委托，不再展示新建入口",async()=>{
 const f=await fixture(),a=await suggested(f),p=await preview(f,a.runId),r=await confirm(f,a.runId,p.previewHash);
 const history=await getProjectChat(f.projectId,f.actor.userId,a.runId);expect(history.at(-1)?.continuationSuggestion).toMatchObject({kind:"OPEN_MISSION",mission:{id:r.missionId}});
});
