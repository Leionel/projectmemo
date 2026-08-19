import { apiError } from "@/lib/api";
import { listArtifacts } from "@/lib/repositories/artifacts";
import { requireProject } from "@/lib/repositories/projects";
import { generateArtifact, saveEditedArtifactVersion } from "@/lib/services/artifactService";
import { artifactCreateSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    await requireProject(id);
    return Response.json({ artifacts: await listArtifacts(id) });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const input = artifactCreateSchema.parse(await request.json());
    const artifact = input.content === undefined
      ? await generateArtifact(id, input.artifactType)
      : await saveEditedArtifactVersion(id, input.artifactType, input.content);
    return Response.json({ artifact }, { status: 201 });
  } catch (error) { return apiError(error); }
}
