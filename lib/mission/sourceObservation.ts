import type { Source } from "./contracts";
/** Frozen per-observation ownership. A mixed file does not invalidate its precisely quoted local observation. */
export function quoteKnowledgeClass(source:Source,start:number,end:number):string {
 if(!source.observationScopes)return source.knowledgeClass??(source.kind==="EXTERNAL"?"EXTERNAL_REFERENCE":source.entityType==="ARTIFACT"?"UNKNOWN":"PROJECT_OBSERVATION");
 if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start||end>source.text.length)return "UNKNOWN";
 return source.observationScopes.find(s=>start>=s.start&&end<=s.end)?.knowledgeClass??"UNKNOWN";
}
export function blockSourceClasses(source:Source,citations:Array<{sourceId:string;start:number;end:number}>):string[]{
 if(!source.observationScopes)return[quoteKnowledgeClass(source,0,source.text.length)];
 const refs=citations.filter(c=>c.sourceId===source.id);
 return refs.length?refs.map(c=>quoteKnowledgeClass(source,c.start,c.end)):["UNKNOWN"];
}
