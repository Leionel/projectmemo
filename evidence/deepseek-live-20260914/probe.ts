import fs from 'node:fs';
import { structureCaptureWithMeta } from '../../lib/agent';
process.env.LLM_MODE='openai-compatible';
process.env.LLM_PROVIDER='deepseek';
process.env.LLM_BASE_URL='https://api.deepseek.com/v1';
process.env.LLM_MODEL_NAME='deepseek-flash';
const results: Record<string,unknown>={time:new Date().toISOString(),model:process.env.LLM_MODEL_NAME};
try {
 const response=await fetch('https://api.deepseek.com/models',{headers:{Authorization:`Bearer ${process.env.LLM_API_KEY}`},signal:AbortSignal.timeout(20000)});
 results.modelsStatus=response.status;
 const body=await response.json();
 results.models=body.data?.map((m:{id:string})=>m.id);
 if(!response.ok) results.error=body.error?.message;
 console.log(JSON.stringify(results));
 if(response.ok){
  const input={project:{title:'API隔离验证',description:'虚构测试，无真实项目资料',goal:'验证记录结构化'},rawText:'今天完成端侧记录按钮修复，测试通过五项。下一步明天验证离线重试，负责人小林。',historyKeywords:[]};
  const first=await structureCaptureWithMeta(input);
  results.defaultTimeoutCapture=first;
  console.log(JSON.stringify({stage:'defaultTimeoutCapture',...first}));
  if(first.status!=='SUCCESS'){
   process.env.LLM_TIMEOUT_MS='60000';
   const retry=await structureCaptureWithMeta(input);
   results.extendedTimeoutCapture=retry;
   console.log(JSON.stringify({stage:'extendedTimeoutCapture',...retry}));
  }
 }
}catch(e){results.error=e instanceof Error?e.message:String(e);console.log(JSON.stringify({error:results.error}));}
finally{
 fs.writeFileSync('evidence/deepseek-live-20260914/results.json',JSON.stringify(results,null,2));
 delete process.env.LLM_API_KEY;
}
