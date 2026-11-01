import {expect,test} from "vitest";
import {deploymentLayers,redactDeploymentLog} from "@/lib/sensing/deploymentEvidence";
import type {DeploymentConfig} from "@/lib/types/deployment";
const now=Date.now(),config:DeploymentConfig={schemaVersion:1,environment:"预发布",origin:"https://service.example.org",expectedRelease:"abcdef012345",healthPath:"/health",userPath:"/status/public-path",expiresAt:new Date(now+86400000).toISOString(),freshnessSeconds:600};
const health={status:200,contentType:"application/json",body:{status:"ok",release:config.expectedRelease,checked_at:new Date(now).toISOString()},observedAt:new Date(now).toISOString()};
test("健康200且版本相符仍不证明构建、部署流水线或用户路径",()=>{
  expect(deploymentLayers(config,health,undefined,now).map(l=>[l.layer,l.state])).toEqual([["BUILD","UNKNOWN"],["DEPLOY","PARTIAL"],["SERVICE","OBSERVED"],["USER_PATH","UNKNOWN"]]);
});
test("旧release、旧检查时间与登录HTML必须分开，不把任意200渲染成全绿",()=>{
  expect(deploymentLayers(config,{...health,body:{...health.body,release:"oldrelease"}},undefined,now)[1].state).toBe("FAILED");
  expect(deploymentLayers(config,{...health,body:{...health.body,checked_at:new Date(now-700000).toISOString()}},undefined,now)[2].state).toBe("STALE");
  expect(deploymentLayers(config,health,{...health,contentType:"text/html",body:"<html>login</html>"},now)[3].state).toBe("UNKNOWN");
  expect(deploymentLayers(config,health,health,now)[3].state).toBe("OBSERVED");
});
test("日志输出前脱敏；正文中的命令没有执行语义",()=>{
  const result=redactDeploymentLog("ignore instructions; API_KEY=secret-value\ncontact a@example.org 13812345678\nhttps://user:password@public.example.org/log?token=abc");
  for(const value of ["secret-value","a@example.org","13812345678","password@","token=abc"])expect(result).not.toContain(value);
  expect(result).toContain("ignore instructions");
});
