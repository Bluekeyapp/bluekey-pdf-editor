const MAX_BYTES = 120 * 1024 * 1024;
const base64 = (bytes) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768)
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary);
};
export function encodeProject(state) {
  const resources = {},
    keys = new Map();
  const document = JSON.parse(
    JSON.stringify(
      {
        ...state,
        thumb: null,
        sources: state.sources.map((source) => ({
          ...source,
          bytes: base64(source.bytes),
        })),
      },
      (key, value) => {
        if (
          ["data", "fontData"].includes(key) &&
          typeof value === "string" &&
          value.startsWith("data:")
        ) {
          if (!keys.has(value)) {
            const id = "asset-" + keys.size;
            keys.set(value, id);
            resources[id] = value;
          }
          return { $asset: keys.get(value) };
        }
        return value;
      },
    ),
  );
  const output = JSON.stringify({
    format: "bluekey-project",
    version: 1,
    resources,
    document,
  });
  if (new TextEncoder().encode(output).length > MAX_BYTES)
    throw Error(
      "Project backup exceeds 120 MB. Export a PDF or reduce its assets.",
    );
  return output;
}
export function decodeProject(text) {
  if (text.length > MAX_BYTES)
    throw Error("Choose a project smaller than 120 MB.");
  const project = JSON.parse(text);
  if (project.format !== "bluekey-project" || project.version !== 1)
    throw Error("Unsupported BlueKey project format.");
  const doc = project.document;
  function restore(value, depth = 0) {
    if (depth > 30) throw Error("Project nesting exceeds the supported limit.");
    if (!value || typeof value !== "object") return value;
    if (Object.hasOwn(value, "$asset")) {
      const asset = project.resources?.[value.$asset];
      if (typeof asset !== "string" || !asset.startsWith("data:"))
        throw Error("Invalid project resource.");
      return asset;
    }
    for (const key of Object.keys(value))
      value[key] = restore(value[key], depth + 1);
    return value;
  }
  restore(doc);
  if (
    !doc ||
    typeof doc.name !== "string" ||
    !Array.isArray(doc.sources) ||
    !doc.sources.length ||
    doc.sources.length > 200 ||
    !Array.isArray(doc.pages) ||
    !doc.pages.length ||
    doc.pages.length > 200
  )
    throw Error("Invalid project document.");
  const ids = new Set();
  let total = 0;
  for (const source of doc.sources) {
    if (
      typeof source.id !== "string" ||
      ids.has(source.id) ||
      typeof source.bytes !== "string" ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(source.bytes)
    )
      throw Error("Invalid project source.");
    ids.add(source.id);
    source.bytes = Uint8Array.from(atob(source.bytes), (c) => c.charCodeAt(0));
    total += source.bytes.length;
    if (source.bytes.length > 40 * 1024 * 1024 || total > 80 * 1024 * 1024)
      throw Error("Project PDF data exceeds the 80 MB workspace limit.");
    source.name =
      typeof source.name === "string" ? source.name : "document.pdf";
    source.values ??= {};
    if (
      typeof source.values !== "object" ||
      Array.isArray(source.values) ||
      Object.values(source.values).some(
        (value) =>
          !["string", "boolean"].includes(typeof value) &&
          !(
            Array.isArray(value) &&
            value.every((item) => typeof item === "string")
          ),
      )
    )
      throw Error("Invalid project form values.");
  }
  for (const page of doc.pages) {
    if (
      !ids.has(page.source) ||
      !Number.isInteger(page.index) ||
      page.index < 0 ||
      ![0, 90, 180, 270].includes(page.rotation) ||
      !Array.isArray(page.marks) ||
      page.marks.length > 10000
    )
      throw Error("Invalid project page.");
    for (const mark of page.marks) {
      if (
        ![
          "text",
          "note",
          "image",
          "highlight",
          "draw",
          "underline",
          "check",
        ].includes(mark.type) ||
        !Array.isArray(mark.basis?.transform) ||
        mark.basis.transform.length !== 6 ||
        !mark.basis.transform.every(Number.isFinite) ||
        ![0, 90, 180, 270].includes(mark.basis.rotation)
      )
        throw Error("Invalid project annotation.");
      if (
        ["text", "note"].includes(mark.type) &&
        (typeof mark.text !== "string" || mark.text.length > 20000)
      )
        throw Error("Invalid project text.");
      if (
        mark.type === "image" &&
        (typeof mark.data !== "string" ||
          !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(mark.data) ||
          mark.data.length > 12 * 1024 * 1024)
      )
        throw Error("Invalid project image.");
      for (const key of ["x", "y", "w", "h", "size"])
        if (mark[key] != null && !Number.isFinite(mark[key]))
          throw Error("Invalid annotation geometry.");
      if (mark.color != null && !/^#[\da-f]{6}$/i.test(mark.color))
        throw Error("Invalid annotation color.");
      if (
        ["draw", "underline"].includes(mark.type) &&
        (!Array.isArray(mark.points) ||
          mark.points.length > 100000 ||
          !mark.points.every(
            (p) =>
              Array.isArray(p) && p.length === 2 && p.every(Number.isFinite),
          ))
      )
        throw Error("Invalid drawing geometry.");
    }
    if (page.textDraft) {
      const draft = page.textDraft;
      if (
        !["native", "recovery"].includes(draft.kind) ||
        typeof draft.id !== "string"
      )
        throw Error("Invalid saved typing buffer.");
      const text = draft.kind === "native" ? draft.buffer?.text : draft.text;
      if (typeof text !== "string" || text.length > 20000)
        throw Error("Invalid saved typing buffer.");
      if (draft.kind === "native") {
        if (
          draft.buffer.type !== "text" ||
          !Number.isInteger(draft.baseRevision) ||
          draft.baseRevision < 0
        )
          throw Error("Invalid saved typing buffer.");
        if (
          draft.buffer.fontData != null &&
          (typeof draft.buffer.fontData !== "string" ||
            draft.buffer.fontData.length > 7 * 1024 * 1024)
        )
          throw Error("Invalid saved font.");
      } else if (
        !draft.region ||
        !["x", "y", "w", "h"].every((key) =>
          Number.isFinite(draft.region[key]),
        ) ||
        draft.region.x < 0 ||
        draft.region.y < 0 ||
        draft.region.w <= 0 ||
        draft.region.h <= 0 ||
        draft.region.x + draft.region.w > 1.01 ||
        draft.region.y + draft.region.h > 1.01
      )
        throw Error("Invalid saved recognition area.");
    }
    // Bound user-editable resources before parsing or inserting them into controls.
    const edits = page.contentEdits || {};
    if (
      typeof edits !== "object" ||
      Array.isArray(edits) ||
      Object.keys(edits).length > 10000
    )
      throw Error("Invalid project content edits.");
    for (const edit of Object.values(edits)) {
      if (
        !edit ||
        !["text", "image"].includes(edit.type) ||
        (edit.text != null &&
          (typeof edit.text !== "string" || edit.text.length > 20000))
      )
        throw Error("Invalid project content edit.");
      if (
        edit.fontData != null &&
        (typeof edit.fontData !== "string" ||
          edit.fontData.length > 7 * 1024 * 1024 ||
          !/^data:.*;base64,[A-Za-z0-9+/]+=*$/.test(edit.fontData))
      )
        throw Error("Invalid project font.");
      if (
        edit.data != null &&
        (typeof edit.data !== "string" ||
          edit.data.length > 12 * 1024 * 1024 ||
          !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(edit.data))
      )
        throw Error("Invalid project image.");
    }
  }
  doc.thumb = null;
  return doc;
}
