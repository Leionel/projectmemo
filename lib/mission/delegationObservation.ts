import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { record } from "@/lib/conversation/repository";
import { json, jsonHash } from "./contracts";
import { event } from "./repository";
import { fenced, release, reserve, settleUsage, type Lease } from "./runtimeStore";
import { investigationInputHash } from "./investigationDelegation";
import type { ToolSet } from "./tools";
import { runBranchObservation } from "./branchObservation";
import type { CiTransport } from "@/lib/sensing/repoCi";

type Target = { connectionId: string; sha?: string; revision: number;kind?:"DEPLOYMENT" };

/** A declared read before reasoning. Uses the same MissionStep, lease, HTTP ledger and cumulative budget. */
export async function runDelegationObservation(lease: Lease, tools: ToolSet, onStep: (id: string) => void, transport?: CiTransport): Promise<boolean> {
  if (await runBranchObservation(lease, onStep, transport)) return true;
  const pending = await db.$transaction(async tx => {
    const m = await fenced(tx, lease);
    const state = record(record(m.planJson).delegation);
    const poll = record(state.poll);
    if (typeof poll.cycle !== "string") return null;
    const targets = poll.targets as Target[];
    if (!Array.isArray(targets) || !targets.length || targets.length > 3) {
      throw new AppError("DELEGATION_CHANGED", "仓库观察范围需要重新核对", 409);
    }
    const steps = await tx.agentMissionStep.findMany({ where: { missionId: m.id, planRevision: m.planRevision }, orderBy: { ordinal: "asc" } });
    const observed = steps.filter(s => record(s.protocolJson).delegationCycle === poll.cycle && s.status === "SUCCEEDED");
    const snapshots: Record<string, string> = {};
    for (const s of observed) {
      const observation = record(record(record(s.resultJson).data).observation), args = record(s.canonicalInputJson);
      // Ignore observation timestamps; ordering and first baseline are explicit, no false 'new information' per poll.
      const byId = (a: unknown) => Array.isArray(a) ? [...a].sort((x, y) => Number(record(x).id) - Number(record(y).id)) : [];
      const metadata=record(observation.metadata);
      snapshots[String(args.connectionId)] = s.toolName==="inspect_deployment"?jsonHash({expectedRelease:metadata.expectedRelease,reportedRelease:metadata.reportedRelease,layers:observation.layers}):jsonHash({ sha: observation.sha, checks: byId(observation.checks), runs: byId(observation.runs), coverage: observation.coverage });
    }
    const next = targets.find(t => snapshots[t.connectionId] === undefined);
    if (!next) {
      const input = await investigationInputHash(m, tx), previous = record(state.remoteSnapshots);
      if (input.truncated) throw new AppError("INPUT_COVERAGE_LIMIT", "资料变化较多，请核对调查范围", 409);
      const changed = input.hash !== state.inputHash || Object.entries(snapshots).some(([key, value]) => previous[key] !== value);

      // Consume strictly the wake frozen for this poll cycle; newer concurrent wakes stay pending
      const pendingWakeObj = record(state.pendingWake);
      const targetWakeSeq = Number(poll.targetWakeSeq) || Number(pendingWakeObj.seq ?? 0);
      const targetWakeKey = (poll.targetWakeKey as string | undefined) ?? (pendingWakeObj.key as string | undefined) ?? "";
      const appliedWake = targetWakeSeq > 0 ? {
        seq: targetWakeSeq,
        key: targetWakeKey,
        appliedAt: new Date().toISOString(),
      } : (state.appliedWake ?? null);

      const freshDb = await tx.agentMission.findUniqueOrThrow({ where: { id: m.id } });
      const latestPlan = record(freshDb.planJson);
      const latestDelegation = record(latestPlan.delegation);
      const latestPending = record(latestDelegation.pendingWake);
      const latestWakeSeq = Math.max(Number(state.wakeSeq ?? 0), Number(latestDelegation.wakeSeq ?? 0));
      // If a newer wake arrived while poll was running, it MUST remain pending!
      const pendingWake = latestDelegation.pendingWake && Number(latestPending.seq ?? 0) > targetWakeSeq
        ? latestDelegation.pendingWake
        : null;

      const fresh = await tx.agentMission.update({
        where: { id: m.id },
        data: {
          planJson: json({
            ...record(m.planJson),
            delegation: {
              ...state,
              wakeSeq: latestWakeSeq,
              poll: null,
              remoteSnapshots: snapshots,
              lastObservedAt: new Date().toISOString(),
              pendingWake,
              appliedWake,
              attention: changed ? null : state.attention,
            },
          }),
          ...(!changed && !(record(m.waitStateJson).questionId && record(m.waitStateJson).resolved !== true)
            ? { waitStateJson: json({ ...record(m.waitStateJson), waitingFor: "OBSERVATION" }) }
            : {}),
          ...(changed ? { contextVersion: { increment: 1 }, planRevision: { increment: 1 } } : {}),
        },
      });

      await event(tx, m.id, changed ? "INVESTIGATION_OBSERVATION_CHANGED" : "INVESTIGATION_NO_NEW_INFORMATION", {
        cycle: poll.cycle,
        changed,
        wakeReason: changed ? "OBSERVATION_DUE" : undefined,
        observationStepIds: observed.map(s => s.id),
      });

      await release(tx, fresh, changed ? "READY" : "WAITING_INPUT");
      return { done: true } as const;
    }

    const connection = await tx.sourceConnection.findUnique({ where: { id: next.connectionId } });
    if (!connection || connection.status !== "ACTIVE" || connection.revokedAt !== null) {
      throw new AppError("CONNECTION_CHANGED", "仓库授权已被撤销，请重新核对", 409);
    }
    const existing = steps.find(s => record(s.protocolJson).delegationCycle === poll.cycle && record(s.canonicalInputJson).connectionId === next.connectionId && s.status === "RUNNING");
    const last = await tx.agentMissionStep.aggregate({ where: { missionId: m.id }, _max: { ordinal: true } });
    const s = existing ?? await tx.agentMissionStep.create({
      data: {
        missionId: m.id,
        ordinal: (last._max.ordinal ?? 0) + 1,
        planRevision: m.planRevision,
        status: "RUNNING",
        toolName: next.kind==="DEPLOYMENT"?"inspect_deployment":"read_repository_ci",
        toolVersion: "1",
        canonicalInputJson: json({ connectionId: next.connectionId, ...(next.kind==="DEPLOYMENT"?{}:{sha:next.sha}) }),
        inputHash: jsonHash(next),
        readSetJson: [],
        protocolJson: { schemaVersion: 1, delegationCycle: poll.cycle },
        startedAt: new Date(),
      },
    });
    return { done: false, mission: m, step: s } as const;
  });

  if (!pending) return false;
  if (pending.done) return true;
  const toolName=pending.step.toolName,tool = tools[toolName];
  if (!tool) throw new AppError("CI_NOT_AUTHORIZED", "原仓库观察工具不可用", 409);
  const stepId = pending.step.id;
  onStep(stepId);

  // reserve() rechecks deadline, STOP, continuity and tool permission before any request.
  await reserve(lease, "tools", toolName);
  const started = Date.now();
  let result;
  try {
    result = await tool.run({ userId: pending.mission.ownerUserId, projectId: pending.mission.projectId, missionId: pending.mission.id }, tool.schema.parse(pending.step.canonicalInputJson));
    if (JSON.stringify(result).length > 40000) throw new AppError("TOOL_OUTPUT_LIMIT", "工具结果超出任务读取范围", 409);
  } catch (error) {
    await settleUsage(lease, "tools", Date.now() - started).catch(() => undefined);
    throw error;
  }
  await settleUsage(lease, "tools", Date.now() - started);

  await db.$transaction(async tx => {
    const m = await fenced(tx, lease);
    for(const source of result.sources.filter(s=>s.deployment)){
      await(await import("@/lib/continuity/sourcePolicy")).assertSourceUse(m.ownerUserId,m.projectId,"connection:"+source.deployment!.connectionId,tx,{missionId:m.id});
      if(!await(await import("@/lib/sensing/deploymentObservations")).deploymentObservationCurrent(m.projectId,{...source,deployment:source.deployment!},tx))throw new AppError("SOURCE_CHANGED","环境观察在提交前失效",409);
    }
    await tx.agentMissionStep.update({ where: { id: stepId }, data: { status: "SUCCEEDED", resultJson: json(result), finishedAt: new Date() } });
    await event(tx, m.id, "TOOL_FINISHED", { stepId, tool: toolName, purpose: "DECLARED_OBSERVATION", result });
    await release(tx, m, "READY");
  });
  return true;
}
