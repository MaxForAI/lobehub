import { useIsGatewayModeEnabled } from '@/helpers/gatewayMode';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { useAgentStore } from '@/store/agent';
import { selectRuntimeType } from '@/store/chat/slices/agentRun/actions/dispatch/agentDispatcher';

/**
 * Resolves whether a Codex conversation supports local edit-and-resend.
 *
 * Use when:
 * - Showing the user-message Edit action or confirming an open editor.
 *
 * Expects:
 * - The owning agent and, for a captured editor, its topic identity.
 *
 * Returns:
 * - True only after effective configuration resolves to the local Codex runtime.
 */
export const useCanEditCodexMessage = (agentId?: string, topicId?: string | null): boolean => {
  const { agencyConfig, isPreferenceLoading, workspaceScoped } = useEffectiveAgencyConfig(agentId, {
    topicId,
  });
  const isGatewayMode = useIsGatewayModeEnabled(agentId);
  const isWorkspaceAgent = useAgentStore((s) => !!(agentId && s.agentMap[agentId]?.workspaceId));
  if (!agentId || isPreferenceLoading || agencyConfig?.heterogeneousProvider?.type !== 'codex')
    return false;
  try {
    return (
      selectRuntimeType({
        boundDeviceId: agencyConfig.boundDeviceId,
        executionTarget: agencyConfig.executionTarget,
        heterogeneousProvider: agencyConfig.heterogeneousProvider,
        isGatewayMode,
        isWorkspaceAgent,
        workspaceScoped,
      }) === 'hetero'
    );
  } catch {
    // Invalid effective runtime configurations cannot offer an executable edit action.
    return false;
  }
};
