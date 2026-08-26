/**
 * Feature flags are intentionally kept as environment switches so a failed
 * optional integration can be disabled without taking down the core loop.
 */
export function isFeatureEnabled(name: string, defaultValue = true): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return defaultValue;
  return !["0", "false", "off", "no"].includes(raw);
}
