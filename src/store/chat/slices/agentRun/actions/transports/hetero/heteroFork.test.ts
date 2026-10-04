import { describe, expect, it } from 'vitest';

import { findHeteroForkSource, resolveHeteroRerunFork } from './heteroFork';

const recorded = (id: string, parentId?: string, threadId?: string) => ({
  id,
  metadata: { heteroMessageId: `native-${id}`, heteroSessionId: 'session-1' },
  parentId,
  threadId,
});

const messages = [
  { id: 'u1' },
  recorded('a1', 'u1'),
  { id: 'u2', parentId: 'a1' },
  // A run that failed before the CLI reported its position.
  { id: 'failed', parentId: 'u2' },
  { id: 'u3', parentId: 'failed' },
  // A sibling branch must never become the fork point.
  recorded('sibling', 'u2'),
];

describe('heteroFork', () => {
  it('forks from the nearest recorded ancestor, skipping unrecorded rows', () => {
    expect(findHeteroForkSource(messages, 'u3')?.point).toEqual({
      afterMessageId: 'native-a1',
      sessionId: 'session-1',
    });
  });

  it('reruns a message from a fork that ends before it', () => {
    expect(resolveHeteroRerunFork(messages, 'u2')?.afterMessageId).toBe('native-a1');
  });

  it('starts a fresh session when the message opens the conversation', () => {
    expect(resolveHeteroRerunFork(messages, 'u1')).toBeNull();
  });

  it('keeps the plain resume when no position was recorded', () => {
    expect(
      resolveHeteroRerunFork([{ id: 'a0' }, { id: 'u', parentId: 'a0' }], 'u'),
    ).toBeUndefined();
  });
});
