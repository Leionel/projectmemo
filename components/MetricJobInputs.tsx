export type MetricJobInput={runId:string;metric:string;value:number;unit:string|null;[field:string]:unknown};
const conditions={dataset:"数据集版本",split:"评估切分",seed:"随机种子",evaluationCode:"评估代码",environment:"环境",phase:"阶段",batchSize:"批量大小",unit:"单位",period:"时间窗口",direction:"指标方向"};
export function MetricJobInputs({left,right}:{left:MetricJobInput;right:MetricJobInput}){
 const value=(v:unknown)=>v===null||v===undefined?"未知":v==="HIGHER_BETTER"?"越高越好":v==="LOWER_BETTER"?"越低越好":String(v);
 return <details><summary>核算输入与条件</summary><table className="mt-2 w-full text-left text-sm"><thead><tr><th className="px-2 py-1 align-top">条件</th><th className="px-2 py-1 align-top">{left.runId}</th><th className="px-2 py-1 align-top">{right.runId}</th></tr></thead><tbody>{Object.entries(conditions).map(([key,label])=><tr key={key}><th className="px-2 py-1 align-top">{label}</th><td className="break-all px-2 py-1 align-top">{value(left[key])}</td><td className="break-all px-2 py-1 align-top">{value(right[key])}</td></tr>)}</tbody></table></details>;
}
