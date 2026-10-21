// @vitest-environment jsdom
import {createElement} from "react";
import {render,screen,cleanup,within} from "@testing-library/react";
import {afterEach,describe,expect,it,vi} from "vitest";
import {projectHref} from "@/lib/projectNavigation";
import {ProjectNavigation,ProjectLegacyRedirect} from "@/components/ProjectNavigation";
const state=vi.hoisted(()=>({pathname:"/projects/p/records",replace:vi.fn()}));
vi.mock("next/navigation",()=>({usePathname:()=>state.pathname,useRouter:()=>({replace:state.replace})}));
afterEach(()=>{cleanup();state.replace.mockReset();window.history.replaceState(null,"","/");});
describe("单项目功能导航",()=>{
 it("真实链接带项目范围，当前页标明，功能页可直接访问",()=>{
  render(createElement(ProjectNavigation,{projectId:"p",missionsEnabled:true}));
  document.querySelector("details")!.open=true;
  expect(within(screen.getByRole("navigation",{name:"项目主要导航"})).getAllByRole("link")).toHaveLength(5);
  expect(screen.getByRole("link",{name:"资料"}).getAttribute("aria-current")).toBe("page");
  const nav=screen.getByRole("navigation",{name:"项目功能导航"});expect(nav.querySelectorAll("a")).toHaveLength(8);
  expect(screen.getByRole("link",{name:"记录与资料"}).getAttribute("href")).toBe("/projects/p/records");
  expect(screen.getByRole("link",{name:"记录与资料"}).getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("link",{name:"项目首页"}).getAttribute("aria-current")).toBeNull();
 });
 it("委托关闭时隐藏入口，其他功能仍可达",()=>{
  render(createElement(ProjectNavigation,{projectId:"q",missionsEnabled:false}));
  document.querySelector("details")!.open=true;
  expect(screen.queryByRole("link",{name:"长期委托"})).toBeNull();
  expect(screen.getByRole("link",{name:"知识与问答"}).getAttribute("href")).toBe("/projects/q/knowledge");
 });
 it.each([
  ["#card-c1","/projects/p/knowledge#card-c1"],
  ["#action-a1","/projects/p/actions#action-a1"],
  ["#attachment-file1","/projects/p/records#attachment-file1"],
  ["#meeting-import","/projects/p/meetings#meeting-import"],
  ["#project-state","/projects/p/health#project-state"],
  ["/projects/p?cardSort=importance#knowledge-assets","/projects/p/knowledge?cardSort=importance#knowledge-assets"],
  ["/projects/p/generate?type=readme","/projects/p/generate?type=readme"],
  ["/projects/other#action-x","/projects/other#action-x"],
 ])("保留具体目标与查询参数 %s",(old,expected)=>{expect(projectHref("p",old)).toBe(expected);});
 it("旧首页书签跳转到功能页，保留筛选和实体锚点",()=>{
  window.history.replaceState(null,"","/projects/p?cardType=risk#knowledge-assets");
  render(createElement(ProjectLegacyRedirect,{projectId:"p"}));
  expect(state.replace).toHaveBeenCalledWith("/projects/p/knowledge?cardType=risk#knowledge-assets");
 });
 it("普通首页和未知锚点不强制跳走",()=>{
  window.history.replaceState(null,"","/projects/p#main-content");
  render(createElement(ProjectLegacyRedirect,{projectId:"p"}));expect(state.replace).not.toHaveBeenCalled();
 });
});
