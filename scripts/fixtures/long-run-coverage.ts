type Sample = Record<string, number | string | boolean>;
/** Pure evidence accounting; injected times in unit tests are never long-run acceptance evidence. */
export function assessRunCoverage(config: { startedAt: string; durationHours: number; intervalMs: number }, lines: Sample[], now = Date.now()) {
  const start = Date.parse(config.startedAt), requiredMs = config.durationHours * 3600000;
  const end = Math.min(now, start + requiredMs), threshold = Math.max(120000, config.intervalMs * 2.5);
  const stamps = lines.map(line => Date.parse(String(line.at)));
  const validOrder = stamps.every((stamp, i) => Number.isFinite(stamp) && stamp >= start && stamp <= now && (i === 0 || stamp > stamps[i - 1]));
  const gaps: Array<{ from: string; to: string; seconds: number }> = [];
  let observedMs = 0;
  for (let i = 1; i < stamps.length; i++) {
    const delta = stamps[i] - stamps[i - 1];
    if (delta > threshold) gaps.push({ from: new Date(stamps[i - 1]).toISOString(), to: new Date(stamps[i]).toISOString(), seconds: delta / 1000 });
    else if (delta > 0) observedMs += delta;
  }
  const leadingMs = stamps.length ? stamps[0] - start : end - start;
  const tailMs = stamps.length ? Math.max(0, end - stamps.at(-1)!) : end - start;
  const elapsedHours = Math.max(0, now - start) / 3600000;
  const windowElapsed = requiredMs > 0 && elapsedHours >= config.durationHours;
  const evidenceComplete = validOrder && stamps.length >= 2 && leadingMs <= threshold && tailMs <= threshold && gaps.length === 0 &&
    observedMs >= Math.max(0, requiredMs - 2 * config.intervalMs);
  const progress = lines.some(line => Number(line.outputs) > 0) && lines.some(line => Number(line.models) > 0);
  const terminalFailure = lines.some(line => ["FAILED", "CANCELLED", "PAUSED"].includes(String(line.status)));
  return { elapsedHours, windowElapsed, observedHours: observedMs / 3600000, validOrder, evidenceComplete,
    wallClockComplete: windowElapsed && evidenceComplete, progressObserved: progress, terminalFailure,
    reliabilityGatePassed: windowElapsed && evidenceComplete && progress && !terminalFailure,
    gaps, leadingGapSeconds: Math.max(0, leadingMs) / 1000, trailingGapSeconds: tailMs / 1000,
    note: "Observed intervals are bounded by successive heartbeats; elapsed calendar time alone cannot pass this gate." };
}
