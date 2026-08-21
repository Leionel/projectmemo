import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// 统一鸿蒙构建入口：设置 DEVECO_SDK_HOME 后调用 hvigor assembleHap，
// 成功时输出 HAP 路径与 SHA-256，作为验收凭证。
// DevEco Studio 安装位置可用环境变量 DEVECO_HOME 覆盖。

const DEFAULT_DEVECO_HOME = process.platform === "win32"
  ? "D:\\Program Files\\Huawei\\DevEco Studio"
  : "/opt/deveco-studio";

const devecoHome = process.env.DEVECO_HOME ?? DEFAULT_DEVECO_HOME;
const hvigorw = path.join(devecoHome, "tools", "hvigor", "bin", "hvigorw.js");
const sdkHome = process.env.DEVECO_SDK_HOME ?? path.join(devecoHome, "sdk");
const javaHome = process.env.JAVA_HOME ?? path.join(devecoHome, "jbr");
const harmonyDirectory = path.resolve(process.cwd(), "harmonyos");

if (!fs.existsSync(hvigorw)) {
  console.error(`[harmony-build] 未找到 hvigor：${hvigorw}`);
  console.error("[harmony-build] 请安装 DevEco Studio 或通过 DEVECO_HOME 指定安装目录。");
  process.exit(1);
}
if (!fs.existsSync(path.join(javaHome, "bin", process.platform === "win32" ? "java.exe" : "java"))) {
  console.error(`[harmony-build] 未找到 JAVA_HOME：${javaHome}`);
  console.error("[harmony-build] hvigor 打包阶段需要 JDK（DevEco 自带 jbr 可用），或通过 JAVA_HOME 指定。");
  process.exit(1);
}

console.log(`[harmony-build] DEVECO_SDK_HOME=${sdkHome}`);
console.log(`[harmony-build] JAVA_HOME=${javaHome}`);
const result = spawnSync(process.execPath, [
  hvigorw,
  "assembleHap",
  "--mode", "module",
  "-p", "product=default",
  "-p", "buildMode=debug",
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

if (result.error) throw result.error;
if (result.status !== 0) {
  console.error(`[harmony-build] hvigor assembleHap 失败，退出码 ${result.status}`);
  process.exit(result.status ?? 1);
}

const candidates = [
  path.join(harmonyDirectory, "entry", "build", "default", "outputs", "default", "entry-default-unsigned.hap"),
  path.join(harmonyDirectory, "entry", "build", "default", "outputs", "default", "entry-default-signed.hap"),
];
const hapPath = candidates.find((candidate) => fs.existsSync(candidate));
if (!hapPath) {
  console.error("[harmony-build] 构建成功但未找到 HAP 产物，请检查 entry/build/default/outputs。");
  process.exit(1);
}

const sha256 = crypto.createHash("sha256").update(fs.readFileSync(hapPath)).digest("hex");
const stats = fs.statSync(hapPath);
console.log(`\n[harmony-build] HAP: ${path.relative(process.cwd(), hapPath)}`);
console.log(`[harmony-build] size: ${stats.size} bytes`);
console.log(`[harmony-build] sha256: ${sha256}`);
