import { db } from "@/lib/db";
import { z } from "zod";
import { AppError } from "@/lib/api";
import { jsonHash, json } from "@/lib/mission/contracts";
import { record } from "@/lib/conversation/repository";
import { boundedPolicy, scopedDelegationAttention } from "@/lib/mission/investigationDelegation";
import { ownedMission, event, commandReplay } from "@/lib/mission/repository";
import {
  assertActor,
  writeTransaction,
  type CopilotActor,
} from "@/lib/copilot/confirmation";
import { isFeatureEnabled } from "@/lib/config/features";
import {
  applyInterventionPolicy,
  interventionPolicyScopeForUser,
} from "@/lib/services/interventionPolicyService";
import { recordFeedback } from "@/lib/services/interventionFeedbackService";
import { readDecisionSnapshot, type Tx } from "./snapshot";
import { assessImpact, changedRoots } from "./impact";
import { missionNavigationHref } from "@/lib/mission/navigation";
const inputSchema = z
  .object({
    action: z.enum([
      "PRESENT",
      "EXPOSED",
      "UNKNOWN",
      "LATER",
      "STOP",
      "WORTH_IT",
      "NOT_USEFUL",
    ]),
    questionId: z.string().min(1),
    contextHash: z.string().regex(/^[a-f0-9]{64}$/),
    requestId: z.string().min(1).max(128),
  })
  .strict();
export async function currentGoalQuestion(
  actor: CopilotActor,
  projectId: string,
  now = new Date(),
) {
  if (!isFeatureEnabled("GOAL_QUESTION_ENABLED", true))
    return { question: null, reason: "DISABLED" };
  return db.$transaction((tx) => currentGoalQuestionInTx(tx, actor, projectId, now));
}
export async function currentGoalQuestionInTx(
  tx: Tx,
  actor: CopilotActor,
  projectId: string,
  now = new Date(),
) {
  if (!isFeatureEnabled("GOAL_QUESTION_ENABLED", true))
    return { question: null, reason: "DISABLED" };
  return selectGoalQuestion(tx, actor, projectId, now);
}
/** Explicit feedback may address a snoozed/unknown question without changing global selection. */
export async function currentMissionGoalQuestionInTx(
  tx: Tx,
  actor: CopilotActor,
  projectId: string,
  missionId: string,
  now = new Date(),
) {
  await assertActor(tx, projectId, actor);
  const mission = await ownedMission(actor.userId, missionId, tx);
  if (mission.projectId !== projectId)
    throw new AppError("MISSION_NOT_FOUND", "委托不存在或无法访问", 404);
  if (!isFeatureEnabled("GOAL_QUESTION_ENABLED", true))
    return { question: null, reason: "DISABLED" };
  return selectGoalQuestion(tx, actor, projectId, now, missionId);
}
async function selectGoalQuestion(
  tx: Tx,
  actor: CopilotActor,
  projectId: string,
  now: Date,
  targetMissionId?: string,
) {
  await assertActor(tx, projectId, actor);
  const member = await tx.projectMembership.findUnique({
    where: { userId_projectId: { projectId, userId: actor.userId } },
  });
  if (member?.role !== "OWNER")
    return { question: null, reason: "NO_PRIVATE_MISSION" };
  const s = await readDecisionSnapshot(tx, projectId, actor.userId, now),
    roots = changedRoots(s),
    impact = assessImpact(s, roots);
  const affected = new Set(
    impact.items
      .filter((i) => i.kind === "PLAN_STALE")
      .map((i) => i.target.slice(8)),
  );
  const candidates = s.missions
    .filter((m) => !targetMissionId || m.id === targetMissionId)
    .filter(
      (m) =>
        m.status === "WAITING_INPUT" ||
        (m.status === "PAUSED" && affected.has(m.id)),
    )
    .sort(
      (a, b) =>
        Number(b.status === "WAITING_INPUT") -
          Number(a.status === "WAITING_INPUT") ||
        Number(b.id === member.focusMissionId) -
          Number(a.id === member.focusMissionId) ||
        Number(affected.has(b.id)) - Number(affected.has(a.id)) ||
        b.updatedAt.getTime() - a.updatedAt.getTime() ||
        a.id.localeCompare(b.id),
    );
  for (const m of candidates) {
    const q =
      m.status === "WAITING_INPUT"
        ? await tx.agentMissionEvent.findFirst({
            where: { missionId: m.id, type: "QUESTION" },
            orderBy: { seq: "desc" },
          })
        : null;
    if (m.status === "WAITING_INPUT" && !q) continue;
    const data = q?.payloadJson as
      | {
          question?: string;
          requirements?: { terms?: string[]; metric?: { name: string } };
        }
      | undefined;
    const questionId = q?.id ?? `impact:${m.id}`,
      text = data?.question ?? "这些依据变化后，原委托是否仍按当前目标推进？";
    const terms = [
      ...(data?.requirements?.terms ?? []),
      ...(data?.requirements?.metric?.name
        ? [data.requirements.metric.name]
        : []),
    ].filter((t) => t.length > 1);
    const paths = impact.items.filter((i) => i.target === `mission:${m.id}`);
    const relevant = s.cards.filter(
      (c) =>
        paths.some((item) => item.path.some((edge) => edge.from === `card:${c.id}`)) ||
        terms.some((t) =>
          (c.summary + " " + (c.capture?.rawText ?? ""))
            .toLowerCase()
            .includes(t.toLowerCase()),
        ),
    );
    const relevantMaterials = [
      ...s.captures
        .filter((c) =>
          terms.some((t) => c.rawText.toLowerCase().includes(t.toLowerCase())),
        )
        .map((c) => ({ id: `capture:${c.id}`, text: c.rawText })),
      ...s.attachments
        .filter((a) =>
          terms.some((t) =>
            (a.extractedText ?? "").toLowerCase().includes(t.toLowerCase()),
          ),
        )
        .map((a) => ({
          id: `attachment:${a.id}`,
          text: a.extractedText,
          revisions: a.revisions,
        })),
    ];
    const relevantMutations = s.mutations
      .filter(
        (m) =>
          Array.isArray(m.rootsJson) &&
          m.rootsJson.some(
            (root) =>
              typeof root === "string" &&
              (relevant.some((c) => root === `card:${c.id}`) ||
                relevantMaterials.some((m) => m.id === root) ||
                paths.some((i) => i.path.some((e) => e.from === root))),
          ),
      )
      .map((m) => m.id);
    const contextHash = jsonHash({
      relevantMaterials,
      relevantMutations,
      questionId,
      text,
      goal: m.goal,
      planRevision: m.planRevision,
      constraintsVersion: m.constraintsVersion,
      relevant: relevant.map((c) => ({
        id: c.id,
        summary: c.summary,
        capture: c.capture,
        attachment: c.attachment,
      })),
      paths: paths.map((i) => i.path),
      states: s.cardStates.filter((c) => relevant.some((r) => r.id === c.id)),
    });
    const preferences = await tx.goalQuestionPreference.findMany({
      where: {
        userId: actor.userId,
        missionId: m.id,
        questionId: { in: ["*", questionId] },
      },
    });
    if (
      preferences.some(
        (p) =>
          p.mode === "STOP" ||
          (!targetMissionId && p.mode === "LATER" && !!p.snoozedUntil && p.snoozedUntil > now) ||
          ((p.mode === "NOT_USEFUL" || (!targetMissionId && p.mode === "UNKNOWN")) &&
            p.contextHash === contextHash),
      )
    )
      continue;
    return {
      reason: "QUESTION_AVAILABLE",
      question: {
        schemaVersion: 1 as const,
        projectId,
        missionId: m.id,
        questionId,
        contextHash,
        text,
        goal: m.goal,
        goalRef: {
          projectGoalHash: jsonHash(s.project.goal),
          missionId: m.id,
          planRevision: m.planRevision,
        },
        whyNow: q
          ? "当前委托明确在等待这项信息，补充后可继续原任务。"
          : "本目标引用的依据发生变化，请先复核根因路径。",
        answerability: q
          ? "可以提供记录；不知道时可如实保留未知。"
          : "可以核对原委托和当前约束，再明确选择。",
        unansweredConsequence: "原任务继续等待，不自动猜测事实或生成新委托。",
        kind: q ? "WAITING_INPUT" : "REVIEW",
        affected: paths,
        href: missionNavigationHref(projectId, m.id, { questionId: q?.id }),
        observedAt: s.observedAt,
        generated: true,
        exposed: false,
        deviceDelivered: false,
      },
    };
  }
  const muted = await tx.goalQuestionPreference.findFirst({
    where: {
      userId: actor.userId,
      ...(targetMissionId ? { missionId: targetMissionId } : {}),
      mission: { projectId, status: { notIn: ["SUCCEEDED", "CANCELLED"] } },
    },
    orderBy: { updatedAt: "desc" },
    select: { missionId: true, mode: true },
  });
  return {
    question: null,
    reason: muted ? "USER_SILENCED" : "NO_ACTIONABLE_QUESTION",
    mutedMissionId: muted?.missionId ?? null,
  };
}
function key(userId: string, questionId: string, hash: string) {
  return `goal:${userId}:${questionId}:${hash}`;
}
export async function interactGoalQuestion(
  actor: CopilotActor,
  projectId: string,
  raw: unknown,
  now = new Date(),
  transaction?: Tx,
  targetMissionId?: string,
) {
  const input = inputSchema.parse(raw);
  if (transaction && input.action === "PRESENT")
    throw new AppError(
      "PRESENT_TRANSACTION_UNSUPPORTED",
      "提醒展示策略不能在调用方事务内执行",
      422,
    );
  if (targetMissionId && ["PRESENT", "EXPOSED"].includes(input.action))
    throw new AppError(
      "TARGETED_FEEDBACK_REQUIRED",
      "指定委托的问题入口仅接受明确反馈",
      422,
    );
  const readCurrent = (tx: Tx) => targetMissionId
    ? currentMissionGoalQuestionInTx(tx, actor, projectId, targetMissionId, now)
    : currentGoalQuestionInTx(tx, actor, projectId, now);
  const current = transaction
      ? await readCurrent(transaction)
      : targetMissionId
        ? await db.$transaction(readCurrent)
        : await currentGoalQuestion(actor, projectId, now),
    q = current.question;
  // Replay committed feedback before re-selecting a question that the feedback deliberately hid.
  const prior = await (transaction ?? db).agentMissionEvent.findFirst({
    where: {
      commandRequestId: `cmd:goal-question:${actor.userId}:${input.requestId}`,
      mission: { ownerUserId: actor.userId, projectId },
    },
  });
  if (prior) {
    const verifyReplay = async (tx: Tx) => {
      await assertActor(tx, projectId, actor);
      await ownedMission(actor.userId, prior.missionId, tx);
      if (targetMissionId && prior.missionId !== targetMissionId)
        throw new AppError("REQUEST_ID_REUSED", "反馈编号已用于其他委托", 409);
    };
    if (transaction) await verifyReplay(transaction);
    else await db.$transaction(verifyReplay);
    if (prior.commandPayloadHash !== jsonHash(input))
      throw new AppError("REQUEST_ID_REUSED", "反馈编号已用于其他选择", 409);
    return { recorded: true, alreadyRecorded: true };
  }
  if (
    !q ||
    q.questionId !== input.questionId ||
    q.contextHash !== input.contextHash
  )
    throw new AppError(
      "QUESTION_CHANGED",
      "问题或依据已变化，请重新读取当前问题",
      409,
    );
  const dedupeKey = key(actor.userId, q.questionId, q.contextHash);
  if (input.action === "PRESENT") {
    const privateMission=await ownedMission(actor.userId,q.missionId);
    if(boundedPolicy(privateMission))return db.$transaction(async tx=>{
      const latest=await readCurrent(tx);if(latest.question?.contextHash!==q.contextHash)throw new AppError("QUESTION_CHANGED","问题已更新，请重新读取",409);
      const m=await ownedMission(actor.userId,q.missionId,tx),attention=await scopedDelegationAttention(tx,m,"WAITING_INPUT");
      await tx.agentMission.update({where:{id:m.id},data:{planJson:json({...record(m.planJson),delegation:{...record(record(m.planJson).delegation),attention}}),version:{increment:1}}});
      const allowed=!!attention&&["DIGEST","URGENT"].includes(attention.level);
      return {allowed,reason:attention?.reasonCode??"UNAVAILABLE",question:allowed?q:null,interventionId:null};
    });
    if (!isFeatureEnabled("INTERVENTION_BUDGET_ENABLED", false))
      return { allowed: false, reason: "POLICY_DISABLED", question: null };
    const outcome = (
      await applyInterventionPolicy(
        projectId,
        [
          {
            candidateKey: `MATERIAL_GAP:${dedupeKey}`,
            triggerType: "MATERIAL_GAP",
            dedupeKey,
            severity: 3,
            title: "当前委托有一项待核对信息",
            content: "进入本人原委托核对信息；当前记录不代表现实未完成。",
            evidenceFacts: [q.whyNow],
            evidenceCardIds: [],
            evidenceRule: "goal_question_v1",
            proposedActions: [],
            isSimulated: false,
          },
        ],
        now,
        interventionPolicyScopeForUser(actor.userId),
        async (tx) => {
          const latest = await readCurrent(tx);
          if (latest.question?.contextHash !== q.contextHash)
            throw new AppError(
              "QUESTION_CHANGED",
              "问题已更新，请重新读取",
              409,
            );
        },
      )
    )[0];
    const allowed =
      outcome?.decision === "FIRE" || outcome?.reasonCode === "DUPLICATE";
    return {
      allowed,
      reason: outcome?.reasonCode ?? "UNAVAILABLE",
      question: allowed ? q : null,
      interventionId: outcome?.interventionId ?? null,
    };
  }
  const apply = async (tx: Tx) => {
    const replay = await commandReplay(
      tx,
      q.missionId,
      `goal-question:${actor.userId}:${input.requestId}`,
      jsonHash(input),
    );
    if (replay) return { recorded: true, alreadyRecorded: true };
    await assertActor(tx, projectId, actor);
    const latest = await readCurrent(tx);
    if (latest.question?.contextHash !== q.contextHash)
      throw new AppError("QUESTION_CHANGED", "问题已更新，请重新读取", 409);
    const mission=await ownedMission(actor.userId, q.missionId, tx);
    const intervention = await tx.agentIntervention.findUnique({
      where: { projectId_dedupeKey: { projectId, dedupeKey } },
    });
    const privateAttention=record(record(record(mission.planJson).delegation).attention);
    const privatePresented=boundedPolicy(mission)&&["DIGEST","URGENT"].includes(String(privateAttention.level))&&typeof privateAttention.decisionId==="string";
    if (input.action === "EXPOSED" && !intervention&&!privatePresented)
      throw new AppError(
        "NOT_PRESENTED",
        "问题尚未通过提醒策略，请先重新读取",
        409,
      );
    if(input.action==="EXPOSED"&&privatePresented)await tx.agentMission.update({where:{id:mission.id},data:{planJson:json({...record(mission.planJson),delegation:{...record(record(mission.planJson).delegation),attention:{...privateAttention,delivery:{channel:"PRIVATE_MISSION_INBOX",status:"SEEN",seenAt:now.toISOString()}}}}),version:{increment:1}}});
    if (["UNKNOWN", "LATER", "STOP", "NOT_USEFUL"].includes(input.action)) {
      const questionId = input.action === "STOP" ? "*" : q.questionId;
      await tx.goalQuestionPreference.upsert({
        where: {
          userId_missionId_questionId: {
            userId: actor.userId,
            missionId: q.missionId,
            questionId,
          },
        },
        create: {
          userId: actor.userId,
          missionId: q.missionId,
          questionId,
          mode: input.action,
          contextHash: q.contextHash,
          snoozedUntil:
            input.action === "LATER" ? new Date(+now + 86400000) : null,
        },
        update: {
          mode: input.action,
          contextHash: q.contextHash,
          snoozedUntil:
            input.action === "LATER" ? new Date(+now + 86400000) : null,
        },
      });
    }
    if (intervention) {
      const feedbackType =
        input.action === "UNKNOWN"
          ? "KEEP_UNKNOWN"
          : input.action === "LATER"
            ? "SNOOZED"
            : input.action === "STOP"
              ? "IGNORED"
              : (input.action as "EXPOSED" | "WORTH_IT" | "NOT_USEFUL");
      await recordFeedback(
        projectId,
        intervention.id,
        { feedbackType, reason: "围绕当前委托的问题反馈" },
        tx,
      );
    }
    await event(
      tx,
      q.missionId,
      "GOAL_QUESTION_FEEDBACK",
      {
        questionId: q.questionId,
        action: input.action,
        contextHash: q.contextHash,
      },
      {
        id: `cmd:goal-question:${actor.userId}:${input.requestId}`,
        hash: jsonHash(input),
      },
    );
    return {
      recorded: true,
      questionId: q.questionId,
      missionId: q.missionId,
      deviceDelivered: false,
    };
  };
  return transaction
    ? apply(transaction)
    : writeTransaction(`goal-question:${input.requestId}`, apply);
}
export type GoalQuestion = NonNullable<
  Awaited<ReturnType<typeof currentGoalQuestion>>["question"]
>;
