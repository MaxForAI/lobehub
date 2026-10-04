/**
 * @vitest-environment happy-dom
 */
import type { UIChatMessage } from '@lobechat/types';
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { branchingAction } from './branching';

const state = vi.hoisted(() => ({ dbMessages: [] as any[], forksNatively: false }));

vi.mock('../../../../hooks/useCanForkHeteroAgent', () => ({
  useCanForkHeteroAgent: () => state.forksNatively,
}));
vi.mock('../../../../store', () => ({
  dataSelectors: {
    getDbMessageById: (id: string) => (s: any) => s.dbMessages.find((m: any) => m.id === id),
  },
  useConversationStore: (selector: (s: any) => any) => selector({ dbMessages: state.dbMessages }),
}));
vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: any) => any) =>
    selector({ activeTopicId: 'topic-1', openThreadCreator: vi.fn() }),
}));

const build = (data: Partial<UIChatMessage>) =>
  renderHook(() =>
    branchingAction.useBuild({ data: data as UIChatMessage, id: 'step-1', role: 'assistant' }),
  ).result.current;

describe('branchingAction', () => {
  it('offers a forking agent no branch from a row without a native position', () => {
    state.forksNatively = true;
    state.dbMessages = [
      { id: 'step-1', metadata: { heteroMessageId: 'turn-1', heteroSessionId: 'thread-1' } },
      // The group's last step predates native position recording.
      { id: 'step-2', metadata: {} },
    ];

    expect(build({ children: [{ id: 'step-1' }, { id: 'step-2' }] as any })).toBeNull();
    expect(build({ children: [{ id: 'step-1' }] as any })).not.toBeNull();
  });

  it('keeps branching for native agents', () => {
    state.forksNatively = false;
    state.dbMessages = [];

    expect(build({})).not.toBeNull();
  });
});
