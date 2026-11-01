import { db } from "@/lib/db";
import type { Tx } from "@/lib/conversation/repository";
import { json, jsonHash } from "@/lib/mission/contracts";
import { policyInTx } from "./userMemoryPolicy";
import { ACCOUNT_SCOPE_KEY } from "./scope";
import { admitPersonalMemory } from "./personalAdmission";


/**
 * PM-2 候选理解：只在已获准的原 Conversation/Mission 输出内生成（memorySynthesis.memoryCandidates），
 * 不为提取额外调用模型；账户开关关闭时不落任何候选；同一原根与表述不重复提议（拒绝后冷却）。
 * 候选永远不进入决策上下文，激活只经用户冻结确认。
 */
export async function recordSynthesisCandidates(tx: Tx, userId: string, synthesis: {
  memoryCandidates?: Array<{ statement: string; kind: string; conditions: string[]; basis: string; sourceIds: string[] }>;
}, scope: { projectId: string; missionId?: string; conversationId?: string }, roots: Array<{ id: string }>): Promise<number> {
  const policy = await policyInTx(tx, userId);
  if (!policy.candidateInferenceEnabled) return 0;
  const proposals = (synthesis.memoryCandidates ?? []).slice(0, 3);
  let created = 0;
  for (const proposal of proposals) {
    const admission = admitPersonalMemory(proposal.statement);
    if (admission.status === "REJECTED_FOR_MEMORY" || admission.status === "NOT_USER_MEMORY_COMMAND") continue;
    // 同一原根集合 + 同一表述只提议一次；被拒绝或已存在（任意状态）都不再催问。
    const rootIds = roots.filter(root => proposal.sourceIds.includes(root.id)).map(root => root.id).sort((a, b) => a.localeCompare(b));
    const originKey = jsonHash({ statement: proposal.statement.trim(), rootIds });
    const existing = await tx.agentClaim.findUnique({ where: { ownerUserId_scopeKey_originKey: { ownerUserId: userId, scopeKey: ACCOUNT_SCOPE_KEY, originKey } } });
    if (existing) continue;
    const conditions = { topics: proposal.conditions.slice(0, 6), useScope: { mode: "ALL" } };
    const claim = await tx.agentClaim.create({ data: { ownerUserId: userId, scopeType: "ACCOUNT", projectId: null,
      scopeKey: ACCOUNT_SCOPE_KEY, conversationId: null, missionId: null, originKey,
      originJson: json({ kind: "MODEL_CANDIDATE", basis: proposal.basis, rootIds, projectId: scope.projectId,
        missionId: scope.missionId ?? null, conversationId: scope.conversationId ?? null }),
      kind: proposal.kind, canonicalStatement: proposal.statement, conditionsJson: json(conditions),
      statusProjection: "CANDIDATE" } });
    await tx.agentClaimEvent.create({ data: { claimId: claim.id, ownerUserId: userId, revision: 1,
      requestId: `candidate-${claim.id}`, payloadHash: jsonHash(proposal), eventKind: "PERSONAL_CANDIDATE",
      actorKind: "MODEL", modelInterpretation: proposal.statement, targetHash: jsonHash({ statement: proposal.statement, conditions }),
      evidenceManifestJson: json(rootIds.map(id => ({ projectId: scope.projectId, sourceId: id }))),
      assessmentJson: json({ basis: proposal.basis }) } });
    created++;
  }
  return created;
}

/** 使用记录：从原 Turn/Step 的读集元数据提取最小可核对指针；不重建内容。 */
export async function readPersonalMemoryUses(userId: string, claimId: string) {
  const turns = await db.conversationTurn.findMany({ where: { conversation: { ownerUserId: userId }, status: { not: "ACCEPTED" } },
    orderBy: { createdAt: "desc" }, take: 120, select: { id: true, createdAt: true, readManifestJson: true, conversationId: true } });
  const steps = await db.agentMissionStep.findMany({ where: { mission: { ownerUserId: userId } },
    orderBy: { ordinal: "desc" }, take: 120, select: { id: true, missionId: true, startedAt: true, protocolJson: true } });
  const uses: Array<{ kind: "CONVERSATION_TURN" | "MISSION_STEP"; id: string; at: string; stage: "INJECTED" }> = [];
  for (const turn of turns) {
    const readSet = (turn.readManifestJson as { personalMemoryReadSet?: { items?: Array<{ claimId: string }> } }).personalMemoryReadSet;
    if ((readSet?.items ?? []).some(item => item.claimId === claimId))
      uses.push({ kind: "CONVERSATION_TURN", id: turn.id, at: turn.createdAt.toISOString(), stage: "INJECTED" });
  }
  for (const step of steps) {
    const readSet = (step.protocolJson as { personalMemoryReadSet?: { items?: Array<{ claimId: string }> } } | null)?.personalMemoryReadSet;
    if ((readSet?.items ?? []).some(item => item.claimId === claimId))
      uses.push({ kind: "MISSION_STEP", id: step.id, at: step.startedAt.toISOString(), stage: "INJECTED" });
  }
  return uses.slice(0, 24);
}
