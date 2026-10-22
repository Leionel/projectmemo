/** Typographic emphasis only: preserve every character and do not infer verified metrics. */
export function EvidenceText({text}:{text:string}) {
 const parts=text.split(/((?:P\d{2}\s*(?:为|[:=：])?\s*)?\d+(?:\.\d+)?\s*(?:ms|GiB|MiB|GB|MB|%))/g);
 return <>{parts.map((part,index)=>index%2?<code key={index} className="evidence-value">{part}</code>:part)}</>;
}
