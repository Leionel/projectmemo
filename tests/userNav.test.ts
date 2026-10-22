// @vitest-environment jsdom
import {createElement} from "react";
import {render,screen,fireEvent,cleanup} from "@testing-library/react";
import {it,expect,vi,afterEach} from "vitest";
import {UserNav} from "@/components/UserNav";
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it("登录完成后不必刷新页面即可更新身份，旧匿名响应不能覆盖新身份",async()=>{
 let finishOld:(v:unknown)=>void=()=>{};let reads=0;
 vi.stubGlobal("fetch",vi.fn(async()=>{reads++;if(reads===1)return new Promise(resolve=>{finishOld=resolve;});return{ok:true,json:async()=>({user:{id:"u",username:"reviewer",displayName:"测试用户"}})};}));
 render(createElement(UserNav));fireEvent(window,new Event("projectmemo:session-changed"));
 expect(await screen.findByRole("button",{name:"测试用户"})).toBeTruthy();
 finishOld({ok:false});await new Promise(resolve=>setTimeout(resolve,0));
 expect(screen.getByRole("button",{name:"测试用户"})).toBeTruthy();expect(screen.queryByRole("link",{name:"登录"})).toBeNull();
});
it("退出接口失败保留身份并明确提供重试",async()=>{
 vi.stubGlobal("fetch",vi.fn(async(url:string)=>url.endsWith("/logout")?{ok:false,status:503}:{ok:true,json:async()=>({user:{id:"u",username:"reviewer",displayName:"测试用户"}})}));
 render(createElement(UserNav));fireEvent.click(await screen.findByRole("button",{name:"测试用户"}));fireEvent.click(screen.getByRole("button",{name:"退出登录"}));
 expect(await screen.findByRole("alert")).toHaveProperty("textContent","退出未完成，当前登录仍保留，请重试。");
 expect(screen.getByRole("button",{name:"测试用户"})).toBeTruthy();expect((screen.getByRole("button",{name:"退出登录"}) as HTMLButtonElement).disabled).toBe(false);
});
