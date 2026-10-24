import { db } from "@/lib/db";
import { createHash } from "node:crypto";
import { json } from "@/lib/mission/contracts";
import { buildTrajectoryIndex, type TrajectoryEntry, type TrajectoryIndex } from "./trajectoryIndex";

/**
 * P3-A 候选经验提炼（纯规则，无模型调用）。
 * WORKFLOW（成功工作方法）：工程执行成功且成果被用户采用的成功工具序列。
 * GUARDRAIL（失败防护规则）：失败后同工具修复成功的 (tool, reasonClass)。
 * 样本只按 missionId 去重计数；同一次重试不重复计样本。
 * 状态机：CANDIDATE →（supportCount ≥ 2 自动）SHADOW →（仅用户操作）ACTIVE / REVOKED。
 * 撤销后保留历史与使用记录；同步只并集样本、上调状态，不删除、不降级。
 */

export type ExperienceKind = "WORKFLOW" | "GUARDRAIL";

export type ExperienceCandidate = {
  kind: ExperienceKind;
  patternHash: string;
  pattern: { sequence?: string[]; tool?: string; reasonClass?: string };
  title: string;
  statement: string;
  applicability: { conditions: string[]; tools: string[] };
  toolVersions: Record<string, string>;
  protocolVersions: number[];
  supportMissionIds: string[];
  counterMissionIds: string[];
  sampleGoal: string;
};

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const goalHint = (goal: string) => (goal.length > 40 ? `${goal.slice(0, 40)}…` : goal);

function toolVersionsOf(entry: TrajectoryEntry, tools: string[]): Record<string, string> {
  const versions: Record<string, string> = {};
  for (const call of entry.tools) if (tools.includes(call.name)) versions[call.name] = call.version;
  return versions;
}

function protocolVersionsOf(entry: TrajectoryEntry): number[] {
  return [...new Set(entry.tools.map(t => t.protocolSchemaVersion).filter((v): v is number => v !== null))];
}

export function extractCandidates(index: TrajectoryIndex): ExperienceCandidate[] {
  const candidates = new Map<string, ExperienceCandidate>();
  const upsert = (candidate: ExperienceCandidate) => {
    const existing = candidates.get(candidate.patternHash);
    if (!existing) { candidates.set(candidate.patternHash, candidate); return; }
    existing.supportMissionIds = [...new Set([...existing.supportMissionIds, ...candidate.supportMissionIds])];
    existing.counterMissionIds = [...new Set([...existing.counterMissionIds, ...candidate.counterMissionIds])].filter(id => !existing.supportMissionIds.includes(id));
  };

  for (const entry of index.entries) {
    // WORKFLOW：工程执行成功 + 用户采用（归入回执）。反例 = 同序列工程成功但未被采用。
    if (entry.engineeringCompleted && entry.adoptionCount > 0 && entry.successSequence.length > 0) {
      const sequence = entry.successSequence;
      const patternHash = hash({ kind: "WORKFLOW", sequence });
      upsert({
        kind: "WORKFLOW",
        patternHash,
        pattern: { sequence },
        title: `工作方法：${sequence.join(" → ")}`,
        statement: `在类似“${goalHint(entry.goal)}”的委托中，按 ${sequence.join(" → ")} 的顺序推进、经你批准后归入成果，曾在 ${entry.missionId.slice(-6)} 号委托达成用户采用。这是建议，不改变任何权限。`,
        applicability: { conditions: [`目标类似“${goalHint(entry.goal)}”`, "需要项目内资料支撑并产出可归入草稿"], tools: sequence },
        toolVersions: toolVersionsOf(entry, sequence),
        protocolVersions: protocolVersionsOf(entry),
        supportMissionIds: [entry.missionId],
        counterMissionIds: [],
        sampleGoal: entry.goal,
      });
    }
    // GUARDRAIL：失败后同工具修复成功。反例 = 同 (tool, reason) 失败且未修复。
    for (const observation of entry.guardrailObservations.filter(o => o.repaired)) {
      const patternHash = hash({ kind: "GUARDRAIL", tool: observation.tool, reasonClass: observation.reasonClass });
      upsert({
        kind: "GUARDRAIL",
        patternHash,
        pattern: { tool: observation.tool, reasonClass: observation.reasonClass },
        title: `防护：${observation.tool} 因 ${observation.reasonClass} 失败`,
        statement: `${observation.tool} 曾因 ${observation.reasonClass} 中断，同一委托内修复后成功。执行 ${observation.tool} 前先确认该诱因已消除（核对模型配置与参数规模），失败时优先恢复而不是绕过检查。这是建议，不改变任何权限。`,
        applicability: { conditions: [`即将调用 ${observation.tool}`, `此前出现过 ${observation.reasonClass}`], tools: [observation.tool] },
        toolVersions: toolVersionsOf(entry, [observation.tool]),
        protocolVersions: protocolVersionsOf(entry),
        supportMissionIds: [entry.missionId],
        counterMissionIds: [],
        sampleGoal: entry.goal,
      });
    }
  }
  // 反例绑定：同一模式下的未成功/未采用轨迹。
  for (const entry of index.entries) {
    for (const candidate of candidates.values()) {
      if (candidate.supportMissionIds.includes(entry.missionId) || candidate.counterMissionIds.includes(entry.missionId)) continue;
      if (candidate.kind === "WORKFLOW"
        && entry.engineeringCompleted && entry.adoptionCount === 0
        && entry.successSequence.length === candidate.applicability.tools.length
        && entry.successSequence.every((tool, i) => tool === candidate.applicability.tools[i])) {
        candidate.counterMissionIds.push(entry.missionId);
      }
      if (candidate.kind === "GUARDRAIL") {
        const tool = candidate.pattern.tool ?? "";
        const reasonClass = candidate.pattern.reasonClass ?? "";
        const failedUnrepaired = entry.guardrailObservations.some(o => o.tool === tool && o.reasonClass === reasonClass && !o.repaired);
        if (failedUnrepaired) candidate.counterMissionIds.push(entry.missionId);
      }
    }
  }
  return [...candidates.values()];
}

const SHADOW_SUPPORT_THRESHOLD = 2;

/** 只读同步：并集样本、更新计数、CANDIDATE→SHADOW 上调；绝不自动激活，绝不删除或降级。 */
export async function syncExperiences(ownerUserId: string, projectId: string): Promise<number> {
  const index = await buildTrajectoryIndex(ownerUserId, projectId);
  const candidates = extractCandidates(index);
  for (const candidate of candidates) {
    const existing = await db.agentExperience.findUnique({ where: { projectId_kind_patternHash: { projectId, kind: candidate.kind, patternHash: candidate.patternHash } } });
    if (!existing) {
      await db.agentExperience.create({
        data: {
          projectId, ownerUserId, kind: candidate.kind, patternHash: candidate.patternHash,
          title: candidate.title, statement: candidate.statement,
          applicabilityJson: json(candidate.applicability),
          toolVersionsJson: json(candidate.toolVersions), protocolVersionsJson: json(candidate.protocolVersions),
          counterExamplesJson: json(candidate.counterMissionIds.map(id => ({ missionId: id, note: "同模式未达成采用的轨迹" }))),
          status: candidate.supportMissionIds.length >= SHADOW_SUPPORT_THRESHOLD ? "SHADOW" : "CANDIDATE",
          sampleMissionIdsJson: json(candidate.supportMissionIds),
          supportCount: candidate.supportMissionIds.length, counterCount: candidate.counterMissionIds.length,
        },
      });
      continue;
    }
    const supportMissionIds = [...new Set([...(existing.sampleMissionIdsJson as string[]), ...candidate.supportMissionIds])];
    const status = existing.status === "CANDIDATE" && supportMissionIds.length >= SHADOW_SUPPORT_THRESHOLD ? "SHADOW" : existing.status;
    await db.agentExperience.update({
      where: { id: existing.id },
      data: {
        status,
        sampleMissionIdsJson: json(supportMissionIds),
        supportCount: supportMissionIds.length, counterCount: candidate.counterMissionIds.length,
        counterExamplesJson: json(candidate.counterMissionIds.map(id => ({ missionId: id, note: "同模式未达成采用的轨迹" }))),
      },
    });
  }
  return candidates.length;
}
