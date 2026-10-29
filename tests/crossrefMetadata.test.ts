import { expect,test,vi } from "vitest";
import { normalizeDoi,normalizeCrossrefWork,readCrossrefMetadata } from "@/lib/research/crossrefMetadata";
test("DOI normalization never turns arbitrary URLs or encoded paths into destinations",()=>{
 expect(normalizeDoi("https://doi.org/10.1234/ABC")).toBe("10.1234/abc");
 for(const value of ["http://localhost/private","10.1234/a?token=x","10.1234/%2e%2e","https://evil.test/10.1234/a"])expect(()=>normalizeDoi(value)).toThrow();
});
test("Crossref metadata retains partial dates, version relationships and retraction notices without claiming full text",()=>{
 const result=normalizeCrossrefWork({DOI:"10.1234/ABC",title:["<i>Paper</i>"],abstract:"<jats:p>Result</jats:p>",published:{"date-parts":[[2025]]},relation:{"is-preprint-of":[{id:"10.1234/version","id-type":"doi"}]},"update-to":[{DOI:"10.1234/notice",type:"retraction"}]});
 expect(result).toMatchObject({doi:"10.1234/abc",title:"Paper",abstract:"Result",publishedDateParts:[[2025]],fullTextRead:false,readLevel:"ACADEMIC_METADATA",edition:null,projectOutcome:"UNKNOWN",updates:[{type:"retraction"}]});
});
test("metadata transport is inside caller dispatch and validates identity and bounded responses",async()=>{
 let admitted=false;const transport=vi.fn(async(url:URL|RequestInfo,init?:RequestInit)=>{expect(admitted).toBe(true);expect(String(url)).toBe("https://api.crossref.org/works/10.1234%2Fabc");expect(init?.redirect).toBe("error");return new Response(JSON.stringify({message:{DOI:"10.1234/abc"}}));});
 const dispatch=async(_url:string,run:()=>Promise<unknown>)=>{admitted=true;return run();};
 expect(await readCrossrefMetadata("10.1234/abc",dispatch,transport)).toMatchObject({doi:"10.1234/abc"});
 await expect(readCrossrefMetadata("10.1234/abc",async()=>({message:{DOI:"10.1234/other"}}),transport)).rejects.toMatchObject({code:"ACADEMIC_IDENTITY_CHANGED"});
 await expect(readCrossrefMetadata("10.1234/abc",dispatch,async()=>new Response("x".repeat(131073)))).rejects.toMatchObject({code:"ACADEMIC_RESPONSE_LIMIT"});
});
