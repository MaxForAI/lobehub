import { describe, expect, it } from 'vitest';

import { buildCodexBranchParams } from './codexBranch';

describe('buildCodexBranchParams', () => {
  const source = {
    id: 'original-user',
    role: 'user' as const,
    content: 'original',
    editorData: { attachment: 'image-1' },
    imageList: [{ id: 'image-1', url: 'https://example.test/image.png', alt: 'image' }],
    fileList: [
      {
        id: 'file-1',
        name: 'document.txt',
        size: 10,
        fileType: 'text/plain',
        url: 'https://example.test/doc.txt',
      },
    ],
    metadata: { codexTurnId: 'turn-7', heteroSessionId: 'native-source', activeBranchIndex: 2 },
    threadId: 'parent-branch',
  };
  const context = { agentId: 'agent', topicId: 'topic', threadId: 'parent-branch' };
  const runtimeMetadata = {
    workingDirectory: '/work/project',
    heteroSessionBindingKey: 'native:codex',
  };

  it('creates a replacement prompt and exclusive child without modifying the source', () => {
    const before = structuredClone(source);
    const result = buildCodexBranchParams({
      context,
      source,
      runtimeMetadata,
      edit: { content: 'edited', editorData: { attachment: 'image-1', edited: true } },
    });
    expect(source).toEqual(before);
    expect(result.threadParams).toMatchObject({
      parentThreadId: 'parent-branch',
      sourceMessageId: 'original-user',
      topicId: 'topic',
      type: 'continuation',
      metadata: {
        sourceMessageExcluded: true,
        codexForkTarget: { position: 'before', threadId: 'native-source', turnId: 'turn-7' },
        workingDirectory: '/work/project',
      },
    });
    expect(result.messageParams).toMatchObject({
      agentId: 'agent',
      topicId: 'topic',
      role: 'user',
      content: 'edited',
      editorData: { attachment: 'image-1', edited: true },
      files: ['file-1', 'image-1'],
    });
    expect(result.messageParams?.metadata).not.toHaveProperty('codexTurnId');
    expect(result.messageParams?.metadata).not.toHaveProperty('activeBranchIndex');
  });

  it('forks at a user prompt without retaining its old native answer', () => {
    const result = buildCodexBranchParams({ context, source, runtimeMetadata });
    expect(result.threadParams.metadata).toMatchObject({
      sourceMessageExcluded: true,
      codexForkTarget: { position: 'before', threadId: 'native-source', turnId: 'turn-7' },
    });
    expect(result.messageParams).toMatchObject({
      role: 'user',
      content: 'original',
      files: ['file-1', 'image-1'],
    });
  });

  it('stages an inclusive native fork without inventing a user message', () => {
    const result = buildCodexBranchParams({
      context,
      source: { ...source, role: 'assistant' },
      runtimeMetadata,
    });
    expect(result.messageParams).toBeUndefined();
    expect(result.threadParams.metadata).toMatchObject({
      sourceMessageExcluded: false,
      codexForkTarget: { position: 'after', threadId: 'native-source', turnId: 'turn-7' },
    });
  });

  it('rejects editing an assistant message', () => {
    expect(() =>
      buildCodexBranchParams({
        context,
        runtimeMetadata,
        source: { ...source, role: 'assistant' },
        edit: { content: 'edited' },
      }),
    ).toThrow('Only user messages can be edited and resent');
  });
});
