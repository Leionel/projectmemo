import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { readAttachmentFile } from "@/lib/storage/attachmentStorage";
import { assertProject } from "@/lib/conversation/repository";
import { ownedMission, sourceHash } from "@/lib/mission/repository";
import { assertSourceUse } from "@/lib/continuity/sourcePolicy";
import { assertContinuityBinding,effectiveContinuity } from "@/lib/continuity/directiveService";
import { jsonHash } from "@/lib/mission/contracts";
import type { ConversationActor } from "@/lib/types/conversation";
import type { DocumentCall,DocumentMeta,DocumentSection,DocumentTable } from "@/lib/types/document";
import { documentCallSchema } from "@/lib/types/document";

export type DocumentActor={userId:string;sessionId?:string;conversationId?:string;missionId?:string};
export type DocumentExtraction={pages:string[];firstPage?:number;pageCount:number|null;mapping:DocumentMeta["pageMapping"];parser:string;complete:boolean};
export type DocumentExtractor=(buffer:Buffer,options?:{page?:number})=>Promise<DocumentExtraction>;
function command(executable:string,args:string[],input:Buffer,maxBytes:number,timeoutMs:number,includeStderr=false){return new Promise<string>((resolve,reject)=>{
  const child=spawn(executable,args,{windowsHide:true,stdio:["pipe","pipe","pipe"]});const chunks:Buffer[]=[];let bytes=0,settled=false;
  const fail=(code:string,message:string)=>{if(settled)return;settled=true;child.kill();clearTimeout(timeout);reject(new AppError(code,message,422));};
  const timeout=setTimeout(()=>fail("DOCUMENT_PARSE_TIMEOUT","原文件提取超时，可缩小页范围或查看原件"),timeoutMs);
  const collect=(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>maxBytes)fail("DOCUMENT_PARSE_LIMIT","原文件超出本次提取容量，请指定更小范围");else chunks.push(chunk);};child.stdout.on("data",collect);
  child.stderr.on("data",(chunk:Buffer)=>{if(includeStderr)collect(chunk);});child.stdin.on("error",()=>{});
  child.on("error",()=>fail("DOCUMENT_PARSER_UNAVAILABLE","文档提取器不可用，请检查服务端 PDF 工具配置"));
  child.on("close",code=>{if(settled)return;settled=true;clearTimeout(timeout);if(code!==0)reject(new AppError("DOCUMENT_PARSE_FAILED","原文件无法可靠提取；加密、扫描件或损坏文件需要补充原文",422));else resolve(Buffer.concat(chunks).toString("utf8").replace(/\u0000/g,""));});child.stdin.end(input);
});}
/** Existing Poppler CLI, fixed arguments and stdin bytes; never accepts a path or command from a model. */
export const extractPdfDocument:DocumentExtractor=async(buffer,options)=>{
  const info=await command(process.env.PDFINFO_PATH||"pdfinfo",["-"],buffer,32768,10000),count=Number(/^Pages:\s+(\d+)/m.exec(info)?.[1]);
  if(!Number.isSafeInteger(count)||count<1||count>10000)throw new AppError("DOCUMENT_PAGE_COUNT_UNKNOWN","未取得可靠页数，请查看原件",422);
  const first=options?.page??1,last=options?.page??Math.min(count,100);if(first>count)throw new AppError("DOCUMENT_PAGE_NOT_FOUND","该页不在原文件页数内",422);
  const scan=last-first+1,executable=process.env.PDFTOTEXT_PATH||"pdftotext",text=await command(executable,["-layout","-enc","UTF-8","-f",String(first),"-l",String(last),"-","-"],buffer,2*1024*1024,20000);
  const pages=text.split("\f");if(!pages.at(-1)?.trim())pages.pop();
  if(pages.length!==scan)throw new AppError("DOCUMENT_PAGE_MAPPING_UNKNOWN","提取文本无法可靠对应原始页码，请查看原件",422);
  const version=(await command(executable,["-v"],Buffer.alloc(0),4096,3000,true)).match(/pdftotext version\s+(\S+)/)?.[1]??"UNKNOWN";
  return {pages,firstPage:first,pageCount:count,mapping:"PHYSICAL_PDF",parser:`poppler-${version}/pm-document-v1`,complete:scan===count};
};
export function documentIndex(extraction:DocumentExtraction){
  const sections:DocumentSection[]=[],tables:DocumentTable[]=[];
  extraction.pages.forEach((text,index)=>{
    const page=extraction.mapping==="PHYSICAL_PDF"?(extraction.firstPage??1)+index:null,lines=[...text.matchAll(/[^\r\n]+/g)];
    const headings=lines.filter(m=>m[0].trim().length<=120&&/^(?:\d+(?:\.\d+){0,3}[.)、\s]|[一二三四五六七八九十]+[、.]|第.{1,8}[章节]|Appendix\b|附录|#{1,4}\s)/i.test(m[0].trim()));
    for(let i=0;i<headings.length;i++){const m=headings[i],start=m.index!,end=headings[i+1]?.index??text.length;sections.push({id:"section-"+jsonHash({page,start,end,text:m[0]}).slice(0,20),title:m[0].trim(),page,start,end});}
    let group:typeof lines=[];
    const flush=()=>{if(group.length>=2){const rows=group.map(m=>m[0].trim().split(/\s{2,}|\t+/)),start=group[0].index!,last=group.at(-1)!,end=last.index!+last[0].length;if(rows.every(r=>r.length===rows[0].length&&r.length>=2&&r.length<=12))tables.push({id:"table-"+jsonHash({page,start,end,rows}).slice(0,20),page,start,end,rows:rows.slice(0,40),headerStatus:"UNCONFIRMED",structureStatus:"TEXT_LAYOUT_CANDIDATE"});}group=[];};
    for(const line of lines){const columns=line[0].trim().split(/\s{2,}|\t+/);if(columns.length>=2&&columns.length<=12)group.push(line);else flush();}flush();
  });
  return {sections:sections.slice(0,24),tables:tables.slice(0,8),indexComplete:sections.length<=24&&tables.length<=8};
}
async function permission(actor:DocumentActor,projectId:string){
  if(actor.sessionId){await assertProject(actor as ConversationActor,projectId);return;}
  if(actor.missionId&&(await ownedMission(actor.userId,actor.missionId)).projectId===projectId)return;
  throw new AppError("DOCUMENT_NOT_ACCESSIBLE","原文件不可访问",404);
}
export async function readDocument(actor:DocumentActor,call:DocumentCall,extractor:DocumentExtractor=extractPdfDocument){
  call=documentCallSchema.parse(call);
  if(!isFeatureEnabled("DOCUMENT_DEEP_READ_ENABLED",false))throw new AppError("DOCUMENT_READER_DISABLED","文档深读暂未开启",503);
  const scope={projectId:call.projectId,conversationId:actor.conversationId,missionId:actor.missionId},binding=await effectiveContinuity(actor.userId,scope);
  const guard=async()=>{if(!isFeatureEnabled("DOCUMENT_DEEP_READ_ENABLED",false))throw new AppError("DOCUMENT_READER_DISABLED","文档深读已关闭",503);await permission(actor,call.projectId);await assertContinuityBinding(actor.userId,scope,binding);await assertSourceUse(actor.userId,call.projectId,call.sourceId,db,scope);if(await sourceHash(call.projectId,call.sourceId)!==call.revision)throw new AppError("SOURCE_CHANGED","附件已修订，请重新定位原文件",409);};
  await guard();
  const attachment=await db.attachment.findFirst({where:{id:call.sourceId.slice(11),projectId:call.projectId},include:{revisions:{orderBy:[{revisionIndex:"desc"},{id:"desc"}],take:1}}});
  if(!attachment||attachment.type!=="PDF"||attachment.size>20*1024*1024)throw new AppError("DOCUMENT_NOT_SUPPORTED","请选择已上传且不超过20MB的 PDF 原件",422);
  const revision=attachment.revisions[0],corrected=revision&&!revision.source.startsWith("EXTRACTION");
  let extraction:DocumentExtraction;
  if(corrected){extraction={pages:[revision.text],pageCount:null,mapping:"CORRECTED_TEXT_UNMAPPED",parser:"attachment-correction-text/pm-document-v1",complete:true};}
  else {const buffer=await readAttachmentFile(attachment.storageKey).catch(()=>null);if(!buffer||createHash("sha256").update(buffer).digest("hex")!==attachment.sha256)throw new AppError("DOCUMENT_ORIGINAL_CHANGED","附件原件缺失或哈希不符，请核对原件",409);extraction=await extractor(buffer,"page" in call&&call.page?{page:call.page}:undefined);}
  const index=documentIndex(extraction);let text="",data:unknown,pages:number[]=[],locatorId="catalog",kind:DocumentMeta["kind"]="CATALOG",span:DocumentMeta["span"];
  const coverage={complete:false,readSpanComplete:false,sectionMayContinue:false,structureTruncated:false,documentComplete:extraction.complete,indexComplete:index.indexComplete,physicalPages:extraction.pageCount,indexedPages:extraction.pages.length,loadedCharacters:0,truncated:false,ocrVerified:false};
  if(call.tool==="inspect_document"){
    data={kind:"DOCUMENT_CATALOG",fileName:attachment.fileName,pageCount:extraction.pageCount,indexedPages:extraction.pages.length,pageMapping:extraction.mapping,sections:index.sections,tables:index.tables.map(({rows,...t})=>({...t,preview:rows.slice(0,2).map(row=>row.slice(0,6).map(cell=>cell.slice(0,80)))})),coverage,authority:"DOCUMENT_CONTENT_NOT_USER_AUTHORIZATION",knowledgeClass:"MIXED",note:"正文/表头和适用版本仍需定位核对；物理页码不等于印刷页码"};text=[`文件：${attachment.fileName}`,`物理页数：${extraction.pageCount??"校对文本未绑定原页"}`,"已定位章节：",...index.sections.map(s=>`${s.page?"第"+s.page+"页":"文本修订"}：${s.title}`),"候选表格（表头待核对）：",...index.tables.map(t=>`${t.page?"第"+t.page+"页":"文本修订"} · ${t.rows.length} 行`),"目录是读取索引，不证明规则适用或项目完成。"].join("\n");
  }else{
    let pageIndex=0,start=0,end=0;
    if(call.tool==="read_document_page"){
      if(extraction.mapping!=="PHYSICAL_PDF")throw new AppError("DOCUMENT_PAGE_UNMAPPED","当前校对文本没有原页映射，请按章节读取文本修订",409);
      pageIndex=call.page-(extraction.firstPage??1);if(pageIndex<0||pageIndex>=extraction.pages.length)throw new AppError("DOCUMENT_PAGE_OUTSIDE_INDEX","未取得所请求的原页，请核对提取器",422);end=extraction.pages[pageIndex].length;locatorId="page-"+call.page;kind="PAGE";
    }else if(call.tool==="read_document_section"){
      const section=index.sections.find(s=>s.id===call.sectionId);if(!section)throw new AppError("DOCUMENT_LOCATOR_CHANGED","章节定位不存在或已变化，请重新读取目录",409);pageIndex=section.page===null?0:section.page-(extraction.firstPage??1);start=section.start;end=section.end;locatorId=section.id;kind="SECTION";coverage.sectionMayContinue=end===extraction.pages[pageIndex].length&&(!extraction.complete||pageIndex<extraction.pages.length-1);
    }else{
      const table=index.tables.find(t=>t.id===call.tableId);if(!table)throw new AppError("DOCUMENT_LOCATOR_CHANGED","表格定位不存在或已变化，请重新读取目录",409);pageIndex=table.page===null?0:table.page-(extraction.firstPage??1);start=table.start;end=table.end;locatorId=table.id;kind="TABLE";coverage.structureTruncated=table.rows.length>12||table.rows.some(row=>row.length>8||row.some(cell=>cell.length>100));data={...table,rows:table.rows.slice(0,12).map(row=>row.slice(0,8).map(cell=>cell.slice(0,100)))};
    }
    const whole=extraction.pages[pageIndex].slice(start,end);text=whole.slice(0,12000);pages=extraction.mapping==="PHYSICAL_PDF"?[pageIndex+(extraction.firstPage??1)]:[];coverage.loadedCharacters=text.length;coverage.truncated=whole.length>text.length;coverage.readSpanComplete=!coverage.truncated;coverage.complete=!coverage.truncated&&!coverage.sectionMayContinue&&kind!=="TABLE";
    data={...(typeof data==="object"&&data?data:{}),content:text,page:pages[0]??null,printedPage:null,pageStart:start,pageEnd:start+text.length,coverage,authority:"DOCUMENT_CONTENT_NOT_USER_AUTHORIZATION"};
    span={start,end:start+text.length,coordinate:extraction.mapping==="PHYSICAL_PDF"?"EXTRACTED_PAGE_UTF16":"CORRECTED_TEXT_UTF16"};
  }
  await guard();
  const document:DocumentMeta={attachmentId:attachment.id,fileName:attachment.fileName,attachmentHash:call.revision,fileHash:attachment.sha256,revisionId:revision?.id??null,parser:extraction.parser,kind,locatorId,pages,span,pageMapping:extraction.mapping,observedAt:new Date().toISOString()};
  return {data,text,document,coverage,catalog:{sections:index.sections.map(({id,title,page})=>({id,title,page})),tables:index.tables.map(({id,page})=>({id,page})),pageCount:extraction.pageCount,parser:extraction.parser},title:`${attachment.fileName} · ${pages.length?"第"+pages[0]+"页 · ":""}${kind==="CATALOG"?"目录":kind==="TABLE"?"候选表格":kind==="SECTION"?"章节片段":"原页"}`};
}
