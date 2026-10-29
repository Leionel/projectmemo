"use client";
export function MissionBudgetReview({budget,used,busy,onReview}:{budget:Record<string,number>;used:Record<string,number>;busy:boolean;onReview:(totals:{models:number;tools:number;activeMs:number;reservedOutputTokens:number})=>void}){
 const totals={models:Math.max(budget.models,Math.min(24,budget.models+6)),tools:Math.max(budget.tools,Math.min(64,budget.tools+8)),activeMs:Math.max(budget.activeMs,Math.min(900000,budget.activeMs+180000)),reservedOutputTokens:Math.max(budget.reservedOutputTokens,Math.min(48000,budget.reservedOutputTokens+12000))};
 return <details><summary>复核累计预算</summary><p>模型已用或预占 {used.models??0} 次，上限 {budget.models} → {totals.models}；工具 {used.tools??0} 次，上限 {budget.tools} → {totals.tools}。活动时间上限 {Math.round(totals.activeMs/60000)} 分钟，累计输出预留上限 {totals.reservedOutputTokens} tokens。UNKNOWN 和原预占继续计入。</p><button disabled={busy||totals.models===budget.models} onClick={()=>onReview(totals)}>确认累计上限，保持暂停</button></details>;
}
