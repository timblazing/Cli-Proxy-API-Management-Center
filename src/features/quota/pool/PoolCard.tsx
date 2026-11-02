import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { getAuthFileIcon, getTypeLabel } from '@/features/authFiles/constants';
import type { ResolvedTheme } from '@/types';
import type { QuotaProviderType } from '../providers/types';
import { poolColor } from './poolColor';
import type { PoolChartMode } from './PoolChart';
import { PoolPanel } from './PoolPanel';
import type { PoolAccountInfo } from './poolAccounts';
import type { HistorySample } from './historyStore';
import type { BurnHours, FutureFactor, PoolRange } from './poolView';
import styles from './PoolCard.module.scss';

export interface PoolCardProps {
  provider: QuotaProviderType;
  /** Longest-window accounts. */
  weeklyAccounts: readonly PoolAccountInfo[];
  /** 5-hour-window accounts; empty hides the session panel. */
  sessionAccounts: readonly PoolAccountInfo[];
  /** Credentials of this provider, loaded or not. */
  credentialCount: number;
  samples: readonly HistorySample[];
  now: number;
  weeklyRange: PoolRange;
  sessionRange: PoolRange;
  mode: PoolChartMode;
  burnHours: BurnHours;
  factor: FutureFactor;
  resolvedTheme: ResolvedTheme;
  locale: string;
}

export function PoolCard(props: PoolCardProps) {
  const {
    provider,
    weeklyAccounts,
    sessionAccounts,
    credentialCount,
    samples,
    now,
    weeklyRange,
    sessionRange,
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

  const hasSession = sessionAccounts.length > 0;
  const hasWeekly = weeklyAccounts.length > 0;
  const accountCount = weeklyAccounts.length || credentialCount;

  const common = {
    provider,
    samples: providerSamples,
    now,
    mode,
    burnHours,
    factor,
    color,
    locale,
    providerLabel: label,
  };

  return (
    <section className={styles.card} aria-label={label}>
      <header className={styles.head}>
        {icon && <img src={icon} alt="" className={styles.icon} />}
        <span className={styles.name}>{label}</span>
        <span className={styles.count}>
          {t('quota_management.pool_accounts', { count: accountCount })}
        </span>
      </header>

      {hasWeekly || hasSession ? (
        <>
          <div className={`${styles.panels} ${hasSession && hasWeekly ? styles.panelsTwo : ''}`}>
            {hasSession && (
              <PoolPanel
                {...common}
                kind="session"
                accounts={sessionAccounts}
                range={sessionRange}
                projectUntil={sessionRange.to}
              />
            )}
            {hasWeekly && (
              <PoolPanel
                {...common}
                kind="weekly"
                accounts={weeklyAccounts}
                range={weeklyRange}
                projectUntil={weeklyRange.to}
              />
            )}
          </div>

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
