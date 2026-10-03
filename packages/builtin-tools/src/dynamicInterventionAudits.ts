import {
  AGENT_ACCOUNT_OUTBOUND_AUDIT,
  agentAccountOutboundAudit,
} from '@lobechat/builtin-tool-agent-account';
import { pathScopeAudit } from '@lobechat/builtin-tool-local-system';
import { type DynamicInterventionResolver } from '@lobechat/types';

export const dynamicInterventionAudits: Record<string, DynamicInterventionResolver> = {
  [AGENT_ACCOUNT_OUTBOUND_AUDIT]: agentAccountOutboundAudit,
  pathScopeAudit,
};
