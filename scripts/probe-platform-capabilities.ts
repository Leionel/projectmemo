// 只读平台能力探针：系统分享与 Intents 的真实条件。
// 运行：node --import tsx scripts/probe-platform-capabilities.ts
//
// 只读取本仓库的模块声明、已安装 SDK 的 API 声明和本机 HDC 目标；
// 不安装应用、不注册能力、不联网、不改任何文件。输出 JSON 供证据归档。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const moduleJson = path.join(root, "harmonyos", "entry", "src", "main", "module.json5");
const buildProfile = path.join(root, "harmonyos", "build-profile.json5");
const devecoHome = process.env.DEVECO_HOME ?? "D:\\Program Files\\Huawei\\DevEco Studio";
const sdkHome = process.env.DEVECO_SDK_HOME ?? path.join(devecoHome, "sdk");
const defaultSdk = path.join(sdkHome, "default");
const hdcExe = path.join(defaultSdk, "openharmony", "toolchains", "hdc.exe");

function read(file: string): string {
  try { return fs.readFileSync(file, "utf8"); } catch { return ""; }
}

const moduleText = read(moduleJson);
const extensionTypes = [...moduleText.matchAll(/"type"\s*:\s*"([a-zA-Z]+)"/g)].map(match => match[1]);
const hasShareExtension = /ShareExtensionAbility/.test(moduleText) || extensionTypes.includes("share");
const moduleSharesSkill = /ohos\.want\.action\.sendData|system\.share/i.test(moduleText);
const intentRegistration = /insightIntent|IntentExecutor|intentName|ohos\.insight/i.test(moduleText);
const signingConfigured = /signingConfigs\s*:\s*\[[\s\S]*?\{/.test(read(buildProfile));

function sdkDeclaration(relative: string): { present: boolean; path: string } {
  const file = path.join(defaultSdk, "openharmony", "ets", relative);
  return { present: fs.existsSync(file), path: file };
}
const shareSdk = sdkDeclaration(path.join("api", "@ohos.app.ability.ShareExtensionAbility.d.ts"));
const insightSdk = sdkDeclaration(path.join("api", "@ohos.app.ability.insightIntent.d.ts"));
const toolchainVersion = (() => {
  try { return JSON.parse(read(path.join(defaultSdk, "openharmony", "toolchains", "oh-uni-package.json"))) as { apiVersion?: string; version?: string }; }
  catch { return {}; }
})();

function hdc(args: string[], timeout = 8000) {
  if (!fs.existsSync(hdcExe)) return { available: false, stdout: "", stderr: "", status: null as number | null };
  const result = spawnSync(hdcExe, args, { encoding: "utf8", timeout, windowsHide: true });
  return { available: true, stdout: (result.stdout ?? "").trim(), stderr: (result.stderr ?? "").trim(), status: result.status };
}

const targetsRaw = hdc(["list", "targets"]);
const targets = targetsRaw.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
const devices = targets.map(target => {
  const model = hdc(["-t", target, "shell", "param", "get", "const.product.model"]);
  const api = hdc(["-t", target, "shell", "param", "get", "const.ohos.apiversion"]);
  return { target, model: model.stdout, apiVersion: api.stdout, shellReachable: hdc(["-t", target, "shell", "echo", "probe-ok"]).stdout === "probe-ok" };
});

const result = {
  schemaVersion: 1,
  kind: "platform-capability-probe",
  readOnly: true,
  generatedAt: new Date().toISOString(),
  sdk: { devecoHome, sdkHome, apiVersion: toolchainVersion.apiVersion ?? null, version: toolchainVersion.version ?? null,
    shareExtensionDeclaration: shareSdk.present, insightIntentDeclaration: insightSdk.present },
  module: { file: path.relative(root, moduleJson), extensionTypes, shareExtensionRegistered: hasShareExtension,
    shareSkillRegistered: moduleSharesSkill, intentsRegistered: intentRegistration },
  signing: { signingConfiguredInBuildProfile: signingConfigured,
    note: signingConfigured ? "本树声明了签名配置" : "本树没有签名配置；不得复制主目录私钥" },
  devices: { hdcAvailable: targetsRaw.available, targets, probed: devices },
  verdict: {
    share: {
      sdkAvailable: shareSdk.present, registered: hasShareExtension || moduleSharesSkill,
      deviceVerified: false,
      status: shareSdk.present ? (hasShareExtension || moduleSharesSkill ? "REGISTERED_NOT_DEVICE_VERIFIED" : "SDK_AVAILABLE_NOT_REGISTERED") : "SDK_UNAVAILABLE",
    },
    intents: {
      sdkAvailable: insightSdk.present, registered: intentRegistration,
      deviceVerified: false,
      status: insightSdk.present ? (intentRegistration ? "REGISTERED_NOT_DEVICE_VERIFIED" : "SDK_AVAILABLE_NOT_REGISTERED") : "SDK_UNAVAILABLE",
    },
  },
};
console.log(JSON.stringify(result, null, 2));

