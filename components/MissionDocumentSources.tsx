import type { DocumentMeta } from "@/lib/types/document";
export function MissionDocumentSources({id,steps}:{id:string;steps:Array<{result?:unknown}>}){
 const sources=steps.flatMap(s=>(s.result as {sources?:Array<{id:string;document?:DocumentMeta}>}|null)?.sources??[]).filter(s=>s.document).slice(-16);
 if(!sources.length)return null;
 return <details><summary>文档原页与引用（{sources.length}）</summary><ul className="grid gap-3 py-3">{sources.map(s=><li key={s.id}><a className="workspace-link" href={`/missions/source/${encodeURIComponent(id)}/${encodeURIComponent(s.id)}`} target="_blank" rel="noopener noreferrer">{s.document!.fileName} · {s.document!.pages.length?`物理第 ${s.document!.pages[0]} 页`:"目录或文本修订"}{s.document!.kind==="TABLE"?" · 表头待核对":""}</a></li>)}</ul></details>;
}
