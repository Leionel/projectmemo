import { strToU8, zipSync } from "fflate";
/** Minimal synthetic Word package shared by parser and browser acceptance. */
export function docxMaterial(paragraph = "客户需求：整理交付说明；验收口径尚未确认。", extra: Record<string, Uint8Array> = {}) {
  const escaped = paragraph.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return zipSync({
    "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    "_rels/.rels": strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    "word/document.xml": strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>' + escaped + '</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>编号</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>状态</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>001</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>分享入口待核对</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'),
    ...extra,
  });
}
