import { type ChatTopic, CreateNewMessageParamsSchema, type UIChatMessage } from '@lobechat/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { messageService } from '@/services/message';
import { topicService } from '@/services/topic';

import { getCodexEditAncestors, prepareCodexEdit } from './codexEdit';

const message = (
  id: string,
  parentId?: string,
  role: UIChatMessage['role'] = 'user',
): UIChatMessage => ({
  content: id,
  createdAt: 1,
  id,
  parentId,
  role,
  updatedAt: 1,
});

/** @example Only the selected message's persisted ancestry can seed its replacement session. */
describe('Codex edit ancestry', () => {
  /** @example A later sibling and a newer turn are excluded even when interleaved in storage. */
  it('follows parent links and excludes the edited message and other branches', () => {
    const rows = [
      message('u1'),
      message('other', 'u1', 'assistant'),
      message('a1', 'u1', 'assistant'),
      message('u2', 'a1'),
      message('later', 'u2', 'assistant'),
    ];
    /** @example The replacement of u2 sees exactly u1 followed by a1. */
    expect(getCodexEditAncestors(rows, 'u2').map((row) => row.id)).toEqual(['u1', 'a1']);
  });

  /** @example The first prompt starts a clean session with no previous conversation. */
  it('supports editing the first prompt', () => {
    /** @example No old prompt is echoed into the new session context. */
    expect(getCodexEditAncestors([message('u1')], 'u1')).toEqual([]);
  });

  /** @example Pagination and corrupt links cannot silently truncate inherited context. */
  it('rejects incomplete or cyclic ancestry before saving the edit', () => {
    /** @example A missing parent requires loading the full conversation. */
    expect(() => getCodexEditAncestors([message('u2', 'missing')], 'u2')).toThrow('incomplete');
    /** @example A cycle must not hang or replay duplicate messages. */
    expect(() =>
      getCodexEditAncestors([message('u2', 'a1'), message('a1', 'u2', 'assistant')], 'u2'),
    ).toThrow('incomplete');
  });
});

/** @example Edit preparation keeps source rows intact and inherits both prior and selected attachments. */
describe('Codex edited continuation persistence', () => {
  afterEach(() => vi.restoreAllMocks());

  const setup = () => {
    const rows: UIChatMessage[] = [
      {
        ...message('u1'),
        content: 'PRIOR-CONTEXT',
        imageList: [
          { id: 'prior-image', url: 'https://example.com/prior.png', alt: 'earlier image' },
        ],
      },
      message('a1', 'u1', 'assistant'),
      {
        ...message('u2', 'a1'),
        imageList: [
          { id: 'selected-image', url: 'https://example.com/selected.png', alt: 'selected image' },
        ],
      },
      message('later', 'u2', 'assistant'),
    ];
    const topic: ChatTopic = {
      id: 'source',
      title: 'Original topic',
      createdAt: 1,
      updatedAt: 1,
      model: 'gpt-6.1-sol',
      provider: 'codex',
      metadata: {
        workingDirectory: '/project',
        heteroEffort: 'low',
        heteroSessionId: 'source-native',
        heteroSessionIdByWorkingDirectory: { '/project': 'source-native' },
      },
    };
    vi.spyOn(topicService, 'createTopic').mockResolvedValue('replacement');
    vi.spyOn(topicService, 'updateTopicMetadata').mockResolvedValue(undefined);
    const remove = vi.spyOn(topicService, 'removeTopic').mockResolvedValue(undefined);
    const writes: Parameters<typeof messageService.createMessage>[0][] = [];
    const create = vi.spyOn(messageService, 'createMessage').mockImplementation(async (row) => {
      writes.push(row);
      return { id: `new-${writes.length}`, messages: [] };
    });
    return { create, remove, rows, topic, writes };
  };

  /** @example A fresh native session still receives the image attached before the edited turn. */
  it('copies the exact ancestry and attachments without changing source history or native bindings', async () => {
    // ROOT CAUSE:
    //
    // The first implementation updated the original user row and serialized only
    // ancestor text. A fresh native session then lost earlier images entirely.
    // The replacement now owns separate rows and receives the full image inputs.
    const { rows, topic, writes } = setup();
    const original = structuredClone({ rows, topic });
    const result = await prepareCodexEdit({
      context: { agentId: 'agent', topicId: 'source', threadId: null },
      edit: { content: 'EDITED', editorData: { preserved: true } },
      messageId: 'u2',
      messages: rows,
      topic,
      workingDirectory: '/project',
    });
    // ROOT CAUSE:
    // Agent ids are not legacy session ids. Using sessionId here violates the
    // topics_session_id foreign key on real persisted agents.
    /** @example The replacement belongs to the source agent, not a legacy session. */
    expect(topicService.createTopic).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agent' }),
    );
    /** @example Agent ownership must not populate the unrelated session foreign key. */
    expect(vi.mocked(topicService.createTopic).mock.calls[0][0]).not.toHaveProperty('sessionId');
    /** @example Every source row and its topic-native session maps remain identical. */
    expect({ rows, topic }).toEqual(original);
    /** @example Later turns and the superseded prompt are not copied into the edited continuation. */
    expect(writes.map((row) => row.content)).toEqual(['PRIOR-CONTEXT', 'a1', 'EDITED']);
    /** @example Persisted image-file associations survive on both user messages. */
    expect(writes.map((row) => row.files)).toEqual([['prior-image'], [], ['selected-image']]);
    /** @example The runtime receives earlier images and the edited prompt's images in order. */
    expect(result.imageList.map((item) => item.id)).toEqual(['prior-image', 'selected-image']);
    /** @example Replay identifies the earlier image as historical context. */
    expect(result.systemContext).toContain('prior-image');
    /** @example The new topic retains the effective model, effort and cwd without native bindings. */
    expect(result.topic).toMatchObject({
      id: 'replacement',
      model: 'gpt-6.1-sol',
      provider: 'codex',
      metadata: { workingDirectory: '/project', heteroEffort: 'low' },
    });
    /** @example A fresh continuation cannot accidentally resume the source native session. */
    expect(result.topic.metadata).not.toHaveProperty('heteroSessionId');
  });

  /** @example Persisted document selections reach the new native run, without source run metadata. */
  it('preserves prior and selected document snapshots when rebuilding edit context', async () => {
    // ROOT CAUSE:
    // Normal sends restore selections from message metadata; copying only text
    // and editorData dropped them on a fresh edit session.
    const { rows, topic, writes } = setup();
    rows[0].metadata = {
      contextSelections: [
        { id: 'prior-selection', source: 'text', content: 'PRIOR_SELECTED_TEXT' },
      ],
    };
    rows[2].metadata = {
      pageSelections: [{ id: 'selected-page', pageId: 'page-1', content: 'SELECTED_PAGE_TEXT' }],
    };
    const result = await prepareCodexEdit({
      context: { agentId: 'agent', topicId: 'source', threadId: null },
      edit: { content: 'EDITED' },
      messageId: 'u2',
      messages: rows,
      topic,
    });
    /** @example Earlier text selections are available to the fresh runtime. */
    expect(result.systemContext).toContain('PRIOR_SELECTED_TEXT');
    /** @example The edited prompt retains its legacy page snapshot too. */
    expect(result.systemContext).toContain('SELECTED_PAGE_TEXT');
    /** @example The durable rows retain only the context metadata. */
    expect(writes.map((row) => row.metadata)).toEqual([
      { contextSelections: rows[0].metadata.contextSelections, pageSelections: undefined },
      { contextSelections: undefined, pageSelections: undefined },
      { contextSelections: undefined, pageSelections: rows[2].metadata.pageSelections },
    ]);
  });

  /** @example Real persisted messages use null for absent tool payloads, while creation expects omitted fields. */
  it('accepts persisted null tool fields when copying ordinary user and assistant rows', async () => {
    // ROOT CAUSE:
    // The message read API returns null for absent plugin and tool_call_id fields.
    // Copying those values directly fails CreateNewMessageParamsSchema validation,
    // so real Edit/Resend never reaches the native runtime despite mocked writes passing.
    // The copy now omits absent optional fields at the existing API boundary.
    const { create, rows, topic, writes } = setup();
    for (const row of rows) Object.assign(row, { plugin: null, tool_call_id: null });
    create.mockImplementation(async (row) => {
      CreateNewMessageParamsSchema.parse(row);
      writes.push(row);
      return { id: `new-${writes.length}`, messages: [] };
    });
    const result = await prepareCodexEdit({
      context: { agentId: 'agent', topicId: 'source', threadId: null },
      edit: { content: 'EDITED' },
      messageId: 'u2',
      messages: rows,
      topic,
    });
    /** @example All copied rows pass the same input schema used by the real creation router. */
    expect(writes).toHaveLength(3);
    /** @example The replacement user row is durably saved after the preceding history. */
    expect(result.messageId).toBe('new-3');
  });

  /** @example Persistence failure removes only the incomplete replacement, leaving the source recoverable. */
  it('rejects and cleans up its own partial topic when a copied message cannot be saved', async () => {
    const { create, remove, rows, topic } = setup();
    create.mockRejectedValueOnce(new Error('save failed'));
    const original = structuredClone({ rows, topic });
    /** @example The editor receives the rejection and can retain its draft. */
    await expect(
      prepareCodexEdit({
        context: { agentId: 'agent', topicId: 'source', threadId: null },
        edit: { content: 'UNSAVED' },
        messageId: 'u2',
        messages: rows,
        topic,
      }),
    ).rejects.toThrow('save failed');
    /** @example Cleanup cannot delete or rewrite the source topic. */
    expect(remove).toHaveBeenCalledWith('replacement');
    /** @example Source data stays unchanged after the failed submission. */
    expect({ rows, topic }).toEqual(original);
  });
});
