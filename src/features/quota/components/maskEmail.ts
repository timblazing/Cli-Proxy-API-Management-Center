/** The class the Quota page blurs unless "Show emails" is on. */
export const EMAIL_CLASS = 'cpamc-email';

// Local part excludes '-' so filenames like `claude-ab12cd-user@host.com.json`
// blur only the address, not the provider/hash prefix.
const EMAIL_PATTERN = /[A-Za-z0-9._%+]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

type EmailSegment = { text: string; email: boolean };

function splitByPattern(text: string): EmailSegment[] {
  const segments: EmailSegment[] = [];
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
 * Split text into plain and email segments. Every occurrence of `knownEmail`
 * is an email segment; the text between them is still scanned for addresses.
 */
export function splitEmailSegments(text: string, knownEmail?: string): EmailSegment[] {
  const known = knownEmail?.trim();
  if (!known) return splitByPattern(text);
  const parts = text.split(known);
  return parts.flatMap((part, index) => [
    ...splitByPattern(part),
    ...(index < parts.length - 1 ? [{ text: known, email: true }] : []),
  ]);
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
