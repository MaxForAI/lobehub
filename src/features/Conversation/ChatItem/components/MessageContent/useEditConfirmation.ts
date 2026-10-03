import { toast } from '@lobehub/ui/base-ui';
import { useCallback, useRef } from 'react';

import {
  dataSelectors,
  messageStateSelectors,
  useConversationStore,
} from '@/features/Conversation/store';
import { useCanEditCodexMessage } from '@/hooks/useCanEditCodexMessage';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

/** The permissions and message identity captured by the message editor. */
interface EditConfirmationOptions {
  /** Whether the user may start a new run. */
  canCreate: boolean;
  /** Whether the user may modify the message. */
  canEdit: boolean;
  /** Whether this row owns the open editor. */
  editing?: boolean;
  /** Persisted message id. */
  id: string;
  /** Closes the editor after an accepted submission. */
  onEditingChange: (editing: boolean) => void;
}

/**
 * Selects save or edit-and-resend behavior for the message editor.
 *
 * Use when:
 * - Confirming an edit of a user or assistant message.
 *
 * Expects:
 * - The owning conversation provider and current content permissions.
 *
 * Returns:
 * - A submit callback and whether the editor should offer Send.
 *
 * Call stack:
 * MessageContent
 *   -> useEditConfirmation
 *     -> regenerateUserMessage (Codex edit)
 *     -> updateMessageContent (ordinary edit)
 */
export const useEditConfirmation = ({
  canCreate,
  canEdit,
  editing,
  id,
  onEditingChange,
}: EditConfirmationOptions) => {
  const [updateMessageContent, regenerateUserMessage] = useConversationStore((s) => [
    s.updateMessageContent,
    s.regenerateUserMessage,
  ]);
  const [agentId, topicId] = useConversationStore((s) => [s.context.agentId, s.context.topicId]);
  const canEditCodex = useCanEditCodexMessage(agentId ?? undefined, topicId);
  const isCodex = useAgentStore(agentSelectors.currentAgentHeterogeneousProviderType) === 'codex';
  const isUserMessage = useConversationStore(
    (s) => !!editing && dataSelectors.getDisplayMessageById(id)(s)?.role === 'user',
  );

  // Short-circuit on non-editing rows so streaming token updates stay O(1) per row
  // instead of each row running `findLast` on displayMessages (O(N²) per update).
  // Use isInputLoading (covers sendMessage + AI runtime) rather than isAIGenerating,
  // otherwise the initial send phase — where the persisted id has just swapped in
  // under an optimistic tmp_* op — would flip to Send and kick off a duplicate
  // regenerate for the same prompt.
  const shouldSendOnConfirm = useConversationStore((s) => {
    if (!editing || !isUserMessage || (isCodex && !canEditCodex)) return false;
    if (!isCodex && s.displayMessages.findLast((m) => m.role === 'user')?.id !== id) return false;
    return !messageStateSelectors.isInputLoading(s);
  });

  const submitting = useRef(false);
  const onConfirm = useCallback(
    async (content: string, editorData?: Record<string, unknown>) => {
      if (!canEdit) return;
      if (isCodex && isUserMessage) {
        if (!canEditCodex || !canCreate || !shouldSendOnConfirm) {
          const error = new Error('This conversation cannot accept an edited message right now');
          toast.error(error.message);
          throw error;
        }
        if (submitting.current) {
          const error = new Error('This edit is already being submitted');
          toast.error(error.message);
          throw error;
        }
        submitting.current = true;
        try {
          await regenerateUserMessage(id, {
            content,
            editorData,
            onAccepted: () => onEditingChange(false),
          });
        } catch (error) {
          toast.error(error instanceof Error ? error.message : String(error));
          throw error;
        } finally {
          submitting.current = false;
        }
        return;
      }
      onEditingChange(false);
      // updateMessageContent does an optimistic state update synchronously before
      // awaiting the DB round trip. Kick off regenerate in parallel so the old
      // assistant reply is replaced by switchMessageBranch without waiting for persistence.
      const save = updateMessageContent(id, content, { editorData });
      if (canCreate && shouldSendOnConfirm) await regenerateUserMessage(id);
      await save;
    },
    [
      canCreate,
      canEdit,
      canEditCodex,
      id,
      isCodex,
      isUserMessage,
      onEditingChange,
      regenerateUserMessage,
      shouldSendOnConfirm,
      updateMessageContent,
    ],
  );

  return { onConfirm, shouldSendOnConfirm };
};
