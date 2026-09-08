import { randomUUID } from "node:crypto";
import { beginRequestResponseSchema } from "@/lib/xiaoyi/contracts";

export function issueXiaoyiRequest() {
  return beginRequestResponseSchema.parse({
    ok: true,
    request_id: randomUUID(),
    issued_at: new Date().toISOString(),
  });
}
