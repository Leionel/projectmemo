import { z } from "zod";
import { AppError } from "@/lib/api";
import type { Source } from "./contracts";
const bindings=z.array(z.object({sourceId:z.string().regex(/^(capture|attachment):/),revision:z.string().regex(/^[a-f0-9]{64}$/)}).passthrough()).min(1).max(2);
/** Decision premises guard dispatch; arithmetic provenance is only the actual frozen numeric inputs. */
export function metricInputSources(readSet:Source[],raw:unknown){
 const refs=bindings.parse(raw),result=refs.map(ref=>readSet.find(s=>s.id===ref.sourceId&&s.hash===ref.revision));
 if(result.some(s=>!s))throw new AppError("SANDBOX_INPUT_PROVENANCE_UNKNOWN","核算输入未绑定原版本，不能作为当前核算依据",409);
 return result as Source[];
}
