import type { z } from "zod";
import type { AgentMission } from "@/lib/generated/prisma/client";
import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { record } from "@/lib/conversation/repository";
import { awaitEventChoiceSchema, json, jsonHash } from "./contracts";
import { boundedPolicy } from "./investigationDelegation";
import { event, type Tx } from "./repository";
import { verifyMissionResult } from "./resultVerifier";
import { release } from "./runtimeStore";

/** Caller owns the fenced transaction. A delivery checkpoint never grants a new source or ends responsibility. */
export async function enterObservationCheckpoint(tx: Tx, mission: AgentMission, choice: z.infer<typeof awaitEventChoiceSchema>) {
  if (mission.runtimeProtocolVersion !== 2 || !isFeatureEnabled("MISSION_V2_ENABLED", false))
    throw new AppError("MISSION_V2_DISABLED", "当前委托不支持持续成果协议", 409);
  const policy = boundedPolicy(mission);
  if (!policy || Date.parse(policy.expiresAt) <= Date.now())
    throw new AppError("CHECKPOINT_AUTHORITY_REQUIRED", "请先确认仍有效的持续跟进范围", 409);
  const allowed = new Set(["project-materials", ...policy.connectionIds.map(id => "connection:" + id)]);
  if (choice.subscriptionIds.some(id => !allowed.has(id)) || new Set(choice.subscriptionIds).size !== choice.subscriptionIds.length)
    throw new AppError("CHECKPOINT_SUBSCRIPTION_DENIED", "等待范围不在当前跟进许可内", 409);
  const verification = await verifyMissionResult(tx, mission, choice.outputId);
  const output = await tx.agentMissionOutput.findUniqueOrThrow({ where: { id: choice.outputId } });
  const plan = record(mission.planJson), previous = record(plan.checkpoint);
  const checkpoint = previous.outputId === output.id ? previous : {
    schemaVersion: 1, cycleSeq: Number(previous.cycleSeq ?? 0) + 1,
    outputId: output.id, outputRevision: output.revision, readSetHash: jsonHash(output.sourceRefsJson),
    checks: verification.checks, subscriptionIds: choice.subscriptionIds,
    reachedAt: new Date().toISOString(), contextVersion: mission.contextVersion,
  };
  if (previous.outputId !== output.id)
    await event(tx, mission.id, "CHECKPOINT_REACHED", { ...checkpoint, realityOutcome: "NOT_INFERRED" });
  const updated = await tx.agentMission.update({ where: { id: mission.id }, data: {
    planJson: json({ ...plan, checkpoint }),
    waitStateJson: json({ waitingFor: "OBSERVATION", checkpointOutputId: output.id,
      subscriptionIds: choice.subscriptionIds, startedAt: new Date().toISOString() }),
  } });
  await release(tx, updated, "WAITING_INPUT");
}
