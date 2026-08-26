import { NextRequest, NextResponse } from "next/server";
import { searchProjectCards } from "@/lib/memory/hybridSearch";
import { requireProject } from "@/lib/repositories/projects";
import { knowledgeTypes, type KnowledgeTypeValue } from "@/lib/types";
import { apiError } from "@/lib/api";
import { cardSearchInputSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

async function search(projectId: string, query: string, limit: number, type: KnowledgeTypeValue | "all") {
  await requireProject(projectId);
  const results = await searchProjectCards({ projectId, query, limit, typeFilter: type });
  return { query, total: results.length, results };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;

    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q") ?? "";
    const requestedLimit = Number(searchParams.get("limit") ?? "10");
    const requestedType = searchParams.get("type") ?? "all";

    if (requestedType !== "all" && !knowledgeTypes.includes(requestedType as KnowledgeTypeValue)) {
      return NextResponse.json({ error: "Unsupported knowledge card type" }, { status: 400 });
    }

    const limit = Number.isFinite(requestedLimit)
      ? Math.min(50, Math.max(1, Math.trunc(requestedLimit)))
      : 10;
    const type = requestedType as KnowledgeTypeValue | "all";

    await requireProject(projectId);
    if (!query.trim()) {
      return NextResponse.json({ query: "", total: 0, results: [] });
    }
    return NextResponse.json(await search(projectId, query, limit, type));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    const input = cardSearchInputSchema.parse(await request.json());
    return Response.json(await search(projectId, input.query, input.topK, input.type as KnowledgeTypeValue | "all"));
  } catch (error) {
    return apiError(error);
  }
}
