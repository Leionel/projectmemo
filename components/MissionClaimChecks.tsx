"use client";
const labels:Record<string,string>={ENTAILS:"证据支持该句",CONTRADICTS:"与引用证据矛盾",NOT_ENOUGH_INFORMATION:"证据不足",NOT_CHECKED:"语义未核验"};
export function MissionClaimChecks({checks,enabled=true}:{enabled?:boolean;checks?:Array<{blockId:string;claimId?:string;text?:string;status:string;mode?:string;reasonCode?:string;checkedAt?:string}>}){
 if(!checks?.length)return null;
 if(!enabled)return <p className="mt-2 text-xs">语义核验未启用，内容待审核。</p>;
 return <details className="mt-2 text-xs"><summary>逐块核验记录</summary><p>这是生成时的来源支持判断，不确认项目事实或现实效果。来源变化后请重新核对。</p>{checks.map(c=><p key={c.claimId??c.blockId}>{c.text??c.blockId} · {labels[c.status]??"语义未核验"} · {c.mode==="JUDGE"?"模型判断":c.mode==="RULE"?"规则检查":"未启用核验"}{c.checkedAt?` · ${new Date(c.checkedAt).toLocaleString("zh-CN")}`:""}</p>)}</details>;
}
