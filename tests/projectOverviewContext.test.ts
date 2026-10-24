import {expect,it,vi} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
const data=vi.hoisted(()=>({primary:"waiting",kind:"MISSION",hasLocalReminder:true,items:[{id:"waiting",goal:"整理汇报",status:"WAITING_INPUT",version:1,attention:"请补充实验对照结果",activity:null,activityAt:null,outputRevision:null}]}));
vi.mock("@/lib/server/projectWorkspace",()=>({requireWorkspaceProject:async()=>({user:{id:"u"},missionOwner:true}),loadWorkspaceOverview:async()=>({project:{cards:[],goal:"研究目标",scenario:"RESEARCH",deadline:null,_count:{captures:1,artifacts:0}},actions:[],interventions:data.hasLocalReminder?[{id:"urgent",title:"还需核对提交要求",content:"核对原始通知",status:"OPEN",severity:5,isSimulated:false}]:[],dashboard:{deadline:{rank:0}}})}));
vi.mock("@/lib/mission/workspaceSummary",()=>({missionWorkspaceSummary:async()=>({enabled:true,totalActive:3,items:data.items})}));
vi.mock("@/lib/services/projectAgentContextService",()=>({getProjectAgentContext:async()=>({goal:"整理汇报",focusMissionId:null,freshness:"FRESH",nextStep:{entityRef:{kind:data.kind,id:data.primary},title:"整理汇报",reason:"请补充实验对照结果",href:`/projects/p/missions?mission=${data.primary}`,actionLabel:"补充委托资料"}})}));
vi.mock("@/lib/config/features",()=>({isFeatureEnabled:()=>false}));
vi.mock("@/components/ProjectAgentFocus",()=>({ProjectAgentFocus:()=>null}));
vi.mock("@/components/ProjectPulse",()=>({ProjectPulse:()=>null}));
vi.mock("@/components/ReentryBrief",()=>({ReentryBrief:()=>null}));
vi.mock("@/components/ProjectNavigation",()=>({ProjectLegacyRedirect:()=>null}));
vi.mock("@/components/ProjectStartGuide",()=>({ProjectStartGuide:()=>null}));
vi.mock("@/components/ProjectOverviewToolbar",()=>({ProjectOverviewToolbar:()=>null}));
import ProjectHome from "@/app/projects/[id]/page";
it("统一选择补料后，不重复展示同一问题，也不漏掉次要提醒",async()=>{
 data.primary="waiting";const html=renderToStaticMarkup(await ProjectHome({params:Promise.resolve({id:"p"})}));
 expect(html.match(/请补充实验对照结果/g)).toHaveLength(1);expect(html).toContain("还需核对提交要求");expect(html).toContain("mission=waiting");
});
it("首要委托不在三项摘要内时，其余摘要不能被误删",async()=>{
 data.primary="older-original";const html=renderToStaticMarkup(await ProjectHome({params:Promise.resolve({id:"p"})}));
 expect(html).toContain("mission=older-original");expect(html).toContain("mission=waiting");
});

it("新提醒与概览快照不同步时，主事项仍可显示且不会读取空数组",async()=>{
 data.kind="INTERVENTION";data.primary="new-reminder";data.hasLocalReminder=false;
 try{const html=renderToStaticMarkup(await ProjectHome({params:Promise.resolve({id:"p"})}));expect(html).toContain("当前最重要的事项");expect(html).not.toContain("阶段记录与时间安排");}
 finally{data.kind="MISSION";data.hasLocalReminder=true;}
});
