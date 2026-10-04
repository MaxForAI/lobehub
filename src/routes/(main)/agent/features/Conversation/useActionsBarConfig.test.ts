import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAgentStore } from '@/store/agent';
import { labPreferSelectors } from '@/store/user/selectors';

import { useActionsBarConfig } from './useActionsBarConfig';

const initialState = useAgentStore.getState();

const renderFor = (
  type?: 'claude-code' | 'codex' | 'opencode',
  { codexAppServer = false } = {},
) => {
  vi.spyOn(labPreferSelectors, 'enableCodexAppServer').mockReturnValue(codexAppServer);
  useAgentStore.setState({
    activeAgentId: 'agent',
    agentMap: {
      agent: type ? { agencyConfig: { heterogeneousProvider: { type } } } : {},
    },
  });
  return renderHook(() => useActionsBarConfig()).result.current;
};

describe('useActionsBarConfig', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useAgentStore.setState(initialState, true);
  });

  it.each([
    ['claude-code', {}],
    ['codex', { codexAppServer: true }],
  ] as const)('lets forkable %s rewrite history', (type, options) => {
    const config = renderFor(type, options);

    expect(config.user?.bar).toContain('edit');
    // User rows record no native position, so they cannot start a branch.
    expect(config.user?.menu).not.toContain('branching');
    expect(config.assistant?.menu).toEqual(expect.arrayContaining(['regenerate', 'branching']));
    expect(config.assistantGroup).toEqual(config.assistant);
  });

  it.each([
    ['opencode', {}],
    // `codex exec` records no turn ids to fork from.
    ['codex', { codexAppServer: false }],
  ] as const)('keeps %s without a forking runtime read-only', (type, options) => {
    const config = renderFor(type, options);

    expect(config.user?.menu).not.toContain('edit');
    expect(config.assistant?.menu).not.toContain('regenerate');
    expect(config.assistant?.menu).not.toContain('branching');
  });

  it('uses the native defaults for agents without a heterogeneous provider', () => {
    expect(renderFor()).toEqual({});
  });
});
