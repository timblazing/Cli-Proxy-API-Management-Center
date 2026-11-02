import { TYPE_COLORS } from '@/features/authFiles/constants';
import type { ResolvedTheme } from '@/types';
import type { QuotaProviderType } from '../providers/types';

/** Provider series colours; others fall back to their brand text colour. */
const POOL_COLORS: Partial<Record<QuotaProviderType, string>> = {
  claude: '#e07a5f',
  codex: '#7c9cff',
};

export const poolColor = (type: QuotaProviderType, theme: ResolvedTheme): string =>
  POOL_COLORS[type] ?? TYPE_COLORS[type]?.[theme]?.text ?? 'var(--text-secondary)';
