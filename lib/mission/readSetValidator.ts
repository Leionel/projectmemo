import { buildTemporalTimeline } from "@/lib/memory/temporalLedger";
import { loadTemporalProject } from "@/lib/repositories/temporalRelations";
import { serializeTemporalRelation } from "@/lib/services/temporalLedgerService";
import { isFeatureEnabled } from "@/lib/config/features";
import type { Source } from "./contracts";
import type { Tx } from "./repository";

/** Reuse Ledger semantics inside the confirmation transaction; a raw source does not upgrade its card's state. */
export async function materialTemporalStates(projectId:string,sources:Source[],tx:Tx,requireLedger=false){
 const cards=await tx.knowledgeCard.findMany({where:{projectId,OR:[{id:{in:sources.filter(s=>s.entityType==="CARD").map(s=>s.id.slice(5))}},{captureId:{in:sources.filter(s=>s.entityType==="CAPTURE").map(s=>s.id.slice(8))}},{attachmentId:{in:sources.filter(s=>s.entityType==="ATTACHMENT").map(s=>s.id.slice(11))}}]},select:{id:true,captureId:true,attachmentId:true}});
 if(!cards.length||!requireLedger&&!isFeatureEnabled("TEMPORAL_MEMORY_ENABLED",true))return[];
 const data=await loadTemporalProject(projectId,tx);
 const timeline=buildTemporalTimeline(data.cards.map(c=>({...c,createdAt:c.createdAt.toISOString()})),data.relations.map(serializeTemporalRelation),new Date());
 return cards.map(c=>({cardId:c.id,sourceIds:sources.filter(s=>s.id===`card:${c.id}`||s.id===`capture:${c.captureId}`||s.id===`attachment:${c.attachmentId}`).map(s=>s.id),state:timeline.find(item=>item.card.id===c.id)?.topLevelState??"UNKNOWN"}));
}
