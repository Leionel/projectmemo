import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { confirmMeetingChanges } from "@/lib/services/meetingStateDiffService";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await authorizeProjectAccess(request, id);
    const body = (await request.json()) as {
      proposalId?: string;
      sourceTextHash?: string;
      proposalVersion?: number;
      selectedChangeIds?: string[];
    };
    return Response.json(await confirmMeetingChanges(id, {
      proposalId: body.proposalId ?? "",
      sourceTextHash: body.sourceTextHash ?? "",
      proposalVersion: body.proposalVersion ?? 0,
      selectedChangeIds: body.selectedChangeIds ?? [],
    }));
  } catch (error) {
    return apiError(error);
  }
}
