/**
 * Sidebar sections that group several routes behind sub-tabs. The sidebar shows
 * one item per section (`navPath`); `SectionTabs` shows the tab row inside it.
 */

export type SectionId = 'accounts' | 'providers' | 'settings';

export interface SectionTabDef {
  path: string;
  labelKey: string;
  /** Tab only exists when the backend supports plugins. */
  pluginOnly?: boolean;
}

export interface SectionDef {
  id: SectionId;
  /** Route of the sidebar item that represents the section. */
  navPath: string;
  tabs: readonly SectionTabDef[];
}

export const SECTIONS: readonly SectionDef[] = [
  {
    id: 'accounts',
    navPath: '/auth-files',
    tabs: [
      { path: '/auth-files', labelKey: 'section_tabs.accounts' },
      { path: '/oauth', labelKey: 'section_tabs.add_account' },
    ],
  },
  {
    id: 'providers',
    navPath: '/ai-providers',
    tabs: [
      { path: '/ai-providers', labelKey: 'section_tabs.providers' },
      { path: '/routing', labelKey: 'section_tabs.routing' },
    ],
  },
  {
    id: 'settings',
    navPath: '/config',
    tabs: [
      { path: '/config', labelKey: 'section_tabs.config' },
      { path: '/system', labelKey: 'section_tabs.system' },
      { path: '/plugins', labelKey: 'section_tabs.plugins', pluginOnly: true },
      { path: '/plugin-store', labelKey: 'section_tabs.plugin_store', pluginOnly: true },
    ],
  },
];

export const getSection = (id: SectionId): SectionDef =>
  SECTIONS.find((section) => section.id === id) as SectionDef;

export const sectionTabs = (section: SectionDef, supportsPlugin: boolean): SectionTabDef[] =>
  section.tabs.filter((tab) => supportsPlugin || !tab.pluginOnly);

const normalize = (pathname: string) =>
  pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;

const matchesPath = (pathname: string, path: string) =>
  pathname === path || pathname.startsWith(`${path}/`);

/** The section a pathname belongs to (including nested edit pages), if any. */
export function findSection(pathname: string): SectionDef | null {
  const path = normalize(pathname);
  return (
    SECTIONS.find((section) => section.tabs.some((tab) => matchesPath(path, tab.path))) ?? null
  );
}

/** Index of the tab a pathname selects within its section, or -1. */
export function sectionTabIndex(section: SectionDef, pathname: string): number {
  const path = normalize(pathname);
  return section.tabs.findIndex((tab) => matchesPath(path, tab.path));
}

/** True when both pathnames are tab routes of the same section. */
export function isSameSectionTabSwitch(from: string, to: string): boolean {
  const fromSection = findSection(from);
  const toSection = findSection(to);
  if (!fromSection || fromSection.id !== toSection?.id) return false;
  // Nested auth-file edit pages keep their own push/pop transition.
  const nested = (pathname: string) => normalize(pathname).startsWith('/auth-files/');
  return !nested(from) && !nested(to);
}
