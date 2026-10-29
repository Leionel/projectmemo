type Receipt={jobName:string;containerId:string;receiptHash:string;finishedAt:string;image:string;scriptHash:string;exitCode:number;result:{state:string;delta:number|null}};
type Execution={phase:string;jobName:string;current:boolean;receipt:Receipt|null;failure:{exitCode?:number}|null};
export function MissionMetricReceipts({steps}:{steps:Array<{id:string;status:string;execution?:Execution}>}){
 const jobs=steps.filter(s=>s.execution&&s.execution.phase!=="NOT_DISPATCHED");if(!jobs.length)return null;
 return <section aria-label="固定核算回执" className="grid gap-4"><h4>固定核算回执</h4>{jobs.map(step=>{const job=step.execution!,receipt=job.receipt;return <article key={step.id} className="rounded-lg border p-4">
  <p>{!job.current?"原指标依据已变化，此回执仅作历史记录。":step.status==="SUCCEEDED"?"固定脚本核算已完成。":receipt?"已取得原 job 回执，当前批准尚未结算。":step.status==="UNKNOWN"?"原 job 结果尚未结算；继续时只核对同一 job，不重发创建。":"正在核对原 job。"}</p>
  {receipt&&<><p>{receipt.result.state==="SAME_CONDITIONS"?`同条件差值：${receipt.result.delta}`:"条件不同或未知，不能比较。"} 这不是训练或实验复现。</p><details><summary>查看核算回执</summary><p>结束于 {new Date(receipt.finishedAt).toLocaleString("zh-CN")} · 退出码 {receipt.exitCode}</p><p className="break-all">Job：{receipt.jobName}</p><p className="break-all">回执：{receipt.receiptHash}</p><p className="break-all">镜像：{receipt.image}</p><p className="break-all">脚本：{receipt.scriptHash}</p></details></>}
  {job.failure&&<p>原 job 未成功完成，退出码：{job.failure.exitCode??"未知"}。失败记录保留。</p>}
 </article>;})}</section>;
}
