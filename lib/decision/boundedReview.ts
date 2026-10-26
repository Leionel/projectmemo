import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { json, jsonHash } from "@/lib/mission/contracts";
import { event, lock, type Tx } from "@/lib/mission/repository";
import { writeTransaction, type CopilotActor } from "@/lib/copilot/confirmation";
import { dynamicAdoptSchema, type ReviewBase, type DynamicReviewResult } from "@/lib/types/changeReview";
import type { DynamicReviewGuard } from "@/lib/mission/dynamicGuard";
import { assertToolConstraints } from "@/lib/mission/constraintsService";
import { reviewFresh, reviewMission, requireReviews } from "./reviewPersistence";

/** Adopting binds one original-Mission operation; the original Runner executes it without another planning call. */
export async function adoptDynamicPlan(actor: CopilotActor, proposalId: string, raw: unknown, transaction?: Tx) {
  const input = dynamicAdoptSchema.parse(raw), inputHash = jsonHash({ proposalId, input, purpose: "ADOPT_DYNAMIC" });
  const apply = async (tx: Tx) => {
    const p = await tx.decisionScenarioProposal.findFirst({ where: { id: proposalId, ownerUserId: actor.userId, purpose: "DYNAMIC_PLAN" } });
    if (!p) throw new AppError("PROPOSAL_NOT_FOUND", "动态方案不存在或不可访问", 404);
    await lock(tx, p.missionId);
    const m = await reviewMission(actor, p.missionId, tx), base = p.baseManifest as unknown as ReviewBase;
    const alias = await tx.decisionReviewRequest.findUnique({ where: { ownerUserId_requestId: { ownerUserId: actor.userId, requestId: input.requestId } } });
    if (alias && (alias.proposalId !== p.id || alias.inputHash !== inputHash)) throw new AppError("REQUEST_ID_REUSED", "确认请求编号已用于其他内容", 409);
    if (p.proposalHash !== input.proposalHash) throw new AppError("PROPOSAL_CHANGED", "所选方案已变化", 409);
    if (p.status === "CONFIRMED") {
      if (p.selectedKey !== input.candidateId) throw new AppError("PROPOSAL_CHANGED", "本方案已采用另一选择", 409);
      if (!alias) await tx.decisionReviewRequest.create({ data: { ownerUserId: actor.userId, requestId: input.requestId, inputHash, proposalId: p.id } });
      return p.receiptJson;
    }
    requireReviews();
    if (p.status !== "READY" || p.expiresAt <= new Date()) throw new AppError("PROPOSAL_EXPIRED", "方案已处理或过期，请重新核对", 409);
    if (m.version !== input.expectedVersion || m.version !== base.expectedVersion || !await reviewFresh(base, m, tx))
      throw new AppError("REVIEW_CHANGED", "原目标、相关资料或委托版本已变化", 409);
    const result = p.scenariosJson as unknown as DynamicReviewResult;
    const candidate = result.candidates.find(c => c.candidateId === input.candidateId);
    if (!candidate || candidate.feasibility !== "READY") throw new AppError("UNKNOWN_HARD_CONSTRAINT", "该方案仍有未核对条件，先读资料或追问", 409);
    if (!["READY", "PAUSED"].includes(m.status) || m.cancelRequestedAt || m.pauseRequestedAt && m.status !== "PAUSED")
      throw new AppError("MISSION_CHANGED", "原委托状态不允许采用新方案", 409);
    const root = await tx.decisionScenarioProposal.findFirst({ where: { id: p.parentId ?? "", missionId: m.id, ownerUserId: actor.userId, purpose: "CHANGE_REVIEW", status: "READY" } });
    if (!root || !await reviewFresh(root.baseManifest as unknown as ReviewBase, m, tx)) throw new AppError("REVIEW_CHANGED", "原变化复核已失效", 409);
    const readAttempts = Number((root.reviewStateJson as { toolAttempts?: number } | null)?.toolAttempts ?? 0);
    if (candidate.kind === "READ_EXISTING" && candidate.sourceIds.length + readAttempts > 2) throw new AppError("REVIEW_READ_LIMIT", "本轮只读调查最多两次，请选择追问或保留计划", 409);
    let missionVersion = m.version, planRevision = m.planRevision;
    if (candidate.kind !== "KEEP_PLAN") {
      assertToolConstraints(m.constraintsJson, candidate.kind === "ASK_USER" ? "ask_user" : "read_project_material", { title: candidate.title, question: candidate.question, sourceIds: candidate.sourceIds });
      if (["WAITING_INPUT", "WAITING_APPROVAL"].includes(String((m.planJson as { resumeStatus?: string }).resumeStatus ?? "")))
        throw new AppError("ORIGINAL_DECISION_PENDING", "请先回应原问题或批准请求，再采用新的调查方案", 409);
      if (!["READ_EXISTING", "ASK_USER"].includes(candidate.kind)) throw new AppError("VERIFICATION_REVIEW_REQUIRED", "验证计划需要先核对条件与区分力", 409);
      const guard: DynamicReviewGuard = { schemaVersion: 2, rootReviewId: root.id, originalRootReviewKey: (root.baseManifest as unknown as ReviewBase).rootReviewKey,
        proposalId: p.id, candidateId: candidate.candidateId, kind: candidate.kind as "READ_EXISTING" | "ASK_USER",
        goalHash: base.goalHash, successHash: base.successHash, constraintsHash: base.constraintsHash, scopeHash: base.scopeHash, projectGoalHash: base.projectGoalHash,
        readSet: base.sourcePointers, allowedReads: base.sourcePointers.filter(p => candidate.sourceIds.includes(p.id)), question: candidate.question, completed: false };
      const pending = await tx.agentMissionStep.findMany({ where: { missionId: m.id, status: { in: ["READY", "RUNNING"] } }, take: 101 });
      if (pending.length > 100) throw new AppError("INCOMPLETE_PENDING_SCOPE", "未执行步骤范围过大，请先核对原计划", 409);
      for (const step of pending) {
        // Switching to an explicitly selected read/question changes the execution scope of incompatible pending work.
        await tx.agentMissionStep.update({ where: { id: step.id }, data: { status: "OBSOLETE", finishedAt: new Date() } });
        await tx.agentMissionApproval.updateMany({ where: { stepId: step.id, status: { in: ["PENDING", "APPROVED"] } }, data: { status: "OBSOLETE" } });
      }
      const updated = await tx.agentMission.update({ where: { id: m.id }, data: { planRevision: { increment: 1 }, contextVersion: { increment: 1 }, version: { increment: 1 },
        planJson: json({ ...m.planJson as object, automaticContinuation: null, dynamicReview: guard }), status: "READY", pauseReason: null,
        executionSlot: null, leaseOwner: null, leaseUntil: null, leaseEpoch: { increment: 1 }, pauseRequestedAt: null, nextAttemptAt: null } });
      missionVersion = updated.version; planRevision = updated.planRevision;
      if (candidate.kind === "READ_EXISTING") {
        const last = await tx.agentMissionStep.aggregate({ where: { missionId: m.id }, _max: { ordinal: true } });
        let ordinal = last._max.ordinal ?? 0;
        const run = await tx.agentRun.create({ data: { projectId: m.projectId, runType: "CHAT", provider: "project_state", status: "SUCCESS", trace: { purpose: "DYNAMIC_PLAN_ADOPTED", proposalId: p.id, candidateId: candidate.candidateId, rootReviewId: root.id } } });
        for (const pointer of guard.allowedReads) {
          const args = { sourceId: pointer.id, sourceHash: pointer.hash };
          await tx.agentMissionStep.create({ data: { missionId: m.id, ordinal: ++ordinal, planRevision, toolName: "read_project_material", toolVersion: "1", status: "READY",
            canonicalInputJson: args, inputHash: jsonHash(args), readSetJson: [], agentRunId: run.id,
            protocolJson: { purpose: "DYNAMIC_READ", rootReviewId: root.id, proposalId: p.id } } });
        }
      }
    }
    const receipt = { id: p.id, missionId: m.id, projectId: m.projectId, candidateId: candidate.candidateId, kind: candidate.kind,
      oldPlanRevision: m.planRevision, planRevision, missionVersion, status: candidate.kind === "KEEP_PLAN" ? m.status : "READY", executed: false };
    await tx.decisionScenarioProposal.update({ where: { id: p.id }, data: { status: "CONFIRMED", confirmRequestId: input.requestId, confirmHash: inputHash, selectedKey: candidate.candidateId, receiptJson: json(receipt) } });
    if (!alias) await tx.decisionReviewRequest.create({ data: { ownerUserId: actor.userId, requestId: input.requestId, inputHash, proposalId: p.id } });
    await event(tx, m.id, candidate.kind === "KEEP_PLAN" ? "DYNAMIC_PLAN_KEPT" : "DYNAMIC_PLAN_ADOPTED", receipt);
    return json(receipt);
  };
  return transaction ? apply(transaction) : writeTransaction(proposalId, apply);
}

export async function latestDynamicReview(actor: CopilotActor, missionId: string) {
  await reviewMission(actor, missionId);
  const p = await db.decisionScenarioProposal.findFirst({ where: { missionId, ownerUserId: actor.userId, purpose: "DYNAMIC_PLAN" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  return p?.id ?? null;
}
