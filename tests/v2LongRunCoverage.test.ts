import { expect, test } from "vitest";
import { assessRunCoverage } from "../scripts/fixtures/long-run-coverage";
const start = Date.parse("2026-01-01T00:00:00Z"), hour = 3600000;
const config = { startedAt: new Date(start).toISOString(), durationHours: 72, intervalMs: 60000 };
const sample = (offset: number) => ({ at: new Date(start + offset).toISOString(), outputs: 1, models: 3, status: "WAITING_INPUT" });
test("calendar time after a short abandoned run cannot pass 72h", () => {
  const result = assessRunCoverage(config, [sample(0), sample(60000)], start + 73 * hour);
  expect(result.windowElapsed).toBe(true); expect(result.wallClockComplete).toBe(false); expect(result.observedHours).toBeLessThan(1);
});
test("a middle outage stays visible even after resume", () => {
  const result = assessRunCoverage(config, [sample(0), sample(60000), sample(71 * hour), sample(72 * hour)], start + 72 * hour);
  expect(result.gaps).toHaveLength(2); expect(result.reliabilityGatePassed).toBe(false);
});
test("ordered complete synthetic samples test accounting only", () => {
  const lines = Array.from({ length: 4321 }, (_, i) => sample(i * 60000));
  expect(assessRunCoverage(config, lines, start + 72 * hour)).toMatchObject({ wallClockComplete: true, reliabilityGatePassed: true });
  lines[200].status = "PAUSED";
  expect(assessRunCoverage(config, lines, start + 72 * hour).reliabilityGatePassed).toBe(false);
  expect(assessRunCoverage(config, [sample(60000), sample(0)], start + 72 * hour).validOrder).toBe(false);
});
