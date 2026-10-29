import type { DocumentMeta } from "@/lib/types/document";
export function DocumentSourceView({projectId,document,text}:{projectId:string;document:DocumentMeta;text:string}){
 const page=document.pages[0],original=`/api/projects/${encodeURIComponent(projectId)}/attachments/${encodeURIComponent(document.attachmentId)}/file${page?"#page="+page:""}`;
 return <><p className="mt-3 text-sm">{page?`原件物理第 ${page} 页` : document.pageMapping==="CORRECTED_TEXT_UNMAPPED"?"校对文本修订 · 未绑定原页":"原文件目录"} · 读取于 {new Date(document.observedAt).toLocaleString("zh-CN")}</p>
  {document.kind==="TABLE"&&<p className="mt-2 text-sm">表格来自文本布局提取，表头、合并单元格和跨页关系需要对照原页核对。</p>}
  <pre className="my-6 whitespace-pre-wrap break-words font-sans leading-8">{text||"未取得可读正文"}</pre>
  <a className="workspace-link" href={original} target="_blank" rel="noopener noreferrer">{page?`打开 PDF 第 ${page} 物理页 ↗`:"打开原文件 ↗"}</a>
  <details className="mt-5"><summary>来源版本</summary><p>附件修订：{document.revisionId??"原始附件"}</p><p>提取器：{document.parser}</p><p className="break-all">文件 SHA256：{document.fileHash}</p></details>
 </>;
}
