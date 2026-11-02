import { Navigate, useRoutes, type Location } from 'react-router-dom';
import { OverviewPage } from '@/features/dashboard/OverviewPage';
import { SectionPage } from '@/components/layout/SectionTabs';
import { ProvidersWorkbenchPage } from '@/features/providers/ProvidersWorkbenchPage';
import { AuthFilesPage } from '@/features/authFiles/AuthFilesPage';
import { AuthFilesOAuthExcludedEditPage } from '@/pages/AuthFilesOAuthExcludedEditPage';
import { AuthFilesOAuthModelAliasEditPage } from '@/pages/AuthFilesOAuthModelAliasEditPage';
import { OAuthPage } from '@/features/oauth/OAuthPage';
import { RoutingPage } from '@/features/routing/RoutingPage';
import { PluginResourcePage } from '@/features/plugins/PluginResourcePage';
import { PluginsPage } from '@/features/plugins/PluginsPage';
import { PluginStorePage } from '@/features/plugins/PluginStorePage';
import { ConfigPage } from '@/features/config/ConfigPage';
import { LogsPage } from '@/features/logs/LogsPage';
import { SystemPage } from '@/pages/SystemPage';
import { useAuthStore } from '@/stores';

const createMainRoutes = (supportsPlugin: boolean) => [
  { path: '/', element: <OverviewPage /> },
  { path: '/dashboard', element: <Navigate to="/" replace /> },
  { path: '/settings', element: <Navigate to="/config" replace /> },
  { path: '/api-keys', element: <Navigate to="/config" replace /> },
  { path: '/quick-start', element: <ProvidersWorkbenchPage fixedBrand="apikeyFun" /> },
  { path: '/quick-start/*', element: <Navigate to="/quick-start" replace /> },
  {
    path: '/ai-providers',
    element: (
      <SectionPage section="providers">
        <ProvidersWorkbenchPage />
      </SectionPage>
    ),
  },
  { path: '/ai-providers/*', element: <Navigate to="/ai-providers" replace /> },
  {
    path: '/auth-files',
    element: (
      <SectionPage section="accounts">
        <AuthFilesPage />
      </SectionPage>
    ),
  },
  { path: '/auth-files/oauth-excluded', element: <AuthFilesOAuthExcludedEditPage /> },
  { path: '/auth-files/oauth-model-alias', element: <AuthFilesOAuthModelAliasEditPage /> },
  {
    path: '/oauth',
    element: (
      <SectionPage section="accounts">
        <OAuthPage />
      </SectionPage>
    ),
  },
  {
    path: '/routing',
    element: (
      <SectionPage section="providers">
        <RoutingPage />
      </SectionPage>
    ),
  },
  { path: '/quota', element: <Navigate to="/" replace /> },
  ...(supportsPlugin
    ? [
        { path: '/plugin-pages/:pluginId/:menuIndex', element: <PluginResourcePage /> },
        {
          path: '/plugins',
          element: (
            <SectionPage section="settings">
              <PluginsPage />
            </SectionPage>
          ),
        },
        {
          path: '/plugin-store',
          element: (
            <SectionPage section="settings">
              <PluginStorePage />
            </SectionPage>
          ),
        },
        { path: '/plugins/*', element: <Navigate to="/plugins" replace /> },
      ]
    : [
        { path: '/plugin-pages/*', element: <Navigate to="/" replace /> },
        { path: '/plugins/*', element: <Navigate to="/" replace /> },
        { path: '/plugin-store', element: <Navigate to="/" replace /> },
      ]),
  {
    path: '/config',
    element: (
      <SectionPage section="settings">
        <ConfigPage />
      </SectionPage>
    ),
  },
  { path: '/logs', element: <LogsPage /> },
  {
    path: '/system',
    element: (
      <SectionPage section="settings">
        <SystemPage />
      </SectionPage>
    ),
  },
  { path: '*', element: <Navigate to="/" replace /> },
];

export function MainRoutes({ location }: { location?: Location }) {
  const supportsPlugin = useAuthStore((state) => state.supportsPlugin);
  return useRoutes(createMainRoutes(supportsPlugin), location);
}
