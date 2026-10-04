import type { HeterogeneousForkPoint } from '@lobechat/types';

interface HeteroHistoryMessage {
  id: string;
  metadata?: { heteroMessageId?: string; heteroSessionId?: string } | null;
  parentId?: string | null;
  threadId?: string | null;
}

/**
 * Finds the nearest message at or above `messageId` (along its parent chain,
 * so sibling branches never count) that recorded its native session position.
 */
export const findHeteroForkSource = <T extends HeteroHistoryMessage>(
  messages: readonly T[],
  messageId: string | null | undefined,
): { message: T; point: HeterogeneousForkPoint } | undefined => {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const visited = new Set<string>();

  for (let id = messageId; id && !visited.has(id);) {
    visited.add(id);
    const message = byId.get(id);
    if (!message) return;

    const { heteroMessageId, heteroSessionId } = message.metadata ?? {};
    if (heteroMessageId && heteroSessionId) {
      return { message, point: { afterMessageId: heteroMessageId, sessionId: heteroSessionId } };
    }
    id = message.parentId;
  }
};

/**
 * Native history for re-running `messageId` (regenerate / edit): a fork that
 * ends right before it, `null` for a fresh session when it opens the
 * conversation, or `undefined` when no recorded position exists (rows from
 * before the agent recorded one), keeping the plain resume.
 */
export const resolveHeteroRerunFork = (
  messages: readonly HeteroHistoryMessage[],
  messageId: string,
): HeterogeneousForkPoint | null | undefined => {
  const message = messages.find((item) => item.id === messageId);
  if (!message) return;
  if (!message.parentId) return null;

  return findHeteroForkSource(messages, message.parentId)?.point;
};
