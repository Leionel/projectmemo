import { NextRequest, NextResponse } from "next/server";
import { searchProjectCards } from "@/lib/memory/hybridSearch";
import { requireProject } from "@/lib/repositories/projects";
import { knowledgeTypes, type KnowledgeTypeValue } from "@/lib/types";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    await requireProject(projectId);

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

    if (!query.trim()) {
      return NextResponse.json({ query: "", total: 0, results: [] });
    }

    const results = await searchProjectCards({
      projectId,
      query,
      limit,
      typeFilter: type,
    });

    return NextResponse.json({
      query,
      total: results.length,
      results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Search failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
