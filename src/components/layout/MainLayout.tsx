import {
  ReactNode,
  RefObject,
  SVGProps,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { PageTransition } from '@/components/common/PageTransition';
import { MainRoutes } from '@/router/MainRoutes';
import { authFilesApi, pluginsApi } from '@/services/api';
import {
  IconSidebarAuthFiles,
  IconSidebarConfig,
  IconSidebarDashboard,
  IconSidebarLogs,
  IconSidebarOauth,
  IconSidebarPlugins,
  IconSidebarProviders,
  IconSidebarRouting,
  IconSidebarStore,
  IconSidebarSystem,
} from '@/components/ui/icons';
import { INLINE_LOGO_JPEG } from '@/assets/logoInline';
import {
  useAuthStore,
  useLoginTransitionStore,
  useConfigStore,
  useLanguageStore,
  useNotificationStore,
  useThemeStore,
} from '@/stores';
import { AUTH_FILES_CHANGED_EVENT } from '@/features/authFiles/authFilesEvents';
import {
  collectPluginResourceEntries,
  PLUGIN_RESOURCES_REFRESH_EVENT,
  resolvePluginAssetURL,
  type PluginResourceEntry,
} from '@/features/plugins/pluginResources';
import { triggerHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { LANGUAGE_LABEL_KEYS, LANGUAGE_ORDER } from '@/utils/constants';
import { isSupportedLanguage } from '@/utils/language';
import {
  SECTIONS,
  findSection,
  isSameSectionTabSwitch,
  sectionTabIndex,
  sectionTabs,
} from './sections';

const sidebarIcons: Record<string, ReactNode> = {
  dashboard: <IconSidebarDashboard size={18} />,
  aiProviders: <IconSidebarProviders size={18} />,
  authFiles: <IconSidebarAuthFiles size={18} />,
  oauth: <IconSidebarOauth size={18} />,
  routing: <IconSidebarRouting size={18} />,
  plugins: <IconSidebarPlugins size={18} />,
  pluginStore: <IconSidebarStore size={18} />,
  config: <IconSidebarConfig size={18} />,
  logs: <IconSidebarLogs size={18} />,
  system: <IconSidebarSystem size={18} />,
};

interface SidebarNavLinkItem {
  kind?: 'link';
  path: string;
  labelKey?: string;
  metaKey?: string;
  label?: string;
  meta?: string;
  badge?: number;
  badgeLabel?: string;
  /** Extra route prefixes that keep this item active (a section's other tabs). */
  matchPaths?: readonly string[];
  icon: ReactNode;
}

interface SidebarNavDrawerItem {
  kind: 'drawer';
  id: string;
  label: string;
  meta?: string;
  icon: ReactNode;
  children: SidebarNavLinkItem[];
}

type SidebarNavItem = SidebarNavLinkItem | SidebarNavDrawerItem;

interface SidebarNavGroup {
  id: string;
  /** Omitted for the unlabelled primary group. */
  labelKey?: string;
  items: SidebarNavItem[];
}

const flattenNavItems = (items: SidebarNavItem[]): SidebarNavLinkItem[] =>
  items.flatMap((item) => (item.kind === 'drawer' ? item.children : [item]));

/** 点击菜单外或按下 Escape 时关闭弹出菜单 */
function useMenuDismiss(
  open: boolean,
  menuRefs: RefObject<HTMLDivElement | null>[],
  onClose: () => void
) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRefs.some((ref) => ref.current?.contains(event.target as Node))) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open, menuRefs, onClose]);
}

function PluginSidebarIcon({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(src) && !failed;

  return showImage ? (
    <img src={src} alt="" onError={() => setFailed(true)} />
  ) : (
    <IconSidebarPlugins size={18} />
  );
}

// Header action icons - smaller size for header buttons
const headerIconProps: SVGProps<SVGSVGElement> = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
  focusable: 'false',
};

const headerIcons = {
  refresh: (
    <svg {...headerIconProps}>
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  ),
  chevronDown: (
    <svg {...headerIconProps}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  ),
  language: (
    <svg {...headerIconProps}>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
  sun: (
    <svg {...headerIconProps}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  ),
  moon: (
    <svg {...headerIconProps}>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z" />
    </svg>
  ),
  logout: (
    <svg {...headerIconProps}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  ),
};

export function MainLayout() {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const location = useLocation();

  const logout = useAuthStore((state) => state.logout);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const apiBase = useAuthStore((state) => state.apiBase);
  const supportsPlugin = useAuthStore((state) => state.supportsPlugin);

  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const clearCache = useConfigStore((state) => state.clearCache);

  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const language = useLanguageStore((state) => state.language);
  const setLanguage = useLanguageStore((state) => state.setLanguage);

  const [menuOpen, setMenuOpen] = useState(false);
  const [authFilesCount, setAuthFilesCount] = useState<number | null>(null);
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const [pluginResources, setPluginResources] = useState<PluginResourceEntry[]>([]);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const authFilesCountRequestRef = useRef(0);
  const navbarRef = useRef<HTMLDivElement | null>(null);
  const languageMenuRef = useRef<HTMLDivElement | null>(null);
  const languagePanelMenuRef = useRef<HTMLDivElement | null>(null);
  const languageMenuRefs = useMemo(() => [languageMenuRef, languagePanelMenuRef], []);
  const navbarRefs = useMemo(() => [navbarRef], []);
  const headerRef = useRef<HTMLElement | null>(null);

  const abbrBrandName = t('title.abbr');
  const arrivingFromLogin = useLoginTransitionStore((state) => state.phase === 'revealing');
  const isLogsPage = location.pathname.startsWith('/logs');
  const isPluginResourcePage = location.pathname.startsWith('/plugin-pages');

  // Keep floating header height available to sticky mobile elements and overlays.
  useLayoutEffect(() => {
    const updateHeaderHeight = () => {
      const height = headerRef.current?.offsetHeight;
      if (height) {
        document.documentElement.style.setProperty('--header-height', `${height}px`);
      }
    };

    updateHeaderHeight();

    const resizeObserver =
      typeof ResizeObserver !== 'undefined' && headerRef.current
        ? new ResizeObserver(updateHeaderHeight)
        : null;
    if (resizeObserver && headerRef.current) {
      resizeObserver.observe(headerRef.current);
    }

    window.addEventListener('resize', updateHeaderHeight);

    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      window.removeEventListener('resize', updateHeaderHeight);
    };
  }, []);

  // Keep the content center available to bottom overlays that align with the main area.
  useLayoutEffect(() => {
    const updateContentCenter = () => {
      const el = contentRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      document.documentElement.style.setProperty('--content-center-x', `${centerX}px`);
    };

    updateContentCenter();

    const resizeObserver =
      typeof ResizeObserver !== 'undefined' && contentRef.current
        ? new ResizeObserver(updateContentCenter)
        : null;

    if (resizeObserver && contentRef.current) {
      resizeObserver.observe(contentRef.current);
    }

    window.addEventListener('resize', updateContentCenter);

    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      window.removeEventListener('resize', updateContentCenter);
      document.documentElement.style.removeProperty('--content-center-x');
    };
  }, []);

  const closeLanguageMenu = useCallback(() => setLanguageMenuOpen(false), []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useMenuDismiss(languageMenuOpen, languageMenuRefs, closeLanguageMenu);

  const toggleLanguageMenu = useCallback(() => {
    setLanguageMenuOpen((prev) => !prev);
  }, []);

  // Sun/moon pill: flip between dark and the light theme auto mode uses.
  const isDarkTheme = resolvedTheme === 'dark';
  const toggleTheme = useCallback(() => {
    setTheme(isDarkTheme ? 'white' : 'dark');
  }, [isDarkTheme, setTheme]);

  // Close the mobile panel on outside click, Escape, or once the bar is wide again.
  useMenuDismiss(menuOpen, navbarRefs, closeMenu);
  useEffect(() => {
    if (!menuOpen) return;
    const query = window.matchMedia('(min-width: 1024px)');
    const onChange = () => {
      if (query.matches) setMenuOpen(false);
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [menuOpen]);

  const handleLanguageSelect = useCallback(
    (nextLanguage: string) => {
      if (!isSupportedLanguage(nextLanguage)) {
        return;
      }
      setLanguage(nextLanguage);
      setLanguageMenuOpen(false);
    },
    [setLanguage]
  );

  useEffect(() => {
    fetchConfig().catch(() => {
      // Ignore the initial failure; the login flow shows the user-facing prompt.
    });
  }, [fetchConfig]);

  const loadPluginResources = useCallback(async () => {
    if (connectionStatus !== 'connected' || !supportsPlugin) {
      setPluginResources([]);
      return;
    }

    try {
      const plugins = await pluginsApi.list();
      setPluginResources(collectPluginResourceEntries(plugins.plugins));
    } catch {
      setPluginResources([]);
    }
  }, [connectionStatus, supportsPlugin]);

  const loadAuthFilesCount = useCallback(async () => {
    const requestID = ++authFilesCountRequestRef.current;
    if (connectionStatus !== 'connected') {
      setAuthFilesCount(null);
      return;
    }

    try {
      const response = await authFilesApi.list();
      if (requestID !== authFilesCountRequestRef.current) return;
      setAuthFilesCount(Array.isArray(response?.files) ? response.files.length : null);
    } catch {
      if (requestID !== authFilesCountRequestRef.current) return;
      setAuthFilesCount(null);
    }
  }, [connectionStatus]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadPluginResources();
      void loadAuthFilesCount();
    }, 0);

    window.addEventListener(PLUGIN_RESOURCES_REFRESH_EVENT, loadPluginResources);
    window.addEventListener(AUTH_FILES_CHANGED_EVENT, loadAuthFilesCount);

    return () => {
      authFilesCountRequestRef.current += 1;
      window.clearTimeout(timer);
      window.removeEventListener(PLUGIN_RESOURCES_REFRESH_EVENT, loadPluginResources);
      window.removeEventListener(AUTH_FILES_CHANGED_EVENT, loadAuthFilesCount);
    };
  }, [apiBase, loadPluginResources, loadAuthFilesCount]);

  const pluginResourceGroups = pluginResources.reduce<
    Array<{ pluginID: string; pluginTitle: string; entries: PluginResourceEntry[] }>
  >((groups, resource) => {
    const group = groups.find((item) => item.pluginID === resource.pluginID);
    if (group) {
      group.entries.push(resource);
      return groups;
    }

    groups.push({
      pluginID: resource.pluginID,
      pluginTitle: resource.pluginTitle,
      entries: [resource],
    });
    return groups;
  }, []);

  const pluginPageNavItems: SidebarNavItem[] = supportsPlugin
    ? pluginResourceGroups.flatMap((group): SidebarNavItem[] => {
        if (group.entries.length === 1) {
          const resource = group.entries[0];
          const pluginLogo = resolvePluginAssetURL(resource.pluginLogo, apiBase);
          return [
            {
              path: resource.route,
              label: resource.label,
              meta: resource.description,
              icon: <PluginSidebarIcon src={pluginLogo} />,
            },
          ];
        }

        const pluginLogo = resolvePluginAssetURL(group.entries[0]?.pluginLogo ?? '', apiBase);
        return [
          {
            kind: 'drawer',
            id: `plugin-pages-${group.pluginID}`,
            label: group.pluginTitle,
            meta: t('plugin_resource.page_count', { count: group.entries.length }),
            icon: <PluginSidebarIcon src={pluginLogo} />,
            children: group.entries.map((resource) => ({
              path: resource.route,
              label: resource.label,
              meta: resource.description,
              icon: <span className="nav-sub-dot" aria-hidden="true" />,
            })),
          },
        ];
      })
    : [];

  const sectionMatchPaths = (sectionId: string) =>
    sectionTabs(
      SECTIONS.find((section) => section.id === sectionId)!,
      supportsPlugin
    ).map((tab) => tab.path);

  const navGroups: SidebarNavGroup[] = [
    {
      id: 'main',
      items: [
        {
          path: '/',
          labelKey: 'nav.overview',
          metaKey: 'nav_meta.overview',
          icon: sidebarIcons.dashboard,
        },
        {
          path: '/auth-files',
          labelKey: 'nav.accounts',
          metaKey: 'nav_meta.accounts',
          badge: authFilesCount ?? undefined,
          badgeLabel:
            typeof authFilesCount === 'number'
              ? t('sidebar.auth_files_count', { count: authFilesCount })
              : undefined,
          matchPaths: sectionMatchPaths('accounts'),
          icon: sidebarIcons.authFiles,
        },
        {
          path: '/ai-providers',
          labelKey: 'nav.providers',
          metaKey: 'nav_meta.providers',
          matchPaths: sectionMatchPaths('providers'),
          icon: sidebarIcons.aiProviders,
        },
        {
          path: '/logs',
          labelKey: 'nav.logs_short',
          metaKey: 'nav_meta.logs',
          icon: sidebarIcons.logs,
        },
        {
          path: '/config',
          labelKey: 'nav.settings',
          metaKey: 'nav_meta.settings',
          matchPaths: sectionMatchPaths('settings'),
          icon: sidebarIcons.config,
        },
      ],
    },
    ...(pluginPageNavItems.length > 0
      ? [
          {
            id: 'plugin-pages',
            labelKey: 'nav_groups.plugin_pages',
            items: pluginPageNavItems,
          },
        ]
      : []),
  ];
  const navItems = navGroups.flatMap((group) => flattenNavItems(group.items));
  const navOrder = navItems.map((item) => item.path);
  const getRouteOrder = (pathname: string) => {
    const trimmedPath =
      pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
    const normalizedPath = trimmedPath === '/dashboard' ? '/' : trimmedPath;

    const authFilesIndex = navOrder.indexOf('/auth-files');
    if (authFilesIndex !== -1) {
      if (normalizedPath === '/auth-files') return authFilesIndex;
      if (normalizedPath.startsWith('/auth-files/')) {
        if (normalizedPath.startsWith('/auth-files/oauth-excluded')) return authFilesIndex + 0.1;
        if (normalizedPath.startsWith('/auth-files/oauth-model-alias')) return authFilesIndex + 0.2;
        return authFilesIndex + 0.05;
      }
    }

    // Sub-tabs of a section sort right after the section's own nav item.
    const section = findSection(normalizedPath);
    if (section) {
      const sectionIndex = navOrder.indexOf(section.navPath);
      const tabIndex = sectionTabIndex(section, normalizedPath);
      if (sectionIndex !== -1 && tabIndex !== -1) return sectionIndex + tabIndex * 0.01;
    }

    const exactIndex = navOrder.indexOf(normalizedPath);
    if (exactIndex !== -1) return exactIndex;
    const nestedIndex = navOrder.findIndex(
      (path) => path !== '/' && normalizedPath.startsWith(`${path}/`)
    );
    return nestedIndex === -1 ? null : nestedIndex;
  };

  const getTransitionVariant = useCallback((fromPathname: string, toPathname: string) => {
    const normalize = (pathname: string) => {
      const trimmed =
        pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
      return trimmed === '/dashboard' ? '/' : trimmed;
    };

    const from = normalize(fromPathname);
    const to = normalize(toPathname);
    const isAuthFiles = (pathname: string) =>
      pathname === '/auth-files' || pathname.startsWith('/auth-files/');
    if (isAuthFiles(from) && isAuthFiles(to)) return 'ios';
    if (isSameSectionTabSwitch(from, to)) return 'none';
    return 'vertical';
  }, []);

  const handleRefreshAll = async () => {
    clearCache();
    const results = await Promise.allSettled([
      fetchConfig(true),
      loadPluginResources(),
      loadAuthFilesCount(),
      triggerHeaderRefresh(),
    ]);
    const rejected = results.find((result) => result.status === 'rejected');
    if (rejected && rejected.status === 'rejected') {
      const reason = rejected.reason;
      const message =
        typeof reason === 'string' ? reason : reason instanceof Error ? reason.message : '';
      showNotification(
        `${t('notification.refresh_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
      return;
    }
    showNotification(t('notification.data_refreshed'), 'success');
  };

  const isLinkActive = (item: SidebarNavLinkItem) => {
    const { pathname } = location;
    const matches = (path: string) =>
      path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`);
    return matches(item.path) || Boolean(item.matchPaths?.some(matches));
  };

  const renderNavLink = (item: SidebarNavLinkItem, variant: 'bar' | 'panel') => {
    const label = item.label ?? (item.labelKey ? t(item.labelKey) : '');
    const active = isLinkActive(item);
    return (
      <NavLink
        key={item.path}
        to={item.path}
        end={item.path === '/'}
        className={`navbar-link navbar-link--${variant}${active ? ' active' : ''}`}
        aria-current={active ? 'page' : undefined}
        aria-label={item.badgeLabel ? `${label}, ${item.badgeLabel}` : undefined}
        onClick={() => setMenuOpen(false)}
      >
        {variant === 'panel' ? <span className="navbar-link-icon">{item.icon}</span> : null}
        <span>{label}</span>
        {typeof item.badge === 'number' && item.badge > 0 ? (
          <span className="navbar-link-badge" aria-hidden="true">
            {item.badge}
          </span>
        ) : null}
      </NavLink>
    );
  };

  const renderLanguageMenu = (ref: RefObject<HTMLDivElement | null>) => (
    <div className={`language-menu ${languageMenuOpen ? 'open' : ''}`} ref={ref}>
      <Button
        variant="ghost"
        size="sm"
        onClick={toggleLanguageMenu}
        title={t('language.switch')}
        aria-label={t('language.switch')}
        aria-haspopup="menu"
        aria-expanded={languageMenuOpen}
      >
        {headerIcons.language}
      </Button>
      {languageMenuOpen && (
        <div
          className="notification entering language-menu-popover"
          role="menu"
          aria-label={t('language.switch')}
        >
          {LANGUAGE_ORDER.map((lang) => (
            <button
              key={lang}
              type="button"
              className={`language-menu-option ${language === lang ? 'active' : ''}`}
              onClick={() => handleLanguageSelect(lang)}
              role="menuitemradio"
              aria-checked={language === lang}
            >
              <span>{t(LANGUAGE_LABEL_KEYS[lang])}</span>
              {language === lang ? <span className="language-menu-check">✓</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const themeToggle = (
    <button
      type="button"
      className="theme-pill"
      onClick={toggleTheme}
      title={t('theme.switch')}
      aria-label={t('theme.switch')}
    >
      <span className={`theme-pill-option${isDarkTheme ? '' : ' active'}`}>{headerIcons.sun}</span>
      <span className={`theme-pill-option${isDarkTheme ? ' active' : ''}`}>{headerIcons.moon}</span>
    </button>
  );

  const refreshButton = (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleRefreshAll}
      title={t('header.refresh_all')}
      aria-label={t('header.refresh_all')}
    >
      {headerIcons.refresh}
    </Button>
  );

  const logoutButton = (
    <Button
      variant="ghost"
      size="sm"
      onClick={logout}
      title={t('header.logout')}
      aria-label={t('header.logout')}
    >
      {headerIcons.logout}
    </Button>
  );

  const menuToggleLabel = menuOpen
    ? t('sidebar.toggle_collapse', { defaultValue: 'Close navigation' })
    : t('sidebar.toggle_expand', { defaultValue: 'Open navigation' });

  return (
    <div
      className={`app-shell ${
        isPluginResourcePage ? 'plugin-resource-shell' : ''
      } ${arrivingFromLogin ? 'app-shell--arriving' : ''}`}
    >
      <header className="navbar" ref={headerRef}>
        <div className={`navbar-surface${menuOpen ? ' open' : ''}`} ref={navbarRef}>
          <div className="navbar-inner">
            <NavLink to="/" className="navbar-brand" onClick={() => setMenuOpen(false)}>
              <img src={INLINE_LOGO_JPEG} alt="" className="navbar-brand-logo" />
              <span>{abbrBrandName}</span>
            </NavLink>
            <nav className="navbar-links" aria-label={t('nav.main', { defaultValue: 'Main' })}>
              {navItems.map((item) => renderNavLink(item, 'bar'))}
            </nav>
            <div className="navbar-actions">
              {refreshButton}
              {renderLanguageMenu(languageMenuRef)}
              {themeToggle}
              {logoutButton}
            </div>
            <div className="navbar-mobile-actions">
              {refreshButton}
              <Button
                variant="ghost"
                size="sm"
                className={`navbar-menu-toggle${menuOpen ? ' open' : ''}`}
                onClick={() => setMenuOpen((prev) => !prev)}
                aria-label={menuToggleLabel}
                aria-expanded={menuOpen}
              >
                {headerIcons.chevronDown}
              </Button>
            </div>
          </div>
          <div className={`navbar-panel${menuOpen ? ' open' : ''}`} aria-hidden={!menuOpen}>
            <div className="navbar-panel-inner">
              <nav className="navbar-panel-links">
                {navItems.map((item) => renderNavLink(item, 'panel'))}
              </nav>
              <div className="navbar-panel-actions">
                {renderLanguageMenu(languagePanelMenuRef)}
                {logoutButton}
                <div className="navbar-panel-spacer" />
                {themeToggle}
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="main-body">
        <div
          className={`content${isLogsPage ? ' content-logs' : ''}${
            isPluginResourcePage ? ' content-plugin-resource' : ''
          }`}
          ref={contentRef}
        >
          <main
            className={`main-content${isLogsPage ? ' main-content-logs' : ''}${
              isPluginResourcePage ? ' main-content-plugin-resource' : ''
            }`}
          >
            <PageTransition
              render={(location) => <MainRoutes location={location} />}
              getRouteOrder={getRouteOrder}
              getTransitionVariant={getTransitionVariant}
              scrollContainerRef={contentRef}
            />
          </main>
        </div>
      </div>
    </div>
  );
}
