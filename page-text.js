// One selectable text layer, shared by copy/paste and search highlighting.
export async function renderPageText(
  pdfjs,
  page,
  viewport,
  container,
  matches = [],
) {
  container.replaceChildren();
  container.style.setProperty("--total-scale-factor", viewport.scale);
  container.style.setProperty("--scale-factor", viewport.scale);
  const content = await page.getTextContent();
  const layer = new pdfjs.TextLayer({
    textContentSource: content,
    container,
    viewport,
  });
  await layer.render();
  const ranges = new Map();
  for (const match of matches)
    for (const range of match.ranges || []) {
      if (!ranges.has(range.index)) ranges.set(range.index, []);
      ranges.get(range.index).push({ ...range, current: match.current });
    }
  for (const [index, highlights] of ranges) {
    const div = layer.textDivs[index];
    if (!div) continue;
    const text = div.textContent,
      nodes = [];
    let offset = 0;
    for (const range of highlights.sort((a, b) => a.start - b.start)) {
      nodes.push(document.createTextNode(text.slice(offset, range.start)));
      const mark = document.createElement("mark");
      mark.className = "search-match" + (range.current ? " current" : "");
      mark.textContent = text.slice(range.start, range.end);
      nodes.push(mark);
      offset = range.end;
    }
    nodes.push(document.createTextNode(text.slice(offset)));
    div.replaceChildren(...nodes);
  }
  return layer;
}

export function findPageMatches(content, query) {
  const items = content.items.filter((item) => typeof item.str === "string");
  const spans = [];
  let text = "";
  items.forEach((item, index) => {
    const start = text.length;
    text += item.str;
    spans.push({ start, end: text.length, index });
    text += " ";
  });
  // Keep offsets in the original UTF-16 text even when case folding expands a
  // character (for example capital dotted I), so highlights never shift.
  let folded = "",
    rawOffset = 0;
  const starts = [],
    ends = [];
  for (const character of text) {
    const lower = character.toLowerCase();
    for (let i = 0; i < lower.length; i++) {
      starts.push(rawOffset);
      ends.push(rawOffset + character.length);
    }
    folded += lower;
    rawOffset += character.length;
  }
  const needle = query.toLowerCase();
  const matches = [];
  if (!needle) return matches;
  for (
    let at = folded.indexOf(needle);
    at !== -1;
    at = folded.indexOf(needle, at + needle.length)
  ) {
    const start = starts[at],
      end = ends[at + needle.length - 1],
      excerptStart = Math.max(0, start - 25),
      excerptEnd = Math.min(text.length, end + 65);
    const ranges = spans
      .filter((span) => span.start < end && span.end > start)
      .map((span) => ({
        index: span.index,
        start: Math.max(start, span.start) - span.start,
        end: Math.min(end, span.end) - span.start,
      }));
    matches.push({
      items: ranges.map((range) => range.index),
      ranges,
      excerpt: text.slice(excerptStart, excerptEnd),
      before: (excerptStart ? "…" : "") + text.slice(excerptStart, start),
      hit: text.slice(start, end),
      after:
        text.slice(end, excerptEnd).trimEnd() +
        (excerptEnd < text.length ? "…" : ""),
    });
  }
  return matches;
}
