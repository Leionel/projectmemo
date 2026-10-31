import {beforeEach,expect,test,vi} from "vitest";
vi.mock("node:dns/promises",()=>({lookup:vi.fn()}));
vi.mock("node:https",()=>({default:{request:vi.fn()}}));
import {lookup} from "node:dns/promises";
import https from "node:https";
import {EventEmitter} from "node:events";
import {deploymentConfigSchema} from "@/lib/types/deployment";
import {deploymentTransport,publicDeploymentAddress} from "@/lib/sensing/deploymentTransport";
beforeEach(()=>vi.resetAllMocks());
test("部署观察拒绝内网/映射地址与文档网段，但保留公网IPv4/IPv6",()=>{
  for(const ip of ["127.0.0.1","10.1.2.3","169.254.169.254","100.100.100.200","192.168.1.1","192.88.99.1","198.18.1.1","203.0.113.1","::1","fc00::1","fe80::1","::ffff:127.0.0.1","2002:7f00:1::1","2001:db8::1","3fff::1"])expect(publicDeploymentAddress(ip),ip).toBe(false);
  for(const ip of ["8.8.8.8","1.1.1.1","2606:4700:4700::1111","2001:4860:4860::8888"])expect(publicDeploymentAddress(ip),ip).toBe(true);
});
test("DNS混合内网结果在任何HTTP前拒绝；固定已验证解析结果而不是再次查询DNS",async()=>{
  vi.mocked(lookup).mockResolvedValue([{address:"1.1.1.1",family:4},{address:"127.0.0.1",family:4}] as never);
  await expect(deploymentTransport("https://service.example.org/health",new AbortController().signal)).rejects.toMatchObject({code:"DEPLOYMENT_ADDRESS_DENIED"});
  expect(https.request).not.toHaveBeenCalled();
  vi.mocked(lookup).mockResolvedValue([{address:"1.1.1.1",family:4}] as never);
  const request=new EventEmitter() as EventEmitter&{end:()=>void};request.end=()=>undefined;
  vi.mocked(https.request).mockReturnValue(request as never);
  const pending=deploymentTransport("https://service.example.org/health",new AbortController().signal);
  await vi.waitFor(()=>expect(https.request).toHaveBeenCalledTimes(1));
  const options=vi.mocked(https.request).mock.calls[0][1] as {lookup:(host:string,options:object,cb:(error:Error|null,address:string,family:number)=>void)=>void;autoSelectFamily:boolean};
  expect(options.autoSelectFamily).toBe(false);
  const read=vi.fn();options.lookup("service.example.org",{},read);expect(read).toHaveBeenCalledWith(null,"1.1.1.1",4);
  request.emit("error",new Error("test end"));await expect(pending).rejects.toThrow("test end");
});
test("解析等待受整个观察截止约束，取消后不发HTTP",async()=>{
  vi.mocked(lookup).mockImplementation(()=>new Promise(()=>undefined));
  const controller=new AbortController(),pending=deploymentTransport("https://service.example.org/health",controller.signal);
  controller.abort(new Error("stop"));await expect(pending).rejects.toThrow("stop");expect(https.request).not.toHaveBeenCalled();
});
test("环境合同只准固定HTTPS origin与读取路径，不把登录回调或部署触发写成健康检查",()=>{
  const base={schemaVersion:1,environment:"验收环境",origin:"https://service.example.org",expectedRelease:"abcdef012345",expiresAt:"2026-11-01T12:00:00Z"};
  expect(deploymentConfigSchema.parse(base).healthPath).toBe("/health");
  for(const origin of ["https://service.example.org/login?token=x","https://user:password@service.example.org","http://service.example.org","https://127.0.0.1"]){expect(()=>deploymentConfigSchema.parse({...base,origin})).toThrow();}
  for(const healthPath of ["/deploy","/restart","/admin/delete","/api/confirm","/../private","/health?token=x","//other.example.org"]){expect(()=>deploymentConfigSchema.parse({...base,healthPath}),healthPath).toThrow();}
});
