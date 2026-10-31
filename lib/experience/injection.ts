import { effectiveContinuity } from "@/lib/continuity/directiveService";
import { sourceUse } from "@/lib/continuity/sourcePolicy";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { json, jsonHash } from "@/lib/mission/contracts";
import { record } from "@/lib/conversation/repository";
import type { AgentMission } from "@/lib/generated/prisma/client";
import type { Tx } from "@/lib/mission/repository";
import { compareConditions, facetsFromMission, readApplicability, type ConditionFacets } from "./conditions";

/**
 * CT-8 注入：只提供可评估的案例/方法建议，不授予业务写入权限，不修改事实或系统 Prompt。
 * 检索命中、注入、模型决策、用户反馈和结果回读分别记录；只有 MATCH + ACTIVE + 当前来源有效
 * 的经验进入模型上下文。SHADOW/CANDIDATE/UNKNOWN 仅在 UI 作为案例参考展示。
 */

export type ExperienceMatchState = "MATCH" | "MISMATCH" | "UNKNOWN";
export type ExperienceAdvisory = {
  id: string;
  version: number;
  contentHash: string;
  kind: string;
  title: string;
  statement: string;
  conditions: string[];
  unknownConditions: string[];
  notApplicableWhen: string[];
  matchState: "MATCH";
  purpose: "METHOD_ADVICE" | "RISK_WARNING";
  originMissionId: string | null;
  note: "项目内经验建议，不改变权限";
};
export type InjectionDecision = { advisory: ExperienceAdvisory; experienceId: string } | { suppressed: { experienceId: string; reason: string; matchState: ExperienceMatchState } };
export type ExperienceReadRef = { experienceId: string; version: number; contentHash: string; conditionKey: string; matchState: ExperienceMatchState };

const MAX_ADVISORIES = 3;
const MAX_ADVISORY_CHARS = 2200;

export function experienceContentHash(row: { version: number; title: string; statement: string; applicabilityJson: unknown; toolVersionsJson: unknown; protocolVersionsJson: unknown }) {
  return jsonHash({ version: row.version, title: row.title, statement: row.statement, applicability: row.applicabilityJson,
    tools: row.toolVersionsJson, protocols: row.protocolVersionsJson });
}

async function scenarioOf(projectId: string, tx: Tx = db) {
  return (await tx.project.findUnique({ where: { id: projectId }, select: { scenario: true } }))?.scenario ?? null;
}

export async function currentMissionFacets(m: AgentMission, usedTools: Array<{ name: string; version: string }>, tx: Tx = db): Promise<ConditionFacets> {
  const [steps, scenario] = await Promise.all([
    tx.agentMissionStep.findMany({ where: { missionId: m.id }, orderBy: { ordinal: "asc" },
      select: { toolName: true, toolVersion: true, status: true, canonicalInputJson: true, protocolJson: true } }),
    scenarioOf(m.projectId, tx),
  ]);
  const facets = facetsFromMission(m, steps, scenario);
  // Registry versions are current capabilities, not claims about what the historical run used.
  for (const tool of usedTools) if (tool.version) facets.toolVersions[tool.name] = tool.version;
  return facets;
}

type Rejection = { reason: string; matchState: ExperienceMatchState };

type ExperienceScope = { ownerUserId: string; projectId: string; missionId?: string; conversationId?: string };

async function evaluateRow(ownerUserId: string, scope: ExperienceScope, row: Awaited<ReturnType<typeof db.agentExperience.findMany>>[number],
  facets: ConditionFacets, usedTools: Array<{ name: string; version: string }>, protocolSchemaVersion: number | null, tx: Tx = db): Promise<{ matchState: ExperienceMatchState; reasons: string[]; rejection: Rejection | null; conditionKey: string }> {
  const conditionKey = row.conditionKey;
  if (row.revokedAt || row.status === "REVOKED") return { matchState: "MISMATCH", reasons: ["REVOKED"], rejection: { reason: "REVOKED", matchState: "MISMATCH" }, conditionKey };
  if (row.validUntil && +row.validUntil <= Date.now()) return { matchState: "MISMATCH", reasons: ["EXPIRED"], rejection: { reason: "EXPIRED", matchState: "MISMATCH" }, conditionKey };
  const policy = await sourceUse(ownerUserId, scope.projectId, "experience:" + row.id, tx, { ...(scope.missionId ? { missionId: scope.missionId } : {}), ...(scope.conversationId ? { conversationId: scope.conversationId } : {}) });
  if (policy.state === "SUPPRESSED" || policy.state === "UNKNOWN") return { matchState: "UNKNOWN", reasons: [policy.reason], rejection: { reason: policy.reason, matchState: "UNKNOWN" }, conditionKey };
  const applicability = readApplicability(row.applicabilityJson);
  if (!applicability) return { matchState: "UNKNOWN", reasons: ["LEGACY_CONDITION_SCHEMA"], rejection: { reason: "LEGACY_CONDITION_SCHEMA", matchState: "UNKNOWN" }, conditionKey };
  const match = compareConditions(row.applicabilityJson, facets);
  if (match.state !== "MATCH") return { matchState: match.state, reasons: match.reasons, rejection: { reason: match.reasons[0] ?? "CONDITION_MISMATCH", matchState: match.state }, conditionKey };
  const toolVersions = row.toolVersionsJson as Record<string, string>;
  const registry = new Map(usedTools.map(t => [t.name, t.version]));
  const missingTools = applicability.tools.filter(name => !registry.has(name));
  if (missingTools.length) return { matchState: "MISMATCH", reasons: [`TOOL_NOT_AVAILABLE:${missingTools.join(",")}`], rejection: { reason: `TOOL_NOT_AVAILABLE:${missingTools[0]}`, matchState: "MISMATCH" }, conditionKey };
  const mismatched = Object.entries(toolVersions).find(([name, version]) => registry.has(name) && registry.get(name) !== version);
  if (mismatched) return { matchState: "MISMATCH", reasons: [`TOOL_VERSION_MISMATCH:${mismatched[0]}`], rejection: { reason: `TOOL_VERSION_MISMATCH:${mismatched[0]}`, matchState: "MISMATCH" }, conditionKey };
  const protocolVersions = row.protocolVersionsJson as number[];
  if (protocolSchemaVersion === null || (protocolVersions.length > 0 && !protocolVersions.includes(protocolSchemaVersion)))
    return { matchState: "MISMATCH", reasons: [`PROTOCOL_VERSION_MISMATCH:${protocolSchemaVersion}`], rejection: { reason: `PROTOCOL_VERSION_MISMATCH:${protocolSchemaVersion}`, matchState: "MISMATCH" }, conditionKey };
  if (row.supportCount === 0) return { matchState: "UNKNOWN", reasons: ["NO_QUALIFIED_SUPPORT"], rejection: { reason: "NO_QUALIFIED_SUPPORT", matchState: "UNKNOWN" }, conditionKey };
  if (row.counterCount >= row.supportCount) return { matchState: "MISMATCH", reasons: ["EVIDENCE_TURNED_AGAINST"], rejection: { reason: "EVIDENCE_TURNED_AGAINST", matchState: "MISMATCH" }, conditionKey };
  if (row.status !== "ACTIVE") return { matchState: "MATCH", reasons: ["NOT_ACTIVE"], rejection: { reason: row.status === "SHADOW" ? "SHADOW_ONLY" : "NOT_ACTIVE", matchState: "MATCH" }, conditionKey };
  return { matchState: "MATCH", reasons: ["ELIGIBLE"], rejection: null, conditionKey };
}

async function resolveForScope(scope: ExperienceScope, facets: ConditionFacets, usedTools: Array<{ name: string; version: string }>,
  protocolSchemaVersion: number | null, tx: Tx = db): Promise<{ decisions: InjectionDecision[]; readSet: ExperienceReadRef[] }> {
  const rows = await tx.agentExperience.findMany({
    where: { projectId: scope.projectId, ownerUserId: scope.ownerUserId, status: { in: ["ACTIVE", "SHADOW", "CANDIDATE"] } },
    orderBy: [{ status: "asc" }, { supportCount: "desc" }], take: 24,
  });
  const decisions: InjectionDecision[] = [];
  const advisories: ExperienceAdvisory[] = [];
  const readSet: ExperienceReadRef[] = [];
  let chars = 0;
  for (const row of rows) {
    const evaluation = await evaluateRow(scope.ownerUserId, scope, row, facets, usedTools, protocolSchemaVersion, tx);
    if (evaluation.rejection) { decisions.push({ suppressed: { experienceId: row.id, ...evaluation.rejection } }); continue; }
    if (advisories.length >= MAX_ADVISORIES) { decisions.push({ suppressed: { experienceId: row.id, reason: "CONTEXT_BUDGET", matchState: "MATCH" } }); continue; }
    const applicability = readApplicability(row.applicabilityJson)!;
    const advisory: ExperienceAdvisory = {
      id: row.id, version: row.version, contentHash: experienceContentHash(row), kind: row.kind,
      title: row.title, statement: row.statement.slice(0, 700),
      conditions: applicability.conditions.slice(0, 3), unknownConditions: applicability.unknownConditions.slice(0, 3),
      notApplicableWhen: applicability.notApplicableWhen.slice(0, 3), matchState: "MATCH",
      purpose: row.kind === "GUARDRAIL" ? "RISK_WARNING" : "METHOD_ADVICE",
      originMissionId: (record(row.originJson).missionId as string | undefined) ?? null,
      note: "项目内经验建议，不改变权限",
    };
    const size = JSON.stringify(advisory).length;
    if (chars + size > MAX_ADVISORY_CHARS) { decisions.push({ suppressed: { experienceId: row.id, reason: "CONTEXT_BUDGET", matchState: "MATCH" } }); continue; }
    chars += size; advisories.push(advisory); decisions.push({ advisory, experienceId: row.id });
    readSet.push({ experienceId: row.id, version: row.version, contentHash: advisory.contentHash, conditionKey: evaluation.conditionKey, matchState: "MATCH" });
  }
  return { decisions, readSet };
}

export async function resolveExperience(m: AgentMission, usedTools: Array<{ name: string; version: string }>, protocolSchemaVersion: number | null, options?: { facets?: ConditionFacets; tx?: Tx }): Promise<{ decisions: InjectionDecision[]; readSet: ExperienceReadRef[] }> {
  const tx = options?.tx ?? db;
  const facets = options?.facets ?? await currentMissionFacets(m, usedTools, tx);
  return resolveForScope({ ownerUserId: m.ownerUserId, projectId: m.projectId, missionId: m.id }, facets, usedTools, protocolSchemaVersion, tx);
}

/** Conversation/Focus consumption uses the same matcher, with conversation-scoped directives and use records. */
export async function resolveConversationExperience(input: { ownerUserId: string; projectId: string; conversationId: string; turnId: string;
  facets: ConditionFacets; usedTools: Array<{ name: string; version: string }>; protocolSchemaVersion: number | null }, tx: Tx = db) {
  return resolveForScope({ ownerUserId: input.ownerUserId, projectId: input.projectId, conversationId: input.conversationId },
    input.facets, input.usedTools, input.protocolSchemaVersion, tx);
}

export async function injectionDecisions(m: AgentMission, usedTools: Array<{ name: string; version: string }>, protocolSchemaVersion: number | null, options?: { facets?: ConditionFacets; tx?: Tx }): Promise<InjectionDecision[]> {
  return (await resolveExperience(m, usedTools, protocolSchemaVersion, options)).decisions;
}

/** Record retrieval for every evaluated row; repeated calls are idempotent on scope+stage. */
export async function recordRetrieval(m: AgentMission, decisions: InjectionDecision[], contextHash: string | null) {
  for (const decision of decisions) {
    const id = "advisory" in decision ? decision.experienceId : decision.suppressed.experienceId;
    const matchState = "advisory" in decision ? "MATCH" : decision.suppressed.matchState;
    await db.agentExperienceUse.upsert({
      where: { experienceId_scopeKey_stage: { experienceId: id, scopeKey: "mission:" + m.id, stage: "RETRIEVED" } },
      create: { experienceId: id, missionId: m.id, scopeKey: "mission:" + m.id, actorKind: "MISSION", stage: "RETRIEVED", matchState, contextHash },
      update: { matchState, contextHash },
    }).catch(() => undefined);
  }
}

/** Legacy-compatible name: records actual injection, not merely a retrieval hit. */
export async function recordUses(missionId: string, decisions: InjectionDecision[], contextHash: string | null): Promise<void> {
  const advisories = decisions.filter((d): d is { advisory: ExperienceAdvisory; experienceId: string } => "advisory" in d);
  if (!advisories.length) return;
  for (const decision of advisories) {
    const a = decision.advisory;
    try {
      await db.agentExperienceUse.upsert({
        where: { experienceId_scopeKey_stage: { experienceId: a.id, scopeKey: "mission:" + missionId, stage: "INJECTED" } },
        create: { experienceId: a.id, missionId, scopeKey: "mission:" + missionId, actorKind: "MISSION", stage: "INJECTED",
          experienceVersion: a.version, contentHash: a.contentHash, matchState: "MATCH", contextHash },
        update: { experienceVersion: a.version, contentHash: a.contentHash, matchState: "MATCH", contextHash },
      });
    } catch { /* 建议注入失败不影响委托执行 */ }
  }
}

/** Conversation retrieval/injection records use the same use table, scoped by conversation turn. */
export async function recordConversationExperience(input: { projectId: string; conversationId: string; turnId: string },
  decisions: InjectionDecision[], contextHash: string | null) {
  const scopeKey = `conversation:${input.conversationId}:${input.turnId}`;
  for (const decision of decisions) {
    const id = "advisory" in decision ? decision.experienceId : decision.suppressed.experienceId;
    const matchState = "advisory" in decision ? "MATCH" : decision.suppressed.matchState;
    const advisory = "advisory" in decision ? decision.advisory : null;
    const stage = advisory ? "INJECTED" : "RETRIEVED";
    await db.agentExperienceUse.upsert({
      where: { experienceId_scopeKey_stage: { experienceId: id, scopeKey, stage } },
      create: { experienceId: id, conversationId: input.conversationId, turnId: input.turnId, scopeKey, actorKind: "CONVERSATION", stage,
        experienceVersion: advisory?.version ?? null, contentHash: advisory?.contentHash ?? null, matchState, contextHash },
      update: { matchState, contextHash, experienceVersion: advisory?.version ?? null, contentHash: advisory?.contentHash ?? null },
    }).catch(() => undefined);
  }
}

/** Model decision is recorded separately from injection and from user adoption. */
export async function recordModelDecision(input: { missionId?: string; conversationId?: string; turnId?: string;
  experienceId: string; disposition: string; reason?: string | null; version: number; contentHash: string; contextHash: string | null }) {
  const scopeKey = input.missionId ? "mission:" + input.missionId : `conversation:${input.conversationId}:${input.turnId}`;
  await db.agentExperienceUse.upsert({
    where: { experienceId_scopeKey_stage: { experienceId: input.experienceId, scopeKey, stage: "MODEL_DECISION" } },
    create: { experienceId: input.experienceId, missionId: input.missionId ?? null, conversationId: input.conversationId ?? null, turnId: input.turnId ?? null,
      scopeKey, actorKind: input.missionId ? "MISSION" : "CONVERSATION", stage: "MODEL_DECISION", experienceVersion: input.version,
      contentHash: input.contentHash, contextHash: input.contextHash, matchState: "MATCH", outcomeJson: json({ disposition: input.disposition, reason: input.reason ?? null }) },
    update: { outcomeJson: json({ disposition: input.disposition, reason: input.reason ?? null }), contextHash: input.contextHash },
  }).catch(() => undefined);
}

/** UI 就近展示：条件、未知、反例、匹配状态和最近一次模型决策；不泄露不可读来源。 */
export async function suggestionsForMission(m: AgentMission) {
  const rows = await db.agentExperience.findMany({
    where: { projectId: m.projectId, ownerUserId: m.ownerUserId, status: { in: ["ACTIVE", "SHADOW", "CANDIDATE", "REVOKED"] } },
    orderBy: [{ status: "asc" }, { supportCount: "desc" }], take: 16,
  });
  const current = await effectiveContinuity(m.ownerUserId, { projectId: m.projectId, missionId: m.id });
  const facets = await currentMissionFacets(m, [], db);
  const uses = await db.agentExperienceUse.findMany({ where: { missionId: m.id, stage: { in: ["INJECTED", "MODEL_DECISION", "USER_FEEDBACK"] } } });
  const items = [];
  for (const row of rows) {
    const policy = await sourceUse(m.ownerUserId, m.projectId, "experience:" + row.id, db, { missionId: m.id });
    if (policy.state === "SUPPRESSED") continue;
    const evaluation = evaluateRowSync(row, facets, current.directives.some(d => d.kind === "USE_SUPPRESSION"));
    if (!evaluation) continue;
    const applicability = readApplicability(row.applicabilityJson);
    const counters = Array.isArray(row.counterExamplesJson) ? row.counterExamplesJson as Array<{ missionId?: string; reason?: string }> : [];
    items.push({
      id: row.id, kind: row.kind, status: row.status, version: row.version,
      title: row.title, statement: row.statement,
      conditions: applicability?.conditions.slice(0, 4) ?? ((row.applicabilityJson as { conditions?: string[] }).conditions ?? []).slice(0, 3),
      unknownConditions: applicability?.unknownConditions.slice(0, 4) ?? ["旧版本未记录适用条件；不会自动升级为建议"],
      notApplicableWhen: applicability?.notApplicableWhen.slice(0, 3) ?? [],
      toolVersions: row.toolVersionsJson as Record<string, string>, supportCount: row.supportCount, counterCount: row.counterCount,
      caseReferenceCount: (row.evidenceJson as { caseReferenceCount?: number })?.caseReferenceCount ?? 0,
      sampleCount: (row.sampleMissionIdsJson as string[]).length,
      matchState: policy.state === "UNKNOWN" ? "UNKNOWN" : evaluation.matchState,
      eligibleForInjection: policy.state === "ALLOWED" && evaluation.matchState === "MATCH" && !evaluation.rejection && row.status === "ACTIVE",
      suppressed: policy.state === "UNKNOWN" ? policy.reason : evaluation.rejection?.reason ?? null,
      validUntil: row.validUntil?.toISOString() ?? null,
      revoked: row.revokedAt !== null,
      counterExamples: counters.slice(0, 3),
      originMissionId: (record(row.originJson).missionId as string | undefined) ?? null,
      modelDecision: uses.find(u => u.stage === "MODEL_DECISION")?.outcomeJson ?? null,
      userFeedback: uses.find(u => u.stage === "USER_FEEDBACK")?.outcomeJson ?? null,
      updatedAt: row.updatedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    });
  }
  return items;
}

/** Sync-only evaluation: source policy is rechecked at injection time; this projection stays bounded and deterministic. */
function evaluateRowSync(row: { revokedAt: Date | null; status: string; validUntil: Date | null; applicabilityJson: unknown; toolVersionsJson: unknown; protocolVersionsJson: unknown; supportCount: number; counterCount: number },
  facets: ConditionFacets, suppressed: boolean): { matchState: ExperienceMatchState; rejection: Rejection | null } | null {
  if (row.revokedAt || row.status === "REVOKED") return { matchState: "MISMATCH", rejection: { reason: "REVOKED", matchState: "MISMATCH" } };
  if (row.validUntil && +row.validUntil <= Date.now()) return { matchState: "MISMATCH", rejection: { reason: "EXPIRED", matchState: "MISMATCH" } };
  if (suppressed) return { matchState: "UNKNOWN", rejection: { reason: "ROOT_SUPPRESSED", matchState: "UNKNOWN" } };
  const match = compareConditions(row.applicabilityJson, facets);
  if (match.state !== "MATCH") return { matchState: match.state, rejection: { reason: match.reasons[0] ?? "CONDITION_MISMATCH", matchState: match.state } };
  if (row.supportCount === 0) return { matchState: "UNKNOWN", rejection: { reason: "NO_QUALIFIED_SUPPORT", matchState: "UNKNOWN" } };
  if (row.counterCount >= row.supportCount) return { matchState: "MISMATCH", rejection: { reason: "EVIDENCE_TURNED_AGAINST", matchState: "MISMATCH" } };
  return { matchState: "MATCH", rejection: null };
}

/** Revalidate every consumed experience before a model/tool/effect proceeds; old generation keeps history only. */
export async function assertExperienceReadSet(ownerUserId: string, raw: unknown, tx: Tx = db) {
  if (!Array.isArray(raw) || !raw.length) return;
  if (raw.length > 8) throw new AppError("COGNITIVE_RECOORDINATE", "经验读集超出范围，请重新核对", 409);
  for (const item of raw) {
    const ref = record(item);
    if (typeof ref.experienceId !== "string" || typeof ref.version !== "number" || typeof ref.contentHash !== "string")
      throw new AppError("COGNITIVE_RECOORDINATE", "经验读集不完整，请重新核对", 409);
    const row = await tx.agentExperience.findFirst({ where: { id: ref.experienceId, ownerUserId } });
    if (!row || row.status !== "ACTIVE" || row.revokedAt || (row.validUntil && +row.validUntil <= Date.now()) ||
      row.version !== ref.version || experienceContentHash(row) !== ref.contentHash)
      throw new AppError("COGNITIVE_RECOORDINATE", "经验已撤销、失效或版本变化，正在重新核对", 409);
    if (!await tx.projectMembership.findUnique({ where: { userId_projectId: { userId: ownerUserId, projectId: row.projectId } } }))
      throw new AppError("COGNITIVE_RECOORDINATE", "项目权限已变化，停止使用原经验", 409);
    const policy = await sourceUse(ownerUserId, row.projectId, "experience:" + row.id, tx);
    if (policy.state !== "ALLOWED") throw new AppError("COGNITIVE_RECOORDINATE", "经验来源已停止使用，正在重新核对", 409);
  }
}
