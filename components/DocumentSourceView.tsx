import type { DocumentMeta } from "@/lib/types/document";
import { SourceProvenance } from "./SourceProvenance";
import { BookOpen } from "lucide-react";
export function DocumentSourceView({projectId,document,text}:{projectId:string;document:DocumentMeta;text:string}){
 const page=document.pages[0],original=`/api/projects/${encodeURIComponent(projectId)}/attachments/${encodeURIComponent(document.attachmentId)}/file${page?"#page="+page:""}`;
 return <><SourceProvenance name={document.fileName} observedAt={document.observedAt} timeLabel="读取时间"
   technical={[{label:"附件修订标识",value:document.revisionId},{label:"提取器",value:document.parser},{label:"文件校验",value:document.fileHash}]} />
  <p className="mt-3 text-sm">{page?`原件物理第 ${page} 页` : document.pageMapping==="CORRECTED_TEXT_UNMAPPED"?"校对文本修订，未绑定原页":"原文件目录"}</p>
  {document.kind==="TABLE"&&<p className="mt-2 text-sm">表格来自文本布局提取，表头、合并单元格和跨页关系需要对照原页核对。</p>}
  <pre className="my-6 whitespace-pre-wrap break-words font-sans leading-8">{text||"未取得可读正文"}</pre>
  <a className="workspace-link inline-flex items-center gap-2" href={original} target="_blank" rel="noopener noreferrer"><BookOpen size={16} aria-hidden="true" />{page?`打开 PDF 第 ${page} 物理页`:"打开原文件"}</a>
 </>;
}
