import json
import sys
from pathlib import Path
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[7]
OUT = Path(__file__).resolve().parents[1] / "json" / "font-metadata.json"
FONTS = [
    "public/fonts/pm-serif-brand.ttf",
    "public/fonts/pm-editorial-serif.ttf",
    "public/fonts/manrope-variable.ttf",
]
KEEP = {"0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "13", "14"}
report = {}
for rel in FONTS:
    p = ROOT / rel
    f = TTFont(p, lazy=True)
    name = {}
    for r in f["name"].names:
        try:
            val = r.toUnicode()
        except Exception:
            val = "<decode-error>"
        name.setdefault(str(r.nameID), []).append(val)
    entry = {
        "path": rel,
        "bytes": p.stat().st_size,
        "names": {k: v for k, v in name.items() if k in KEEP},
        "tables": sorted(f.keys()),
        "numGlyphs": f["maxp"].numGlyphs,
    }
    try:
        entry["fvar"] = [[a.axisTag, a.minValue, a.defaultValue, a.maxValue] for a in f["fvar"].axes]
    except KeyError:
        entry["fvar"] = None
    report[rel] = entry
    print(f"=== {rel} bytes={entry['bytes']} glyphs={entry['numGlyphs']} tables={','.join(entry['tables'])}")
    for nid in ("0", "1", "2", "3", "4", "5", "6", "13", "14"):
        if nid in entry["names"]:
            txt = " | ".join(entry["names"][nid])
            ascii_txt = txt.encode("ascii", "backslashreplace").decode("ascii")
            print(f"  nameID {nid}: {ascii_txt[:300]}")
OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print("wrote", OUT)
