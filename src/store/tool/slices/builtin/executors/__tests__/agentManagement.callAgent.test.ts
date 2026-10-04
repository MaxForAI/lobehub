import { agentManagementExecutor } from '@lobechat/builtin-tool-agent-management/executor';
import { describe, expect, it } from 'vitest';

describe('agentManagementExecutor.callAgent', () => {
  it('rejects a persisted runAsTask argument instead of silently delegating synchronously', async () => {
    // `runAsTask` was removed from `CallAgentParams`; the cast models a tool call
    // persisted under the retired manifest and replayed when an operation resumes.
    const legacyParams = {
      agentId: 'agent-target',
      instruction: 'Do the thing',
      runAsTask: true,
    } as never;

    const result = await agentManagementExecutor.callAgent(legacyParams, {} as never);

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('deprecated_parameter');
  });
});
