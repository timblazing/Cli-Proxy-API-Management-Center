import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { getAuthFileIcon, getTypeLabel } from '@/features/authFiles/constants';
import type { ResolvedTheme } from '@/types';
import { MaskedName } from '../components/MaskedName';
import type { QuotaProviderType } from '../providers/types';
import { poolColor } from './poolColor';
import { PoolChart, type PoolChartMode } from './PoolChart';
import { formatDuration, formatMonthDay, formatWhen } from './poolFormat';
import type { PoolAccountInfo } from './poolAccounts';
import type { HistorySample } from './historyStore';
import {
  buildPoolView,
  poolRange,
  type BurnHours,
  type FutureFactor,
  type PoolRange,
} from './poolView';
import styles from './PoolCard.module.scss';

export interface PoolCardProps {
  provider: QuotaProviderType;
  accounts: readonly PoolAccountInfo[];
  /** Credentials of this provider, loaded or not. */
  credentialCount: number;
  samples: readonly HistorySample[];
  now: number;
  range: PoolRange;
  mode: PoolChartMode;
  burnHours: BurnHours;
  factor: FutureFactor;
  resolvedTheme: ResolvedTheme;
  locale: string;
}

export function PoolCard(props: PoolCardProps) {
  const {
    provider,
    accounts,
    credentialCount,
    samples,
    now,
    range,
    mode,
    burnHours,
    factor,
    resolvedTheme,
    locale,
  } = props;
  const { t } = useTranslation();
  const label = getTypeLabel(t, provider);
  const icon = getAuthFileIcon(provider, resolvedTheme);
  const color = poolColor(provider, resolvedTheme);

  const providerSamples = useMemo(
    () => samples.filter((sample) => sample.provider === provider),
    [samples, provider]
  );
  const view = useMemo(
    () =>
      accounts.length === 0
        ? null
        : buildPoolView({ now, accounts, samples: providerSamples, burnHours, factor, range }),
    [accounts, providerSamples, now, burnHours, factor, range]
  );

  const defaultRangeEnd = poolRange(now, 0).to;
  const notBy = t('quota_management.pool_not_by', {
    date: formatMonthDay((view?.projectedUntil ?? defaultRangeEnd) - 1, locale),
  });

  const poolEmptyText = view
    ? view.poolEmpty !== null
      ? formatWhen(view.poolEmpty, locale)
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

  return (
    <section className={styles.card} aria-label={label}>
      <header className={styles.head}>
        {icon && <img src={icon} alt="" className={styles.icon} />}
        <span className={styles.name}>{label}</span>
        <span className={styles.count}>
          {t('quota_management.pool_accounts', { count: accounts.length || credentialCount })}
        </span>
      </header>

      {view ? (
        <>
          <div className={styles.summary}>
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
          </div>

          <PoolChart
            mode={mode}
            view={view}
            range={range}
            now={now}
            color={color}
            locale={locale}
            ariaLabel={t('quota_management.pool_chart_aria', { provider: label })}
          />

          <footer className={styles.legend}>
            <span className={styles.legendTitle}>{t('quota_management.pool_legend_pool')}</span>
            <span className={styles.legendItem}>
              <svg width="18" height="8" aria-hidden="true">
                <line x1="0" y1="4" x2="18" y2="4" stroke={color} strokeWidth="2" />
              </svg>
              {t('quota_management.pool_legend_recorded')}
            </span>
            <span className={styles.legendItem}>
              <svg width="18" height="8" aria-hidden="true">
                <line
                  x1="0"
                  y1="4"
                  x2="18"
                  y2="4"
                  stroke={color}
                  strokeWidth="2"
                  strokeDasharray="4 3"
                />
              </svg>
              {t('quota_management.pool_legend_projected')}
            </span>
          </footer>
        </>
      ) : (
        <p className={styles.empty}>{t('quota_management.pool_no_data')}</p>
      )}
    </section>
  );
}
