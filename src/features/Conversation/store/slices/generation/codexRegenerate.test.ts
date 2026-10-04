import type { ConversationContext, UIChatMessage } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { messageService } from '@/services/message';

import { prepareCodexRegenerate } from './codexRegenerate';

vi.mock('@/services/message', () => ({
  messageService: {
    getEarlierMessages: vi.fn(),
    getMessageListPage: vi.fn(),
    getToolResultPayloads: vi.fn(),
  },
}));

const context: ConversationContext = { agentId: 'agent', topicId: 'topic' };
const message = (id: string, fields: Partial<UIChatMessage> = {}): UIChatMessage => ({
  content: id,
  createdAt: 1,
  id,
  role: 'user',
  updatedAt: 1,
  ...fields,
});

/** @example Regenerating an earlier branch replays only its persisted ancestors. */
describe('prepareCodexRegenerate', () => {
  beforeEach(() => vi.resetAllMocks());

  /** @example A result row parallel to the final assistant remains part of historical context. */
  it('hydrates ancestor tool results and excludes sibling replies and later turns', async () => {
    // ROOT CAUSE:
    // Resuming the topic session includes turns beyond the selected user.
    // Rebuild only the selected parent spine and its tool results for a fresh session.
    const root = message('early');
    const call = message('call', {
      parentId: root.id,
      role: 'assistant',
      tools: [
        { apiName: 'run', arguments: '{}', id: 'tool-call', identifier: 'bash', type: 'default' },
      ],
    });
    const result = message('result', {
      content: 'projected',
      parentId: call.id,
      payloadOmitted: 'render',
      role: 'tool',
      tool_call_id: 'tool-call',
    });
    const final = message('final', { parentId: call.id, role: 'assistant' });
    const selected = message('selected', { parentId: final.id });
    const replacement = message('superseded', { parentId: selected.id, role: 'assistant' });
    const later = message('future', { parentId: replacement.id });
    vi.mocked(messageService.getToolResultPayloads).mockResolvedValue({
      result: {
        content: 'FULL-TOOL-RESULT',
        pluginState: {
          results: [{ title: 'Search result', url: 'https://example.com/result' }],
          agents_states: { worker: { status: 'completed', message: 'SUBAGENT-RESULT' } },
        },
      },
    });
    const input = [root, call, result, final, selected, replacement, later];
    const before = JSON.stringify(input);

    const prepared = await prepareCodexRegenerate(context, input, selected);

    expect(messageService.getToolResultPayloads).toHaveBeenCalledWith(['result']);
    expect(prepared.systemContext).toContain('FULL-TOOL-RESULT');
    expect(prepared.systemContext).toContain('https://example.com/result');
    expect(prepared.systemContext).toContain('SUBAGENT-RESULT');
    expect(prepared.systemContext).toContain('early');
    expect(prepared.systemContext).not.toContain('superseded');
    expect(prepared.systemContext).not.toContain('future');
    expect(JSON.stringify(input)).toBe(before);
  });

  /** @example A timestamp with microsecond precision must reach the pagination API unchanged. */
  it('loads missing ancestors through lossless server cursors', async () => {
    const root = message('root');
    const parent = message('parent', { parentId: root.id, role: 'assistant' });
    const selected = message('selected', { parentId: parent.id });
    const cursor = { createdAt: '2026-10-04T12:00:00.123456Z', id: 'boundary' };
    vi.mocked(messageService.getMessageListPage).mockResolvedValue({
      messages: [selected],
      olderCursor: cursor,
    });
    vi.mocked(messageService.getEarlierMessages).mockResolvedValue({
      messages: [root, parent],
      olderCursor: null,
    });

    const prepared = await prepareCodexRegenerate(context, [selected], selected);

    expect(messageService.getEarlierMessages).toHaveBeenCalledWith(context, cursor);
    expect(prepared.systemContext).toContain('root');
    expect(prepared.systemContext).toContain('parent');
  });

  /** @example An inaccessible parent or a repeated cursor must never start a truncated replay. */
  it('rejects incomplete history and stops repeated pagination cursors', async () => {
    const selected = message('selected', { parentId: 'missing' });
    const page = {
      messages: [selected],
      olderCursor: { createdAt: '2026-10-04T12:00:00.123456Z', id: 'selected' },
    };
    vi.mocked(messageService.getMessageListPage).mockResolvedValue(page);
    vi.mocked(messageService.getEarlierMessages).mockResolvedValue(page);

    await expect(prepareCodexRegenerate(context, [selected], selected)).rejects.toThrow(
      'history is incomplete',
    );
    expect(messageService.getEarlierMessages).toHaveBeenCalledTimes(1);
  });

  /** @example A projected result without a recoverable payload cannot become model context. */
  it('rejects missing stored tool bodies', async () => {
    const call = message('call', {
      role: 'assistant',
      tools: [
        {
          apiName: 'run',
          arguments: '{}',
          id: 'tool-call',
          identifier: 'bash',
          result_msg_id: 'result',
          type: 'default',
        },
      ],
    });
    const result = message('result', {
      parentId: call.id,
      payloadOmitted: 'render',
      role: 'tool',
      tool_call_id: 'tool-call',
    });
    const selected = message('selected', { parentId: call.id });
    vi.mocked(messageService.getToolResultPayloads).mockResolvedValue({});

    await expect(
      prepareCodexRegenerate(context, [call, result, selected], selected),
    ).rejects.toThrow('could not be restored');
  });

  /** @example Corrupt cyclic parent links fail without paging indefinitely. */
  it('rejects cycles before fetching history', async () => {
    const selected = message('selected', { parentId: 'parent' });
    const parent = message('parent', { parentId: selected.id, role: 'assistant' });

    await expect(prepareCodexRegenerate(context, [parent, selected], selected)).rejects.toThrow(
      'Cyclic',
    );
    expect(messageService.getMessageListPage).not.toHaveBeenCalled();
  });

  /** @example Earlier images precede current images, and persisted selections survive regeneration. */
  it('preserves image order, deduplicates attachments and restores selected context', async () => {
    const firstImage = {
      alt: 'early image',
      id: 'early-image',
      url: 'https://example.com/early.png',
    };
    const selectedImage = {
      alt: 'selected image',
      id: 'selected-image',
      url: 'https://example.com/selected.png',
    };
    const root = message('root', { imageList: [firstImage] });
    const selected = message('selected', {
      imageList: [firstImage, selectedImage],
      metadata: {
        contextSelections: [
          { content: 'CODE-CONTEXT', filePath: 'sample.ts', id: 'code', source: 'code' },
        ],
        pageSelections: [
          { content: 'PAGE-CONTEXT', id: 'page', pageId: 'page-id', xml: '<p>PAGE-CONTEXT</p>' },
        ],
      },
      parentId: root.id,
    });

    const prepared = await prepareCodexRegenerate(context, [root, selected], selected);

    expect(prepared.imageList).toEqual([firstImage, selectedImage]);
    expect(prepared.systemContext).toContain('CODE-CONTEXT');
    expect(prepared.systemContext).toContain('<p>PAGE-CONTEXT</p>');
    expect(prepared.systemContext).toContain(firstImage.url);
  });
});
