import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("Harmony model settings permissions", () => {
  it("keeps settings read-only until the backend explicitly marks them editable", () => {
    const source = fs.readFileSync("harmonyos/entry/src/main/ets/pages/Index.ets", "utf8");

    expect(source).toContain("@State settingsEditable: boolean = false;");
    expect(source).toContain("this.settingsEditable = res.editable;");
    expect(source).toContain("if (!this.settingsEditable) {");
    expect(source).toContain(".enabled(this.settingsEditable && !this.isSavingSettings)");
    expect(source).toContain("生产环境只读");
  });
});
