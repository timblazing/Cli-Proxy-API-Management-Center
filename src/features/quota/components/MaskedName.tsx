import { Fragment } from 'react';
import { EMAIL_CLASS, splitEmailSegments } from './maskEmail';

/**
 * Wraps the email part of a credential name in `.cpamc-email`. The Quota page
 * blurs that class unless "Show emails" is on (see QuotaPage.module.scss), so
 * cards, pool stats and timeline labels all follow one switch.
 */
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
