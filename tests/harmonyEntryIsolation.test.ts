import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("harmonyos/entry/src/main/ets");

describe("Harmony page entry isolation", () => {
  it("does not evaluate another page entry through the startup import graph", () => {
    const seen = new Set<string>();
    function visit(file: string) {
      if (seen.has(file)) return;
      seen.add(file);
      const source = fs.readFileSync(file, "utf8");
      if (file !== path.join(root, "pages/Index.ets")) {
        expect(source, `Startup dependency registers a page: ${file}`).not.toMatch(/@Entry\b/);
      }
      for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        if (!match[1].startsWith(".")) continue;
        visit(path.resolve(path.dirname(file), `${match[1]}.ets`));
      }
    }
    visit(path.join(root, "pages/Index.ets"));
  });

  it("keeps a container root while authentication branches change", () => {
    const source = fs.readFileSync(path.join(root, "pages/Index.ets"), "utf8");
    expect(source).toMatch(/build\(\)\s*\{\s*(Stack|Column|Row)\(\)\s*\{/);
  });
});
