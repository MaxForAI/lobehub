import type { CodexForkTarget } from '@lobechat/types';

interface CodexSourceMessage {
  id: string;
  metadata?: { codexTurnId?: string; heteroSessionId?: string } | null;
}

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
