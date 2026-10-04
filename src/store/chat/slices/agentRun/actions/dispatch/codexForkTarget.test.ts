import { describe, expect, it } from 'vitest';

import { resolveCodexForkTarget, resolvePersistedCodexChildSession } from './codexForkTarget';

describe('resolveCodexForkTarget', () => {
  const selected = {
    id: 'message-selected',
    metadata: { codexTurnId: 'native-turn-7', heteroSessionId: 'native-child-thread' },
  };

  it('uses native provenance even when earlier UI messages are not loaded', () => {
    expect(resolveCodexForkTarget([selected], selected.id, 'after')).toEqual({
      position: 'after',
      threadId: 'native-child-thread',
      turnId: 'native-turn-7',
    });
  });

  it('uses the same native turn as an exclusive boundary for an edit', () => {
    expect(resolveCodexForkTarget([selected], selected.id, 'before')).toEqual({
      position: 'before',
      threadId: 'native-child-thread',
      turnId: 'native-turn-7',
    });
  });

  it('rejects a missing source instead of resuming the original topic', () => {
    expect(() => resolveCodexForkTarget([selected], 'missing', 'after')).toThrow(
      'The selected Codex message is unavailable',
    );
  });

  it('rejects legacy rows without a reliable native turn boundary', () => {
    expect(() =>
      resolveCodexForkTarget(
        [{ id: 'legacy', metadata: { heteroSessionId: 'source' } }],
        'legacy',
        'after',
      ),
    ).toThrow('The selected message has no native Codex turn');
  });

  it('rejects turn metadata without a native thread', () => {
    expect(() =>
      resolveCodexForkTarget(
        [{ id: 'orphan', metadata: { codexTurnId: 'turn-1' } }],
        'orphan',
        'after',
      ),
    ).toThrow('The selected message has no native Codex thread');
  });
});

/** @example A stale thread row can recover its child without choosing a sibling session. */
describe('resolvePersistedCodexChildSession', () => {
  const child = {
    id: 'child-answer',
    parentId: 'source-answer',
    threadId: 'branch',
    metadata: { codexTurnId: 'child-turn', heteroSessionId: 'native-child' },
  };
  const source = {
    id: 'source-answer',
    threadId: null,
    metadata: { codexTurnId: 'source-turn', heteroSessionId: 'native-source' },
  };
  const prompt = { id: 'next-user', parentId: child.id, threadId: 'branch' };

  /** @example Order and unrelated native sessions do not change the selected ancestor. */
  it('recovers the nearest own child from unordered durable ancestry', () => {
    const sibling = {
      ...child,
      id: 'sibling',
      metadata: { codexTurnId: 'other-turn', heteroSessionId: 'other-session' },
    };
    /** @example The sibling is newer in the array but is not the prompt ancestor. */
    expect(
      resolvePersistedCodexChildSession(
        [prompt, child, sibling, source],
        prompt.id,
        'branch',
        'native-source',
      ),
    ).toBe('native-child');
  });

  /** @example An inherited source row cannot masquerade as the child's binding. */
  it('does not recover a source or another branch', () => {
    /** @example A source session stamped on a branch row is still not a child. */
    expect(
      resolvePersistedCodexChildSession(
        [prompt, { ...child, metadata: source.metadata }],
        prompt.id,
        'branch',
        'native-source',
      ),
    ).toBeUndefined();
    /** @example Another branch's native ID is not recoverable for this branch. */
    expect(
      resolvePersistedCodexChildSession(
        [prompt, { ...child, threadId: 'other' }],
        prompt.id,
        'branch',
        'native-source',
      ),
    ).toBeUndefined();
  });

  /** @example Legacy rows without native turn provenance cannot establish a handoff. */
  it('ignores incomplete provenance', () => {
    /** @example A session ID without a native turn could be inherited pending state. */
    expect(
      resolvePersistedCodexChildSession(
        [prompt, { ...child, metadata: { heteroSessionId: 'native-child' } }],
        prompt.id,
        'branch',
        'native-source',
      ),
    ).toBeUndefined();
  });

  /** @example Incomplete or cyclic history terminates without guessing a child. */
  it('terminates on missing and cyclic ancestry', () => {
    /** @example A missing ancestor cannot be replaced with an unrelated loaded child. */
    expect(
      resolvePersistedCodexChildSession(
        [{ ...prompt, parentId: 'missing' }, child],
        prompt.id,
        'branch',
        'native-source',
      ),
    ).toBeUndefined();
    /** @example A cycle with no native provenance does not loop forever. */
    expect(
      resolvePersistedCodexChildSession(
        [{ ...prompt, parentId: prompt.id }],
        prompt.id,
        'branch',
        'native-source',
      ),
    ).toBeUndefined();
  });
});
