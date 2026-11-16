/**
 * Effect classification for instrumented routing evaluation.
 * It mirrors the Tool.effects contract and the V2 effect classes; it never grants anything.
 */

export type EffectClass = "LOCAL_READ" | "PRIVATE_DRAFT" | "PROPOSAL" | "BUSINESS_WRITE" | "EXTERNAL_READ" | "EXTERNAL_WRITE";

const EXTERNAL_READ = new Set([
  "web_search", "web_fetch", "browser_read", "read_paper_metadata", "search_papers", "read_academic_metadata",
  "read_repository_ci", "read_ci_jobs", "read_ci_log", "inspect_deployment", "read_deployment_logs",
]);
const EXTERNAL_WRITE = new Set(["create_calendar_event", "create_calendar_events", "delete_calendar_event", "publish_deployment", "deploy"]);
const BUSINESS_WRITE = new Set(["create_action", "complete_action", "create_reminder"]);
const PROPOSAL = new Set(["propose_action", "propose_metric_verification", "propose_calendar_event", "propose_calendar_events"]);

export function effectClassOf(tool: string): EffectClass {
  if (tool === "save_mission_output") return "PRIVATE_DRAFT";
  if (PROPOSAL.has(tool) || tool.startsWith("propose_")) return "PROPOSAL";
  if (EXTERNAL_WRITE.has(tool)) return "EXTERNAL_WRITE";
  if (BUSINESS_WRITE.has(tool) || tool.startsWith("write_") || tool.startsWith("create_")) return "BUSINESS_WRITE";
  if (EXTERNAL_READ.has(tool)) return "EXTERNAL_READ";
  return "LOCAL_READ";
}

export function isDeploymentTool(tool: string): boolean {
  return /deployment|deploy/i.test(tool);
}

export function isCalendarWriteTool(tool: string): boolean {
  return /calendar/i.test(tool) && !/^read_|^inspect_|^list_/.test(tool);
}
