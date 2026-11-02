import { describe, expect, test } from 'bun:test';
import { layerKeyFor } from '@/components/common/pageTransitionKey';

describe('layerKeyFor', () => {
  test('keeps router-assigned keys', () => {
    expect(layerKeyFor({ key: 'abc123', pathname: '/logs' })).toBe('abc123');
  });

  test('distinguishes stateless entries by pathname', () => {
    // Typing a URL or setting location.hash gives every entry the key "default".
    const system = layerKeyFor({ key: 'default', pathname: '/system' });
    const accounts = layerKeyFor({ key: 'default', pathname: '/auth-files' });
    expect(system).not.toBe(accounts);
    expect(layerKeyFor({ key: 'default', pathname: '/system' })).toBe(system);
  });
});
