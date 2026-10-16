# BlueKey PDF Editor — local web app

Standalone repository: https://github.com/Bluekeyapp/bluekey-pdf-editor

Hosted app: https://bluekeyapp.github.io/bluekey-pdf-editor/

Run `Start App.cmd`, or `npm start`, then open **http://localhost:4173** for local development. The server binds to this computer only. The original PdfCraft checkout is unchanged.

GitHub Pages publishes the static application from `main` at the repository root. `.nojekyll` keeps vendor assets intact. All runtime URLs and the PWA scope are relative, so the same code works locally and at `/bluekey-pdf-editor/`. Bluekeyapp.com contains only the portfolio card and a redirect from the former `/pdf-editor/` address. Publishing this repository does not deploy the company website.

Drafts are stored in the browser for each website origin. Moving from localhost or bluekeyapp.com to the standalone GitHub Pages address does not transfer drafts automatically. Export PDFs at the original location and reopen them in the new app. No client files are stored in this repository.

## Text editing improvements (0.5.0)

The app analyzes the current page first, then works through the remaining pages in the background. The status bar distinguishes native text, scans, mixed pages, searchable scans and empty pages. Pause/resume controls stop background work without canceling Apply or Export. Image regions on mixed pages and pages containing outlined/vector text can use local OCR. Existing OCR layers are reused instead of generating duplicate text outlines. Automatic OCR uses the current interface language (French or English); the reconstruction dialog also offers Spanish and combined models. Download the relevant language assets while online before relying on offline recognition.

**Native editing:** non-form documents open in Edit PDF. Choose Word, Sentence or Paragraph, click text, and type; word/sentence mode selects the corresponding span in its text run. Compatible neighboring runs can be edited as a paragraph, including rotated text. Mixed formatting stays in separate runs. Alt + Left/Right navigates text objects. The compact toolbar exposes typeface, bold/italic, size, color, alignment and Apply/Cancel. The side panel also controls width, position, fitting and line spacing. Original fonts are reused where possible; imported fonts take their style from the actual font file.

**Unfinished typing:** native and recognized-text buffers are saved in the browser draft and portable project backup, separately from committed PDF edits. They survive zoom, rotation, page changes and reload. Apply or Cancel is required before exporting a PDF or undoing committed edits. A failed Apply keeps the buffer. If an old text object can no longer be matched, its saved typing remains available for copying or explicit discard.

**Scans and difficult text:** click an OCR/extracted/read-only text outline and type directly on the page, then choose Preview replacement. The established review dialog provides confidence feedback, font/background controls and an actual exported-PDF preview. Regional replacement removes safely located original text operators and creates selectable text while preserving surrounding vector objects, links, attachments, metadata, page geometry and unrelated interactive forms. This is a separate editable copy; the original draft remains available. Selections cutting through text runs or interactive fields are rejected rather than silently deleting adjacent content.

If regional replacement cannot safely locate/remove the source text, it stops with an explanation. Whole-page raster fallback is **opt-in**, requires a new preview, and loses advanced structure. Background details inside erased regions and replacement font appearance can change even with regional replacement. Removal is not secure redaction: unused resources and covered image pixels can remain in the file.

**Unicode boundary:** replacement text is normalized to NFC; wrapping keeps grapheme clusters intact and supports scripts such as CJK when a suitable original or imported font covers the characters. General Arabic/Hebrew/Indic/Thai shaping and bidi layout are not implemented. Such native text stays read-only and replacement attempts explain the limitation. Glyph coverage is not presented as proof of correct shaping. OCR models cover printed French, English and Spanish; handwriting, arbitrary OCR languages and automatic table reflow are not promised.

Analysis uses a separate worker, one OCR task at a time, a 2200 px automatic raster, eight detailed page analyses and sixteen OCR result pages. The active page is retained; evicted results can be recognized again. Regional PDF generation runs in the processing worker with cancellation/time limits. Explicit full-page raster fallback still uses the capped canvas workflow. No document processing is uploaded to a service.

Validation adds `tests/text-experience.cjs` and `tests/text-experience-ui.cjs`: font/color/position changes with unchanged neighbors, rotated grouping, grapheme wrapping, existing OCR layers, regional replacement on clipped text at 0/90 degrees with CropBox/UserUnit, retained links/attachments/forms, independent pixel comparisons, word/paragraph selection, pause/resume, direct OCR typing, recovered caret/buffers, portable projects and exported text. Broader client-document and physical-device validation remain necessary.

## Reliability improvements (0.4.0)

- A failed draft save keeps the current document open. Retry, export a PDF, or download a portable project before leaving. Export reports the actual save result.
- **Backup project** downloads a `.bluekey.json` file with source PDFs, form values, committed edits, annotations and imported fonts. **Open project backup** restores it in another browser or origin. It contains document data; store it as carefully as the PDF. Unapplied native and recognized-text buffers are included from version 0.5.0.
- For one complete PDF in its original page order, export edits the loaded document instead of copying its pages. This retains document-level metadata, attachment and outline trees. The export dialog offers **Flatten form fields**; uncheck it to retain interactive forms. Merge, extraction, deletion and reordering still rebuild a PDF and can lose advanced structures. Preservation is covered by fixtures, not a certification of all PDF structures.
- Export checking verifies page dimensions/rotation, text occurrences at expected transforms, replaced-content removal, image stream fingerprints, and added text/image positions. It still does not certify arbitrary vector content, accessibility, signatures or every visual detail.
- Added text and form appearances use managed Unicode fonts when required. Missing glyphs and unsupported complex scripts produce an error. Content parsing and PDF generation run in a worker with cancellation and time limits. Streams and tokens have processing limits.
- Library listings read a separate metadata store. Existing drafts migrate automatically. Closing documents releases PDF workers, previews, images and thumbnails. Thumbnails are generated near the active page, including pages beyond 30.
- Select/copy text in Select mode. Search highlights matching text runs and offers previous/next occurrence navigation. OCR is still required for image-only pages. Search covers native/edited page text, not unexported form values or added annotation text.
- The app shell is cached independently of OCR. Use **Offline OCR languages** while online to download English, French or Spanish assets. Assets use a cache-first release. Updates wait for **Update ready — save and reload**; close other BlueKey tabs first. Failed saves prevent reload unless a project backup has been downloaded.

### Development and checks

Use Node 24 or later:

```sh
npm ci
npx playwright install chromium
npm start
```

In another terminal, or with no server running for the self-starting browser runner:

```sh
npm run check
npm test
npm run test:browser
npm run build
```

`npm test` runs all engine, reconstruction, localization, deployment and reliability suites and generates required synthetic fixtures. Browser tests start and stop their own local server. To use an installed Chrome, set `BROWSER_CHANNEL=chrome`; otherwise they use Playwright Chromium. An individual browser suite can be run with `npm run test:browser -- --suite=reliability-ui`. Tests use declared pinned dependencies and the lockfile, without Codex-specific paths.

Run `npm run format` before `npm run build`. The build regenerates the offline asset list and a content-based service-worker release ID; commit these generated changes before publishing the static site. GitHub Actions runs syntax, Node and browser checks, including OCR, failed-storage recovery, project restoration, legacy-draft migration, mobile sizing and a PDF pixel comparison. No production deployment is performed by the checks workflow.

The compatibility cases and remaining corpus gaps are described in [tests/COMPATIBILITY.md](tests/COMPATIBILITY.md).

## Try the new editor

On the home screen choose **Try the editing playground**. The four-page example includes ordinary text, two uses of one image, nested objects, an embedded font, and a scanned page.

1. Select **Edit PDF**, then tap an outlined text or image object. Green outlines are editable; dashed amber outlines are read-only. The Page objects list is an alternative to tapping small objects.
2. Type directly on the page or in the side panel. Choose **Apply** to commit or **Cancel** to discard. Ctrl/Cmd+Enter applies; Escape cancels while typing on the page.
3. Use **Shrink to fit**, **Wrap into lines**, or **Keep size**, plus size and box-width controls. Overflow is blocked unless explicitly allowed. Wrapping does not push neighboring objects down; review overlap before exporting.
4. A font notice tells you whether the original font is reused or a matching standard font is substituted. Spanish accents and other WinAnsi characters are supported. Embedded fonts with usable ToUnicode mappings can reuse their existing glyphs, including mapped Unicode characters; missing glyphs use a standard-font fallback where possible. Unsupported replacement characters produce an error rather than silently becoming blank glyphs.
5. Select an image. Drag to move, use the corner handle to resize, or enter X/Y offsets, scales and rotation. Replacement preserves proportions using **fit** or **crop to fill**. Apply commits the outline/controls preview. Remove and Reset this object are available.
6. Switch between **Original** and **Edited** to compare the page. Reset a single object or all page content edits independently of added annotations.
7. Undo/redo and autosaved drafts include committed content edits. Unapplied typing is recovered separately in the draft and must be applied or canceled before PDF export. Export a PDF and reopen it to inspect the final result.

## Text editing upgrades (0.3.0)

Choose **Try the text editing lab** for a three-page example with a paragraph, clipped text, and a scan.

- **Automatic page analysis** reports directly editable text and areas needing reconstruction. Text recovered by PDF.js can offer a reconstruction outline even when our native stream decoder cannot rewrite it.
- **Sentences & paragraphs** groups nearby horizontal runs with matching font, size, transform and color. Editing a group replaces its first run and removes the old member runs while preserving neighboring positions. Mixed formatting stays as individual objects. Grouping is conservative, not full word-processor reflow; it does not push objects or tables down. Reset a group before combining existing individual edits.
- **Fonts** now decode StandardEncoding, MacRoman, named base encodings with Differences glyph-name maps, and supported ToUnicode maps. Embedded original glyphs are reused when available. Standard-font fallback remains available; Liberation Sans can be embedded automatically for broader Latin, Greek and Cyrillic coverage. Import a TTF/OTF font (up to 5 MB) for additional supported characters. Font bytes are saved with committed edits in the browser draft. Missing glyphs are rejected. General bidi/complex-script shaping remains unsupported, so Arabic, Hebrew and related replacement layouts are not promised.
- Text boxes include left/center/right alignment and line-spacing controls. Overlap with nearby text and newly intersected images is checked before applying; review and explicitly allow an overlap if intentional. This is a conservative geometry check, not full layout validation.
- **Export checking** reopens the generated PDF, checks page count, and reads back committed replacement text before download/sharing. It does not automatically certify every visual detail, bookmark, attachment, or unrelated original object.

## Make an area editable / OCR

In Edit PDF choose **Make an area editable** and drag a rectangle, or select a read-only object and choose **Make this text editable**. The OCR toolbar opens the same workflow for the whole page.

1. The app prepares the current exported document, including committed edits, filled fields and added marks. It first extracts complete text runs intersecting the selected area; OCR is optional if the extracted text is usable.
2. For scans, recognize the selected area using local English, Spanish, or combined language models. Optional contrast cleanup and small-angle deskew improve recognition input only; bounding boxes are mapped back to the untouched source pixels. Confidence below 80 percent is highlighted for review. This is not handwriting or table-structure recognition.
3. Review/correct each text area, uncheck areas to retain as image pixels, or choose **Type text manually**. Manual entry replaces the entire selected rectangle and unchecks earlier extracted areas to prevent duplicate text. Choose the fill and text colors, and optionally import a font.
4. **Preview editable copy** generates a real PDF, reads back the reviewed text, and renders the exported page. Compare Original/Reconstructed preview. Any subsequent text/font/color change requires a new preview.
5. **Create editable copy** saves the original draft and opens a separate document containing all current pages. Regional replacement preserves the selected page’s surrounding native objects when safe. Whole-page raster reconstruction is available only through its explicit fallback checkbox. Other pages remain in the current export. Native editing is then available for the reconstructed text.

Whole-page raster reconstruction is lossy: the selected page loses its original vector/text structure outside the rebuilt areas; color, fonts, spacing, links, accessibility and background graphics behind erased text can change. It is not secure redaction or a guarantee that every uploaded document will retain its original appearance. Complete single-document regional copies retain unrelated interactive forms and document structures. Merged/reordered workspaces and explicit raster fallback retain the current export’s metadata/form-flattening limitations. Encrypted, corrupt, signed and XFA documents retain their import restrictions.

The page raster is capped at 3000 pixels on its longest side. Processing remains on this device with bundled Tesseract and font assets. Recognition can be canceled. Review representative client documents before relying on this for production.

## Other features

PDF viewing, form filling, typed/drawn visible signatures, added text/images, highlights, drawing, notes, page rotation/reordering/deletion, merge, extraction, search, export and browser file sharing remain available. Certificate signatures, encrypted PDFs and XFA forms are rejected. Visible signatures do not provide identity verification or a certificate audit trail.

Drafts are stored in IndexedDB for this browser and origin. Clearing site data removes them. Native and recognized-text typing buffers are saved separately until applied or canceled. Saving is debounced; an abrupt shutdown before the write completes can lose the latest change. Export important documents. The service worker caches app code, PDF resources and examples after successful installation; OCR assets are downloaded separately through Offline OCR languages; offline operation was tested. There is no cloud sync or account.

40 MB per PDF, 80 MB of source PDFs per workspace, 200 pages per workspace and 8 MB per replacement/added image. Large or complex documents can still stress browser memory. OCR works on one page at a time and caps the raster's longest side at 3000 pixels.

## Engine architecture

- `content-lexer.js`: our content-stream tokenizer, including escaped literal and hex strings.
- `editing-engine.js`: our graphics/text state tracking, text metrics, font-map decoding, object geometry, nesting, layout and rewriting logic.
- `content-engine.js`: public engine exports.
- `editing-ui.js`: direct selection, inline editor, compatibility feedback, comparisons and image controls.
- `ocr.js`: local Tesseract integration and scan contrast/cropping helpers.
- `font-manager.js`: bundled/imported font parsing, glyph coverage and embedding.
- `text-model.js`: conservative text grouping and collision checks.
- `reconstruction.js` / `rebuild-ui.js`: extracted/OCR/manual text review, deskew, multipage reconstruction and exported preview.
- `export-check.js`: page-count and replacement-text verification using PDF.js.
- `app.js`: document library, drafts, history, viewer, annotations and UI integration.
- `pdf-core.js`: form flattening and PDF export.

Edits are addressed against original stream spans, leaving source bytes unchanged. Text replacement restores text/line matrices so later mixed-font runs stay positioned. Editing one occurrence of a shared nested Form clones its object/resources instead of mutating every occurrence. Image edits replace drawing references and transforms. Native text editing does not use a white rectangle over the original text.

This is our own **content-editing layer**, not a PDF renderer/parser/font rasterizer written from scratch. PDF.js renders, pdf-lib reads/writes PDF objects and embeds images, and Tesseract performs OCR. No commercial PDF SDK or PdfCraft engine code is used.

## Compatibility boundaries

Supported cases include standard Type1 text, WinAnsi simple fonts with valid widths, horizontal Identity-H composite fonts with supported ToUnicode maps, mixed-style text runs/TJ spacing, rotated transforms, page-level images and nested Form XObjects (up to eight levels/1000 visited streams). Compatibility is checked per object; unsupported text may not have a precise outline if its font cannot be decoded.

Clipped/stroked/invisible text, certain graphics-state fonts, Type3/vertical/custom composite encodings, inherited CMaps, unmapped glyphs, inline-image streams and malformed/oversized maps remain read-only. The object model is not full word-processor paragraph layout. General complex-script shaping, arbitrary vector editing and exact visual font matching are not guaranteed. Nested Form bounding boxes can clip longer replacements. Removal is not secure redaction; unused resources can remain in the output.

Export flattens form fields by default and draws added marks into the PDF. Complete single-document exports can retain interactive fields and document-level structure. Your app draft remains editable. When pages are merged, reordered, deleted or extracted, document-level bookmarks, attachments, metadata and other advanced structures may not carry over. Always keep originals. Thumbnails do not include every added annotation.

## Validation

Run from this folder (Node regression tests):

- `node tests/core.cjs` — forms, annotations, rotation, merge/extract and signature rejection.
- `node tests/content-engine.cjs` — stream rewriting, image occurrence isolation and rejection cases.
- `node tests/advanced-engine.cjs` — accented text, TJ spacing, neighboring runs/line positions, overflow, nested Form isolation and embedded subset font reuse/fallback.
- `node tests/text-upgrade.cjs` — additional encodings, Unicode fonts, paragraph replacement, neighboring geometry and collisions.
- `node tests/reconstruction.cjs` — separate multipage reconstruction, selected-region geometry, scan cleanup/deskew, font coverage.
- With the server running: `npm test`, `node tests/advanced-ui.cjs`, `node tests/ocr-ui.cjs`, and `node tests/offline-ocr.cjs`.

Browser tests use the pinned local Playwright dependency. `tests/fixtures.cjs` generates the embedded-font and scanned-page fixtures independently of test order. Screenshots and fixture PDFs are in `tests/`. `tests/make-demo.cjs` regenerates the playground from test fixtures. Tests cover synthetic documents; representative client PDFs are still needed for broader compatibility confidence.

## Licenses

PDF.js 5.6.205: Apache-2.0; pdf-lib 1.17.1: MIT; Lucide: ISC. Their notices and PDF.js font/WASM notices are in `vendor/`. Tesseract.js 7.0.0, its core and English/Spanish tessdata_fast models are bundled in `vendor/ocr/` with notices. Models were obtained from the official tesseract-ocr/tessdata_fast repository. The example's embedded Inter subset is under SIL OFL, with its notice in `examples/embedded-font-LICENSE.txt` and `tests/embedded-font-LICENSE.txt`. No ArtCraft branding is included.

Manual verification steps and results are in `tests/MANUAL-TEXT-TESTS.md`. Browser automation entrypoints were updated for the preview step; the 0.4.0 automated regression suite reruns those Playwright entrypoints.

Font support adds @pdf-lib/fontkit 1.1.1 (MIT); upstream package metadata and notices are in `vendor/fontkit/`. Encoding and glyph-name tables are from PDF.js 5.6.205 (Apache-2.0), with source headers retained. Bundled Liberation Sans uses the existing `vendor/standard_fonts/LICENSE_LIBERATION` notice.

## French and English interface

The interface starts in French. Use FR / EN in the home or editor header to switch immediately; the choice is saved locally. Menus, dialogs, statuses, accessibility labels and newly generated sample documents use the selected language. Library dates and inserted dates follow that locale. Uploaded PDF contents, filenames, filled values and unsaved text buffers stay intact when switching. French OCR and French + English recognition use local `fra.traineddata`; English and Spanish remain available. The language catalogue and UI translation boundary are in `i18n.js`.

Validation: `node tests/i18n.cjs` checks the catalogue, parameterized messages, French PDF sample and field tooltips, English restoration and offline asset inclusion. Browser checks covered saved language after reload, unchanged in-progress text and form values, French export/signature/reconstruction dialogs, actual French OCR, and a 390 px mobile layout. Changing interface language does not translate the contents of existing PDFs or previously saved sample drafts.
