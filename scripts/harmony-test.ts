import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// 统一鸿蒙本地单元测试入口：与 harmony-build.ts 共用 DEVECO_HOME 探测，
// 运行 hvigor test 并打印 Hypium 测试汇总。

const DEFAULT_DEVECO_HOME = process.platform === "win32"
  ? "D:\\Program Files\\Huawei\\DevEco Studio"
  : "/opt/deveco-studio";

const devecoHome = process.env.DEVECO_HOME ?? DEFAULT_DEVECO_HOME;
const hvigorw = path.join(devecoHome, "tools", "hvigor", "bin", "hvigorw.js");
const sdkHome = process.env.DEVECO_SDK_HOME ?? path.join(devecoHome, "sdk");
const javaHome = process.env.JAVA_HOME ?? path.join(devecoHome, "jbr");
const harmonyDirectory = path.resolve(process.cwd(), "harmonyos");

if (!fs.existsSync(hvigorw) || !fs.existsSync(path.join(javaHome, "bin", process.platform === "win32" ? "java.exe" : "java"))) {
  console.error("[harmony-test] 未找到 DevEco Studio 环境，请通过 DEVECO_HOME 指定。");
  process.exit(1);
}

const result = spawnSync(process.execPath, [
  hvigorw,
  "test",
  "--mode", "module",
  "-p", "product=default",
  "--no-daemon",
], {
  cwd: harmonyDirectory,
  env: {
    ...process.env,
    DEVECO_SDK_HOME: sdkHome,
    JAVA_HOME: javaHome,
    PATH: `${path.join(javaHome, "bin")}${path.delimiter}${process.env.PATH ?? ""}`,
  },
  stdio: "inherit",
});

if (result.status !== 0) {
  console.error(`[harmony-test] hvigor test 失败，退出码 ${result.status}`);
  process.exit(result.status ?? 1);
}

const resultFile = path.join(harmonyDirectory, "entry", ".test", "default", "intermediates", "test", "coverage_data", "test_result.txt");
if (fs.existsSync(resultFile)) {
  const summary = fs.readFileSync(resultFile, "utf8").split("\n").find((line) => line.startsWith("Tests run:"));
  console.log(`\n[harmony-test] ${summary ?? "已运行，但未找到汇总行"}`);
} else {
  console.log("[harmony-test] 测试通过，但未找到 test_result.txt 汇总文件。");
}
