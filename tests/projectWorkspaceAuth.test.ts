import {beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({session:vi.fn(),access:vi.fn(),findProject:vi.fn(),evaluate:vi.fn()}));
vi.mock("react",()=>({cache:(fn:unknown)=>fn}));
vi.mock("@/lib/db",()=>({db:{project:{findUnique:mocks.findProject}}}));
vi.mock("@/lib/auth/serverSession",()=>({getSessionUser:mocks.session,hasProjectAccess:mocks.access}));
vi.mock("@/lib/services/agentContextService",()=>({evaluateProjectContext:mocks.evaluate}));
vi.mock("next/navigation",()=>({notFound:()=>{throw new Error("NOT_FOUND");},redirect:(url:string)=>{throw new Error(url);}}));
import {loadWorkspaceProject,requireWorkspaceProject} from "@/lib/server/projectWorkspace";
beforeEach(()=>{vi.clearAllMocks();mocks.session.mockResolvedValue({id:"owner"});mocks.access.mockResolvedValue(true);mocks.findProject.mockResolvedValue({id:"p",title:"私有项目",memberships:[{role:"OWNER"}]});});
describe("功能页共享项目授权",()=>{
 it("匿名不读取项目信息，登录后回到请求的功能页",async()=>{
  mocks.session.mockResolvedValue(null);await expect(requireWorkspaceProject("p","missions")).rejects.toThrow("/login?from=%2Fprojects%2Fp%2Fmissions");
  expect(mocks.access).not.toHaveBeenCalled();expect(mocks.findProject).not.toHaveBeenCalled();expect(mocks.evaluate).not.toHaveBeenCalled();
 });
 it("越权先返回404，不读项目、不生成提醒",async()=>{
  mocks.access.mockResolvedValue(false);await expect(loadWorkspaceProject("p")).rejects.toThrow("NOT_FOUND");
  expect(mocks.findProject).not.toHaveBeenCalled();expect(mocks.evaluate).not.toHaveBeenCalled();
 });
 it("项目壳仅在已授权后读取元数据，不执行项目评估",async()=>{
  expect(await loadWorkspaceProject("p")).toMatchObject({project:{id:"p"},user:{id:"owner"}});expect(mocks.access).toHaveBeenCalledWith("owner","p");expect(mocks.evaluate).not.toHaveBeenCalled();
 });
 it("仅项目成员而非Owner时不开放私有委托摘要",async()=>{mocks.findProject.mockResolvedValue({id:"p",memberships:[{role:"MEMBER"}]});expect(await loadWorkspaceProject("p")).toMatchObject({missionOwner:false});});
 it("数据库失败保留错误，不能伪装成项目不存在",async()=>{
  mocks.findProject.mockRejectedValue(new Error("database unavailable"));await expect(loadWorkspaceProject("p")).rejects.toThrow("database unavailable");
 });
});
