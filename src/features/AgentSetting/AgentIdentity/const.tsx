import type { AgentAccountKind } from '@lobechat/types';
import type { LucideIcon } from 'lucide-react';
import { Mail } from 'lucide-react';

/**
 * One address channel the identity tab can open.
 *
 * The pair (kind, provider) is what the control plane is asked for; the icon
 * and copy are presentation. `prefixable` marks the channels where the caller
 * may ask for a specific handle (a mailbox local part, for example); a channel
 * whose handles the provider mints on its own leaves it off.
 */
export interface IdentityChannel {
  descKey: 'identity.mail.desc';
  icon: LucideIcon;
  kind: AgentAccountKind;
  prefixable: boolean;
  provider: string;
  titleKey: 'identity.mail.title';
}

export const IDENTITY_CHANNELS: IdentityChannel[] = [
  {
    descKey: 'identity.mail.desc',
    icon: Mail,
    kind: 'mail',
    prefixable: true,
    provider: 'agent-mail',
    titleKey: 'identity.mail.title',
  },
];
