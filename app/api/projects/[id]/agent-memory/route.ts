import { conversationHttp } from "@/lib/conversation/http";
import { assertProject } from "@/lib/conversation/repository";
import { readEffectiveDigests } from "@/lib/memory/digestService";
import { readClaimCorrections } from "@/lib/memory/claimService";
import { readExperiences } from "@/lib/experience/service";
import { readHypotheses } from "@/lib/memory/hypothesisService";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return conversationHttp(request, async actor => {
    const id = (await context.params).id, member = await assertProject(actor, id);
    const [memory, corrections, experience, hypotheses] = await Promise.all([readEffectiveDigests(actor.userId, id), readClaimCorrections(actor, id),
      member.role === "OWNER" ? readExperiences(actor.userId, id) : Promise.resolve(null), readHypotheses(actor.userId, id)]);
    return { memory, corrections, experience, hypotheses, authority: "PRIVATE_DERIVED_VIEW" };
  });
}
