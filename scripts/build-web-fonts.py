"""重新生成 public/fonts 下的 Web 字体子集。

依赖：fonttools、brotli（放在临时 venv 里即可，不进项目依赖）。
用法：python scripts/build-web-fonts.py <NotoSerifSC-VF.ttf 路径>

- pm-brand.woff2：字标“忆程 ProjectMemo”，字重 600。
- pm-editorial.woff2：官网标题，字重 500，字符集来自官网与登录页源码。
- pm-serif-core.woff2 / pm-serif-ext.woff2：工作台标题，字重 600。
  core 取项目文案中最常用的汉字，ext 补齐 GB2312 一级字；用户标题超出范围时回退系统宋体。
"""
import collections
import glob
import pathlib
import re
import string
import sys

from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "fonts"
CJK = re.compile(r"[一-鿿]")
LATIN = set(string.ascii_letters + string.digits + string.punctuation + " ")
CJK_PUNCT = set("，。、；：？！“”‘’（）《》【】—…·")


def read_chars(patterns):
    text = ""
    for pattern in patterns:
        for name in glob.glob(str(ROOT / pattern), recursive=True):
            text += pathlib.Path(name).read_text(encoding="utf8", errors="ignore")
    return text


def gb2312_level1():
    chars = set()
    for high in range(0xB0, 0xD8):
        for low in range(0xA1, 0xFF):
            if high == 0xD7 and low > 0xF9:
                continue
            chars.add(bytes([high, low]).decode("gb2312"))
    return chars


def build(source, weight, chars, name, family):
    options = Options()
    options.layout_features = ["*"]
    options.flavor = "woff2"
    options.notdef_outline = True
    options.name_IDs = [1, 2, 4, 6]
    font = TTFont(source)
    subsetter = Subsetter(options)
    subsetter.populate(unicodes=[ord(c) for c in chars])
    subsetter.subset(font)
    font = instancer.instantiateVariableFont(font, {"wght": weight})
    for record in font["name"].names:
        if record.nameID in (1, 4):
            record.string = family
        elif record.nameID == 6:
            record.string = family.replace(" ", "")
    font.flavor = "woff2"
    path = OUT / name
    font.save(path)
    print(f"{name}: {len(chars)} chars, {path.stat().st_size / 1024:.1f} KB")


def main(source):
    build(source, 600, set("忆程 ProjectMemo"), "pm-brand.woff2", "PM Brand")

    editorial = read_chars(["app/page.tsx", "components/HomeJourney.tsx", "components/home/*", "components/AuthScreen.tsx", "app/not-found.tsx", "app/error.tsx"])
    build(source, 500, set(CJK.findall(editorial)) | LATIN | CJK_PUNCT, "pm-editorial.woff2", "PM Editorial")

    corpus = read_chars(["app/**/*.tsx", "components/**/*.tsx", "lib/**/*.ts", "prisma/seed.ts", "docs/**/*.md", "*.md"])
    ranked = [c for c, _ in collections.Counter(CJK.findall(corpus)).most_common()]
    level1 = gb2312_level1()
    core = ranked[:1400]
    build(source, 600, set(core) | LATIN | CJK_PUNCT, "pm-serif-core.woff2", "PM Serif")
    build(source, 600, (level1 | set(ranked[1400:3200])) - set(core), "pm-serif-ext.woff2", "PM Serif Ext")


if __name__ == "__main__":
    main(sys.argv[1])
