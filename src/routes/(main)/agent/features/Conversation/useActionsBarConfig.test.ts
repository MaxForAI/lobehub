import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useAgentStore } from '@/store/agent';

import { useActionsBarConfig } from './useActionsBarConfig';

const initialState = useAgentStore.getState();

const renderFor = (type?: 'claude-code' | 'codex' | 'opencode') => {
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
    useAgentStore.setState(initialState, true);
  });

  it.each(['claude-code', 'codex'] as const)('lets forkable %s rewrite history', (type) => {
    const config = renderFor(type);

    expect(config.user?.bar).toContain('edit');
    expect(config.user?.menu).toEqual(expect.arrayContaining(['edit', 'branching']));
    expect(config.assistant?.menu).toEqual(expect.arrayContaining(['regenerate', 'branching']));
    expect(config.assistantGroup).toEqual(config.assistant);
  });

  it('keeps agents without native fork read-only', () => {
    const config = renderFor('opencode');

    expect(config.user?.menu).not.toContain('edit');
    expect(config.assistant?.menu).not.toContain('regenerate');
    expect(config.assistant?.menu).not.toContain('branching');
  });

  it('uses the native defaults for agents without a heterogeneous provider', () => {
    expect(renderFor()).toEqual({});
  });
});
