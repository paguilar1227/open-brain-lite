import { describe, expect, it } from 'vitest';
import { apiBase, configureHost, navigation, onNavigation, resourceUrl } from './host';

describe('embedded workspace host', () => {
  it('keeps navigation and local file links inside the host service without changing parent history', () => {
    const parentUrl = window.location.href;
    const element = document.createElement('div');
    configureHost({ element, apiBase:'/api/plugins/brain/web/workspace/api/v1', assetBase:'/api/plugins/brain/web/workspace', initialRoute:{route:'session',session:'one'} });
    expect(navigation.history.state.obRoute).toEqual({route:'session',session:'one'});
    let changed = 0;
    const stop = onNavigation(() => changed++);
    navigation.history.pushState({obRoute:{route:'home'}},'', '/?route=home');
    navigation.history.back();
    expect(changed).toBe(1);
    expect(navigation.history.state.obRoute.session).toBe('one');
    expect(window.location.href).toBe(parentUrl);
    expect(apiBase()).toContain('/api/plugins/brain/');
    expect(resourceUrl('/api/files/example?sig=abc')).toBe('/api/plugins/brain/web/workspace/api/files/example?sig=abc');
    expect(resourceUrl('https://example.test/file')).toBe('https://example.test/file');
    stop();
  });
});
