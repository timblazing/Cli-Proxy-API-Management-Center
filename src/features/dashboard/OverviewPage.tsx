import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconEye, IconEyeOff, IconRefreshCw } from '@/components/ui/icons';
import { useAuthStore } from '@/stores';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { formatCompactNumber, formatDateValue, formatPercent } from '@/utils/format';
import {
  QuotaOverview,
  type QuotaOverviewHandle,
  type QuotaOverviewSummary,
} from '@/features/quota/QuotaOverview';
import { readQuotaUiState, writeQuotaUiState } from '@/features/quota/uiState';
import { useDashboardOverview } from './hooks/useDashboardOverview';
import { Meter } from './components/Meter';
import { ThroughputChart } from './components/ThroughputChart';
import { useCountUp, useRevealGroup, useRevealOnScroll } from '@/hooks/motion';
import { splitWindowMinutes, toneForSuccessRate, type MeterTone } from './utils';
import styles from './dashboard.module.scss';

const DASH = '—';

/** KPI 卡左上角色签：有语义色调的卡用状态色，其余保持中性 */
const TILE_ACCENTS: Record<MeterTone, string> = {
  good: 'var(--viz-success)',
  warning: 'var(--amber-color)',
  critical: 'var(--viz-failure)',
  idle: 'var(--text-quaternary)',
};

/** 大数字：六位以内用千分位，再往上压缩，避免撑破排版 */
const formatHeadline = (value: number): string =>
  value < 100_000 ? value.toLocaleString() : formatCompactNumber(value);

/**
 * Overview：额度池（QuotaOverview）在上，其下是紧凑的流量与运行参数。
 * useHeaderRefresh 是单槽位 —— 这里只注册一个处理器，同时刷新仪表盘数据
 * 与额度（文件列表 + 批量额度）。
 */
export function OverviewPage() {
  const { t, i18n } = useTranslation();
  const serverVersion = useAuthStore((state) => state.serverVersion);
  const serverBuildDate = useAuthStore((state) => state.serverBuildDate);

  const { connectionStatus, connected, config, counts, traffic, credentials, refresh } =
    useDashboardOverview();

  const quotaRef = useRef<QuotaOverviewHandle>(null);
  const [quotaRefreshing, setQuotaRefreshing] = useState(false);
  const [showEmails, setShowEmails] = useState<boolean>(
    () => readQuotaUiState()?.showEmails ?? false
  );

  const refreshAll = useCallback(async () => {
    quotaRef.current?.refreshAll();
    await refresh();
  }, [refresh]);
  useHeaderRefresh(refreshAll, connected);

  const handleToggleEmails = useCallback(() => {
    const next = !showEmails;
    setShowEmails(next);
    writeQuotaUiState({ showEmails: next });
  }, [showEmails]);
  const handleQuotaSummary = useCallback(
    (summary: QuotaOverviewSummary) => setQuotaRefreshing(summary.refreshing),
    []
  );

  const headerRef = useRevealGroup<HTMLElement>();
  const statsRef = useRevealGroup<HTMLElement>(0.12);
  const trafficRef = useRevealOnScroll<HTMLElement>();
  const detailRef = useRevealGroup<HTMLElement>();

  const animatedTotal = useCountUp(traffic.total, connected);

  const windowLabel = useMemo(() => {
    if (traffic.windowMinutes <= 0) return DASH;
    const { hours, minutes } = splitWindowMinutes(traffic.windowMinutes);
    if (hours === 0) return t('dashboard.window_m', { minutes });
    if (minutes === 0) return t('dashboard.window_h', { hours });
    return t('dashboard.window_hm', { hours, minutes });
  }, [traffic.windowMinutes, t]);

  const routingStrategy = useMemo(() => {
    const raw = config?.routingStrategy?.trim() ?? '';
    if (!raw) return DASH;
    if (raw === 'round-robin') return t('basic_settings.routing_strategy_round_robin');
    if (raw === 'weighted-round-robin') {
      return t('basic_settings.routing_strategy_weighted_round_robin');
    }
    if (raw === 'fill-first') return t('basic_settings.routing_strategy_fill_first');
    return raw;
  }, [config?.routingStrategy, t]);

  const successRateTone = toneForSuccessRate(traffic.successRate);

  const connectionLabel = t(
    connectionStatus === 'connected'
      ? 'common.connected'
      : connectionStatus === 'connecting'
        ? 'common.connecting'
        : 'common.disconnected'
  );
  const versionLabel = serverVersion ? `v${serverVersion.trim().replace(/^[vV]+/, '')}` : null;
  const credentialTotal = credentials?.total ?? null;
  const metaParts = [
    versionLabel,
    connectionLabel,
    credentialTotal === null
      ? null
      : t('quota_management.meta_credentials', { count: credentialTotal }),
  ].filter((part): part is string => Boolean(part));

  const statTiles = [
    {
      key: 'success',
      label: t('dashboard.success_rate'),
      value: traffic.successRate === null ? DASH : formatPercent(traffic.successRate),
      hint: t('dashboard.stat_success_hint', { total: traffic.total.toLocaleString() }),
      meter: traffic.successRate,
      tone: successRateTone,
    },
    {
      key: 'credentials',
      label: t('dashboard.stat_credentials'),
      value: credentials ? credentials.total.toLocaleString() : DASH,
      hint: credentials
        ? t('dashboard.stat_credentials_hint', {
            active: credentials.active,
            disabled: credentials.disabled + credentials.unavailable,
          })
        : t('dashboard.stat_credentials_empty'),
      meter:
        credentials && credentials.total > 0
          ? (credentials.active / credentials.total) * 100
          : null,
      tone: undefined,
    },
    {
      key: 'providerKeys',
      label: t('dashboard.stat_provider_keys'),
      value: counts.providerKeys === null ? DASH : counts.providerKeys.toLocaleString(),
      hint: t('dashboard.stat_provider_keys_hint'),
      meter: null,
      tone: undefined,
    },
    {
      key: 'models',
      label: t('dashboard.stat_models'),
      value: counts.models === null ? DASH : counts.models.toLocaleString(),
      hint: t('dashboard.stat_models_hint'),
      meter: null,
      tone: undefined,
    },
  ];

  const runtimeRows: Array<{ label: string; value: string; mono?: boolean }> = [
    { label: t('dashboard.runtime_routing'), value: routingStrategy },
    { label: t('dashboard.runtime_retry'), value: String(config?.requestRetry ?? 0) },
    {
      label: t('dashboard.runtime_management_keys'),
      value: counts.managementKeys === null ? DASH : String(counts.managementKeys),
    },
    { label: t('dashboard.runtime_version'), value: serverVersion?.trim() || DASH },
    {
      label: t('dashboard.runtime_build'),
      value: formatDateValue(serverBuildDate, i18n.language) || DASH,
    },
    { label: t('dashboard.runtime_proxy'), value: config?.proxyUrl?.trim() || DASH, mono: true },
  ];

  const runtimeToggles = config
    ? [
        { label: t('dashboard.runtime_debug'), on: Boolean(config.debug) },
        { label: t('dashboard.runtime_file_logging'), on: Boolean(config.loggingToFile) },
        { label: t('dashboard.runtime_request_log'), on: Boolean(config.requestLog) },
        { label: t('dashboard.runtime_ws_auth'), on: Boolean(config.wsAuth) },
        { label: t('dashboard.runtime_model_prefix'), on: Boolean(config.forceModelPrefix) },
      ]
    : [];

  return (
    <div className={styles.page}>
      {/* ---------- Header ---------- */}
      <header className={styles.header} ref={headerRef}>
        <div className={styles.copy}>
          <h1 className={styles.title} data-reveal>
            {t('overview.title')}
          </h1>
          <p className={styles.meta} data-reveal>
            {metaParts.map((part, index) => (
              <span key={part} className={styles.metaPart}>
                {index > 0 && (
                  <span className={styles.metaDot} aria-hidden="true">
                    ·
                  </span>
                )}
                {part}
              </span>
            ))}
          </p>
        </div>
        <div className={styles.actions} data-reveal>
          <button
            type="button"
            className={styles.ghostAction}
            aria-pressed={showEmails}
            onClick={handleToggleEmails}
          >
            {showEmails ? <IconEye size={16} /> : <IconEyeOff size={16} />}
            {t('quota_management.show_emails')}
          </button>
          <button
            type="button"
            className={styles.primaryAction}
            onClick={() => void refreshAll()}
            disabled={!connected || quotaRefreshing}
          >
            <IconRefreshCw size={16} className={quotaRefreshing ? styles.spinning : undefined} />
            {t('quota_management.refresh_all_credentials')}
          </button>
        </div>
      </header>

      {/* ---------- Quota pools ---------- */}
      <QuotaOverview ref={quotaRef} showEmails={showEmails} onSummaryChange={handleQuotaSummary} />

      {/* ---------- Traffic ---------- */}
      <section className={styles.section} ref={trafficRef}>
        <h2 className={styles.sectionTitle}>{t('overview.traffic')}</h2>
        <div className={styles.trafficGrid}>
          <div className={styles.requestsCard}>
            <div className={styles.requestsTop}>
              <span className={styles.requestsLabel}>{t('dashboard.hero_requests_label')}</span>
              {connected && (
                <span className={styles.liveBadge}>
                  <i className={styles.liveDot} aria-hidden="true" />
                  {t('dashboard.hero_live')}
                </span>
              )}
            </div>
            <strong className={styles.requestsFigure}>
              {connected ? formatHeadline(animatedTotal) : DASH}
            </strong>
            <span className={styles.requestsMeta}>
              {t('dashboard.hero_window_meta', { window: windowLabel })}
            </span>
            {traffic.total > 0 && (
              <div className={styles.ratioBar} aria-hidden="true">
                {traffic.totalSuccess > 0 && (
                  <span
                    className={`${styles.ratioSegment} ${styles.splitSuccess}`}
                    style={{ flexGrow: traffic.totalSuccess }}
                  />
                )}
                {traffic.totalFailure > 0 && (
                  <span
                    className={`${styles.ratioSegment} ${styles.splitFailure}`}
                    style={{ flexGrow: traffic.totalFailure }}
                  />
                )}
              </div>
            )}
            <div className={styles.requestsSplit}>
              <span className={styles.requestsSplitItem}>
                <i className={`${styles.splitSwatch} ${styles.splitSuccess}`} aria-hidden="true" />
                {t('stats.success')}
                <b>{traffic.totalSuccess.toLocaleString()}</b>
              </span>
              <span className={styles.requestsSplitItem}>
                <i className={`${styles.splitSwatch} ${styles.splitFailure}`} aria-hidden="true" />
                {t('stats.failure')}
                <b>{traffic.totalFailure.toLocaleString()}</b>
              </span>
            </div>
          </div>
          <div className={styles.panel}>
            <ThroughputChart traffic={traffic} />
          </div>
        </div>
      </section>

      <section className={styles.statsRow} ref={statsRef} aria-label={t('dashboard.stats_aria')}>
        {statTiles.map((tile) => (
          <article
            key={tile.key}
            className={styles.statTile}
            data-reveal
            style={
              {
                '--tile-accent': tile.tone ? TILE_ACCENTS[tile.tone] : 'var(--border-hover)',
              } as React.CSSProperties
            }
          >
            <span className={styles.statLabel}>{tile.label}</span>
            <strong className={styles.statValue}>{tile.value}</strong>
            {tile.meter !== null && tile.meter !== undefined && (
              <Meter
                value={tile.meter}
                tone={tile.tone}
                ariaLabel={tile.label}
                className={styles.statMeter}
              />
            )}
            <span className={styles.statHint}>{tile.hint}</span>
          </article>
        ))}
      </section>

      {/* ---------- Runtime ---------- */}
      <section className={styles.section} ref={detailRef}>
        <h2 className={styles.sectionTitle} data-reveal>
          {t('overview.runtime')}
        </h2>
        <div className={styles.panel} data-reveal>
          <dl className={styles.specList}>
            {runtimeRows.map((row) => (
              <div key={row.label} className={styles.specRow}>
                <dt className={styles.specLabel}>{row.label}</dt>
                <dd className={`${styles.specValue} ${row.mono ? styles.specMono : ''}`}>
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
          {runtimeToggles.length > 0 && (
            <ul className={styles.toggleList}>
              {runtimeToggles.map((toggle) => (
                <li
                  key={toggle.label}
                  className={`${styles.togglePill} ${toggle.on ? styles.toggleOn : styles.toggleOff}`}
                >
                  {toggle.label}
                  <b>{toggle.on ? t('common.yes') : t('common.no')}</b>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
