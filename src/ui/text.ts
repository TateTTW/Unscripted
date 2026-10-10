const REPLACEMENTS: [RegExp, string][] = [
  [/[\u2018\u2019\u201A\u201B\u2032]/g, "'"],
  [/[\u201C\u201D\u201E\u201F\u2033]/g, '"'],
  [/[\u2013\u2014\u2012\u2015\u2212]/g, "-"],
  [/\u2026/g, "..."],
  [/\u00A0/g, " "],
  [/\r\n?/g, "\n"],
  [/\t/g, " "],
];

/**
 * Converts text to the bitmap font's printable ASCII range (32-126), preserving line breaks.
 * Unsupported characters become `?` so glyphs are never silently dropped.
 */
export function toFontText(text: string): string {
  let out = text;
  for (const [pattern, replacement] of REPLACEMENTS) out = out.replace(pattern, replacement);
  let result = "";
  for (const ch of out) {
    const code = ch.codePointAt(0) ?? 63;
    result += ch === "\n" || (code >= 32 && code <= 126) ? ch : "?";
  }
  return result;
}
