import { Fragment } from 'react';

/**
 * Wraps the email part of a credential name in `.cpamc-email`. The Quota page
 * blurs that class unless "Show emails" is on (see QuotaPage.module.scss), so
 * cards, pool stats and timeline labels all follow one switch.
 */
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

export function MaskedName({ text, email }: { text: string; email?: string }) {
  return (
    <>
      {splitEmailSegments(text, email).map((segment, index) => (
        <Fragment key={index}>
          {segment.email ? <span className={EMAIL_CLASS}>{segment.text}</span> : segment.text}
        </Fragment>
      ))}
    </>
  );
}
