export const projectSections = [
  {key:"",label:"项目首页",description:"当前状态、重要事项和下一步"},
  {key:"missions",label:"长期委托",description:"委托目标、执行进度和成果草稿"},
  {key:"records",label:"记录与资料",description:"记录进展、上传和处理附件"},
  {key:"meetings",label:"会议更新",description:"整理会议、预览变化并逐项确认"},
  {key:"actions",label:"行动与提醒",description:"处理提醒、推进待办和安排时间"},
  {key:"knowledge",label:"知识与问答",description:"检索项目记忆、查看原文和询问忆程"},
  {key:"health",label:"项目体检",description:"状态变化、阶段检查和准备度"},
  {key:"generate",label:"成果文档",description:"生成、审阅和管理项目成果"},
] as const;
export function projectSectionForHash(hash:string):string|null {
 if(/^#intervention-/.test(hash)||/^#action-/.test(hash)||["#action-board","#interventions","#schedule-planner"].includes(hash))return "actions";
 if(/^#card-/.test(hash)||["#knowledge-assets","#archived-memory","#memory-consolidation","#memory-copilot"].includes(hash))return "knowledge";
 if(["#project-health","#project-state","#project-evolution","#episode-checkpoint","#competition-readiness"].includes(hash))return "health";
 if(/^#attachment-/.test(hash)||["#capture-box","#attachment-inbox"].includes(hash))return "records";
 if(hash==="#meeting-import")return "meetings";
 if(hash==="#mission-agent")return "missions";
 return null;
}
/** Accepts local anchors and existing project links, preserving query and entity IDs. */
export function projectHref(projectId:string,href:string):string {
 const base=`/projects/${projectId}`;
 if(!href.startsWith("#")&&!href.startsWith(`${base}#`)&&!href.startsWith(`${base}?`))return href;
 const hash=href.includes("#")?href.slice(href.indexOf("#")):"";
 const section=projectSectionForHash(hash);
 if(!section)return href;
 const queryStart=href.indexOf("?");const query=queryStart>=0?href.slice(queryStart,href.indexOf("#")>=0?href.indexOf("#"):undefined):"";
 return `${base}/${section}${query}${hash}`;
}
