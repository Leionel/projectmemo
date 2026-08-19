import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../lib/db";

const confirmed = process.argv.includes("--confirm");

async function main() {
  if (!confirmed) {
    console.error("为保护现有本地项目，请使用：npm.cmd run db:demo-reset -- --confirm");
    process.exitCode = 1;
    return;
  }

  const projectCount = await db.project.count();
  await db.project.deleteMany();
  await db.$disconnect();

  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const tsxCli = path.resolve(scriptDirectory, "../node_modules/tsx/dist/cli.mjs");
  const seedScript = path.resolve(scriptDirectory, "../prisma/seed.ts");
  const result = spawnSync(process.execPath, [tsxCli, seedScript], { cwd: path.resolve(scriptDirectory, ".."), stdio: "inherit", env: process.env });

  if (result.status !== 0) {
    throw new Error("演示数据重建失败，请检查上方输出。");
  }
  console.log(`已清空 ${projectCount} 个本地项目，并重新导入唯一的忆程演示项目。`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => db.$disconnect());
