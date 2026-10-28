import { sourceUse } from "@/lib/continuity/sourcePolicy";
import { db } from "@/lib/db";
import { jsonHash } from "@/lib/mission/contracts";
import type { Tx } from "@/lib/mission/repository";
import type { AgentMission } from "@/lib/generated/prisma/client";

/** A bounded original-object snapshot, not a second goal-status ledger or a model verdict. */
export async function reviewGoalState(m: AgentMission, tx: Tx = db) {
  const actions = await tx.actionItem.findMany({ where: { projectId: m.projectId, isSimulated: false }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 8 });
  for (let i = actions.length - 1; i >= 0; i--) if ((await sourceUse(m.ownerUserId, m.projectId, "action:" + actions[i].id, tx, { missionId: m.id })).state !== "ALLOWED") actions.splice(i, 1);
  const outputs = await tx.agentMissionOutput.findMany({ where: { missionId: m.id }, orderBy: { revision: "desc" }, take: 4 });
  const facts = { actions: actions.map(a => ({ id: a.id, hash: jsonHash(a) })), outputs: outputs.map(o => ({ id: o.id, hash: jsonHash(o) })) };
  return { hash: jsonHash(facts), snapshot: { missionId: m.id, goal: m.goal, successCriteria: m.successCriteriaJson,
    currentPlan: { revision: m.planRevision, status: m.status },
    actionReceipts: actions.map(a => ({ sourceId: "action:" + a.id, revision: jsonHash(a), title: a.title, status: a.status,
      resultCardId: a.resultCardId, resultText: a.resultText?.slice(0, 1200) ?? null, resultTruncated: (a.resultText?.length ?? 0) > 1200,
      verification: a.resultText ? "REPORTED" : "NOT_CHECKED", completedAt: a.completedAt?.toISOString() ?? null })),
    outputs: outputs.map(o => ({ id: o.id, revision: o.revision, kind: o.kind, verificationStatus: o.verificationStatus })),
    coverage: { complete: false, policy: "LATEST_8_REAL_ACTIONS_4_PRIVATE_MISSION_OUTPUTS" } } };
}
