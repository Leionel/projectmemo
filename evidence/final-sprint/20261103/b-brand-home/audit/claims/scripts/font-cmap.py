import json
from pathlib import Path
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[7]
OUT = Path(__file__).resolve().parents[1] / "json" / "font-cmap.json"
FONTS = {
    "pm-serif-brand": "public/fonts/pm-serif-brand.ttf",
    "pm-editorial": "public/fonts/pm-editorial-serif.ttf",
    "manrope": "public/fonts/manrope-variable.ttf",
}
report = {}
for key, rel in FONTS.items():
    f = TTFont(ROOT / rel, lazy=True)
    chars = set()
    for table in f["cmap"].tables:
        for cp in table.cmap.keys():
            chars.add(cp)
    ordered = sorted(chars)
    report[key] = {
        "path": rel,
        "codepoints": ordered,
        "chars": "".join(chr(c) for c in ordered if c >= 32),
        "count": len(ordered),
    }
    print(f"{key}: {len(ordered)} codepoints; sample={report[key]['chars'][:80].encode('unicode_escape').decode('ascii')}")
OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print("wrote", OUT)
