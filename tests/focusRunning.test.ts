import {expect,it,vi} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
vi.mock("@/lib/auth/serverSession",()=>({getSessionUser:async()=>({id:"user"})}));
vi.mock("@/lib/server/globalFocus",()=>({loadGlobalFocus:async()=>({counts:{waiting:0,running:1,actions:0,reminders:0},nextDeadline:null,schemaVersion:1,missionEnabled:true,archived:false,hasMore:false,waiting:[],running:[{id:"running-1",projectId:"project-1",projectTitle:"研究课题",title:"整理阶段结果",detail:"",status:"RUNNING",activity:"已读取项目",activityAt:"",recordedAt:"",dueAt:"",projectDeadline:"",recordFields:[]}],actions:[],reminders:[],records:[]})}));
import FocusPage from "@/app/focus/page";
it("RUNNING 委托确实渲染，并直达原委托",async()=>{
 const html=renderToStaticMarkup(await FocusPage({searchParams:Promise.resolve({})}));
 expect(html).toContain("整理阶段结果");expect(html).toContain("正在执行");expect(html).toContain("/projects/project-1/missions?mission=running-1");
});
