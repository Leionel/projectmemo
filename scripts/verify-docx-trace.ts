/** Verify the Node Worker and every runtime dependency entry in the production extraction route. */
import fs from "node:fs";
import path from "node:path";
import { createRequire, isBuiltin } from "node:module";

const file = path.join(process.env.NEXT_DIST_DIR ?? ".next", "server/app/api/projects/[id]/material-extract/route.js.nft.json");
const traced = new Set<string>((JSON.parse(fs.readFileSync(file, "utf8")).files as string[]).map(name => path.resolve(path.dirname(file), name)));
const checked = new Set<string>();
function visit(name: string, from: string) {
  if (isBuiltin(name)) return;
  const entry = createRequire(path.resolve(from)).resolve(name);
  if (!traced.has(entry)) throw new Error("UNTRACED " + entry);
  let folder = path.dirname(entry), pkg: string | undefined;
  while (folder !== path.dirname(folder)) {
    const candidate = path.join(folder, "package.json");
    if (fs.existsSync(candidate) && JSON.parse(fs.readFileSync(candidate, "utf8")).name === name) { pkg = candidate; break; }
    folder = path.dirname(folder);
  }
  if (!pkg) throw new Error("PACKAGE_NOT_FOUND " + name);
  if (checked.has(pkg)) return;
  checked.add(pkg);
  const meta = JSON.parse(fs.readFileSync(pkg, "utf8"));
  for (const dep of Object.keys(meta.dependencies ?? {})) visit(dep, pkg);
}
if (!traced.has(path.resolve("lib/intake/docxWorker.cjs"))) throw new Error("WORKER_NOT_TRACED");
visit("mammoth", "package.json"); visit("fflate", "package.json");
console.log("DOCX_TRACE_PASS worker + " + checked.size + " dependency package entries: " +
  [...checked].map(pkg => JSON.parse(fs.readFileSync(pkg, "utf8")).name).join(", "));
