import { strToU8 } from "fflate";
import { describe, expect, test } from "vitest";
import { extractXlsxText } from "@/lib/intake/xlsx";
import { extractPlainText, plainMaterialFormat } from "@/lib/intake/plainText";
import { parseProjectMaterial } from "@/lib/intake/projectMaterial";

import { xlsxMaterial as makeXlsx } from "../scripts/fixtures/xlsx-material";

describe("XLSX 材料读取", () => {
  test("sheet names, shared strings, inline strings, numbers and booleans become bounded text", async () => {
    const text = await extractXlsxText(makeXlsx());
    expect(text).toContain("工作表：发布记录");
    expect(text).toContain("工作表：指标");
    expect(text).toContain("输入回归\t状态");
    expect(text).toContain("系统分享\t仍待真机验证\t2");
    expect(text).toContain("\t\tTRUE");
    expect(text).toContain("准确率\t0.91");
    expect(text).not.toContain("<t>");
    expect(text.length).toBeLessThan(20_000);
  });

  test("material format recognises xlsx and keeps it out of the plain-text path", () => {
    expect(plainMaterialFormat("发布记录.XLSX")).toBe("XLSX");
    expect(parseProjectMaterial("工作表：发布记录\n输入回归\t状态", "发布记录.xlsx").format).toBe("XLSX_TEXT");
    try { extractPlainText(makeXlsx(), "发布记录.xlsx"); throw new Error("expected a format rejection"); }
    catch (error) { expect(error).toMatchObject({ code: "MATERIAL_FORMAT" }); }
  });

  test("styled empty cells and formulas without cached values do not move or invent data", async () => {
    const worksheet = '<worksheet><sheetData><row r="1"><c r="A1" s="1"/><c r="B1"><v>7</v></c><c r="C1" t="b"><f>TRUE()</f></c><c r="D1"><v>9</v></c></row></sheetData></worksheet>';
    const text = await extractXlsxText(makeXlsx({ "xl/worksheets/sheet1.xml": strToU8(worksheet) }));
    expect(text).toContain("工作表：发布记录\n\t7\t\t9");
  });

  test("rejects a sheet with material beyond the column limit instead of dropping it", async () => {
    const worksheet = '<worksheet><sheetData><row r="1"><c r="A1"><v>7</v></c><c r="AY1"><v>9</v></c></row></sheetData></worksheet>';
    await expect(extractXlsxText(makeXlsx({ "xl/worksheets/sheet1.xml": strToU8(worksheet) }))).rejects.toMatchObject({ code: "XLSX_EXTRACTION_FAILED" });
  });

  test("macro, DOCTYPE and broken archives are rejected without evaluating content", async () => {
    await expect(extractXlsxText(makeXlsx({ "xl/vbaProject.bin": strToU8("macro") }))).rejects.toMatchObject({ code: "XLSX_EXTRACTION_FAILED" });
    const doctype = makeXlsx({ "xl/sharedStrings.xml": strToU8('<!DOCTYPE sst SYSTEM "x"><sst><si><t>回归</t></si></sst>') });
    await expect(extractXlsxText(doctype)).rejects.toMatchObject({ code: "XLSX_EXTRACTION_FAILED" });
    await expect(extractXlsxText(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({ code: "XLSX_EXTRACTION_FAILED" });
  });
});
