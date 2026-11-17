/**
 * Read-only reproducibility baseline. It compares declared vs locked vs actually installed versions and
 * the DOCX runtime dependency, but does not install or upgrade anything.
 *
 *   npm.cmd exec tsx -- scripts/verify-repro-env.ts --out evidence/v2-first-loop/m4-20261117/env
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const arg = (name: string, fallback = "") => { const index = process.argv.indexOf("--" + name); return index >= 0 ? process.argv[index + 1] ?? fallback : fallback; };
const outDir = path.resolve(arg("out", "evidence/v2-first-loop/m4-20261117/env"));
fs.mkdirSync(outDir, { recursive: true });
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")) as { dependencies: Record<string, string>; devDependencies: Record<string, string>; engines?: unknown };
const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8")) as { lockfileVersion: number; packages: Record<string, { version?: string }> };
const declared = { ...pkg.dependencies, ...pkg.devDependencies };
const lockRoot = lock.packages[""] as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | undefined;
const lockedSpecs = { ...(lockRoot?.dependencies ?? {}), ...(lockRoot?.devDependencies ?? {}) };
const rows = Object.entries(declared).sort(([left], [right]) => left.localeCompare(right)).map(([name, spec]) => {
  const entry = lock.packages["node_modules/" + name];
  let installed: string | null = null;
  try { installed = (JSON.parse(fs.readFileSync(path.join("node_modules", name, "package.json"), "utf8")) as { version: string }).version; } catch { installed = null; }
  return { name, declared: spec, lockRoot: lockedSpecs[name] ?? null, lockedVersion: entry?.version ?? null, installed,
    exactInstalled: installed !== null && installed === spec, mismatch: installed !== null && installed !== spec };
});
let npmVersion = "unavailable";
try { npmVersion = execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["--version"], { encoding: "utf8" }).trim(); } catch { /* diagnostics only */ }
const docxRuntime = ["mammoth", "fflate", "better-sqlite3", "next", "react", "react-dom", "prisma", "@prisma/client"].map(name => rows.find(row => row.name === name)).filter(Boolean);
const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), node: process.version, npm: npmVersion,
  lockfileVersion: lock.lockfileVersion, packageCount: Object.keys(lock.packages).length,
  declaredExact: rows.filter(row => /^\d+\.\d+\.\d+$/.test(row.declared)).length,
  installedMismatches: rows.filter(row => row.mismatch).map(row => ({ name: row.name, declared: row.declared, installed: row.installed })),
  docxRuntime, cleanInstallVerified: false, productionPackVerified: false,
  limitation: "This baseline reads the existing node_modules; it is not a clean-install proof. Run npm ci in an empty temp checkout with network access to verify reproducibility." };
fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ out: path.join(outDir, "report.json"), node: report.node, npm: report.npm, mismatches: report.installedMismatches.length, docxRuntime: docxRuntime.map(row => row?.name + "@" + row?.installed) }, null, 2));
