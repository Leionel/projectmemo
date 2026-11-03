import fs from "node:fs";
import path from "node:path";
const root = "evidence/final-c/20261103";
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const keep = new Set(manifest.screenshots.map((p) => path.resolve(p)));
const historyDir = path.join(root, "screenshots", "history");
fs.mkdirSync(historyDir, { recursive: true });
const moved = [];
for (const group of ["normal", "abnormal"]) {
  const dir = path.join(root, "screenshots", group);
  if (!fs.existsSync(dir)) continue;
  for (const name of fs.readdirSync(dir)) {
    const full = path.resolve(dir, name);
    if (fs.statSync(full).isFile() && !keep.has(full)) {
      const target = path.join(historyDir, group + "-" + name);
      fs.renameSync(full, target);
      moved.push(path.relative(root, target));
    }
  }
}
console.log(JSON.stringify({ moved: moved.length, files: moved.slice(0, 10) }, null, 1));
const remaining = [];
for (const group of ["normal", "abnormal"]) {
  const dir = path.join(root, "screenshots", group);
  remaining.push(...fs.readdirSync(dir).map((n) => group + "/" + n));
}
console.log(JSON.stringify({ finalScreenshots: remaining.length, history: fs.readdirSync(historyDir).length }, null, 1));
