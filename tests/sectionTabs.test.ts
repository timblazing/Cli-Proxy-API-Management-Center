import { describe, expect, test } from 'bun:test';
import {
  SECTIONS,
  findSection,
  isSameSectionTabSwitch,
  sectionTabIndex,
  sectionTabs,
} from '../src/components/layout/sections';

describe('sidebar sections', () => {
  test('groups the tab routes under three sections', () => {
    expect(SECTIONS.map((section) => section.id)).toEqual(['accounts', 'providers', 'settings']);
    expect(findSection('/oauth')?.id).toBe('accounts');
    expect(findSection('/auth-files/oauth-excluded')?.id).toBe('accounts');
    expect(findSection('/routing')?.id).toBe('providers');
    expect(findSection('/plugin-store')?.id).toBe('settings');
    expect(findSection('/logs')).toBeNull();
    expect(findSection('/')).toBeNull();
  });

  test('plugin tabs only appear when plugins are supported', () => {
    const settings = SECTIONS.find((section) => section.id === 'settings')!;
    expect(sectionTabs(settings, false).map((tab) => tab.path)).toEqual(['/config', '/system']);
    expect(sectionTabs(settings, true).map((tab) => tab.path)).toEqual([
      '/config',
      '/system',
      '/plugins',
      '/plugin-store',
    ]);
  });

  test('tab switches inside a section skip the page transition', () => {
    expect(isSameSectionTabSwitch('/auth-files', '/oauth')).toBe(true);
    expect(isSameSectionTabSwitch('/config', '/system')).toBe(true);
    expect(isSameSectionTabSwitch('/auth-files', '/routing')).toBe(false);
    expect(isSameSectionTabSwitch('/auth-files', '/auth-files/oauth-excluded')).toBe(false);
    expect(isSameSectionTabSwitch('/', '/config')).toBe(false);
    const accounts = SECTIONS[0];
    expect(sectionTabIndex(accounts, '/oauth')).toBe(1);
  });
});
