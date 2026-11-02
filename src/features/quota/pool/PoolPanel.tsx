import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MaskedName } from '../components/MaskedName';
import type { PoolAccountInfo } from './poolAccounts';
import { PoolChart, type PoolChartMode } from './PoolChart';
import { formatDuration, formatMonthDay, formatWhen } from './poolFormat';
import type { HistorySample } from './historyStore';
import {
  buildPoolView,
  sessionTicks,
  weeklyTicks,
  type BurnHours,
  type FutureFactor,
  type PoolRange,
  type PoolWindowKind,
} from './poolView';
import styles from './PoolCard.module.scss';

export interface PoolPanelProps {
  kind: PoolWindowKind;
  provider: string;
  accounts: readonly PoolAccountInfo[];
  samples: readonly HistorySample[];
  now: number;
  range: PoolRange;
  /** Where the projection ends (the range end). */
  projectUntil: number;
  mode: PoolChartMode;
  burnHours: BurnHours;
  factor: FutureFactor;
  color: string;
  locale: string;
  providerLabel: string;
}

/** One window of a provider pool: headline, four stats, chart. */
export function PoolPanel(props: PoolPanelProps) {
  const {
    kind,
    accounts,
    samples,
    now,
    range,
    projectUntil,
    mode,
    burnHours,
    factor,
    color,
    locale,
    providerLabel,
  } = props;
  const { t } = useTranslation();

  const view = useMemo(
    () =>
      accounts.length === 0
        ? null
        : buildPoolView({ now, accounts, samples, burnHours, factor, range, projectUntil }),
    [accounts, samples, now, burnHours, factor, range, projectUntil]
  );
  const ticks = useMemo(
    () => (kind === 'session' ? sessionTicks(range, locale) : weeklyTicks(range, locale)),
    [kind, range, locale]
  );

  const windowLabel = t(
    kind === 'session'
      ? 'quota_management.pool_window_session'
      : 'quota_management.pool_window_weekly'
  );
  const notBy = t('quota_management.pool_not_by', {
    date:
      kind === 'session'
        ? formatWhen(projectUntil, locale)
        : formatMonthDay(projectUntil - 1, locale),
  });

  const poolEmptyText = view
    ? view.poolEmpty !== null
      ? view.poolEmpty <= now + 60_000
        ? t('quota_management.pool_empty_now')
        : formatWhen(view.poolEmpty, locale)
      : view.burn === null
        ? t('quota_management.pool_collecting')
        : notBy
    : '—';

  const firstEmptyNode = (() => {
    if (!view) return '—';
    if (!view.firstEmpty) {
      return view.burn === null ? t('quota_management.pool_collecting') : notBy;
    }
    const wait = view.firstEmpty.at - now;
    return (
      <>
        <span className={styles.firstName}>
          <MaskedName text={view.firstEmpty.label} />
        </span>{' '}
        {wait <= 0
          ? t('quota_management.pool_first_empty_now')
          : t('quota_management.pool_first_empty_in', { duration: formatDuration(wait) })}
      </>
    );
  })();

  const nextResetText =
    view && view.nextReset
      ? `${t('quota_management.pool_step_gain', { value: Math.round(view.nextReset.gain) })} ${formatWhen(view.nextReset.t, locale)}`
      : '—';

  if (!view) return null;

  return (
    <div className={styles.panel} data-window={kind}>
      <div className={styles.panelLabel}>{windowLabel}</div>
      <div className={styles.big}>
        <span className={styles.bigValue}>{Math.round(view.current)}%</span>
        <span className={styles.bigOf}>
          {t('quota_management.pool_of', { total: Math.round(view.capacity) })}
        </span>
      </div>
      <dl className={styles.stats}>
        <div className={styles.stat}>
          <dt>{t('quota_management.pool_stat_empty')}</dt>
          <dd>{poolEmptyText}</dd>
        </div>
        <div className={styles.stat}>
          <dt>{t('quota_management.pool_stat_first_empty')}</dt>
          <dd>{firstEmptyNode}</dd>
        </div>
        <div className={styles.stat}>
          <dt>{t('quota_management.pool_stat_next_reset')}</dt>
          <dd>{nextResetText}</dd>
        </div>
        <div className={styles.stat}>
          <dt>{t('quota_management.pool_stat_burn', { hours: burnHours })}</dt>
          <dd>
            {view.burn === null
              ? '—'
              : t('quota_management.pool_burn_value', { value: view.burn.toFixed(1) })}
          </dd>
        </div>
      </dl>
      <PoolChart
        mode={mode}
        view={view}
        range={range}
        ticks={ticks}
        tickLabelPlacement={kind === 'session' ? 'at' : 'between'}
        now={now}
        color={color}
        locale={locale}
        ariaLabel={t('quota_management.pool_chart_aria_window', {
          provider: providerLabel,
          window: windowLabel,
        })}
      />
    </div>
  );
}
