import { apiError } from "@/lib/api";
import { authenticateUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { user } = await authenticateUser(request);

    const memberships = await db.projectMembership.findMany({
      where: { userId: user.id },
      include: {
        project: {
          select: {
            id: true,
            title: true,
            description: true,
            scenario: true,
            updatedAt: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const projects = memberships.map((m) => m.project);

    return Response.json(
      {
        user: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
        },
        projects,
      },
      {
        status: 200,
        headers: { "cache-control": "no-store" },
      }
    );
  } catch (error) {
    return apiError(error);
  }
}
