import { toast } from '@lobehub/ui/base-ui';
import { t } from 'i18next';
import { useCallback } from 'react';

import {
  dataSelectors,
  messageStateSelectors,
  useConversationStore,
} from '@/features/Conversation/store';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

export const useEditConfirmation = ({
  canCreate,
  canEdit,
  editing,
  id,
  onEditingChange,
}: {
  canCreate: boolean;
  canEdit: boolean;
  editing?: boolean;
  id: string;
  onEditingChange: (editing: boolean) => void;
}) => {
  const [updateMessageContent, regenerateUserMessage, forkCodexMessage] = useConversationStore(
    (state) => [state.updateMessageContent, state.regenerateUserMessage, state.forkCodexMessage],
  );
  const isCodex = useAgentStore(
    (state) => agentSelectors.currentAgentHeterogeneousProviderType(state) === 'codex',
  );
  const shouldSendOnConfirm = useConversationStore((state) => {
    if (!editing || dataSelectors.getDisplayMessageById(id)(state)?.role !== 'user') return false;
    if (!isCodex && state.displayMessages.findLast((message) => message.role === 'user')?.id !== id)
      return false;
    return !messageStateSelectors.isInputLoading(state);
  });
  const onConfirm = useCallback(
    async (content: string, editorData?: Record<string, any>) => {
      if (!canEdit) return;
      if (isCodex) {
        if (!canCreate || !shouldSendOnConfirm) return;
        onEditingChange(false);
        try {
          await forkCodexMessage(id, { content, editorData });
        } catch (error) {
          toast.error(
            t('codexForkFailed', {
              ns: 'common',
              message: error instanceof Error ? error.message : String(error),
            }),
          );
        }
        return;
      }
      onEditingChange(false);
      const save = updateMessageContent(id, content, { editorData });
      if (canCreate && shouldSendOnConfirm) await regenerateUserMessage(id);
      await save;
    },
    [
      canCreate,
      canEdit,
      forkCodexMessage,
      id,
      isCodex,
      onEditingChange,
      regenerateUserMessage,
      shouldSendOnConfirm,
      updateMessageContent,
    ],
  );
  return { onConfirm, shouldSendOnConfirm };
};
