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
    vi.spyOn(topicService, 'updateTopicMetadata').mockResolvedValue([]);
    const remove = vi.spyOn(topicService, 'removeTopic').mockResolvedValue(undefined);
    const writes: Parameters<typeof messageService.createMessage>[0][] = [];
    const persist = vi
      .spyOn(messageService, 'batchMutateOrThrow')
      .mockImplementation(async (operations) => {
        for (const operation of operations) {
          if (operation.type === 'createMessage') writes.push(operation.message);
        }
        return { success: true };
      });
    return { persist, remove, rows, topic, writes };
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

  /** @example Copied reasoning and failed tool cards retain their historical presentation. */
  it('preserves ancestor presentation without retaining intervention ownership', async () => {
    // ROOT CAUSE:
    // The edit copy selected only text/tool payloads, dropping persisted reasoning
    // and errors consumed by AssistantGroup. Copy display fields, not old run ids.
    const { rows, topic, writes } = setup();
    rows[1].reasoning = { content: 'Prior reasoning', duration: 4 };
    rows[1].error = { type: 'ProviderBizError', message: 'Prior failure' };
    rows[1].model = 'prior-model';
    rows[1].provider = 'prior-provider';
    rows[1].metadata = { heteroMessageId: 'old-message', heteroSessionId: 'old-session' };
    rows.splice(2, 0, {
      ...message('tool', 'a1', 'tool'),
      plugin: { identifier: 'fixture', apiName: 'read', arguments: '{}', type: 'builtin' },
      pluginError: { message: 'Prior tool failure' },
      pluginIntervention: {
        status: 'rejected',
        rejectedReason: 'User declined',
        skipped: true,
        operationId: 'old-operation',
        batchId: 'old-batch',
        resolutionRequestId: 'old-resolution',
      },
    });
    rows[3].parentId = 'tool';
    const original = structuredClone(rows);
    await prepareCodexEdit({
      context: { agentId: 'agent', topicId: 'source' },
      edit: { content: 'EDITED' },
      messageId: 'u2',
      messages: rows,
      topic,
    });
    /** @example The historical assistant renders the same reasoning/error/model. */
    expect(writes[1]).toMatchObject({
      reasoning: rows[1].reasoning,
      error: rows[1].error,
      model: 'prior-model',
      provider: 'prior-provider',
    });
    /** @example Tool failure and decision presentation survive, with no live operation ownership. */
    expect(writes[2]).toMatchObject({
      pluginError: { message: 'Prior tool failure' },
      pluginIntervention: { status: 'rejected', rejectedReason: 'User declined', skipped: true },
    });
    /** @example The new historical card cannot resume or resolve the old operation. */
    expect(writes[2].pluginIntervention).toEqual({
      status: 'rejected',
      rejectedReason: 'User declined',
      skipped: true,
    });
    /** @example Native session/turn provenance is not copied with render data. */
    expect(writes[1].metadata).not.toHaveProperty('heteroMessageId');
    /** @example Copying never changes the source rows. */
    expect(rows).toEqual(original);
  });

  /** @example A visible edited prompt can inherit ancestors across multiple server pages. */
  it('loads missing ancestry with lossless cursors before persisting the edit', async () => {
    // ROOT CAUSE:
    // dbMessages contains only loaded pages. Reloading fetches the same newest
    // window, so a missing parent previously made a valid historical edit unusable.
    const { rows, topic, writes } = setup();
    const cursor1 = { createdAt: '2026-10-01T00:00:00.123456Z', id: 'u2' };
    const cursor2 = { createdAt: '2026-10-01T00:00:00.123455Z', id: 'a1' };
    const newest = vi
      .spyOn(messageService, 'getMessageListPage')
      .mockResolvedValue({ messages: rows.slice(2), olderCursor: cursor1 });
    const earlier = vi
      .spyOn(messageService, 'getEarlierMessages')
      .mockResolvedValueOnce({ messages: [rows[1]], olderCursor: cursor2 })
      .mockResolvedValueOnce({ messages: [rows[0]], olderCursor: null });
    await prepareCodexEdit({
      context: { agentId: 'agent', topicId: 'source' },
      edit: { content: 'EDITED' },
      messageId: 'u2',
      messages: rows.slice(2),
      topic,
    });
    /** @example Pagination uses the captured source identity. */
    expect(newest).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agent', topicId: 'source' }),
    );
    /** @example Server microsecond cursors are passed unchanged, avoiding boundary loss. */
    expect(earlier.mock.calls.map((call) => call[1])).toEqual([cursor1, cursor2]);
    /** @example Only the selected ancestry is copied, in order, excluding later replies. */
    expect(writes.map((row) => row.content)).toEqual(['PRIOR-CONTEXT', 'a1', 'EDITED']);
  });

  /** @example Deleted or corrupt ancestors still fail before creating any replacement. */
  it('rejects missing ancestry after server history is exhausted without writing', async () => {
    const { rows, topic, writes } = setup();
    vi.spyOn(messageService, 'getMessageListPage').mockResolvedValue({
      messages: rows.slice(2),
      olderCursor: null,
    });
    const earlier = vi.spyOn(messageService, 'getEarlierMessages');
    /** @example Exhausting actual history cannot silently truncate the replacement context. */
    await expect(
      prepareCodexEdit({
        context: { agentId: 'agent', topicId: 'source' },
        edit: { content: 'EDITED' },
        messageId: 'u2',
        messages: rows.slice(2),
        topic,
      }),
    ).rejects.toThrow('incomplete');
    /** @example No topic or partial message batch exists on a failed ancestry read. */
    expect(topicService.createTopic).not.toHaveBeenCalled();
    /** @example No writes occur before complete ancestry is known. */
    expect(writes).toEqual([]);
    /** @example Exhaustion never loops or invents a cursor. */
    expect(earlier).not.toHaveBeenCalled();
  });

  /** @example A failed history read leaves a retryable draft and the source untouched. */
  it('propagates history pagination failure before saving', async () => {
    const { rows, topic, writes } = setup();
    vi.spyOn(messageService, 'getMessageListPage').mockRejectedValue(new Error('history offline'));
    /** @example The caller receives the actual fetch failure and retains its editor. */
    await expect(
      prepareCodexEdit({
        context: { agentId: 'agent', topicId: 'source' },
        edit: { content: 'EDITED' },
        messageId: 'u2',
        messages: rows.slice(2),
        topic,
      }),
    ).rejects.toThrow('history offline');
    /** @example Failed reads cannot leave an incomplete replacement topic. */
    expect(topicService.createTopic).not.toHaveBeenCalled();
    /** @example No copied rows exist after a read failure. */
    expect(writes).toEqual([]);
  });

  /** @example Editing a Project conversation keeps its persisted project and directory association. */
  it('requests the source project binding when creating the replacement topic', async () => {
    // ROOT CAUSE:
    // Spreading the source topic only preserved project fields in memory, while
    // createTopic omitted them from storage and the replacement left its Project.
    const { rows, topic } = setup();
    topic.projectId = 'project';
    topic.projectWorkingDirectoryId = 'directory';
    await prepareCodexEdit({
      context: { agentId: 'agent', topicId: 'source', threadId: null },
      edit: { content: 'EDITED' },
      messageId: 'u2',
      messages: rows,
      topic,
    });
    /** @example The server derives both bindings from the authorized source topic. */
    expect(topicService.createTopic).toHaveBeenCalledWith(
      expect.objectContaining({ inheritProjectFromTopicId: 'source' }),
    );
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
    const { persist, rows, topic, writes } = setup();
    for (const row of rows) Object.assign(row, { plugin: null, tool_call_id: null });
    persist.mockImplementation(async (operations) => {
      for (const operation of operations) {
        if (operation.type !== 'createMessage') continue;
        CreateNewMessageParamsSchema.parse(operation.message);
        writes.push(operation.message);
      }
      return { success: true };
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
    expect(result.messageId).toBe(writes[2].id);
  });

  /** @example A long history copies in bounded batches without rereading the whole topic per row. */
  it('copies 201 rows in two bounded requests while preserving every parent link', async () => {
    // ROOT CAUSE:
    // createMessage rereads the topic after every insert; N ancestor rows caused
    // N serialized round trips and repeated growing full-history responses.
    // Preallocated ids let the existing batch API preserve ordering without rereads.
    const { topic } = setup();
    const rows = Array.from({ length: 201 }, (_, i) =>
      message(`u${i}`, i ? `u${i - 1}` : undefined),
    );
    const batch = vi
      .spyOn(messageService, 'batchMutateOrThrow')
      .mockResolvedValue({ success: true });
    await prepareCodexEdit({
      context: { agentId: 'agent', topicId: 'source', threadId: null },
      edit: { content: 'EDITED' },
      messageId: 'u200',
      messages: rows,
      topic,
    });
    /** @example The router accepts at most 200 operations per request. */
    expect(batch.mock.calls.map(([operations]) => operations.length)).toEqual([200, 1]);
    const copies = batch.mock.calls
      .flatMap(([operations]) => operations)
      .flatMap((operation) => (operation.type === 'createMessage' ? [operation.message] : []));
    /** @example Parent ids connect the history across the batch boundary. */
    expect(copies.every((row, i) => row.id && row.parentId === copies[i - 1]?.id)).toBe(true);
    /** @example The final persisted prompt is the replacement. */
    expect(copies.at(-1)?.content).toBe('EDITED');
  });

  /** @example A later batch failure also removes earlier saved copies and preserves the source. */
  it('cleans up the replacement when a later batch fails', async () => {
    const { persist, remove, topic } = setup();
    const rows = Array.from({ length: 201 }, (_, i) =>
      message(`u${i}`, i ? `u${i - 1}` : undefined),
    );
    const source = structuredClone(rows);
    persist
      .mockResolvedValueOnce({ success: true })
      .mockRejectedValueOnce(new Error('second batch failed'));
    /** @example The caller retains its draft instead of accepting a partial history. */
    await expect(
      prepareCodexEdit({
        context: { agentId: 'agent', topicId: 'source', threadId: null },
        edit: { content: 'EDITED' },
        messageId: 'u200',
        messages: rows,
        topic,
      }),
    ).rejects.toThrow('second batch failed');
    /** @example Cleanup targets only the new topic. */
    expect(remove).toHaveBeenCalledWith('replacement');
    /** @example Every original row remains unchanged. */
    expect(rows).toEqual(source);
  });

  /** @example Persistence failure removes only the incomplete replacement, leaving the source recoverable. */
  it('rejects and cleans up its own partial topic when a copied message cannot be saved', async () => {
    const { persist, remove, rows, topic } = setup();
    persist.mockRejectedValueOnce(new Error('save failed'));
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
