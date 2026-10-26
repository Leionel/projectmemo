import { conversationHttp } from "@/lib/conversation/http";
import { isFeatureEnabled } from "@/lib/config/features";
export const runtime = "nodejs";
export async function GET(request: Request) { return conversationHttp(request, async () => ({ schemaVersion: 1, enabled: isFeatureEnabled("FOCUS_AGENT_ENABLED", false), followAvailable: isFeatureEnabled("FOCUS_AGENT_FOLLOW_ENABLED", false), intents: ["ANSWER", "CLARIFY", "PROPOSE_ACTION", "OPEN_MISSION", "INSPECT", "PREVIEW_INPUT", "PREVIEW_APPROVAL", "PREVIEW_CONTINUATION", "PREVIEW_SCENARIO", "REPORT_RESULT", "ADOPT_ARTIFACT"], cloudAvailable: process.env.LLM_MODE === "openai-compatible" })); }
