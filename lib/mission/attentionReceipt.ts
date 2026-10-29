import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { record } from "@/lib/conversation/repository";
import { event, lock, ownedMission, commandReplay } from "./repository";
import { json, jsonHash } from "./contracts";
const schema=z.object({requestId:z.string().min(1).max(128),expectedVersion:z.number().int().positive(),decisionId:z.string().min(1)}).strict();
export async function acknowledgeMissionAttention(userId:string,id:string,raw:unknown){
  const body=schema.parse(raw),hash=jsonHash(body);
  return db.$transaction(async tx=>{
    await lock(tx,id);const m=await ownedMission(userId,id,tx);
    if(await commandReplay(tx,id,body.requestId,hash))return {acknowledged:true};
    const plan=record(m.planJson),delegation=record(plan.delegation),attention=record(delegation.attention);
    if(m.version!==body.expectedVersion||attention.decisionId!==body.decisionId)throw new AppError("MISSION_CHANGED","这条提醒已变化，请刷新",409);
    const seenAt=new Date().toISOString();
    await tx.agentMission.update({where:{id},data:{version:{increment:1},planJson:json({...plan,delegation:{...delegation,attention:{...attention,delivery:{channel:"PRIVATE_MISSION_INBOX",status:"SEEN",seenAt}}}})}});
    await event(tx,id,"ATTENTION_SEEN",{decisionId:body.decisionId,seenAt},{id:`cmd:${body.requestId}`,hash});return {acknowledged:true};
  });
}
