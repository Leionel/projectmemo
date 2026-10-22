"use client";
import {missionStatusLabels,missionToolLabels} from "@/lib/mission/presentation";
import {projectHref} from "@/lib/projectNavigation";
import { useCallback,useEffect,useRef,useState } from "react";
import { emitWorkspaceChange } from "@/lib/client/workspaceEvents";
import { MissionClaimChecks } from "./MissionClaimChecks";
import { MissionMetricInput } from "./MissionMetricInput";
import { MissionArtifactAdoption } from "./MissionArtifactAdoption";
import { MissionContinuation } from "./MissionContinuation";
import { MissionResearchScopeEditor } from "./MissionResearchScopeEditor";
import { MissionConstraintsEditor } from "./MissionConstraintsEditor";
import styles from "./MissionPanel.module.css";
type Mission={semanticCheckEnabled?:boolean;continuationPolicy?:{mode:string};autoContinuationEnabled?:boolean;artifactAdoptionEnabled?:boolean;id:string;goal:string;status:string;version:number;contextVersion:number;constraintsVersion:number;researchScopeVersion:number;constraints:Record<string,unknown>;researchScope:Record<string,unknown>;pauseRequestedAt?:string|null;cancelRequestedAt?:string|null;pauseReason:string|null;error:{code?:string;message?:string;diagnostic?:{reason?:string}}|null;question:{id:string;payloadJson:{question:string;requirements?:{metric?:{name:string;unit:string;period:string}}}}|null;steps:Array<{id:string;toolName:string;status:string;result?:{data?:{actionId?:string;title?:string;status?:string;resultCardId?:string|null}}|null}>;approvals:Array<{id:string;proposalHash:string;proposal:{args:{title:string;description:string;priority?:number;dueAt?:string|null}};expiresAt:string}>;outputs:Array<{id:string;revision:number;verificationStatus:string;claimChecksJson?:Array<{blockId:string;status:string;mode?:string;checkedAt?:string}>;contentJson:{blocks:Array<{blockId:string;text:string;kind:string;sourceIds:string[]}>}}>};
const toolLabels=missionToolLabels;
const stepLabels:Record<string,string>={READY:"准备执行",RUNNING:"正在执行",WAITING_APPROVAL:"待批准",SUCCEEDED:"已执行",FAILED:"执行失败",OBSOLETE:"依据已变化",SKIPPED:"已跳过"};
const labels=missionStatusLabels;
async function api(path:string,method="GET",body?:unknown){
 let response:Response;let value;
 try{response=await fetch(path,{method,signal:AbortSignal.timeout(20000),headers:{"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});value=await response.json();}
 catch{throw Object.assign(new Error("网络结果尚未确认，请核对最新状态后重试"),{status:0});}
 if(!response.ok)throw Object.assign(new Error(value.error?.message??"请求失败，请重试"),{status:response.status});return value;
}
type WebSource={id:string;requestedUrl:string;title:string;retrievalMode:string;availability:string;fetchedAt:string;excerptJson:{text:string}};
export function MissionPanel({projectId,initialMissionId}:{projectId:string;initialMissionId?:string}){
 return <MissionWorkspace key={projectId} projectId={projectId} initialMissionId={initialMissionId}/>;
}
function MissionWorkspace({projectId,initialMissionId}:{projectId:string;initialMissionId?:string}){
 const [list,setList]=useState<Array<{id:string;goal:string;status:string}>>([]),[mission,setMission]=useState<Mission|null>(null),[goal,setGoal]=useState(""),[answer,setAnswer]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false),[sources,setSources]=useState<WebSource[]>([]),[cloud,setCloud]=useState(false);
 const [showList,setShowList]=useState(false),[checkedAt,setCheckedAt]=useState(0),[readOnly,setReadOnly]=useState(false);
 const [notice,setNotice]=useState(""),[nextCursor,setNextCursor]=useState<string|null>(null);
 const requestKeys=useRef(new Map<string,string>()),questionId=useRef<string|undefined>(undefined);
 const seenActions=useRef(new Set<string>());
 const selectedId=useRef<string|null>(null),readGeneration=useRef(0),pending=useRef(false);
 const handleError=useCallback((e:unknown)=>{if(e instanceof Error&&"status" in e&&e.status===401){readGeneration.current++;selectedId.current=null;setMission(null);setList([]);setSources([]);setAnswer("");setGoal("");setCloud(false);setReadOnly(false);setNotice("");setNextCursor(null);requestKeys.current.clear();}setError(e instanceof Error?e.message:"操作失败");},[]);
 useEffect(()=>{let changed=false;for(const s of mission?.steps??[]){const id=s.result?.data?.actionId;if(s.status==="SUCCEEDED"&&id&&!seenActions.current.has(id)){seenActions.current.add(id);changed=true;}}if(changed)emitWorkspaceChange(projectId,["actions"]);},[mission,projectId]);
 const refresh=useCallback(async(id?:string)=>{const generation=++readGeneration.current;if(id)selectedId.current=id;const result=await api(`/api/missions?projectId=${encodeURIComponent(projectId)}`);if(generation!==readGeneration.current)return;setList(result.missions);setNextCursor(result.nextCursor??null);if(id){const [d,s]=await Promise.all([api(`/api/missions/${id}`),api(`/api/missions/${id}/sources`)]);if(generation!==readGeneration.current||selectedId.current!==id)return;if(d.mission.projectId!==projectId)throw new Error("此委托不属于当前项目，请从列表选择");setCheckedAt(Date.now());setMission(d.mission);setSources(s.sources);if(questionId.current!==d.mission.question?.id){setAnswer("");questionId.current=d.mission.question?.id;}}},[projectId]);
 useEffect(()=>{if(initialMissionId)void refresh(initialMissionId).catch(handleError);},[initialMissionId,refresh,handleError]);
 useEffect(()=>{let live=true;const generation=readGeneration.current;void api(`/api/missions?projectId=${encodeURIComponent(projectId)}`).then(v=>{if(live&&generation===readGeneration.current){setList(v.missions);setNextCursor(v.nextCursor??null);}}).catch(e=>{if(live&&generation===readGeneration.current)handleError(e);});return()=>{live=false;};},[projectId,handleError]);
 useEffect(()=>{if(!mission?.id)return;let live=true,inFlight=false;const id=mission.id;const timer=setInterval(()=>{if(document.hidden||inFlight||pending.current||selectedId.current!==id)return;inFlight=true;const generation=readGeneration.current;void Promise.all([api(`/api/missions/${id}`),api(`/api/missions/${id}/sources`)]).then(([v,s])=>{if(live&&selectedId.current===id&&generation===readGeneration.current){setCheckedAt(Date.now());setMission(current=>current&&current.version>v.mission.version?current:v.mission);setList(rows=>rows.map(row=>row.id===id?{...row,status:v.mission.status}:row));setSources(s.sources);if(questionId.current!==v.mission.question?.id){setAnswer("");questionId.current=v.mission.question?.id;}}}).catch(e=>{if(live&&selectedId.current===id&&generation===readGeneration.current)handleError(e);}).finally(()=>{inFlight=false;});},2000);return()=>{live=false;clearInterval(timer);};},[mission?.id,handleError]);
 async function perform(work:()=>Promise<unknown>){if(pending.current)return;pending.current=true;readGeneration.current++;setBusy(true);setError("");try{await work();}catch(e){
 if(e instanceof Error&&"status" in e&&e.status===0){
  try{await refresh(mission?.id);}catch(readError){handleError(readError);return;}
  handleError(new Error("网络结果尚未确认，已读取最新状态。请先核对委托列表或当前进度；重试会保留原请求编号。"));
 }else handleError(e);
 }finally{pending.current=false;setBusy(false);}}
 function requestId(payload:unknown){const key=JSON.stringify(payload);let id=requestKeys.current.get(key);if(!id){id=crypto.randomUUID();requestKeys.current.set(key,id);}return id;}
 async function command(action:string,extra:Record<string,unknown>={}){if(!mission)return;const payload={missionId:mission.id,action,expectedVersion:mission.version,...extra};await perform(async()=>{await api(`/api/missions/${mission.id}/${action}`,"POST",{requestId:requestId(payload),expectedVersion:mission.version,...extra});setNotice(action.startsWith("approvals/")?"审批已记录，实际行动以执行回执为准。":action==="input"?"答复已保存，委托将重新评估资料与缺口。":action==="pause"?"暂停请求已受理，请查看服务端状态。":action==="cancel"?"取消请求已受理，已有历史仍保留。":"请求已受理，请查看最新状态。");await refresh(mission.id);});}
 const terminal=["SUCCEEDED","CANCELLED"].includes(mission?.status??"");
 const done=mission?.steps.filter(s=>s.status==="SUCCEEDED").length??0;
 return <section id="mission-agent" className={styles.panel} aria-labelledby="mission-heading">
  <header className={styles.header}>
   <div><h2 id="mission-heading">长期项目委托</h2><p>交给 Agent 一个目标，在同一委托中持续推进、补充材料和审阅成果。</p></div>
   <span className={styles.count}>已加载 {list.length} 项委托</span>
  </header>
  {error&&<div role="alert" className={styles.error}><p>{error}</p><button disabled={busy} onClick={()=>void perform(()=>refresh(mission?.id))}>刷新重试</button></div>}
  {notice&&<p className={styles.notice} role="status">{notice} <button aria-label="收起操作回执" onClick={()=>setNotice("")}>收起</button></p>}
  {mission&&<button className={styles.listToggle} aria-expanded={showList} onClick={()=>setShowList(v=>!v)}>{showList?"返回委托详情":"查看委托列表与新建"}</button>}
  <div className={styles.workspace}>
   <aside className={`${styles.sidebar} ${mission&&!showList?styles.collapsedSidebar:""}`} aria-label="委托列表与创建">
    <details className={styles.newMission} open={!initialMissionId&&!list.length&&!mission}><summary>委托新目标</summary><form className={styles.composer} onSubmit={e=>{e.preventDefault();void perform(async()=>{const v=await api("/api/missions","POST",{projectId,requestId:requestId({projectId,goal,llmContextApproved:cloud,readOnly}),goal,llmContextApproved:cloud,...(readOnly?{missionConstraints:{executionBoundary:"READ_ANALYZE"}}:{})});await refresh(v.mission.id);requestKeys.current.delete(JSON.stringify({projectId,goal,llmContextApproved:cloud,readOnly}));setGoal("");});}}>
     <h3>新建委托</h3>
     <button type="button" disabled={busy} onClick={()=>{setGoal("根据本项目已有材料，形成带来源的阶段汇报草稿，包括已完成事项、当前风险和下一步建议。缺少依据的内容列为信息缺口，不编造实验指标。本次只读取、分析和保存草稿，不搜索网络，不创建或修改行动。");setReadOnly(true);}}>使用阶段汇报模板</button>
     <label htmlFor="mission-goal">委托目标</label>
     <textarea id="mission-goal" rows={4} placeholder="例如：根据已有材料准备阶段汇报，列出风险和缺失信息。" value={goal} onChange={e=>setGoal(e.target.value)} required minLength={3} maxLength={2000}/>
     <label className={styles.consent}><input type="checkbox" checked={cloud} onChange={e=>setCloud(e.target.checked)}/><span>允许配置的云模型使用本委托目标、选入的项目资料和任务历史</span></label>
     <label className={styles.consent}><input type="checkbox" checked={readOnly} onChange={e=>setReadOnly(e.target.checked)}/><span>仅允许读取、分析和保存草稿</span></label>
     <button className={styles.primary} disabled={busy}>创建委托</button>
    </form></details>
    <nav className={styles.missionList} aria-label="已有委托">
     <h3>已有委托</h3>
     {!list.length&&<p className={styles.muted}>还没有委托。从上方填写一个目标开始。</p>}
     {list.map(m=><button className={styles.missionRow} key={m.id} disabled={busy} aria-pressed={mission?.id===m.id} aria-label={`${m.goal} · ${labels[m.status]??"状态待确认"}`} onClick={()=>{setShowList(false);void perform(()=>refresh(m.id));}}>
      <span className={styles.rowGoal}>{m.goal}</span><span className={styles.rowMeta}><span className={styles.statusDot} data-status={m.status}/>{labels[m.status]??"状态待确认"}</span>
     </button>)}
    </nav>
    {nextCursor&&<button disabled={busy} onClick={()=>void perform(async()=>{const v=await api(`/api/missions?projectId=${encodeURIComponent(projectId)}&cursor=${encodeURIComponent(nextCursor)}`);setList(rows=>[...rows,...v.missions.filter((m:{id:string})=>!rows.some(r=>r.id===m.id))]);setNextCursor(v.nextCursor??null);})}>加载更多委托</button>}
   </aside>
   <div className={styles.detail} aria-busy={busy}>
   {!mission?<div className={styles.empty}><span className={styles.emptyMark} aria-hidden="true">↗</span><h3>让目标持续向前</h3><p>新建一个委托，或选择已有委托查看执行进度。</p><p className={styles.muted}>步骤与草稿会保留；需要你的材料或批准时，Agent 会停下来等待。</p></div>:<>
    <header className={styles.detailHeader}>
     <div className={styles.detailMeta}><span className={styles.badge} data-status={mission.status}>{labels[mission.status]??"状态待确认"}</span><span>{done} 个步骤已执行 · {mission.outputs.length} 份草稿</span></div>
     <h3 className={styles.goal}>{mission.goal.length>90?`${[...mission.goal].slice(0,90).join("")}…`:mission.goal}</h3>{mission.goal.length>90&&<details><summary>查看完整委托目标</summary><p>{mission.goal}</p></details>}

     <div role="status" className={styles.statusText}>{labels[mission.status]}{mission.status==="RUNNING"?"，最近已完成的步骤见下方":mission.status==="READY"?"，进度已保存，等待开始":mission.status==="WAITING_INPUT"?"，补充后可继续同一委托":mission.status==="WAITING_APPROVAL"?"，确认预览后才会创建行动":""}</div>
     {mission.status==="RUNNING"&&(mission.cancelRequestedAt||mission.pauseRequestedAt)&&<p role="status">{mission.cancelRequestedAt?"取消":"暂停"}请求已受理，等待当前执行安全停止。</p>}
     {mission.status==="PAUSED"&&<button className={styles.primary} disabled={busy} onClick={()=>void command("resume")}>继续</button>}
     <details><summary>暂停、取消与恢复操作</summary><div className={styles.actions}>
      {mission.status==="WAITING_APPROVAL"&&<button disabled={busy} onClick={()=>void command("replan")}>更新依据并重新预览</button>}
      {["READY","RUNNING","WAITING_INPUT","WAITING_APPROVAL"].includes(mission.status)&&<button disabled={busy} onClick={()=>void command("pause")}>暂停</button>}
      {!terminal&&<button className={styles.cancel} disabled={busy} onClick={()=>void command("cancel")}>取消委托</button>}
     </div></details>
    </header>
    {mission.status==="PAUSED"&&mission.error&&<div className={styles.error} role="alert"><div><strong>执行已暂停，已有进度已保留</strong><p>{mission.error.code==="MODEL_PROTOCOL_ERROR"&&mission.error.message==="委托执行失败，请检查服务配置后继续"?"模型回复格式不符合要求，尚未执行新步骤。修复后可继续此委托。":mission.error.message}</p>{mission.error.code&&<small>{mission.error.code}{mission.error.diagnostic?.reason?` · ${mission.error.diagnostic.reason}`:""}</small>}</div></div>}
    {mission.question&&<section className={styles.attention} aria-label="待补充信息"><h4>需要你补充</h4><p>{mission.question.payloadJson.question}</p>{mission.question.payloadJson.requirements?.metric&&<MissionMetricInput projectId={projectId} {...mission.question.payloadJson.requirements.metric}/>}<label>补充信息<textarea rows={3} maxLength={3000} value={answer} onChange={e=>setAnswer(e.target.value)}/></label><button className={styles.primary} disabled={busy||!answer.trim()} onClick={()=>void command("input",{questionId:mission.question!.id,answer})}>补充并继续</button><MissionContinuation key={`${mission.question.id}:${mission.version}:${mission.contextVersion}`} id={mission.id} questionId={mission.question.id} version={mission.version} contextVersion={mission.contextVersion} onContinued={()=>refresh(mission.id)}/></section>}
    {mission.approvals.map(a=><section className={styles.attention} key={a.id}><h4>等待你的批准</h4><p>将创建本项目 1 项待办：{a.proposal.args.title}</p><p className={styles.muted}>批准记录与实际执行分开；创建待办不表示现实行动完成。</p><p>{a.proposal.args.description}</p><p className={styles.muted}>优先级：{a.proposal.args.priority??3} · 截止时间：{a.proposal.args.dueAt?new Date(a.proposal.args.dueAt).toLocaleString("zh-CN"):"未设定"}</p><p className={styles.muted}>批准有效至：{new Date(a.expiresAt).toLocaleString("zh-CN")}</p>{checkedAt>0&&Date.parse(a.expiresAt)<=checkedAt&&<p role="status">提案已过期，请更新依据并重新预览。</p>}<div className={styles.actions}><button className={styles.primary} disabled={busy||checkedAt===0||Date.parse(a.expiresAt)<=checkedAt} onClick={()=>void command(`approvals/${a.id}`,{decision:"APPROVED",proposalHash:a.proposalHash})}>批准创建行动</button><button disabled={busy} onClick={()=>void command(`approvals/${a.id}`,{decision:"REJECTED",proposalHash:a.proposalHash})}>拒绝</button></div></section>)}
    <section className={styles.activity} aria-label="最近进展"><h4>最近进展</h4>{mission.steps.filter(s=>s.status==="SUCCEEDED").slice(-2).map(s=><p key={s.id}>{toolLabels[s.toolName]??"工具步骤"}已执行</p>)}{mission.outputs[0]&&<p>草稿修订 {mission.outputs[0].revision} 已保存，内容待审阅。</p>}{done===0&&!mission.outputs.length&&<p>尚无已完成步骤；当前状态：{labels[mission.status]??"待核对"}。</p>}</section>
    {mission.outputs.length>0&&<section className={styles.results} aria-label="委托成果"><h4>成果草稿</h4>{mission.outputs.map((o,index)=><details className={styles.output} key={o.id} open={index===0}><summary><h5>草稿版本 {o.revision} · 内容待审核</h5></summary>{o.contentJson.blocks.map(b=><div className={styles.outputBlock} key={b.blockId}><p>{b.text}</p><small>{b.kind==="EXTERNAL_REFERENCE"?"外部参考":b.kind==="INFERENCE"?"推断或建议":"项目观察"}{b.sourceIds.length?` · ${b.sourceIds.join("、")}`:""}</small></div>)}<MissionClaimChecks checks={o.claimChecksJson} enabled={mission.semanticCheckEnabled===true}/>{mission.artifactAdoptionEnabled&&mission.status!=="CANCELLED"&&<MissionArtifactAdoption missionId={mission.id} outputId={o.id} revision={o.revision}/>}</details>)}</section>}

    <details className={styles.progress}><summary>执行详情与回执（{done} 个步骤已执行）</summary><section aria-label="执行记录"><div className={styles.sectionTitle}><h4>执行记录</h4><span>{done} 个步骤已执行</span></div>
     {!mission.steps.length&&<p className={styles.muted}>{mission.status==="READY"?"委托已保存，等待开始执行。":"尚无执行步骤。"}</p>}
     <p className={styles.taskId}>任务编号：{mission.id}</p><ol>{mission.steps.map((s,index)=><li key={s.id}><span className={styles.stepNumber} data-status={s.status}>{s.status==="SUCCEEDED"?"✓":index+1}</span><div className={styles.stepBody}><div className={styles.stepHeading}><span>{toolLabels[s.toolName]??"执行步骤"}</span><small>{stepLabels[s.status]??"状态待确认"}</small></div>{s.result?.data?.actionId&&<p><a href={projectHref(projectId,`#action-${s.result.data.actionId}`)}>{s.toolName==="inspect_action"?"行动结果":"已创建行动"}：{s.result.data.title??"查看行动"}</a>（{s.result.data.status==="DONE"?"已报告完成":s.result.data.status==="CANCELLED"?"已取消":["IN_PROGRESS","DOING"].includes(s.result.data.status??"")?"进行中":"创建回执：待办"}）{s.result.data.resultCardId&&<a href={projectHref(projectId,`#card-${s.result.data.resultCardId}`)}>查看结果复盘</a>}</p>}</div></li>)}</ol>
    </section></details>
    <div className={styles.settings}>
     <h4>委托设置与来源</h4>
     <details><summary>材料到达后的接续许可</summary><div className={styles.settingBody}><p>当前：{mission.continuationPolicy?.mode==="LOW_RISK_READ_ANALYZE"?"允许符合条件后继续读取与分析":"人工确认后继续"}。</p><p>自动接续只接受字段完全匹配的结构化本项目实验记录，不会自动创建行动或发布成果。</p>{!mission.autoContinuationEnabled&&<p>服务端自动接续未开启，当前仍需人工确认。</p>}<button disabled={busy||terminal} onClick={()=>void perform(async()=>{await api(`/api/missions/${mission.id}/continuation-policy`,"PATCH",{requestId:crypto.randomUUID(),expectedVersion:mission.version,policy:{mode:mission.continuationPolicy?.mode==="LOW_RISK_READ_ANALYZE"?"MANUAL":"LOW_RISK_READ_ANALYZE"}});await refresh(mission.id);})}>{mission.continuationPolicy?.mode==="LOW_RISK_READ_ANALYZE"?"撤销自动接续许可":"授权满足结构化缺口后自动读取与分析"}</button></div></details>
     <details><summary>查看或修改个人约束</summary><MissionConstraintsEditor key={`${mission.id}:${mission.constraintsVersion}`} initial={mission.constraints} cloudApproved={mission.constraints.llmContextApproved===true} busy={busy||terminal} onSave={(constraints,llmContextApproved)=>void perform(async()=>{await api(`/api/missions/${mission.id}/constraints`,"PATCH",{requestId:crypto.randomUUID(),expectedVersion:mission.version,expectedConstraintsVersion:mission.constraintsVersion,constraints,llmContextApproved});await refresh(mission.id);})}/></details>
     <details><summary>公开研究范围</summary><MissionResearchScopeEditor key={`${mission.id}:${mission.researchScopeVersion}`} initial={mission.researchScope} busy={busy||terminal} onSave={scope=>void perform(async()=>{await api(`/api/missions/${mission.id}/research-scope`,"PATCH",{requestId:crypto.randomUUID(),expectedVersion:mission.version,expectedScopeVersion:mission.researchScopeVersion,scope});await refresh(mission.id);})}/></details>
     <details><summary>公开资料与获取记录（{sources.length}）</summary><div className={styles.settingBody}>{!sources.length&&<p className={styles.muted}>此委托尚未获取公开资料。</p>}{sources.map(s=><article className={styles.source} key={s.id}><a href={s.requestedUrl} target="_blank" rel="noreferrer">{s.title||s.requestedUrl}</a><p className={styles.muted}>{s.retrievalMode==="SEARCH_SNIPPET"?"搜索摘要，尚未读取正文":"托管提取正文，最终域名未独立验证"} · {s.availability==="AVAILABLE"?"已获取":"来源已变化"} · {new Date(s.fetchedAt).toLocaleString("zh-CN")}</p><p>{s.excerptJson.text.slice(0,600)}</p></article>)}</div></details>
    </div>
   </>}
   </div>
  </div>
 </section>;
}
