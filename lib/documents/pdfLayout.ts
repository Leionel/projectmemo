type Word = { xMin: number; xMax: number; yMin: number; yMax: number; text: string };
type Line = { words: Word[]; center: number; height: number };

const WORD = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/word>/g;
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

const decode = (value: string) => value.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => ENTITIES[name]);
const displayWidth = (text: string) => [...text].reduce((sum, char) => sum + (char.codePointAt(0)! >= 0x2e80 ? 2 : 1), 0);
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

function linesOf(words: Word[]) {
  const lines: Line[] = [];
  const centerOf = (word: Word) => (word.yMin + word.yMax) / 2;
  for (const word of [...words].sort((a, b) => centerOf(a) - centerOf(b))) {
    const center = centerOf(word), height = word.yMax - word.yMin, line = lines.at(-1);
    if (line && Math.abs(center - line.center) <= Math.min(height, line.height) / 2) {
      line.words.push(word);
      // 行基准取最矮的词：减号这类符号的框比文字高得多。
      if (height < line.height) { line.height = height; line.center = center; }
    } else lines.push({ words: [word], center, height });
  }
  return lines;
}

function renderPage(words: Word[]) {
  if (!words.length) return "";
  const left = Math.min(...words.map(word => word.xMin));
  const cell = Math.max(1, median(words.map(word => word.yMax - word.yMin)) / 2);
  const output: string[] = [];
  let previous: Line | null = null;
  for (const line of linesOf(words)) {
    if (previous && line.center - previous.center > line.height * 2.2) output.push("");
    previous = line;
    let row = "", column = 0, end = left;
    for (const word of [...line.words].sort((a, b) => a.xMin - b.xMin)) {
      const gap = word.xMin - end, target = Math.round((word.xMin - left) / cell);
      // 列间距按位置补齐，空单元格才不会让后面的数字跑到前一列；句内只留一个空格或不留。
      const padding = !row || gap > line.height * 1.5 ? Math.max(row ? 2 : 0, target - column) : gap > line.height * 0.15 ? 1 : 0;
      row += " ".repeat(padding) + word.text;
      column += padding + displayWidth(word.text);
      end = word.xMax;
    }
    output.push(row);
  }
  return output.join("\n");
}

/**
 * 把 `pdftotext -bbox` 的词坐标还原成带版面的文字。
 *
 * `-layout` 按基线分行，公式里基线不同的减号会被挤到另一行（“借出 期末库存”上面孤零零一个 −）。
 * 这里按词框的垂直中心分行，减号回到原位，表格仍按列对齐。
 */
export function pagesFromBbox(xhtml: string) {
  return xhtml.split("<page ").slice(1).map(page => renderPage([...page.matchAll(WORD)].map(match => ({
    xMin: Number(match[1]), yMin: Number(match[2]), xMax: Number(match[3]), yMax: Number(match[4]), text: decode(match[5]),
  }))));
}
