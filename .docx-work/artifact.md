# ProjectMemo 官方模板迁移执行契约

## Reference

- Reference: `D:\Projects\hongmen\.docx-work\reference.docx`
- Original retained source: `D:\Projects\hongmen\2026中国高校计算机大赛人工智能创意赛初赛（鸿蒙赛道）作品说明文档模板.docx`
- SHA-256: `194AA0C5740234DEDE313D54E931201556E1B544FFCB7664378D473ED089AA71`
- Reference pages: 6 (Microsoft Word PDF export)
- Sections: 1
- Render evidence: `.docx-work/template-render/reference-word.pdf` and `.docx-work/template-render/pages/page-1.png` through `page-6.png`
- Structural evidence: `.docx-work/template-style-evidence.json` and console audits from `section_audit.py`, `heading_audit.py`, `images_audit.py`, `fields_report.py`

## Page system

- A4 portrait, one section.
- Final required margins override the source's rounded-inch values: top/bottom 2.5 cm, left/right 3.0 cm.
- Header/footer distance: 1.5 cm.
- Single column, no first-page variant.
- Add outside bottom page numbers: odd pages right, even pages left.
- Keep the official template's footer wording and replace its static date with the page field.

## Typography

- Typeface required by the embedded specification: 宋体 for all submission body content.
- Document title: 二号 / 22 pt / bold / centered.
- Author/team line: 三号 / 16 pt / bold / centered.
- Level 1 heading: 三号 / 16 pt / bold.
- Level 2 heading: 四号 / 14 pt / bold.
- Level 3 heading: 小四号 / 12 pt / bold.
- Level 4 heading and body: 五号 / 10.5 pt; level 4 bold.
- Single line spacing; body justified; captions centered at 五号.
- Existing cover, information table, and originality declaration retain their template-derived direct formatting.

## Existing components and preservation

- Pages 1-4 are preserve-first: official cover, contents reminder, team information table, team strengths, originality declaration, and signature spaces.
- Preserve the existing team data already present in the retained template; do not invent or alter identity fields.
- Preserve table structure, merged cells, borders, row flow, and the originality statement.
- Preserve the document theme, numbering package, and all unrelated package parts.
- Replace pages 5-6 (submission instructions) with actual submission content.

## Content flow

1. Official cover and required front matter (preserved).
2. 创意描述（30字以内）.
3. 设计稿（Agent创新）: design premise, user flow, Agent Workflow, proactive intervention loop, and five current Demo screenshots.
4. 作品介绍（800字以内）.
5. Capability-boundary note that mock data is for demonstration and Xiaoyi is only a future interface reservation.

## Slot map

- Editable start locator: body paragraph whose exact text is `作品说明文档提交规范说明`.
- Remove that paragraph and every subsequent body block except the final `sectPr`.
- Append the new submission body after a page break following the originality declaration.
- Insert figures from `docs/competition/assets/` in this order: three diagram PNGs, then 首页.png, 项目页面.png, 项目详细.png, 主动介入.png, 成果呈现.png.
- Use figures at the full 15 cm usable width; keep each image and its caption together and dedicate a new page where required.
- Final output: `D:\Projects\hongmen\忆程ProjectMemo_初赛作品说明文档_迁移稿.docx`, never overwrite the retained template.

## Fidelity gates

- Retained source hash remains unchanged.
- Front four rendered pages remain visually source-derived except page-number footer changes.
- Final document remains A4 portrait, within 20 pages, and contains no clipping, overlaps, blank broken tables, missing images, or instruction-page residue.
- All eight figure references exist and render legibly.
- Microsoft Word export is the render authority because LibreOffice is unavailable in the workspace runtime.
