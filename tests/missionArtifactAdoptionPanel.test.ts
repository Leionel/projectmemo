// @vitest-environment jsdom
import {createElement} from "react";
import {render,screen,fireEvent,waitFor,cleanup} from "@testing-library/react";
import {it,expect,vi,afterEach} from "vitest";
import {MissionArtifactAdoption} from "@/components/MissionArtifactAdoption";
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it("成果写入响应丢失后重放同请求编号，成功能定位固定成果版本",async()=>{
 const bodies:Array<{requestId:string}>=[];let first=true;
 vi.stubGlobal("fetch",vi.fn(async(url:string,init:RequestInit)=>{
  if(url.endsWith("artifact-preview"))return{ok:true,json:async()=>({receipt:{previewHash:"hash",content:"带来源草稿",contextVersion:3,visibility:"将共享给项目成员",sourceManifest:[]}})};
  bodies.push(JSON.parse(init.body as string));if(first){first=false;throw new Error("response lost");}
  return{ok:true,json:async()=>({receipt:{artifactId:"fixed-artifact"}})};
 }));
 render(createElement(MissionArtifactAdoption,{projectId:"p",missionId:"m",outputId:"o",revision:1}));
 fireEvent.click(screen.getByRole("button",{name:"预览归入项目周报"}));
 fireEvent.click(await screen.findByRole("button",{name:"确认保存并向项目成员共享"}));
 await screen.findByRole("alert");expect(screen.getByText("带来源草稿")).toBeTruthy();
 fireEvent.click(screen.getByRole("button",{name:"确认保存并向项目成员共享"}));
 await waitFor(()=>expect(bodies).toHaveLength(2));expect(bodies[0].requestId).toBe(bodies[1].requestId);
 expect((await screen.findByRole("link",{name:"打开已归入的成果版本"})).getAttribute("href")).toBe("/projects/p/generate?type=weekly_report&artifact=fixed-artifact");
});
