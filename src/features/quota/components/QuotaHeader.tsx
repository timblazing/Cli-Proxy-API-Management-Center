import { useTranslation } from 'react-i18next';
import { IconEye, IconEyeOff, IconRefreshCw } from '@/components/ui/icons';
import { useCountUp } from '@/hooks/motion';
import styles from './QuotaHeader.module.scss';

export type QuotaHeaderProps = {
  totalCount: number;
  loadedCount: number;
  attentionCount: number;
  refreshing: boolean;
  disableControls: boolean;
  showEmails: boolean;
  onToggleEmails: () => void;
  onRefreshAll: () => void;
};

/**
 * 额度页头部：标题 + 同行 meta，右侧「显示邮箱」开关与主按钮「刷新全部」。
 * 样式来自共享的 pageHeader mixin。
 *
 * 入场：三处 `data-reveal` 交给页面壳的 useRevealGroup 统一编排
 * （标题 0ms → meta 70ms → 动作 140ms → tabs 210ms）。
 */
export function QuotaHeader(props: QuotaHeaderProps) {
  const {
    totalCount,
    loadedCount,
    attentionCount,
    refreshing,
    disableControls,
    showEmails,
    onToggleEmails,
    onRefreshAll,
  } = props;
  const { t } = useTranslation();
  // 批量结果陆续落地时，「已加载」是页面上唯一滚动的数字
  const displayLoadedCount = useCountUp(loadedCount);

  return (
    <header className={styles.header}>
      <div className={styles.copy}>
        <h1 className={styles.title} data-reveal>
          {t('quota_management.title')}
        </h1>
        <p className={styles.meta} data-reveal>
          <span className={styles.metaTotal}>
            {t('quota_management.meta_credentials', { count: totalCount })}
          </span>
          <span className={styles.metaDot} aria-hidden="true">
            ·
          </span>
          <span className={loadedCount > 0 ? styles.metaLoaded : styles.metaMuted}>
            {t('quota_management.meta_loaded', { count: displayLoadedCount })}
          </span>
          {attentionCount > 0 && (
            <>
              <span className={styles.metaDot} aria-hidden="true">
                ·
              </span>
              <span className={styles.metaAttention}>
                {t('quota_management.meta_attention', { count: attentionCount })}
              </span>
            </>
          )}
        </p>
      </div>
      <div className={styles.actions} data-reveal>
        <button
          type="button"
          className={styles.ghostAction}
          aria-pressed={showEmails}
          onClick={onToggleEmails}
        >
          {showEmails ? <IconEye size={16} /> : <IconEyeOff size={16} />}
          {t('quota_management.show_emails')}
        </button>
        <button
          type="button"
          className={styles.primaryAction}
          onClick={onRefreshAll}
          disabled={disableControls || refreshing}
        >
          <IconRefreshCw size={16} className={refreshing ? styles.spinning : undefined} />
          {t('quota_management.refresh_all_credentials')}
        </button>
      </div>
    </header>
  );
}
