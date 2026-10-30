import { createHash } from "node:crypto";
import { z } from "zod";
import { AppError } from "@/lib/api";

export const claimOriginSchema = z.object({
  kind: z.enum(["CAPTURE", "CARD", "MESSAGE", "MISSION_OUTPUT", "ARTIFACT", "EPISODE", "CLAIM"]),
  id: z.string().min(1).max(180), contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  offsetEncoding: z.literal("UTF16_CODE_UNITS"), normalization: z.literal("RAW_V1"),
  start: z.number().int().nonnegative(), end: z.number().int().positive(),
  quote: z.string().min(1).max(6000),
}).strict();
export type ClaimOrigin = z.infer<typeof claimOriginSchema>;
export const claimTextHash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
function splitsSurrogate(text: string, at: number) {
  return at > 0 && at < text.length && /[\uD800-\uDBFF]/.test(text[at - 1]) && /[\uDC00-\uDFFF]/.test(text[at]);
}
/** Input text must be resolved from the authenticated original object by the calling service. */
export function validateClaimLocator(text: string, raw: unknown): ClaimOrigin {
  const origin = claimOriginSchema.parse(raw);
  if (origin.contentHash !== claimTextHash(text)) throw new AppError("CLAIM_SOURCE_CHANGED", "原内容已变化，请重新选择需要纠正的内容", 409);
  if (origin.start >= origin.end || origin.end > text.length || splitsSurrogate(text, origin.start) || splitsSurrogate(text, origin.end) ||
      text.slice(origin.start, origin.end) !== origin.quote)
    throw new AppError("CLAIM_LOCATOR_INVALID", "无法准确定位这句话，请从原内容重新选择", 422);
  return origin;
}
