/**
 * 额度查询页：池化图表 + 提供商 tabs + 可折叠的账号卡网格。
 *
 * 加载契约（与上游不同：上游只在点击时加载）：
 * - 页面挂载后，文件列表落定即对全部凭证批量加载一次额度（复用 useQuotaBatchLoader），
 *   之后页面可见（document.visibilityState）时每 10 分钟再加载一次；同一时刻最多一个批次在飞；
 * - 每次加载成功都会把各凭证最长窗口的剩余额度记入浏览器端历史（pool/historyStore），
 *   用于池图表的「已记录」曲线与消耗速率；历史为空时只显示预测；
 * - 「账号」开关（默认关）展开原有的搜索/排序、账号卡片网格与额度窗口时间线；
 * - cacheGeneration 会话隔离 + request-id 去重（见 useQuotaBatchLoader）；
 * - 文件列表变化后按 provider 剪枝额度缓存（已删文件不残留）；
 * - useHeaderRefresh 单槽位：本页唯一注册者，全局刷新 = 重取文件列表并重新加载额度。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authFilesApi } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconSearch, IconX } from '@/components/ui/icons';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useNow } from '@/hooks/useNow';
import { useRevealGroup } from '@/hooks/motion';
import { useAuthStore, useQuotaStore, useThemeStore } from '@/stores';
import type { AuthFileItem, ResolvedTheme } from '@/types';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { ProviderTabs } from '@/features/authFiles/components/ProviderTabs';
import { QuotaHeader } from './components/QuotaHeader';
import { QuotaCard } from './components/QuotaCard';
import { QuotaTimeline } from './components/QuotaTimeline';
import { PoolCard } from './pool/PoolCard';
import type { PoolChartMode } from './pool/PoolChart';
import { PoolToolbar } from './pool/PoolToolbar';
import { buildPoolAccounts } from './pool/poolAccounts';
import { poolRange, type BurnHours, type FutureFactor } from './pool/poolView';
import { useQuotaHistory, useQuotaHistoryRecorder } from './pool/useQuotaHistory';
import {
  CARD_ENTRANCE_BUDGET_MS,
  QUOTA_PAGE_SIZE,
  QUOTA_SORT_MODES,
  QUOTA_TAB_ORDER,
  type QuotaSortMode,
  type QuotaTabId,
} from './constants';
import {
  buildTabCounts,
  canRefreshQuotaAfterList,
  classifyQuotaFiles,
  filterEntriesByTab,
  filterEntriesBySearch,
  paginate,
  sortQuotaEntries,
  type QuotaFileEntry,
} from './logic';
import { nextRecoveryMs } from './resetSchedule';
import { QUOTA_ADAPTERS, getQuotaSetter, type QuotaCardState } from './providers';
import type { QuotaProviderType } from './providers/types';
import { useQuotaActions } from './hooks/useQuotaActions';
import { useQuotaBatchLoader } from './hooks/useQuotaBatchLoader';
import { readQuotaUiState, writeQuotaUiState } from './uiState';
import styles from './QuotaPage.module.scss';

const TAB_IDS: string[] = ['all', ...QUOTA_TAB_ORDER];
const SKELETON_CARD_COUNT = 6;
/** Background quota reload cadence while the tab is visible. */
const QUOTA_AUTO_REFRESH_MS = 10 * 60 * 1000;
const AUTO_REFRESH_POLL_MS = 30 * 1000;

/**
 * Existing providers display filenames; Devin's card and timeline share an
 * identity-aware display label. Keep the filename fallback stable for memoization.
 */
const displayNameFor = (name: string) => name;

export function QuotaPage() {
  const { t, i18n } = useTranslation();
  const apiBase = useAuthStore((state) => state.apiBase);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const resolvedTheme: ResolvedTheme = useThemeStore((state) => state.resolvedTheme);

  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<QuotaTabId>(() => readQuotaUiState()?.tab ?? 'all');
  const [sortMode, setSortMode] = useState<QuotaSortMode>(
    () => readQuotaUiState()?.sortMode ?? 'default'
  );
  const [showEmails, setShowEmails] = useState<boolean>(
    () => readQuotaUiState()?.showEmails ?? false
  );
  const [showAccounts, setShowAccounts] = useState<boolean>(
    () => readQuotaUiState()?.showAccounts ?? false
  );
  const [poolMode, setPoolMode] = useState<PoolChartMode>('remaining');
  const [burnHours, setBurnHours] = useState<BurnHours>(3);
  const [factor, setFactor] = useState<FutureFactor>(1);
  const [rangeOffsetWeeks, setRangeOffsetWeeks] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  // 页头 + tabs 的入场级联（标题 → meta → 动作 → tabs，级差 70ms）
  const revealRef = useRevealGroup<HTMLDivElement>();

  const disableControls = connectionStatus !== 'connected';

  /* ---------- 文件列表 ---------- */

  const sessionGeneration = useQuotaStore((state) => state.cacheGeneration);
  const [filesGeneration, setFilesGeneration] = useState<number | null>(null);
  const listRequestRef = useRef(0);
  const loadFiles = useCallback(async () => {
    const requestId = ++listRequestRef.current;
    if (connectionStatus !== 'connected') {
      setFiles([]);
      setFilesGeneration(null);
      setLoading(false);
      return;
    }
    const isCurrent = () =>
      requestId === listRequestRef.current &&
      sessionGeneration === useQuotaStore.getState().cacheGeneration;
    setLoading(true);
    setError('');
    try {
      const data = await authFilesApi.list();
      if (!isCurrent()) return;
      setFiles(data?.files || []);
      setFilesGeneration(sessionGeneration);
    } catch (err: unknown) {
      if (!isCurrent()) return;
      const message = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError(message);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [connectionStatus, sessionGeneration, t]);

  useHeaderRefresh(loadFiles);

  useEffect(() => {
    void loadFiles();
    return () => {
      listRequestRef.current += 1;
    };
  }, [loadFiles]);

  /* ---------- 额度缓存 ----------
   * 排在归类/排序之前：「最快恢复优先」要读它算排序键。 */

  const antigravityQuota = useQuotaStore((state) => state.antigravityQuota);
  const claudeQuota = useQuotaStore((state) => state.claudeQuota);
  const codexQuota = useQuotaStore((state) => state.codexQuota);
  const devinQuota = useQuotaStore((state) => state.devinQuota);
  const kimiQuota = useQuotaStore((state) => state.kimiQuota);
  const metaQuota = useQuotaStore((state) => state.metaQuota);
  const pluginQuota = useQuotaStore((state) => state.pluginQuota);
  const xaiQuota = useQuotaStore((state) => state.xaiQuota);

  const quotaByType = useMemo<Record<QuotaProviderType, Record<string, QuotaCardState>>>(
    () =>
      ({
        antigravity: antigravityQuota,
        claude: claudeQuota,
        codex: codexQuota,
        devin: devinQuota,
        kimi: kimiQuota,
        meta: metaQuota,
        plugin: pluginQuota,
        xai: xaiQuota,
      }) as unknown as Record<QuotaProviderType, Record<string, QuotaCardState>>,
    [
      antigravityQuota,
      claudeQuota,
      codexQuota,
      devinQuota,
      kimiQuota,
      metaQuota,
      pluginQuota,
      xaiQuota,
    ]
  );

  const getQuota = useCallback(
    (entry: QuotaFileEntry): QuotaCardState | undefined =>
      quotaByType[entry.type][getQuotaCacheKey(entry.file)],
    [quotaByType]
  );

  /* ---------- 归类 / 过滤 / 排序 / 分页 ---------- */

  // 只在「最快恢复优先」下订阅分钟时钟。默认序下不门控的话，pageItems 每分钟
  // 换一次身份，会反复空转下面那个「刷新全部」的 loading 下降沿 effect。
  const tick = useNow(sortMode !== 'default');
  const sortNow = sortMode === 'default' ? 0 : tick;

  const entries = useMemo(() => classifyQuotaFiles(files), [files]);
  const tabCounts = useMemo(() => buildTabCounts(entries), [entries]);
  const filteredEntries = useMemo(
    () => filterEntriesBySearch(filterEntriesByTab(entries, tab), search),
    [entries, tab, search]
  );
  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);

  const resolveNextRecovery = useCallback(
    (entry: QuotaFileEntry) => nextRecoveryMs(entry.type, getQuota(entry), sortNow),
    [getQuota, sortNow]
  );
  // 排序在分页之前：否则「最快恢复」只在当前页内成立。
  const sortedEntries = useMemo(
    () => sortQuotaEntries(filteredEntries, sortMode, resolveNextRecovery),
    [filteredEntries, sortMode, resolveNextRecovery]
  );

  const { pageItems, currentPage, totalPages } = useMemo(
    () => paginate(sortedEntries, page, QUOTA_PAGE_SIZE),
    [sortedEntries, page]
  );

  const handleTabChange = useCallback((next: string) => {
    setTab(next as QuotaTabId);
    setPage(1);
    writeQuotaUiState({ tab: next as QuotaTabId });
  }, []);

  const handleSortModeChange = useCallback((next: string) => {
    setSortMode(next as QuotaSortMode);
    setPage(1);
    writeQuotaUiState({ sortMode: next as QuotaSortMode });
  }, []);

  const sortOptions = useMemo(
    () =>
      QUOTA_SORT_MODES.map((mode) => ({ value: mode, label: t(`quota_management.sort_${mode}`) })),
    [t]
  );

  const { loadedCount, attentionCount } = useMemo(() => {
    let loaded = 0;
    let attention = 0;
    entries.forEach((entry) => {
      const status = quotaByType[entry.type][getQuotaCacheKey(entry.file)]?.status;
      if (status === 'success') loaded += 1;
      else if (status === 'error') attention += 1;
    });
    return { loadedCount: loaded, attentionCount: attention };
  }, [entries, quotaByType]);

  // 剪枝：文件列表落定后，各 provider 缓存只保留仍存在的凭证
  useEffect(() => {
    if (loading || error || filesGeneration !== sessionGeneration) return;
    const survivorsByType = new Map<QuotaProviderType, Set<string>>(
      QUOTA_TAB_ORDER.map((type) => [type, new Set<string>()])
    );
    entries.forEach((entry) => survivorsByType.get(entry.type)?.add(getQuotaCacheKey(entry.file)));

    QUOTA_TAB_ORDER.forEach((type) => {
      const survivors = survivorsByType.get(type) ?? new Set<string>();
      const setQuota = getQuotaSetter(QUOTA_ADAPTERS[type]);
      setQuota((prev) => {
        const staleKeys = Object.keys(prev).filter((name) => !survivors.has(name));
        if (staleKeys.length === 0) return prev;
        const next = { ...prev };
        staleKeys.forEach((name) => delete next[name]);
        return next;
      });
    });
  }, [entries, error, filesGeneration, loading, sessionGeneration]);

  /* ---------- 加载与操作 ---------- */

  const { batchLoading, loadQuota } = useQuotaBatchLoader();
  const { resettingQuotaName, refreshQuota, resetQuota } = useQuotaActions(disableControls);

  const pendingRefreshRef = useRef<number | null>(null);
  const lastAutoLoadAtRef = useRef(0);
  const autoLoadedGenerationRef = useRef<number | null>(null);
  const prevLoadingRef = useRef(loading);

  // 刷新全部：先重取文件列表，待其落定（loading 下降沿）再批量拉当前页额度
  const handleRefreshAll = useCallback(() => {
    if (disableControls) return;
    pendingRefreshRef.current = sessionGeneration;
    lastAutoLoadAtRef.current = Date.now();
    void loadFiles();
  }, [disableControls, loadFiles, sessionGeneration]);

  useEffect(() => {
    const wasLoading = prevLoadingRef.current;
    prevLoadingRef.current = loading;

    const requestedSession = pendingRefreshRef.current;
    if (requestedSession === null) return;
    if (requestedSession !== sessionGeneration) {
      pendingRefreshRef.current = null;
      return;
    }
    if (loading || !wasLoading) return;

    pendingRefreshRef.current = null;
    if (
      canRefreshQuotaAfterList(
        requestedSession,
        sessionGeneration,
        filesGeneration,
        Boolean(error),
        disableControls
      )
    ) {
      void loadQuota(entries);
    }
  }, [disableControls, entries, error, filesGeneration, loading, loadQuota, sessionGeneration]);

  /* ---------- 挂载即加载 + 可见时每 10 分钟重载 ---------- */

  const filesReady =
    !disableControls && !loading && !error && filesGeneration === sessionGeneration;
  const batchLoadingRef = useRef(batchLoading);
  const entriesRef = useRef(entries);
  useEffect(() => {
    batchLoadingRef.current = batchLoading;
    entriesRef.current = entries;
  }, [batchLoading, entries]);

  useEffect(() => {
    if (!filesReady || entries.length === 0) return;
    const attempt = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (batchLoadingRef.current) return;
      const first = autoLoadedGenerationRef.current !== sessionGeneration;
      if (!first && Date.now() - lastAutoLoadAtRef.current < QUOTA_AUTO_REFRESH_MS) return;
      autoLoadedGenerationRef.current = sessionGeneration;
      lastAutoLoadAtRef.current = Date.now();
      void loadQuota(entriesRef.current);
    };
    attempt();
    const timer = window.setInterval(attempt, AUTO_REFRESH_POLL_MS);
    document.addEventListener('visibilitychange', attempt);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', attempt);
    };
  }, [entries.length, filesReady, loadQuota, sessionGeneration]);

  /* ---------- 池数据：账号快照 + 浏览器端历史 ---------- */

  const poolNow = useNow();
  const { samples, reload: reloadHistory } = useQuotaHistory(apiBase);
  useQuotaHistoryRecorder(apiBase, entries, getQuota, reloadHistory);
  const poolAccountsByType = useMemo(
    () => buildPoolAccounts(entries, getQuota),
    [entries, getQuota]
  );
  const credentialCounts = useMemo(() => {
    const counts = new Map<QuotaProviderType, number>();
    entries.forEach((entry) => counts.set(entry.type, (counts.get(entry.type) ?? 0) + 1));
    return counts;
  }, [entries]);
  const poolTypes = useMemo(
    () =>
      QUOTA_TAB_ORDER.filter(
        (type) => (tab === 'all' || tab === type) && credentialCounts.has(type)
      ),
    [credentialCounts, tab]
  );
  const range = useMemo(() => poolRange(poolNow, rangeOffsetWeeks), [poolNow, rangeOffsetWeeks]);

  const handleToggleEmails = useCallback(() => {
    const next = !showEmails;
    setShowEmails(next);
    writeQuotaUiState({ showEmails: next });
  }, [showEmails]);
  const handleToggleAccounts = useCallback(() => {
    const next = !showAccounts;
    setShowAccounts(next);
    writeQuotaUiState({ showAccounts: next });
  }, [showAccounts]);

  const canUseActions = !disableControls && !loading && filesGeneration === sessionGeneration;

  /* ---------- 首屏卡片一次性级联入场 ----------
   * 首批数据渲染后立即翻转 cardsAnimated；已挂载的卡片在挂载时捕获过自己的
   * 延迟（QuotaCard 内 useState 初始化），后续切 tab/翻页/刷新新挂载的卡片
   * 拿到 null —— 不重播。 */

  const [cardsAnimated, setCardsAnimated] = useState(false);
  const enableCardEntrance = !cardsAnimated && !loading && pageItems.length > 0;
  useEffect(() => {
    if (enableCardEntrance) {
      setCardsAnimated(true);
    }
  }, [enableCardEntrance]);
  const cardEntranceDelay = (index: number): number | null => {
    if (!enableCardEntrance) return null;
    if (pageItems.length <= 1) return 0;
    return Math.round((index / (pageItems.length - 1)) * CARD_ENTRANCE_BUDGET_MS);
  };

  /* ---------- 渲染 ---------- */

  const accountsSection = (
    <>
      <div className={styles.toolbar}>
        <div className={styles.search}>
          <IconSearch size={16} className={styles.searchIcon} aria-hidden="true" />
          <input
            ref={searchInputRef}
            className={styles.searchInput}
            type="search"
            value={search}
            onChange={(event) => handleSearchChange(event.target.value)}
            placeholder={t('quota_management.search_placeholder')}
            aria-label={t('quota_management.search_label')}
          />
          {search && (
            <button
              type="button"
              className={styles.clearSearch}
              aria-label={t('quota_management.search_clear')}
              title={t('quota_management.search_clear')}
              onClick={() => {
                handleSearchChange('');
                searchInputRef.current?.focus();
              }}
            >
              <IconX size={14} aria-hidden="true" />
            </button>
          )}
        </div>
        <div className={styles.sort}>
          <Select
            value={sortMode}
            options={sortOptions}
            onChange={handleSortModeChange}
            ariaLabel={t('quota_management.sort_label')}
            size="sm"
          />
        </div>
      </div>

      {loading ? (
        <div className={styles.grid} aria-hidden="true">
          {Array.from({ length: SKELETON_CARD_COUNT }, (_, index) => (
            <Skeleton key={index} height={168} rounded={12} />
          ))}
        </div>
      ) : filteredEntries.length === 0 ? (
        <EmptyState
          title={
            search.trim()
              ? t('quota_management.search_empty_title')
              : tab === 'all'
                ? t('quota_management.empty_title')
                : t(`${QUOTA_ADAPTERS[tab].i18nPrefix}.empty_title`)
          }
          description={
            search.trim()
              ? t('quota_management.search_empty_desc')
              : tab === 'all'
                ? t('quota_management.empty_desc')
                : t(`${QUOTA_ADAPTERS[tab].i18nPrefix}.empty_desc`)
          }
          action={
            search.trim() ? (
              <Button variant="secondary" size="sm" onClick={() => handleSearchChange('')}>
                {t('quota_management.search_clear')}
              </Button>
            ) : tab === 'all' ? undefined : (
              <Button variant="secondary" size="sm" onClick={() => handleTabChange('all')}>
                {t('auth_files.filter_all')}
              </Button>
            )
          }
        />
      ) : (
        <div className={styles.grid}>
          {pageItems.map((entry, index) => (
            <QuotaCard
              key={`${entry.type}:${getQuotaCacheKey(entry.file)}`}
              entry={entry}
              quota={getQuota(entry)}
              resolvedTheme={resolvedTheme}
              canRefresh={canUseActions && !entry.file.disabled}
              resetting={resettingQuotaName === getQuotaCacheKey(entry.file)}
              entranceDelayMs={cardEntranceDelay(index)}
              onRefresh={() => void refreshQuota(entry.file, QUOTA_ADAPTERS[entry.type])}
              onReset={() => resetQuota(entry.file, QUOTA_ADAPTERS[entry.type])}
            />
          ))}
        </div>
      )}

      {!loading && filteredEntries.length > QUOTA_PAGE_SIZE && (
        <div className={styles.pagination}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPage(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1}
          >
            {t('auth_files.pagination_prev')}
          </Button>
          <div className={styles.pageInfo}>
            {t('auth_files.pagination_info', {
              current: currentPage,
              total: totalPages,
              count: filteredEntries.length,
            })}
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage >= totalPages}
          >
            {t('auth_files.pagination_next')}
          </Button>
        </div>
      )}

      {/* 时间线只比较当前页凭证，避免大量凭证一次性生成无界泳道。 */}
      <QuotaTimeline
        entries={pageItems}
        quotaFor={getQuota}
        displayNameFor={displayNameFor}
        resolvedTheme={resolvedTheme}
      />
    </>
  );

  return (
    <div className={`${styles.page} ${showEmails ? '' : styles.emailsHidden}`} ref={revealRef}>
      <QuotaHeader
        totalCount={entries.length}
        loadedCount={loadedCount}
        attentionCount={attentionCount}
        refreshing={loading || batchLoading}
        disableControls={disableControls}
        showEmails={showEmails}
        onToggleEmails={handleToggleEmails}
        onRefreshAll={handleRefreshAll}
      />

      <section className={styles.workbench}>
        {/* 提供商导航与池图表分层，避免不同控件争夺视觉焦点。 */}
        <div className={styles.tabsRow} data-reveal>
          <ProviderTabs
            types={TAB_IDS}
            counts={tabCounts}
            active={tab}
            resolvedTheme={resolvedTheme}
            onChange={handleTabChange}
          />
        </div>

        <PoolToolbar
          mode={poolMode}
          burnHours={burnHours}
          factor={factor}
          showAccounts={showAccounts}
          range={range}
          offsetWeeks={rangeOffsetWeeks}
          locale={i18n.language}
          onModeChange={setPoolMode}
          onBurnHoursChange={setBurnHours}
          onFactorChange={setFactor}
          onToggleAccounts={handleToggleAccounts}
          onShiftRange={(weeks) => setRangeOffsetWeeks((prev) => prev + weeks)}
          onResetRange={() => setRangeOffsetWeeks(0)}
        />

        {error && (
          <div className={styles.errorBanner} role="alert">
            {error}
          </div>
        )}

        {loading && entries.length === 0 ? (
          <div className={styles.pools} aria-hidden="true">
            <Skeleton height={420} rounded={12} />
          </div>
        ) : poolTypes.length === 0 ? (
          !loading && !showAccounts ? (
            <EmptyState
              title={t('quota_management.empty_title')}
              description={t('quota_management.empty_desc')}
            />
          ) : null
        ) : (
          <div className={styles.pools}>
            {poolTypes.map((type) => (
              <PoolCard
                key={type}
                provider={type}
                accounts={poolAccountsByType.get(type) ?? []}
                credentialCount={credentialCounts.get(type) ?? 0}
                samples={samples}
                now={poolNow}
                range={range}
                mode={poolMode}
                burnHours={burnHours}
                factor={factor}
                resolvedTheme={resolvedTheme}
                locale={i18n.language}
              />
            ))}
          </div>
        )}

        {showAccounts && accountsSection}
      </section>
    </div>
  );
}
