import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { record } from "@/lib/conversation/repository";
import { json, jsonHash } from "./contracts";
import { fenced, release, reserve, settleUsage, type Lease } from "./runtimeStore";
import { event } from "./repository";
import { missionCiDispatch } from "./repositoryTools";
import { readRepositoryHead, type CiTransport } from "@/lib/sensing/repoCi";
import { repositoryGrantBinding } from "@/lib/sensing/repoGrantBinding";
import { boundedPolicy } from "./investigationDelegation";

/** Original declared observation, original Step and HTTP budget; no networking in the scanner. */
export async function runBranchObservation(lease: Lease, onStep: (id: string) => void, transport?: CiTransport) {
  const pending = await db.$transaction(async tx => {
    const m = await fenced(tx, lease), state = record(record(m.planJson).delegation), poll = record(state.poll);
    if (poll.kind !== "BRANCH_HEAD" || typeof poll.cycle !== "string") return null;
    if (!boundedPolicy(m)?.trackBranchHead) throw new AppError("DELEGATION_CHANGED", "分支跟踪许可已变化", 409);
    const allTargets = Array.isArray(poll.targets) ? poll.targets.map(record) : [];
    const targets=allTargets.filter(t=>t.kind!=="DEPLOYMENT");
    if (!targets.length || targets.length > 3) throw new AppError("DELEGATION_CHANGED", "分支观察范围需要重新核对", 409);
    const steps = await tx.agentMissionStep.findMany({where:{missionId:m.id,planRevision:m.planRevision},orderBy:{ordinal:"asc"}});
    const observed = steps.filter(s => record(s.protocolJson).branchCycle === poll.cycle && s.status === "SUCCEEDED");
    const next = targets.find(t => !observed.some(s => record(s.canonicalInputJson).connectionId === t.connectionId));
    if (!next) {
      const heads = observed.map(s => record(record(s.resultJson).data));
      const fresh = await tx.agentMission.update({where:{id:m.id},data:{planJson:json({...record(m.planJson),delegation:{...state,
        poll:{...poll,kind:"CI",targets:[...heads.map(h=>({connectionId:h.connectionId,sha:h.sha,revision:h.connectionRevision})),...allTargets.filter(t=>t.kind==="DEPLOYMENT")]}}})}});
      await release(tx,fresh,"READY"); return {done:true} as const;
    }
    const existing = steps.find(s => record(s.protocolJson).branchCycle === poll.cycle && record(s.canonicalInputJson).connectionId === next.connectionId && s.status === "RUNNING");
    const last = await tx.agentMissionStep.aggregate({where:{missionId:m.id},_max:{ordinal:true}});
    const step = existing ?? await tx.agentMissionStep.create({data:{missionId:m.id,planRevision:m.planRevision,ordinal:(last._max.ordinal??0)+1,
      toolName:"read_repository_ci",toolVersion:"1",status:"RUNNING",canonicalInputJson:{connectionId:String(next.connectionId),observationKind:"BRANCH_HEAD"},
      inputHash:jsonHash({cycle:poll.cycle,next}),readSetJson:[],protocolJson:{branchCycle:poll.cycle,schemaVersion:1},startedAt:new Date()}});
    return {done:false,m,step} as const;
  });
  if (!pending) return false;
  if (pending.done) return true;
  onStep(pending.step.id);
  await reserve(lease,"tools","read_repository_ci"); const started = Date.now();
  let head;
  try {
    head = await readRepositoryHead({userId:pending.m.ownerUserId,missionId:pending.m.id,missionProjectId:pending.m.projectId},
      pending.m.projectId,String(record(pending.step.canonicalInputJson).connectionId),transport,missionCiDispatch(lease));
  } catch (error) {
    await settleUsage(lease,"tools",Date.now()-started).catch(()=>undefined);
    throw error;
  }
  await settleUsage(lease,"tools",Date.now()-started);
  await db.$transaction(async tx => {
    const m = await fenced(tx,lease), c = await tx.sourceConnection.findUniqueOrThrow({where:{id:head.connectionId}});
    if (c.revision !== head.connectionRevision || c.repo !== head.repo || c.ref !== head.ref) throw new AppError("CONNECTION_CHANGED","分支观察来源已变化",409);
    const old = await tx.externalSignal.findUnique({where:{connectionId_sha:{connectionId:c.id,sha:head.sha}}});
    if (!old) {
      await tx.externalSignal.create({data:{connectionId:c.id,projectId:m.projectId,ownerUserId:m.ownerUserId,sha:head.sha,
        title:`分支 ${c.ref} 当前提交 ${head.sha.slice(0,7)}`,authorName:"git",url:`https://github.com/${c.repo}/commit/${head.sha}`,
        status:"CANDIDATE",sourceBindingJson:json(repositoryGrantBinding(c,c.revision)),fetchedAt:new Date(head.observedAt)}});
      await event(tx,m.id,"INVESTIGATION_BRANCH_HEAD_DISCOVERED",{...head,status:"CANDIDATE"});
    }
    await tx.agentMissionStep.update({where:{id:pending.step.id},data:{status:"SUCCEEDED",finishedAt:new Date(),
      resultJson:json({data:{...head,verification:"BRANCH_HEAD_NOT_CI_OR_DEPLOYMENT"},sources:[]})}});
    await event(tx,m.id,"TOOL_FINISHED",{stepId:pending.step.id,purpose:"DECLARED_BRANCH_HEAD",sha:head.sha});
    await release(tx,m,"READY");
  });
  return true;
}
