import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores';
import { getSection, sectionTabs, type SectionId } from './sections';
import styles from './SectionTabs.module.scss';

/** Segmented sub-navigation shown above the pages of a sidebar section. */
export function SectionTabs({ section }: { section: SectionId }) {
  const { t } = useTranslation();
  const supportsPlugin = useAuthStore((state) => state.supportsPlugin);
  const tabs = sectionTabs(getSection(section), supportsPlugin);
  if (tabs.length < 2) return null;

  return (
    <nav className={styles.tabs} aria-label={t('section_tabs.aria')}>
      {tabs.map((tab) => (
        <NavLink
          key={tab.path}
          to={tab.path}
          end
          className={({ isActive }) => `${styles.tab} ${isActive ? styles.tabActive : ''}`}
        >
          {t(tab.labelKey)}
        </NavLink>
      ))}
    </nav>
  );
}

/** Route wrapper: the tab row, then the page. */
export function SectionPage({ section, children }: { section: SectionId; children: ReactNode }) {
  return (
    <>
      <SectionTabs section={section} />
      {children}
    </>
  );
}
