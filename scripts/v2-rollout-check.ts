export {};
/** Read-only mixed Worker/API rollout gate. Prints JSON and exits 2 when deployment must stop. */
const { inspectV2Rollout } = await import("../lib/mission/rolloutCheck");
try {
  const report = await inspectV2Rollout();
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.ok ? 0 : 2;
} catch (error) {
  console.error("V2 升级检查失败（未修改任何数据）：" + (error instanceof Error ? error.message : "unknown"));
  process.exitCode = 2;
}
