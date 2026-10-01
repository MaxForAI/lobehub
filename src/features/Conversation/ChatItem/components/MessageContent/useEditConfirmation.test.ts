import { act, renderHook } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStore, Provider } from '@/features/Conversation/store';
import { agentSelectors } from '@/store/agent/selectors';

import { useEditConfirmation } from './useEditConfirmation';

describe('Codex edit confirmation', () => {
  afterEach(() => vi.restoreAllMocks());

  const setup = (provider: 'codex' | 'claude-code' = 'codex') => {
    vi.spyOn(agentSelectors, 'currentAgentHeterogeneousProviderType').mockReturnValue(provider);
    const store = createStore({
      context: { agentId: 'agent', topicId: 'topic', threadId: null },
      initialMessages: ['u1', 'u2'].map((id, index) => ({
        id,
        content: id,
        role: 'user',
        createdAt: index,
        updatedAt: index,
      })),
    });
    const fork = vi.spyOn(store.getState(), 'forkCodexMessage').mockResolvedValue();
    const save = vi.spyOn(store.getState(), 'updateMessageContent').mockResolvedValue();
    const regenerate = vi.spyOn(store.getState(), 'regenerateUserMessage').mockResolvedValue();
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(Provider, { children, createStore: () => store });
    const hook = renderHook(
      () =>
        useEditConfirmation({
          id: 'u1',
          editing: true,
          canEdit: true,
          canCreate: true,
          onEditingChange: vi.fn(),
        }),
      { wrapper },
    );
    return { ...hook, fork, save, regenerate };
  };

  it('resends an older prompt without overwriting the original', async () => {
    const { result, fork, save, regenerate } = setup();
    expect(result.current.shouldSendOnConfirm).toBe(true);
    const editorData = { attachment: 'original-attachment' };
    await act(() => result.current.onConfirm('edited', editorData));
    expect(fork).toHaveBeenCalledWith('u1', { content: 'edited', editorData });
    expect(save).not.toHaveBeenCalled();
    expect(regenerate).not.toHaveBeenCalled();
  });

  it('retains save-only behavior for older non-Codex messages', async () => {
    const { result, fork, save } = setup('claude-code');
    expect(result.current.shouldSendOnConfirm).toBe(false);
    await act(() => result.current.onConfirm('edited'));
    expect(save).toHaveBeenCalledWith('u1', 'edited', { editorData: undefined });
    expect(fork).not.toHaveBeenCalled();
  });
});
