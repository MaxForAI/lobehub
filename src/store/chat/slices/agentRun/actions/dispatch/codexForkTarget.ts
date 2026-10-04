import type { CodexForkTarget } from '@lobechat/types';

interface CodexSourceMessage {
  id: string;
  metadata?: { codexTurnId?: string; heteroSessionId?: string } | null;
  parentId?: string | null;
  threadId?: string | null;
}

/**
 * Resolves a saved message to its exact native Codex history boundary.
 *
 * Use when:
 * - Editing, resending, or branching a persisted Codex message.
 * Expects:
 * - The source row carries its own native thread and turn IDs.
 * Returns:
 * - The requested native boundary, or throws when provenance is unavailable.
 */
export const resolveCodexForkTarget = (
  messages: readonly CodexSourceMessage[],
  sourceMessageId: string,
  position: CodexForkTarget['position'],
): CodexForkTarget => {
  const source = messages.find((message) => message.id === sourceMessageId);
  if (!source) throw new Error('The selected Codex message is unavailable');

  const turnId = source.metadata?.codexTurnId;
  if (!turnId) throw new Error('The selected message has no native Codex turn');
  const threadId = source.metadata?.heteroSessionId;
  if (!threadId) throw new Error('The selected message has no native Codex thread');

  return { position, threadId, turnId };
};

/**
 * Recovers an established native child from its saved message ancestry.
 *
 * Use when:
 * - A pending Fork target survived a failed thread metadata write and reload.
 * Expects:
 * - The current send's ancestry, branch ID, and original source session ID.
 * - The caller has already validated cwd and binding compatibility.
 * Returns:
 * - The nearest recorded child session, never a source or sibling branch session.
 */
export const resolvePersistedCodexChildSession = (
  messages: readonly CodexSourceMessage[],
  messageId: string,
  threadId: string,
  sourceSessionId: string,
): string | undefined => {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const visited = new Set<string>();
  let currentId: string | null | undefined = messageId;

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const message = byId.get(currentId);
    if (!message) return;
    const { codexTurnId, heteroSessionId } = message.metadata ?? {};
    if (
      message.threadId === threadId &&
      codexTurnId &&
      heteroSessionId &&
      heteroSessionId !== sourceSessionId
    ) {
      return heteroSessionId;
    }
    currentId = message.parentId;
  }
};
