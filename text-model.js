const rect = (q) => ({
  left: Math.min(...q.map((p) => p[0])),
  right: Math.max(...q.map((p) => p[0])),
  bottom: Math.min(...q.map((p) => p[1])),
  top: Math.max(...q.map((p) => p[1])),
});
export function overlaps(a, b, pad = 0) {
  return (
    a.left < b.right - pad &&
    a.right > b.left + pad &&
    a.bottom < b.top - pad &&
    a.top > b.bottom + pad
  );
}
export function textBlocks(items) {
  const blocks = [];
  let current;
  const local = (item, base) => {
    const [a, b, c, d, e, f] = base,
      det = a * d - b * c;
    if (Math.abs(det) < 1e-10) return null;
    const point = ([x, y]) => [
      (d * (x - e) - c * (y - f)) / det,
      (-b * (x - e) + a * (y - f)) / det,
    ];
    return {
      box: rect(item.quad.map(point)),
      baseline: point([item.matrix[4], item.matrix[5]]),
    };
  };
  for (const item of items) {
    if (item.type !== "text" || !item.editable || !item.text.trim()) {
      current = null;
      continue;
    }
    const prev = current?.items.at(-1),
      r = prev && local(item, current.items[0].matrix),
      pr = prev && local(prev, current.items[0].matrix);
    const same =
      prev &&
      r &&
      pr &&
      prev.root === item.root &&
      JSON.stringify(prev.path) === JSON.stringify(item.path) &&
      prev.label === item.label &&
      prev.color === item.color &&
      prev.size === item.size &&
      item.matrix
        .slice(0, 4)
        .every((value, index) => Math.abs(value - prev.matrix[index]) < 0.001);
    const inline =
      same &&
      Math.abs(r.baseline[1] - pr.baseline[1]) < item.size * 0.15 &&
      r.box.left - pr.box.right >= -1 &&
      r.box.left - pr.box.right < item.size * 0.9;
    const newline =
      same &&
      pr.baseline[1] - r.baseline[1] > item.size * 0.8 &&
      pr.baseline[1] - r.baseline[1] < item.size * 1.85 &&
      Math.abs(r.box.left - current.localBox.left) < item.size * 0.6;
    if (inline || newline) {
      current.text +=
        (newline
          ? "\n"
          : /\s$/.test(current.text) ||
              /^\s/.test(item.text) ||
              r.box.left - pr.box.right < item.size * 0.12
            ? ""
            : " ") + item.text;
      current.items.push(item);
      const q = rect(item.quad);
      current.box = {
        left: Math.min(current.box.left, q.left),
        right: Math.max(current.box.right, q.right),
        bottom: Math.min(current.box.bottom, q.bottom),
        top: Math.max(current.box.top, q.top),
      };
      current.localBox = {
        left: Math.min(current.localBox.left, r.box.left),
        right: Math.max(current.localBox.right, r.box.right),
        bottom: Math.min(current.localBox.bottom, r.box.bottom),
        top: Math.max(current.localBox.top, r.box.top),
      };
      if (newline)
        current.lineHeight = (pr.baseline[1] - r.baseline[1]) / item.size;
      current.width = current.localBox.right - current.localBox.left;
    } else {
      const first = local(item, item.matrix);
      current = {
        id: item.id,
        items: [item],
        text: item.text,
        box: rect(item.quad),
        localBox: first?.box,
        width: Math.abs(item.advance),
        lineHeight: 1.2,
      };
      blocks.push(current);
    }
  }
  return blocks.filter((block) => block.items.length > 1);
}
export function collisionItems(item, layout, items, excluded = [], edit = {}) {
  const [a, b, c, d, e, f] = item.matrix.map(
      (value, index) =>
        value +
        (index === 4
          ? Number(edit.dx || 0)
          : index === 5
            ? Number(edit.dy || 0)
            : 0),
    ),
    point = (x, y) => [a * x + c * y + e, b * x + d * y + f];
  const q = [
    [
      0,
      item.rise -
        layout.size * 0.22 -
        (layout.lines.length - 1) * layout.size * layout.lineHeight,
    ],
    [
      layout.width,
      item.rise -
        layout.size * 0.22 -
        (layout.lines.length - 1) * layout.size * layout.lineHeight,
    ],
    [layout.width, item.rise + layout.size * 0.93],
    [0, item.rise + layout.size * 0.93],
  ].map((p) => point(...p));
  const box = rect(q),
    original = rect(item.quad);
  return items.filter(
    (i) =>
      i.id !== item.id &&
      !excluded.includes(i.id) &&
      (i.type === "text"
        ? i.text.trim()
        : i.type === "image" && !overlaps(original, rect(i.quad), 1)) &&
      overlaps(box, rect(i.quad), 1),
  );
}
export function analyzeRoutes(items, recovered = 0) {
  const text = items.filter((i) => i.type === "text");
  return {
    direct: text.filter((i) => i.editable).length,
    rebuild: text.filter((i) => !i.editable).length + recovered,
    images: items.filter((i) => i.type === "image").length,
    scan: !text.some((i) => i.text.trim()),
  };
}
