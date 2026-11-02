import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from '@/components/ui/Select';
import type { PoolChartMode } from './PoolChart';
import { BURN_HOURS_OPTIONS } from './toolbarOptions';
import type { BurnHours, FutureFactor } from './poolView';
import styles from './PoolToolbar.module.scss';

export interface PoolToolbarProps {
  mode: PoolChartMode;
  burnHours: BurnHours;
  factor: FutureFactor;
  showAccounts: boolean;
  onModeChange: (mode: PoolChartMode) => void;
  onBurnHoursChange: (hours: BurnHours) => void;
  onFactorChange: (factor: FutureFactor) => void;
  onToggleAccounts: () => void;
}

interface SegmentedProps<T extends string | number> {
  value: T;
  options: { value: T; label: string }[];
  ariaLabel: string;
  onChange: (value: T) => void;
}

function Segmented<T extends string | number>({
  value,
  options,
  ariaLabel,
  onChange,
}: SegmentedProps<T>) {
  return (
    <div className={styles.segmented} role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`${styles.segment} ${option.value === value ? styles.segmentActive : ''}`}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function PoolToolbar(props: PoolToolbarProps) {
  const {
    mode,
    burnHours,
    factor,
    showAccounts,
    onModeChange,
    onBurnHoursChange,
    onFactorChange,
    onToggleAccounts,
  } = props;
  const { t } = useTranslation();

  const modeOptions = useMemo(
    () => [
      { value: 'remaining' as const, label: t('quota_management.pool_view_remaining') },
      { value: 'drain' as const, label: t('quota_management.pool_view_drain') },
    ],
    [t]
  );
  const burnOptions = useMemo(
    () =>
      BURN_HOURS_OPTIONS.map((hours) => ({
        value: hours,
        label: t('quota_management.pool_burn_option', { hours }),
      })),
    [t]
  );
  const factorOptions = useMemo(
    () => [
      { value: '1', label: t('quota_management.pool_future_same') },
      { value: '0.5', label: t('quota_management.pool_future_lighter') },
      { value: '1.5', label: t('quota_management.pool_future_heavier') },
    ],
    [t]
  );

  return (
    <div className={styles.toolbar}>
      <div className={styles.group}>
        <Segmented
          value={mode}
          options={modeOptions}
          ariaLabel={t('quota_management.pool_view_label')}
          onChange={onModeChange}
        />
        <div className={styles.field}>
          <span className={styles.label}>{t('quota_management.pool_burn_label')}</span>
          <Segmented
            value={burnHours}
            options={burnOptions}
            ariaLabel={t('quota_management.pool_burn_label')}
            onChange={onBurnHoursChange}
          />
        </div>
        <div className={styles.field}>
          <span className={styles.label}>{t('quota_management.pool_future_label')}</span>
          <div className={styles.factor}>
            <Select
              value={String(factor)}
              options={factorOptions}
              onChange={(next) => onFactorChange(Number(next) as FutureFactor)}
              ariaLabel={t('quota_management.pool_future_label')}
              size="sm"
              fullWidth={false}
            />
          </div>
        </div>
        <button
          type="button"
          className={`${styles.toggle} ${showAccounts ? styles.toggleActive : ''}`}
          aria-pressed={showAccounts}
          onClick={onToggleAccounts}
        >
          {t('quota_management.pool_accounts_toggle')}
        </button>
      </div>
    </div>
  );
}
