"""Build the landing-only editorial face from the OFL Noto Serif SC font.

This uses an installed upstream font, never a proprietary system font.
Only characters in the public page and story are needed; UI text stays sans.
"""
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

root = Path(__file__).resolve().parents[3]
source = Path("C:/Windows/Fonts/NotoSerifSC-VF.ttf")
text = "".join((root / name).read_text(encoding="utf-8") for name in (
    "app/page.tsx", "components/HomeJourney.tsx", "components/SiteHeader.tsx", "components/AuthScreen.tsx"
))
font = instantiateVariableFont(TTFont(source), {"wght": 500}, inplace=True)
options = subset.Options()
options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
subsetter = subset.Subsetter(options=options)
subsetter.populate(text=text)
subsetter.subset(font)
for record in font["name"].names:
    renamed = {1: "PM Editorial", 2: "Medium", 3: "PMEditorial-Medium-20261023",
               4: "PM Editorial Medium", 6: "PMEditorial-Medium"}.get(record.nameID)
    if renamed:
        record.string = renamed.encode(record.getEncoding())
font.save(root / "public/fonts/pm-editorial-serif.ttf")
print("Generated homepage subset; upstream copyright and OFL metadata preserved.")
