// Keep grapheme clusters intact, including combining marks and CJK characters.
export function wrapText(text, width, measure) {
  const graphemes = (value) =>
    typeof Intl.Segmenter === "function"
      ? [
          ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
            value,
          ),
        ].map((part) => part.segment)
      : Array.from(value);
  const lines = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/(\s+)/u)) {
      if (!word) continue;
      if (line && measure(line + word) > width) {
        lines.push(line.trimEnd());
        line = "";
      }
      if (measure(word) > width && !/^\s+$/u.test(word)) {
        for (const cluster of graphemes(word)) {
          if (line && measure(line + cluster) > width) {
            lines.push(line);
            line = "";
          }
          line += cluster;
        }
      } else line += line ? word : word.trimStart();
    }
    lines.push(line);
  }
  return lines;
}

export function textSelection(text, index, scope = "word") {
  index = Math.max(0, Math.min(text.length, index));
  if (scope === "paragraph") return { start: 0, end: text.length };
  const granularity = scope === "sentence" ? "sentence" : "word";
  if (typeof Intl.Segmenter === "function") {
    const parts = [
      ...new Intl.Segmenter(undefined, { granularity }).segment(text),
    ];
    const part =
      parts.find(
        (part) =>
          part.index <= index && part.index + part.segment.length > index,
      ) || parts.at(-1);
    if (part)
      return { start: part.index, end: part.index + part.segment.length };
  }
  return { start: 0, end: text.length };
}
