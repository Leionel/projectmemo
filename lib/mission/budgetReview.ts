import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { missionBudgetReviewSchema } from "@/lib/types/missionBudget";
import { defaultBudget, json, jsonHash, usageOf } from "./contracts";
import { commandReplay, event, lock, ownedMission } from "./repository";
import { requireMissions } from "./missionService";
export async function reviewMissionBudget(userId:string,id:string,raw:unknown){
  requireMissions();const body=missionBudgetReviewSchema.parse(raw),hash=jsonHash({kind:"BUDGET_REVIEW",body});
  return db.$transaction(async tx=>{
    await lock(tx,id);const m=await ownedMission(userId,id,tx);
    if(await commandReplay(tx,id,body.requestId,hash))return m;
    if(m.status!=="PAUSED"||m.version!==body.expectedVersion)throw new AppError("MISSION_CHANGED","请暂停并读取最新委托后复核预算",409);
    const before={...defaultBudget,...m.budgetJson as object},used=usageOf(m.budgetUsedJson);
    for(const [key,total] of Object.entries(body.totals))if(total<before[key as keyof typeof before]||total<used[key as keyof typeof used])throw new AppError("BUDGET_TOTAL_TOO_SMALL","总上限不能低于原上限或已用、预占的额度",409);
    // Budget review fences old workers without changing the approved effect's goal/source premise.
    const updated=await tx.agentMission.update({where:{id},data:{budgetJson:json({...before,...body.totals}),version:{increment:1},leaseEpoch:{increment:1},leaseOwner:null,leaseUntil:null,executionSlot:null}});
    await event(tx,id,"BUDGET_REVIEWED",json({before,totals:updated.budgetJson,used:m.budgetUsedJson,unknownReservationsPreserved:true,doesNotAuthorizeNewEffects:true}),{id:`cmd:${body.requestId}`,hash});
    return updated;
  });
}
