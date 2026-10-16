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
  for (const match of matches) {
    for (const index of match.items)
      layer.textDivs[index]?.classList.add("search-match");
  }
  return layer;
}

export function findPageMatches(content, query) {
  const items = content.items.filter((item) => typeof item.str === "string");
  const spans = [];
  let text = "";
  items.forEach((item, index) => {
    const start = text.length;
    text += item.str.toLocaleLowerCase();
    spans.push({ start, end: text.length, index });
    text += " ";
  });
  const needle = query.toLocaleLowerCase();
  const matches = [];
  if (!needle) return matches;
  for (
    let at = text.indexOf(needle);
    at !== -1;
    at = text.indexOf(needle, at + needle.length)
  ) {
    matches.push({
      items: spans
        .filter((span) => span.start < at + needle.length && span.end > at)
        .map((span) => span.index),
      excerpt: items
        .map((item) => item.str)
        .join(" ")
        .slice(Math.max(0, at - 25), at + needle.length + 65),
    });
  }
  return matches;
}
