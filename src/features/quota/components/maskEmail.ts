/** The class the Quota page blurs unless "Show emails" is on. */
export const EMAIL_CLASS = 'cpamc-email';

// Local part excludes '-' so filenames like `claude-ab12cd-user@host.com.json`
// blur only the address, not the provider/hash prefix.
const EMAIL_PATTERN = /[A-Za-z0-9._%+]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

/** Split text into plain and email segments. `knownEmail` wins over the pattern. */
export function splitEmailSegments(
  text: string,
  knownEmail?: string
): { text: string; email: boolean }[] {
  const known = knownEmail?.trim();
  if (known) {
    const at = text.indexOf(known);
    if (at !== -1) {
      return [
        { text: text.slice(0, at), email: false },
        { text: known, email: true },
        { text: text.slice(at + known.length), email: false },
      ].filter((segment) => segment.text !== '');
    }
  }
  const segments: { text: string; email: boolean }[] = [];
  let last = 0;
  for (const match of text.matchAll(EMAIL_PATTERN)) {
    const start = match.index ?? 0;
    if (start > last) segments.push({ text: text.slice(last, start), email: false });
    segments.push({ text: match[0], email: true });
    last = start + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), email: false });
  return segments;
}

/**
 * Plain-text version for title/aria attributes, which CSS cannot blur: keeps
 * the surrounding text and the first 3 characters of each email, then "…".
 */
export function maskEmailsInText(text: string, show: boolean, knownEmail?: string): string {
  if (show) return text;
  return splitEmailSegments(text, knownEmail)
    .map((segment) => (segment.email ? `${segment.text.slice(0, 3)}…` : segment.text))
    .join('');
}
