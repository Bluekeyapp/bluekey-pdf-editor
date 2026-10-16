// Glyph coverage alone does not establish correct shaping or bidi ordering.
// Simple-script replacements use NFC so decomposed accents retain their meaning.
export const replacementText = (text) =>
  text.normalize("NFC").replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
export function shapingRequired(text) {
  return /[\u0590-\u109f\u1780-\u17ff\ua980-\ua9df\u202a-\u202e\u2066-\u2069\u200c\u200d]/u.test(
    text,
  );
}
export function assertReplacementLayout(text) {
  if (shapingRequired(text))
    throw Error(
      "This script needs bidirectional or complex text layout, which is not supported for replacement text yet. Keep the original text or use a tool with a shaping engine.",
    );
  if (/\p{Mark}/u.test(replacementText(text)))
    throw Error(
      "These combining marks need positioned glyph shaping. Use precomposed characters where available; the original is unchanged.",
    );
}
