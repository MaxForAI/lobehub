'use client';

import { useMemo } from 'react';

import { useCanForkHeteroAgent } from '@/features/Conversation/hooks/useCanForkHeteroAgent';
import { type ActionsBarConfig, type MessageActionSlot } from '@/features/Conversation/types';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

/**
 * Hetero-agent sessions keep the menu minimal — copy + delete — because the
 * external runtime owns the conversation history. `select` remains available
 * because forwarding / batch deletion is handled by the local conversation UI.
 *
 * The one user-message action that DOES belong here is `restoreToInput`: a long
 * CLI run that errors out or loses context is exactly when you want to pull the
 * original prompt (text + attachments) back into the composer to retry.
 */
const HETERO_USER: { bar: MessageActionSlot[]; menu: MessageActionSlot[] } = {
  bar: ['copy'],
  menu: ['restoreToInput', 'copy', 'divider', 'select', 'divider', 'del'],
};

const HETERO_ASSISTANT: { bar: MessageActionSlot[]; menu: MessageActionSlot[] } = {
  bar: ['copy'],
  menu: ['copy', 'divider', 'select', 'divider', 'del'],
};

/**
 * Agents that fork their native session at a recorded message can rewrite
 * history like a native agent: edit / regenerate rerun from a fork that ends
 * before the message, and branching starts a subtopic from a fork after a
 * reply. User rows record no native position of their own, so they cannot be
 * a branch point.
 */
const FORKABLE_USER: typeof HETERO_USER = {
  bar: ['edit', 'copy'],
  menu: ['edit', 'restoreToInput', 'copy', 'divider', 'select', 'divider', 'del'],
};

const FORKABLE_ASSISTANT: typeof HETERO_ASSISTANT = {
  bar: ['copy', 'regenerate'],
  menu: ['regenerate', 'copy', 'branching', 'divider', 'select', 'divider', 'del'],
};

/**
 * Selects message actions supported by the current agent runtime.
 *
 * Use when:
 * - Configuring the main conversation's message action bars.
 *
 * Expects:
 * - The active agent's configuration is available in the agent store.
 *
 * Returns:
 * - Runtime-specific overrides, or native message defaults via an empty object.
 */
export const useActionsBarConfig = (): ActionsBarConfig => {
  const isHeteroAgent = useAgentStore(agentSelectors.isCurrentAgentHeterogeneous);

  const forkable = useCanForkHeteroAgent();

  return useMemo<ActionsBarConfig>(() => {
    if (isHeteroAgent) {
      return {
        assistant: forkable ? FORKABLE_ASSISTANT : HETERO_ASSISTANT,
        assistantGroup: forkable ? FORKABLE_ASSISTANT : HETERO_ASSISTANT,
        user: forkable ? FORKABLE_USER : HETERO_USER,
      };
    }

    return {};
  }, [isHeteroAgent, forkable]);
};
