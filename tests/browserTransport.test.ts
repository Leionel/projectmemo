import {expect,it,vi} from "vitest";
import {EventEmitter} from "node:events";
vi.mock("node:https",()=>({default:{request:vi.fn()}}));
import https from "node:https";
import {readBrowserResource} from "@/lib/browser/transport";

it("浏览器不再次解析域名，socket固定为已验证地址且不携带页面凭据",async()=>{
 const req=Object.assign(new EventEmitter(),{end:vi.fn(),destroy:vi.fn()});vi.mocked(https.request).mockReturnValue(req as never);
 const pending=readBrowserResource("https://public.example.org/page",["1.1.1.1"],new AbortController().signal,()=>undefined);
 await vi.waitFor(()=>expect(https.request).toHaveBeenCalled());
 const options=vi.mocked(https.request).mock.calls[0][1] as {headers:Record<string,string>;lookup:(host:string,options:unknown,cb:unknown)=>void;autoSelectFamily:boolean};
 const resolved=vi.fn();options.lookup("public.example.org",{},resolved);expect(resolved).toHaveBeenCalledWith(null,"1.1.1.1",4);
 expect(options.autoSelectFamily).toBe(false);expect(options.headers).not.toHaveProperty("Authorization");expect(options.headers).not.toHaveProperty("Cookie");
 req.emit("error",new Error("fixture end"));await expect(pending).rejects.toThrow("fixture end");
});
