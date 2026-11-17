import { strToU8, zipSync } from "fflate";

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`;
const WORKBOOK = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="发布记录" sheetId="1" r:id="rId1"/><sheet name="指标" sheetId="2" r:id="rId2"/></sheets></workbook>`;
const RELS = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`;
const SHARED = `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="3" uniqueCount="3"><si><t>输入回归</t></si><si><r><t>系统</t></r><r><t>分享</t></r></si><si><t>仍待真机验证</t></si></sst>`;
const SHEET1 = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>状态</t></is></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" t="s"><v>2</v></c><c r="C2"><v>2</v></c></row><row r="4"><c r="C4" t="b"><v>1</v></c></row></sheetData></worksheet>`;
const SHEET2 = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="str"><v>准确率</v></c><c r="B1"><v>0.91</v></c></row></sheetData></worksheet>`;

/** Minimal but valid XLSX: two sheets, shared/rich/inline strings, number and boolean cells. */
export function xlsxMaterial(extra: Record<string, Uint8Array> = {}) {
  return new Uint8Array(zipSync({
    "[Content_Types].xml": strToU8(CONTENT_TYPES),
    "xl/workbook.xml": strToU8(WORKBOOK),
    "xl/_rels/workbook.xml.rels": strToU8(RELS),
    "xl/sharedStrings.xml": strToU8(SHARED),
    "xl/worksheets/sheet1.xml": strToU8(SHEET1),
    "xl/worksheets/sheet2.xml": strToU8(SHEET2),
    ...extra,
  }));
}
