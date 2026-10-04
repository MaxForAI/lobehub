import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { canForkHeteroSession } from '@/store/chat/slices/agentRun/actions/transports/hetero/heteroFork';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

/** Whether the current agent's runtime can fork its native session; see `canForkHeteroSession`. */
export const useCanForkHeteroAgent = (): boolean => {
  const codexAppServer = useUserStore(labPreferSelectors.enableCodexAppServer);

  return useAgentStore((s) =>
    canForkHeteroSession(
      agentSelectors.currentAgentConfig(s)?.agencyConfig?.heterogeneousProvider,
      codexAppServer,
    ),
  );
};
