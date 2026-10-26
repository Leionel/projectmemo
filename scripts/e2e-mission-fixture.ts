import {E2E_DATABASE_URL,E2E_ENV,E2E_USERNAME} from "./e2e-env";
if(process.env.DATABASE_URL!==E2E_DATABASE_URL)throw new Error("Mission E2E fixture只能使用隔离数据库");
Object.assign(process.env,E2E_ENV);
const [operation,id,rawChoice]=process.argv.slice(2);
const{db}=await import("../lib/db");
try{
 const mission=await db.agentMission.findUniqueOrThrow({where:{id},include:{owner:true}});
 if(mission.owner.username!==E2E_USERNAME)throw new Error("只允许E2E测试身份的委托");
 if(operation==="slice"){
  const{runMissionSlice}=await import("../lib/mission/runner"),{choiceSchema}=await import("../lib/mission/contracts");const choice=choiceSchema.parse(JSON.parse(rawChoice));
  await runMissionSlice({id,provider:async()=>({choice,provider:"E2E_TEST_FIXTURE",model:"scripted",protocol:"JSON_CHOICE",usage:{inputTokens:1,outputTokens:1}})});
 }else if(operation==="review"){
  const { createSession } = await import("../lib/auth/session");
  const { createChangeReview } = await import("../lib/decision/changeUnderstanding");
  const { createDynamicReview } = await import("../lib/decision/dynamicCandidates");
  const { sourceHash } = await import("../lib/mission/repository");
  const actor = { userId: mission.ownerUserId, sessionId: (await createSession(mission.ownerUserId)).session.id };
  const capture = await db.capture.create({ data: { projectId: mission.projectId, rawText: "设备D部署日志：模型A内存峰值6.8GB，原预算6GB，需核对缓存口径。", sourceType: "E2E_TEST_FIXTURE" } });
  const sourceId = "capture:" + capture.id;
  const root = await createChangeReview(actor, id, { requestId: "e2e-review:" + id, expectedVersion: mission.version, sources: [{ id: sourceId, hash: await sourceHash(mission.projectId, sourceId) }], llmContextApproved: true }, { provider: async prompt => {
    const context = JSON.parse(prompt.split("context=")[1]);
    return { provider: "E2E_TEST_FIXTURE", status: "SUCCESS", durationMs: 1, usage: { inputTokens: 1, outputTokens: 1 }, data: JSON.stringify({ decision: "ATTEND", summary: "设备D部署测量超过原预算，需要核对。", candidates: [{ premise: "部署预算可能不满足", goalQuote: mission.goal, question: "原日志是否包含缓存？", changeKind: "UNKNOWN", relevance: "DIRECT", reason: "需核对原日志条件", unknown: ["缓存口径"], evidence: [{ ref: context.evidence[0].ref, quote: "模型A内存峰值6.8GB" }] }] }) };
  } });
  await createDynamicReview(actor, id, { requestId: "e2e-dynamic:" + id, reviewId: root.id, llmContextApproved: true }, { provider: async prompt => {
    const context = JSON.parse(prompt.split("context=")[1]);
    return { provider: "E2E_TEST_FIXTURE", status: "SUCCESS", durationMs: 1, usage: { inputTokens: 1, outputTokens: 1 }, data: JSON.stringify({ summary: "先读设备D部署日志，再核对口径。", candidates: [{ kind: "READ_EXISTING", title: "读取设备D部署日志", reason: "已有日志包含原测量", question: null, sourceIds: [sourceId], expectedObservation: "峰值和缓存条件", stopCondition: "读取后停止，等待核对", branches: [], evidence: [{ ref: context.evidence[0].ref, quote: "模型A内存峰值6.8GB" }] }] }) };
  } });
 }else if(operation==="review-slice"){
  const { runMissionSlice } = await import("../lib/mission/runner"); await runMissionSlice({ id }); await runMissionSlice({ id });
 }else if(operation==="scan"){
  const{processMaterialContinuationBatch}=await import("../lib/mission/continuationService");await processMaterialContinuationBatch(100);
 }else if(operation!=="state")throw new Error("不支持的E2E fixture命令");
 const current=await db.agentMission.findUniqueOrThrow({where:{id}});
 const[events,steps,actions,approvals,receipt]=await Promise.all([db.agentMissionEvent.findMany({where:{missionId:id},select:{type:true}}),db.agentMissionStep.findMany({where:{missionId:id},select:{toolName:true,resultJson:true}}),db.actionItem.findMany({where:{projectId:mission.projectId},select:{title:true,status:true}}),db.agentMissionApproval.findMany({where:{missionId:id},select:{status:true}}),db.missionArtifactReceipt.findFirst({where:{missionId:id},select:{artifactId:true,outputId:true}})]);
 process.stdout.write(JSON.stringify({status:current.status,events,steps,actions,approvals,receipt}));
}finally{await db.$disconnect();}
