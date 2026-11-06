/** 拼音文字和数字之间的空格是词边界，不能去掉；中文前后的空格多半是版面造成的。 */
const WORD_CHAR = /^(?![\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}])[\p{L}\p{N}]$/u;

function fold(char: string) {
  return char.normalize("NFKC")
    .replace(/[­​-‍⁠﻿]/g, "")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“-‟「-』]/g, '"')
    .replace(/[‐-―−]/g, "-");
}

/**
 * 只抹掉 PDF 抽取和模型转写带来的排版差异：断行、版面空格、全半角、
 * 兼容字形（⽅→方）、弯引号与各式横线。字序和用字的差异全部保留，改写过的句子仍然对不上。
 * starts/ends 把规范形式的每个位置映射回原文。
 */
function canonicalize(text: string) {
  const units: string[] = [], starts: number[] = [], ends: number[] = [];
  let pendingSpace = false;
  for (let at = 0; at < text.length;) {
    const char = String.fromCodePoint(text.codePointAt(at)!), next = at + char.length, folded = fold(char);
    for (let i = 0; i < folded.length; i++) {
      const unit = folded[i];
      if (/\s/.test(unit)) { pendingSpace = units.length > 0; continue; }
      if (pendingSpace && WORD_CHAR.test(units[units.length - 1]) && WORD_CHAR.test(unit)) { units.push(" "); starts.push(at); ends.push(at); }
      pendingSpace = false;
      units.push(unit); starts.push(at); ends.push(next);
    }
    at = next;
  }
  return { key: units.join(""), starts, ends };
}

export function quoteKey(text: string) { return canonicalize(text).key; }

/**
 * 在原文里定位引文，返回原文中的实际片段；找不到返回 null。
 * 下游要按偏移或逐字复核时用 `text`，它一定是原文的连续子串。
 */
export function locateQuote(text: string, quote: string) {
  if (!quote.trim()) return null;
  const direct = text.indexOf(quote);
  if (direct >= 0) return { start: direct, end: direct + quote.length, text: quote, unique: text.indexOf(quote, direct + 1) < 0 };
  const source = canonicalize(text), key = quoteKey(quote);
  const at = key ? source.key.indexOf(key) : -1;
  if (at < 0) return null;
  const start = source.starts[at], end = source.ends[at + key.length - 1];
  return { start, end, text: text.slice(start, end), unique: source.key.indexOf(key, at + 1) < 0 };
}
