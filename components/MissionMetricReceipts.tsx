type Receipt={jobName:string;containerId:string;receiptHash:string;finishedAt:string;image:string;scriptHash:string;exitCode:number;result:{state:string;delta:number|null}};
type Execution={phase:string;jobName:string;current:boolean;receipt:Receipt|null;failure:{exitCode?:number}|null};
export function MissionMetricReceipts({steps}:{steps:Array<{id:string;status:string;execution?:Execution}>}){
 const jobs=steps.filter(s=>s.execution&&s.execution.phase!=="NOT_DISPATCHED");if(!jobs.length)return null;
 return <section aria-label="核算结果" className="grid gap-4"><h4>核算结果</h4>{jobs.map(step=>{const job=step.execution!,receipt=job.receipt;return <article key={step.id} className="rounded-lg border p-4">
  <p>{!job.current?"原指标依据已变化，此回执仅作历史记录。":step.status==="SUCCEEDED"?"核算已完成。":receipt?"已拿到核算结果，等待确认。":step.status==="UNKNOWN"?"核算还没结束；继续时只核对这一次，不会重复执行。":"正在核对。"}</p>
  {receipt&&<><p>{receipt.result.state==="SAME_CONDITIONS"?`同条件差值：${receipt.result.delta}`:"条件不同或未知，不能比较。"} 这不是训练或实验复现。</p></>}
  {job.failure&&<p>核算没有成功完成。</p>}
 </article>;})}</section>;
}
