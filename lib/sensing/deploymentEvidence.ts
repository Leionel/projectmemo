import type {DeploymentConfig,DeploymentLayer} from "@/lib/types/deployment";
import type {DeploymentHttpResult} from "./deploymentTransport";
import {record} from "@/lib/conversation/repository";
import {redactCiLog} from "./repoCi";

export function deploymentLayers(config:DeploymentConfig,health:DeploymentHttpResult,userPath?:DeploymentHttpResult,now=Date.now()):DeploymentLayer[]{
  const body=record(health.body),release=typeof body.release==="string"?body.release:null;
  const layers:DeploymentLayer[]=[{layer:"BUILD",state:"UNKNOWN",description:"本观察未读取构建回执；需要另查同一提交的原CI证据"},
    {layer:"DEPLOY",state:release===null?"UNKNOWN":release!==config.expectedRelease?"FAILED":"PARTIAL",
      description:release===null?"服务未报告版本，不能确定正在提供哪个release":release!==config.expectedRelease?"服务报告的版本与期望release不一致":"服务自报版本与期望release相符；不是部署流水线或制品签名回执"}];
  const assess=(probe:DeploymentHttpResult,path:string,layer:"SERVICE"|"USER_PATH"):DeploymentLayer=>{
    const value=record(probe.body),checkedAt=typeof value.checked_at==="string"?Date.parse(value.checked_at):NaN;
    if(probe.status!==200)return{layer,state:"FAILED",path,httpStatus:probe.status,description:"该固定读取路径未返回200；未尝试登录、重定向或执行恢复操作"};
    if(!/^application\/(?:[a-z0-9.-]+\+)?json$/.test(probe.contentType)||!Object.keys(value).length)return{layer,state:"UNKNOWN",path,httpStatus:200,description:"返回200但不是约定JSON，登录页或HTML不能当作检查通过"};
    if(!Number.isFinite(checkedAt))return{layer,state:"PARTIAL",path,httpStatus:200,description:"缺少有效的检查时间，只证明当前取得了响应"};
    if(checkedAt>now+120000||now-checkedAt>config.freshnessSeconds*1000)return{layer,state:"STALE",path,httpStatus:200,description:"响应中的检查时间过期或超前，不能证明当前状态"};
    if(!["ok","pass","healthy"].includes(String(value.status).toLowerCase()))return{layer,state:"FAILED",path,httpStatus:200,description:"该路径报告的自检状态未通过"};
    if(layer==="USER_PATH"&&value.release!==config.expectedRelease)return{layer,state:"PARTIAL",path,httpStatus:200,description:"公共路径有响应，但未绑定到期望release"};
    return{layer,state:"OBSERVED",path,httpStatus:200,description:layer==="SERVICE"?"在记录时点取得该服务的自检通过响应；不证明业务数据、后台任务或真实用户流程通过":"该授权公共只读路径在记录时点通过约定检查；不覆盖登录后的交互和未检查路径"};
  };
  layers.push(assess(health,config.healthPath,"SERVICE"));
  layers.push(config.userPath&&userPath?assess(userPath,config.userPath,"USER_PATH"):{layer:"USER_PATH",state:"UNKNOWN",description:"未配置或未读取公共用户路径；不能从CI或健康检查推断用户任务成功"});
  return layers;
}
export function redactDeploymentLog(text:string){
  return redactCiLog(text).replace(/https?:\/\/[^\s/@:]+:[^\s/@]+@/gi,"https://[已隐藏凭据]@")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,"[已隐藏邮箱]")
    .replace(/\b1[3-9]\d{9}\b/g,"[已隐藏手机号]").slice(-6000);
}
