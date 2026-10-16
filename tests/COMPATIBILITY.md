# Compatibility regression corpus

All included inputs are synthetic, generated locally from redistributable bundled
fonts and images. Tests do not include client documents or make network requests
to obtain fixtures. Run `npm test` to generate the inputs, then
`npm run test:browser` for the independent browser/render checks.

| Cases | Coverage |
| --- | --- |
| Forms, accents, checks, signatures, rotation, merge, extraction | `core.cjs`, `smoke.cjs` |
| Stream spans, repeated image occurrences, removal, stale edits | `content-engine.cjs` |
| TJ spacing, neighboring mixed fonts, nested/shared Forms, subset fonts, clipped/ActualText refusal | `advanced-engine.cjs` |
| MacRoman, Differences, Greek/Cyrillic font embedding, paragraph geometry, collisions | `text-upgrade.cjs` |
| Scans, cropped regions, deskew and inverse coordinates, separate multi-page reconstruction | `reconstruction.cjs`, `ocr-ui.cjs` |
| French interface, accented examples and field tooltips | `i18n.cjs` |
| Retained metadata, outline/attachment trees, interactive Unicode forms, duplicate replacement words, same-size image replacement | `reliability.cjs` |
| Storage quota failure, portable projects in a fresh browser, v1 draft migration, worker cancellation, page 40 thumbnail, search occurrences, mobile fit | `reliability-ui.cjs` |
| Independent PDF.js pixel comparison outside a native edit region | `reliability-ui.cjs` |
| Offline Spanish recognition, cancellation, scoped release caches, opt-in model downloads, multiple-tab update guard | `offline-ocr.cjs`, `deployment.cjs` |

The pixel check compares a baseline to an exported PDF independently of the
content-editing engine. Object verification also compares text geometry and image
stream hashes. Neither establishes universal visual fidelity or secure redaction.

## Text experience stage (0.5.0)

`text-experience.cjs` adds rotated grouping, movement/typeface/style/color with
neighbor preservation, CJK/grapheme wrapping, explicit shaping refusals, clipped
native text reconstructed regionally at 0 and 90 degrees with CropBox/UserUnit,
retained links/attachments/interactive fields, pixel equality outside the selected
area, duplicate hidden-OCR prevention, typing backup and an explicit lossy fallback.

`text-experience-ui.cjs` exercises automatic native/scan/mixed/searchable-scan
analysis, pause/resume, word/paragraph click-and-type, native and OCR inline
editors, formatting, caret/buffer recovery through zoom/rotation/reload/project
import, undo/redo, worker-based regional preview, clipped-text replacement,
independent PDF.js readback and a 390 px layout. Generated test inputs contain no
client data. These cases do not establish universal PDF or language compatibility.

## Workspace stage (0.5.1)

`workspace-ui.cjs` checks selected controls before page-wide settings, exact
search highlights (including multiple and cross-run matches in the Node suite),
save/backup menus, toolbar and menu bounds at 1440/1100/390/320 px, a mobile
properties drawer, OCR review/compare navigation, non-overlapping footer and
correction fields, preview invalidation, and translated French controls. It
previews an explicitly selected raster fallback on the native demo; regional
preservation continues to be covered by the existing reconstruction suites.
Physical mobile keyboards and screen-reader workflows still need device testing.

## Adding representative documents

Before expanding compatibility claims, add anonymized, authorized examples of
actual invoices, contracts, exported office documents, government forms and scans.
Keep originals and record expected retained features, editable/read-only regions,
page order, fonts, form values and render snapshots. Include multiple producers
and languages. Do not commit confidential PDFs, signatures, passwords or metadata.

Outstanding gaps include general bidi/complex-script shaping, accessible tagged
structure after page rearrangement/reconstruction, encrypted/signed/XFA files,
large or pathological files, unusual color spaces, and validation on physical
iOS/Android devices. Synthetic fixtures and a 390 px viewport do not resolve
these gaps.
