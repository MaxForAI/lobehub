import { DEFAULT_AGENT_CONFIG } from '@lobechat/const';
import { type ChatTopic, type ThreadItem, ThreadStatus } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { messageService } from '@/services/message';
import { threadService } from '@/services/thread';
import { agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import * as dispatcher from '@/store/chat/slices/agentRun/actions/dispatch/agentDispatcher';
import * as executor from '@/store/chat/slices/agentRun/actions/transports/hetero/heterogeneousAgentExecutor';

import { createStore } from '../../index';

describe('forkCodexMessage', () => {
  const topic: ChatTopic = {
    id: 'topic',
    title: 'Original',
    createdAt: 0,
    updatedAt: 0,
    metadata: {
      workingDirectory: '/work',
      heteroSessionId: 'native-source',
      heteroSessionBindingKey: 'native:v1:codex',
    },
  };
  const context = { agentId: 'agent', topicId: 'topic', threadId: null };
  const source = {
    id: 'original',
    content: 'Original prompt',
    role: 'user' as const,
    createdAt: 0,
    updatedAt: 0,
    metadata: { codexTurnId: 'turn-2', heteroSessionId: 'native-source' },
  };
  let threads: ThreadItem[];
  beforeEach(() => {
    threads = [];
    useChatStore.setState(useChatStore.getInitialState(), true);
    useChatStore.setState({
      activeAgentId: 'agent',
      activeTopicId: 'topic',
      topicDetailMap: { topic },
    });
    vi.spyOn(agentSelectors, 'getAgentConfigById').mockReturnValue(() => ({
      ...DEFAULT_AGENT_CONFIG,
      agencyConfig: {
        executionTarget: 'local',
        heterogeneousProvider: { type: 'codex', command: 'codex' },
      },
    }));
    vi.spyOn(dispatcher, 'selectRuntimeType').mockReturnValue('hetero');
    vi.spyOn(useChatStore.getState(), 'refreshMessages').mockResolvedValue();
    vi.spyOn(threadService, 'getThreads').mockImplementation(async () => threads);
    vi.spyOn(threadService, 'createThreadWithMessage').mockImplementation(async (params) => {
      threads.push({
        ...params,
        id: 'branch',
        title: 'Branch',
        status: ThreadStatus.Active,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        lastActiveAt: new Date(0),
        userId: 'user',
      });
      return { messageId: 'edited-user', threadId: 'branch' };
    });
    vi.spyOn(threadService, 'createThread').mockResolvedValue('branch');
    vi.spyOn(messageService, 'createMessage').mockResolvedValue({
      id: 'new-assistant',
      messages: [],
    });
    vi.spyOn(executor, 'executeHeterogeneousAgent').mockResolvedValue();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    useChatStore.setState(useChatStore.getInitialState(), true);
  });

  it('runs the edited prompt in a separate branch while preserving the original', async () => {
    const store = createStore({ context, initialMessages: [source] });
    const original = structuredClone(store.getState().dbMessages);
    await store.getState().forkCodexMessage(source.id, { content: 'Corrected prompt' });
    expect(store.getState().dbMessages).toEqual(original);
    expect(executor.executeHeterogeneousAgent).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        context: expect.objectContaining({ topicId: 'topic', threadId: 'branch' }),
        codexForkTarget: { position: 'before', threadId: 'native-source', turnId: 'turn-2' },
        userMessageId: 'edited-user',
        message: 'Corrected prompt',
      }),
    );
    expect(useChatStore.getState().portalThreadId).toBe('branch');
    expect(useChatStore.getState().topicDetailMap.topic).toEqual(topic);
    expect(
      Object.values(useChatStore.getState().operations).some(
        (op) => op.type === 'regenerate' && op.status === 'running',
      ),
    ).toBe(false);
  });

  it('does not create a branch when the selected message has no native provenance', async () => {
    const store = createStore({ context, initialMessages: [{ ...source, metadata: {} }] });
    await expect(
      store.getState().forkCodexMessage(source.id, { content: 'edited' }),
    ).rejects.toThrow('no native Codex turn');
    expect(threadService.createThreadWithMessage).not.toHaveBeenCalled();
    expect(executor.executeHeterogeneousAgent).not.toHaveBeenCalled();
    expect(
      Object.values(useChatStore.getState().operations).some((op) => op.status === 'running'),
    ).toBe(false);
  });
});
