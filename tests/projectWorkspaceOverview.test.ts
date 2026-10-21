import {beforeEach,describe,expect,it,vi} from "vitest";

const mocks=vi.hoisted(()=>({
 session:vi.fn(),access:vi.fn(),findProject:vi.fn(),findProjectOrThrow:vi.fn(),
 after:vi.fn(),afterCallback:(null as null|(()=>Promise<void>)),evaluate:vi.fn(),
 listActions:vi.fn(),listInterventions:vi.fn(),getProjectMetrics:vi.fn(),
}));

vi.mock("react",()=>({cache:(fn:unknown)=>fn}));
vi.mock("next/server",()=>({after:mocks.after}));
vi.mock("@/lib/db",()=>({db:{project:{findUnique:mocks.findProject,findUniqueOrThrow:mocks.findProjectOrThrow}}}));
vi.mock("@/lib/auth/serverSession",()=>({getSessionUser:mocks.session,hasProjectAccess:mocks.access}));
vi.mock("@/lib/services/agentContextService",()=>({evaluateProjectContext:mocks.evaluate}));
vi.mock("@/lib/repositories/agent",()=>({listActions:mocks.listActions,listInterventions:mocks.listInterventions,getProjectMetrics:mocks.getProjectMetrics}));

import {loadWorkspaceOverview} from "@/lib/server/projectWorkspace";

beforeEach(()=>{
 vi.resetAllMocks();
 mocks.session.mockResolvedValue({id:"owner"});
 mocks.access.mockResolvedValue(true);
 mocks.findProject.mockResolvedValue({id:"p",title:"项目",memberships:[{role:"OWNER"}]});
 mocks.findProjectOrThrow.mockResolvedValue({id:"p",deadline:null,cards:[],artifacts:[]});
 mocks.listActions.mockResolvedValue([]);
 mocks.listInterventions.mockResolvedValue([]);
 mocks.getProjectMetrics.mockResolvedValue({});
 mocks.after.mockImplementation((callback:()=>Promise<void>)=>{mocks.afterCallback=callback;});
});

describe("项目概览响应时间",()=>{
 it("先返回概览数据，再在响应后评估提醒",async()=>{
  const overview=await loadWorkspaceOverview("p");

  expect(overview.project.id).toBe("p");
  expect(mocks.after).toHaveBeenCalledOnce();
  expect(mocks.evaluate).not.toHaveBeenCalled();

  await mocks.afterCallback?.();
  expect(mocks.evaluate).toHaveBeenCalledWith("p",{},"owner");
 });
});
