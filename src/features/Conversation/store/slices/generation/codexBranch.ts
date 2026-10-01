import type {
  ChatTopicMetadata,
  ConversationContext,
  CreateMessageParams,
  CreateThreadParams,
  UIChatMessage,
} from '@lobechat/types';

import { setHeteroSessionIdForWorkingDirectory } from '@/helpers/heteroSessionByWorkingDirectory';
import { resolveCodexForkTarget } from '@/store/chat/slices/agentRun/actions/dispatch/codexForkTarget';

export interface CodexMessageEdit {
  content: string;
  editorData?: Record<string, any>;
}
type SourceMessage = Pick<
  UIChatMessage,
  | 'id'
  | 'role'
  | 'content'
  | 'metadata'
  | 'threadId'
  | 'editorData'
  | 'files'
  | 'fileList'
  | 'imageList'
  | 'audioList'
  | 'videoList'
>;

export const buildCodexBranchParams = ({
  context,
  source,
  runtimeMetadata,
  edit,
}: {
  context: ConversationContext;
  source: SourceMessage;
  runtimeMetadata: ChatTopicMetadata;
  edit?: CodexMessageEdit;
}): { threadParams: CreateThreadParams; messageParams?: CreateMessageParams } => {
  if (!context.topicId) throw new Error('Codex branches require a saved topic');
  if (edit && source.role !== 'user')
    throw new Error('Only user messages can be edited and resent');
  const resend = edit ?? (source.role === 'user' ? { content: source.content } : undefined);
  const target = resolveCodexForkTarget([source], source.id, resend ? 'before' : 'after');
  const threadParams: CreateThreadParams = {
    agentId: context.agentId,
    groupId: context.groupId ?? undefined,
    parentThreadId: source.threadId ?? undefined,
    sourceMessageId: source.id,
    topicId: context.topicId,
    type: 'continuation',
    metadata: {
      codexForkTarget: target,
      sourceMessageExcluded: Boolean(resend),
      heteroSessionBindingKey: runtimeMetadata.heteroSessionBindingKey,
      heteroSessionBindingKeyByWorkingDirectory:
        runtimeMetadata.heteroSessionBindingKeyByWorkingDirectory,
      heteroSessionId: target.threadId,
      heteroSessionIdByWorkingDirectory: setHeteroSessionIdForWorkingDirectory(
        runtimeMetadata,
        runtimeMetadata.workingDirectory,
        target.threadId,
      ),
      workingDirectory: runtimeMetadata.workingDirectory,
      workingDirectoryConfig: runtimeMetadata.workingDirectoryConfig,
    },
  };
  if (!resend) return { threadParams };

  const metadata = { ...source.metadata };
  delete metadata.activeBranchIndex;
  delete metadata.codexTurnId;
  delete metadata.heteroMessageId;
  delete metadata.heteroSessionId;
  delete metadata.operationId;
  const files = [
    ...new Set([
      ...(source.files ?? []),
      ...(source.fileList ?? []).map((file) => file.id),
      ...(source.imageList ?? []).map((file) => file.id),
      ...(source.audioList ?? []).map((file) => file.id),
      ...(source.videoList ?? []).map((file) => file.id),
    ]),
  ];
  return {
    threadParams,
    messageParams: {
      agentId: context.agentId,
      content: resend.content,
      editorData: edit?.editorData ?? source.editorData ?? undefined,
      files,
      metadata,
      role: 'user',
      topicId: context.topicId,
    },
  };
};
