import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { AppError } from "@/lib/api";
import { BUILTIN_SKILLS, type BuiltinSkillId } from "./registry";
/** Only the four shipped methods can load; no scripts, user path or remote imports. */
export function loadBuiltinSkill(id: BuiltinSkillId) {
  if (!Object.hasOwn(BUILTIN_SKILLS, id)) throw new AppError("SKILL_UNAVAILABLE", "该内置能力未登记", 409);
  const root = fs.realpathSync(path.resolve("skills/builtins"));
  const file = fs.realpathSync(path.join(root, id, "SKILL.md"));
  const relative = path.relative(root, file);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new AppError("SKILL_PATH_DENIED", "能力资源越过只读目录", 409);
  const bytes = fs.readFileSync(file);
  if (bytes.length > 12000) throw new AppError("SKILL_RESOURCE_LIMIT", "能力方法超出读取上限", 409);
  const instructions = bytes.toString("utf8").replaceAll("\r\n", "\n");
  if (!instructions.startsWith("---") || !instructions.includes("name: " + id + "\n"))
    throw new AppError("SKILL_INVALID_MANIFEST", "能力元数据不匹配", 409);
  return { id, ...BUILTIN_SKILLS[id], contentHash: createHash("sha256").update(instructions).digest("hex"), instructions };
}
