import { randomUUID } from "node:crypto";
import type { AgentMission } from "@/lib/generated/prisma/client";
import { AppError } from "@/lib/api";
import { record } from "@/lib/conversation/repository";
import { json, jsonHash, type Source } from "@/lib/mission/contracts";
import { event, validateSources, type Tx } from "@/lib/mission/repository";
import { outputSchema } from "@/lib/mission/tools";
import { validateResearchOutput } from "@/lib/mission/researchOutputSchema";
import type { BuiltinSkillId } from "./registry";

/**
 * Stage artifacts are the viewable deliverable of a non-creation Skill (planning / research / review).
 * They are persisted in Mission.planJson so this round needs no migration and never becomes a report
 * revision: creation outputs stay untouched, and business actions are not created by these Skills.
 */

export type SkillArtifactCheck = { name: string; passed: boolean; detail: string };
export type SkillArtifact = {
  schemaVersion: 1;
  id: string;
  skillId: BuiltinSkillId;
  stage: BuiltinSkillId;
  createdAt: string;
  contextVersion: number;
  planRevision: number;
  contentHash: string;
  blocks: Array<{ blockId: string; text: string; kind: string; sourceIds: string[]; citations: Array<{ sourceId: string; start: number; end: number; excerptHash: string }> }>;
  sources: Source[];
  checks: SkillArtifactCheck[];
  unknowns: string[];
  policy: string;
};

const POLICY = "阶段成果只依据本轮读取的来源；不修改原报告，不创建业务行动，不代表现实工作已完成。";

export function readSkillArtifacts(planJson: unknown): SkillArtifact[] {
  const raw = record(planJson).skillArtifacts;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is SkillArtifact => {
    const value = item as { schemaVersion?: number; id?: unknown; blocks?: unknown };
    return value?.schemaVersion === 1 && typeof value.id === "string" && Array.isArray(value.blocks);
  });
}

function artifactChecks(body: { blocks: Array<{ kind: string; sourceIds: string[]; text: string }>; missingInformation: string[] }): SkillArtifactCheck[] {
  return [
    { name: "SOURCES_BOUND", passed: body.blocks.some(block => block.sourceIds.length > 0), detail: "阶段成果至少一段绑定真实来源" },
    { name: "CITATIONS_RESOLVE", passed: true, detail: "引用已通过原输出校验器与来源指纹核对" },
    { name: "UNKNOWNS_DECLARED", passed: body.missingInformation.length > 0 || body.blocks.some(block => block.kind === "INFERENCE" && /未知|待核对|未写明|未给出|尚未/.test(block.text)), detail: "未知项显式记录，未写成事实" },
    { name: "NO_BUSINESS_ACTION", passed: true, detail: "阶段成果不创建行动或外部写入" },
  ];
}

/** Validate and append the current Skill's stage artifact. The caller owns the fenced transaction. */
export async function saveSkillArtifact(tx: Tx, mission: AgentMission, input: unknown, available: Source[],
  skill: { stage: BuiltinSkillId; sequence: BuiltinSkillId[] }): Promise<SkillArtifact> {
  const body = outputSchema.parse(input);
  if (!body.blocks.some(block => block.sourceIds.length > 0))
    throw new AppError("SKILL_ARTIFACT_UNSOURCED", "阶段成果缺少可核对来源，未保存", 409);
  validateResearchOutput(body, available);
  const sourceIds = [...new Set(body.blocks.flatMap(block => block.sourceIds))];
  const sources = sourceIds.map(id => available.find(source => source.id === id)).filter((source): source is Source => !!source)
    .map(source => ({ ...source, text: source.text.slice(0, 2000) }));
  if (!sources.length) throw new AppError("SKILL_ARTIFACT_UNSOURCED", "阶段成果没有可核对的项目来源", 409);
  await validateSources(mission.projectId, sources, tx, mission.id);
  const contentHash = jsonHash({ stage: skill.stage, blocks: body.blocks, sources: sources.map(source => [source.id, source.hash]) });
  const existing = readSkillArtifacts(mission.planJson).find(item => item.contentHash === contentHash);
  if (existing) return existing;
  const artifact: SkillArtifact = {
    schemaVersion: 1, id: randomUUID(), skillId: skill.stage, stage: skill.stage,
    createdAt: new Date().toISOString(), contextVersion: mission.contextVersion, planRevision: mission.planRevision,
    contentHash, blocks: body.blocks.map(block => ({ blockId: block.blockId, text: block.text, kind: block.kind,
      sourceIds: block.sourceIds, citations: block.citations })),
    sources, checks: artifactChecks(body), unknowns: body.missingInformation, policy: POLICY,
  };
  const plan = record(mission.planJson), previous = readSkillArtifacts(mission.planJson);
  await tx.agentMission.update({ where: { id: mission.id }, data: { planJson: json({ ...plan, skillArtifacts: [...previous, artifact].slice(-8) }) } });
  await event(tx, mission.id, "SKILL_ARTIFACT_SAVED", {
    artifactId: artifact.id, skillId: artifact.skillId, contentHash, contextVersion: artifact.contextVersion,
    planRevision: artifact.planRevision, sourceRefs: artifact.sources.map(source => ({ id: source.id, hash: source.hash })),
    checks: artifact.checks, unknowns: artifact.unknowns, sequence: skill.sequence,
  });
  return artifact;
}
