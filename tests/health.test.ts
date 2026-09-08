import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/health/route";

describe("release health response", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("publishes a non-secret release fingerprint and adapter capabilities", async () => {
    vi.stubEnv("PROJECTMEMO_RELEASE", "28809bf-w05");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      service: "projectmemo",
      schema_version: "2.1",
      release: "28809bf-w05",
      capabilities: ["record_memory", "query_memory", "inspect_project", "create_action"],
      workflow_helpers: ["begin_request"],
    });
  });

  it("does not expose adapter secrets", async () => {
    vi.stubEnv("PROJECTMEMO_RELEASE", "release-candidate");
    vi.stubEnv("XIAOYI_ADAPTER_TOKEN", "must-not-appear-in-health");
    vi.stubEnv("XIAOYI_TEST_PROJECT_ID", "must-not-appear-in-health");
    const body = JSON.stringify(await (await GET()).json());
    expect(body).not.toContain("must-not-appear-in-health");
  });
});
