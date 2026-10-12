# Text editor verification — 0.3.0

Verified locally on 2026-10-11 in the Codex in-app browser. Synthetic examples were used; no client PDF was edited during these checks.

## Quick test for the user

Run `Start App.cmd`, open http://localhost:4173, and choose **Try the text editing lab**.

1. On page 1, choose a paragraph under **Sentences & paragraphs**. Replace it, change font/alignment/line spacing, then Apply. Check that the separate line below stays in place. Use Undo, Redo, Original/Edited and Reset this object.
2. Try Greek or Cyrillic text. Automatic embedding should use Liberation Sans. Import a TTF/OTF for additional glyph coverage. Missing glyphs must produce a clear error.
3. Add enough lines to overlap the separate text below. Applying should be blocked unless **Allow overlap after review** is checked. Cancel should restore the committed edit.
4. On page 2, select the amber clipped text and choose **Make this text editable**. Review extracted text, edit it, generate a preview, and create the separate copy. All three pages should remain. Edit the reconstructed text again using Edit PDF.
5. On page 3, choose **Make an area editable** and drag a rectangle around the client name. Recognize only this area, correct it, preview the PDF and create a copy. The title and invoice should retain their appearance as pixels.
6. After previewing, change the text again. Create must disable until a new preview passes. Cancel recognition partway through and return to editing.
7. Export, reopen in another PDF reader, inspect appearance and select/copy replacement text. Keep the original file and draft for comparison.

## Checks completed

- Native three-run paragraph selection, multilingual replacement, old member-run removal, original/edited comparison, undo/redo and draft reopening.
- Local TTF import, imported-font draft recovery and matching inline font preview.
- Overlap warning and blocked Apply; Cancel restores the saved paragraph.
- Clipped text extracted without OCR, reviewed reconstruction, all other pages retained, subsequent native edit with a Spanish accent.
- Image-only English OCR, confidence review, accented correction, real exported-PDF preview and multipage copy creation.
- Drag-selected OCR region found only the name; unrelated title/invoice were not included in recognition.
- Manual entry, missing CJK glyph error, supported multilingual manual reconstruction and preview invalidation.
- OCR cancellation with no browser error logs.
- 390 × 844 layout: no document-level horizontal overflow; fitted page, text controls and all reconstruction footer actions remain within the screen. This is a viewport test, not an actual iOS/Android device test.
- Independent pypdf extraction verified three browser-exported pages retained earlier edits and the OCR correction.
- Independent Poppler rendering/pixel comparison of native and reconstructed fixtures showed no changes outside the designated text area.
- All five Node engine regression suites passed. Older standalone Playwright entrypoints were updated for the new preview step but not rerun in this upgrade.

## Remaining compatibility limits

General complex-script shaping/bidi, full mixed-style paragraph reflow, automatic movement of neighboring objects, inherited CMaps, certain clipped/graphics-state content, and universal visual font matching remain incomplete. Reconstruction makes the selected page a raster background plus new text; it loses original selectable text/vector/link/accessibility structure elsewhere on that page. Other pages are copied from the current flattened export. OCR is for printed English/Spanish, one page/area at a time, and requires review. Encrypted/corrupt/signed/XFA restrictions remain. Removal/reconstruction is not secure redaction.

Representative client documents are still needed for broader compatibility confidence. Drafts and font bytes stay in this browser; clearing browser storage removes them.
