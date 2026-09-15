import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import {
  DELIVERY_CHANNEL,
  DELIVERY_STATUSES,
  listInterventionDeliveries,
  recordInterventionDelivery,
  type DeliveryStatus,
} from "@/lib/services/interventionDeliveryService";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; interventionId: string }> }) {
  try {
    const { id, interventionId } = await params;
    await authorizeProjectAccess(request, id);
    return Response.json({ deliveries: await listInterventionDeliveries(id, interventionId) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string; interventionId: string }> }) {
  try {
    const { id, interventionId } = await params;
    await authorizeProjectAccess(request, id);
    const body = (await request.json()) as {
      channel?: string;
      deliveryKey?: string;
      status?: string;
      message?: string | null;
    };
    if (!body.deliveryKey || !body.status || !DELIVERY_STATUSES.includes(body.status as DeliveryStatus)) {
      return Response.json({ error: { code: "INVALID_DELIVERY_RECEIPT", message: "通知回执参数无效" } }, { status: 422 });
    }
    const delivery = await recordInterventionDelivery(id, interventionId, {
      channel: body.channel ?? DELIVERY_CHANNEL,
      deliveryKey: body.deliveryKey,
      status: body.status as DeliveryStatus,
      message: body.message,
    });
    return Response.json({ delivery: {
      id: delivery.id,
      interventionId: delivery.interventionId,
      projectId: delivery.projectId,
      channel: delivery.channel,
      deliveryKey: delivery.deliveryKey,
      status: delivery.status,
      message: delivery.message,
      attemptedAt: delivery.attemptedAt.toISOString(),
      publishedAt: delivery.publishedAt?.toISOString() ?? null,
    } });
  } catch (error) {
    return apiError(error);
  }
}
