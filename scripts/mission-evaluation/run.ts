import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { getChatProviderConfig, getChatProviderDefaults } from "../../lib/config/provider";
import { EvaluationBudget, PRICE_SOURCE, PRICE_VERIFIED_AT } from "./budget";
import { fixtureFetch, prepareEvaluationEnvironment } from "./environment";

type Options = { live: boolean; fixture: boolean; confirmCost: boolean; maxRequests: number; maxCostCny: number; repeats: number; phase: "protocol" | "all" };
export function parseEvaluationOptions(argv: string[], phase: "protocol" | "all"): Options {
  const flags = new Set(["--live", "--fixture", "--confirm-cost"]), values = new Set(["--max-requests", "--max-cost-cny", "--repeats"]);
  for (let i = 0; i < argv.length; i++) {
    if (flags.has(argv[i])) continue;
    if (values.has(argv[i]) && argv[i + 1]) { i++; continue; }
    throw new Error("UNKNOWN_EVALUATION_ARGUMENT");
  }
  const value = (key: string, fallback: number) => argv.includes(key) ? Number(argv[argv.indexOf(key) + 1]) : fallback;
  const options = { live: argv.includes("--live"), fixture: argv.includes("--fixture"), confirmCost: argv.includes("--confirm-cost"),
    maxRequests: value("--max-requests", 60), maxCostCny: value("--max-cost-cny", 10), repeats: value("--repeats", 3), phase };
  if (options.live && options.fixture || options.live && !options.confirmCost || !Number.isInteger(options.repeats) || options.repeats < 1 || options.repeats > 3)
    throw new Error("INVALID_EVALUATION_AUTHORIZATION");
  return options;
}
function safeCode(error: unknown) {
  const code = (error as { code?: unknown })?.code;
  if (typeof code === "string" && /^[A-Z0-9_]{1,80}$/.test(code)) return code;
  const message = error instanceof Error ? error.message : "EVALUATION_FAILED";
  return /^[A-Z0-9_]{1,100}$/.test(message) ? message : "EVALUATION_FAILED";
}
export async function runEvaluation(options: Options) {
  if (!options.live && !options.fixture) {
    const provider = getChatProviderDefaults();
    return { mode: "DRY_RUN", actualModelVerified: false, phase: options.phase, repeats: options.repeats,
      provider: { model: provider.model, origin: new URL(provider.baseUrl).origin, keyConfigured: !!process.env.LLM_API_KEY },
      limits: { maxRequests: options.maxRequests, maxCostCny: options.maxCostCny }, priceSource: PRICE_SOURCE, priceVerifiedAt: PRICE_VERIFIED_AT,
      boundary: "No database/network/paid call. Live credentials remain server environment only." };
  }
  if (options.live) getChatProviderConfig();
  const environment = await prepareEvaluationEnvironment(options.live), config = getChatProviderConfig();
  const budget = await EvaluationBudget.acquire(path.join(environment.directory, "budget.json"), config,
    { live: options.live, maxRequests: options.maxRequests, maxCostCny: options.maxCostCny });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = budget.wrapFetch(options.fixture ? fixtureFetch() : originalFetch);
  const reportPath = path.join(environment.directory, "results.json");
  const report = { schemaVersion: 1, mode: options.live ? "REAL_MODEL_SYNTHETIC_DATA" : "FIXTURE_HTTP_SYNTHETIC_DATA",
    sourceVersions: {} as Record<string, string>,
    taskSet: "p0-a-internal-continuation-v1", runId: budget.summary().runId,
    protocol: process.env.MISSION_MODEL_PROTOCOL === "native" ? "native" : "json", attempts: [] as Array<Record<string, unknown>>, budget: {} };
  let disconnect: (() => Promise<void>) | undefined;
  try {
  report.sourceVersions = Object.fromEntries(await Promise.all(["lib/mission/runner.ts", "lib/mission/modelAdapter.ts", "lib/mission/contextBuilder.ts", "lib/mission/tools.ts", "lib/mission/memorySearch.ts", "lib/mission/modelProtocol.ts", "lib/mission/continuationService.ts", "prisma/schema.prisma"].map(async file => [file, createHash("sha256").update(await readFile(path.join(process.cwd(), file))).digest("hex")])));
  try {
    const prior = JSON.parse(await readFile(reportPath, "utf8"));
    if (prior.runId === report.runId && Array.isArray(prior.attempts)) report.attempts = prior.attempts.map((attempt: Record<string, unknown>) => attempt.status === "STARTED" ? { ...attempt, status: "ABORTED_UNKNOWN", code: "PRIOR_PROCESS_INTERRUPTED" } : attempt);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const { db } = await import("../../lib/db");
  disconnect = () => db.$disconnect();
    const { createMission, commandMission, missionDetail } = await import("../../lib/mission/missionService");
    const { runMissionSlice } = await import("../../lib/mission/runner");
    const { projectTools } = await import("../../lib/mission/tools");
    const { scanWaitingMaterials, readProjectMaterial } = await import("../../lib/mission/sourceSignals");
    const { previewContinuation, confirmContinuation } = await import("../../lib/mission/continuationService");
    const { previewArtifactAdoption, confirmArtifactAdoption } = await import("../../lib/mission/artifactAdoptionService");
    const save = async () => { report.budget = budget.summary(); await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 }); };
    const fixture = async (goal: string) => {
      const owner = await db.user.create({ data: { username: "p0a-" + randomUUID(), displayName: "隔离评测身份", passwordHash: "EVALUATION_NO_LOGIN", security: { create: {
        email: randomUUID() + "@evaluation.invalid", emailVerifiedAt: new Date(), dailyCloudLimit: options.maxRequests } } } });
      const project = await db.project.create({ data: { title: "P0-A 隔离合成项目", description: "SYNTHETIC；不是真实用户实验", goal, scenario: "RESEARCH",
        memberships: { create: { userId: owner.id, role: "OWNER" } } } });
      const capture = await db.capture.create({ data: { projectId: project.id, sourceType: "EVALUATION_SYNTHETIC", rawText: "已完成基线训练和参数核对，复赛验证准确率尚未记录。" } });
      await db.knowledgeCard.create({ data: { projectId: project.id, captureId: capture.id, title: "阶段汇报实验进度", summary: capture.rawText,
        type: "experiment_log", keywords: ["准确率", "阶段汇报", "项目"], relatedTasks: [], nextActions: [], importance: 3 } });
      return { owner, project };
    };
    const runSlice = async (id: string, tools = projectTools) => { if (!await runMissionSlice({ id, tools })) throw new Error("MISSION_NOT_CLAIMED"); };
    if (!report.attempts.some(attempt => attempt.kind === "protocol")) {
      budget.setScope("protocol");
      const data = await fixture("协议往返探针：先读取项目，再根据实际观察检索本项目记录；只读取，不写业务、不研究外网。");
      const mission = await createMission(data.owner.id, { projectId: data.project.id, requestId: randomUUID(), goal: data.project.goal, llmContextApproved: true });
      const attempt: Record<string, unknown> = { kind: "protocol", missionId: mission.id, status: "STARTED", datasetOrigin: "SYNTHETIC" };
      report.attempts.push(attempt); await save();
      try {
        const reads = { inspect_project: projectTools.inspect_project, search_memory: projectTools.search_memory };
        for (let slice = 0; slice < 3; slice++) {
          await runSlice(mission.id, reads);
          const state = await missionDetail(data.owner.id, mission.id);
          if (budget.entries().some(entry => entry.scope === "protocol" && entry.hasObservation)) break;
          if (state.status !== "READY") throw new Error("PROTOCOL_STOPPED_" + state.status);
        }
        const entries = budget.entries().filter(entry => entry.scope === "protocol"), state = await missionDetail(data.owner.id, mission.id);
        const runs = await db.agentRun.count({ where: { projectId: data.project.id, status: "SUCCESS" } });
        if (!state.steps.some(step => step.status === "SUCCEEDED") || runs < 2 || !entries.some(entry => entry.hasObservation)) throw new Error("ROUND_TRIP_NOT_VERIFIED");
        Object.assign(attempt, { status: "PASSED", actualReadTool: state.steps[0]?.toolName, modelRequests: entries.length, observationReturned: true, taskSuccessInferred: false });
        await commandMission(data.owner.id, mission.id, "cancel", { requestId: randomUUID(), expectedVersion: state.version });
      } catch (error) { Object.assign(attempt, { status: "FAILED", code: safeCode(error) }); }
      await save();
    }
    if (options.phase === "all" && report.attempts.some(attempt => attempt.kind === "protocol" && attempt.status === "PASSED")) {
      for (let repeat = 1; repeat <= options.repeats; repeat++) {
        if (report.attempts.some(attempt => attempt.repeat === repeat)) continue;
        budget.setScope("continuation-" + repeat);
        const data = await fixture("根据本项目材料准备阶段汇报草稿，包含已完成事项、风险和下一步。先核对已有记录；缺少复赛验证准确率时向用户询问，不能猜测。补充记录后继续本委托，保存带准确来源引用的简明草稿，最后满足验收条件。不要外部研究，不创建行动。");
        const mission = await createMission(data.owner.id, { projectId: data.project.id, requestId: randomUUID(), goal: data.project.goal,
          successCriteria: ["DRAFT_EXISTS", "REQUIRED_INPUT_PRESENT", { type: "SOURCE_COUNT", minimum: 1 }], llmContextApproved: true });
        const attempt: Record<string, unknown> = { kind: "continuation", repeat, missionId: mission.id, projectId: data.project.id,
          status: "STARTED", datasetOrigin: "SYNTHETIC", humanInputMode: "PREDECLARED_EVALUATION_RESPONSE" };
        report.attempts.push(attempt); await save();
        try {
          let supplied = false;
          for (let slice = 0; slice < 18; slice++) {
            let state = await missionDetail(data.owner.id, mission.id);
            if (state.status === "WAITING_INPUT") {
              if (supplied || !state.question) throw new Error("UNEXPECTED_ADDITIONAL_INPUT");
              const capture = await db.capture.create({ data: { projectId: data.project.id, sourceType: "EVALUATION_SYNTHETIC",
                rawText: "复赛验证准确率：91%。本项目基线训练与参数核对已完成；数字是隔离评测合成材料，不代表真实实验。下一步核对验证数据划分并审阅阶段汇报。" } });
              await scanWaitingMaterials();
              const source = await readProjectMaterial(data.project.id, "capture:" + capture.id);
              if (!source) throw new Error("INPUT_SOURCE_MISSING");
              const body = { questionId: state.question.id, sourcePointers: [{ id: source.id, hash: source.hash }] };
              const preview = await previewContinuation(data.owner.id, mission.id, body);
              const result = await confirmContinuation(data.owner.id, mission.id, { ...body, requestId: randomUUID(), expectedVersion: state.version,
                expectedContextVersion: state.contextVersion, assessmentHash: preview.assessmentHash, answer: capture.rawText, confirmedGap: true });
              if (!result.continued) throw new Error("CONTINUATION_HELD");
              supplied = true; attempt.questionId = state.question.id; attempt.inputSourceId = source.id; continue;
            }
            if (state.status === "SUCCEEDED") {
              if (!supplied || !state.outputs[0]) throw new Error("PREMATURE_COMPLETION");
              const output = state.outputs[0];
              const preview = await previewArtifactAdoption(data.owner.id, mission.id, output.id, { artifactType: "weekly_report", expectedOutputRevision: output.revision });
              const receipt = await confirmArtifactAdoption(data.owner.id, mission.id, output.id, { requestId: randomUUID(), artifactType: "weekly_report",
                expectedOutputRevision: output.revision, expectedContextVersion: state.contextVersion, previewHash: preview.previewHash });
              state = await missionDetail(data.owner.id, mission.id);
              Object.assign(attempt, { status: "ENGINEERING_COMPLETED_PENDING_HUMAN_CONTENT_REVIEW", outputId: output.id, outputVerification: output.verificationStatus,
                artifactId: receipt.artifactId, receiptId: receipt.id, sameMissionRestored: true,
                draftForHumanReview: output,
                businessActionCount: await db.actionItem.count({ where: { projectId: data.project.id } }), steps: state.steps.map(step => ({ tool: step.toolName, status: step.status })),
                goalSemanticSuccess: "NOT_INFERRED", realityOutcome: "NOT_INFERRED" });
              break;
            }
            if (state.status !== "READY") throw new Error("MISSION_STOPPED_" + state.status);
            await runSlice(mission.id);
          }
          if (attempt.status === "STARTED") throw new Error("EVALUATION_SLICE_LIMIT");
        } catch (error) {
          const state = await missionDetail(data.owner.id, mission.id);
          Object.assign(attempt, { status: "FAILED", code: safeCode(error), missionStatus: state.status, error: state.error, outputCount: state.outputs.length });
        }
        await save();
        if (budget.summary().requestsStarted >= options.maxRequests) break;
      }
    }
    await save(); return { ...report, evidenceDirectory: environment.directory, humanReviewRequired: true, realProjectOutcomeVerified: false };
  } finally { globalThis.fetch = originalFetch; try { await disconnect?.(); } finally { await budget.close(); } }
}
