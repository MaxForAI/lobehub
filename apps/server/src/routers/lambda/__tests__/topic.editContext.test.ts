// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ConversationResourceGuard from '../_helpers/conversationResourceGuard';
import type * as ResolveContext from '../_helpers/resolveContext';
import type * as ShareVisitorTargetGuard from '../_helpers/shareVisitorTargetGuard';

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(() => ({})) }));

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  findSource: vi.fn(),
  guard: vi.fn(),
  resolveSession: vi.fn(),
}));
vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn(function () {
    return { create: mocks.create, findOwnTopicById: mocks.findSource };
  }),
}));
vi.mock('../_helpers/resolveContext', async (importOriginal) => ({
  ...(await importOriginal<typeof ResolveContext>()),
  resolveContextWithAgentId: vi.fn(async () => ({ agentId: 'agent', sessionId: null })),
  resolveAgentIdFromSession: mocks.resolveSession,
}));
vi.mock('../_helpers/conversationResourceGuard', async (importOriginal) => ({
  ...(await importOriginal<typeof ConversationResourceGuard>()),
  assertCanUseConversationTargets: vi.fn(),
  assertCanUseTopicTargets: mocks.guard,
}));
vi.mock('../_helpers/shareVisitorTargetGuard', async (importOriginal) => ({
  ...(await importOriginal<typeof ShareVisitorTargetGuard>()),
  assertCreatorMessageTargets: vi.fn(),
}));

const { topicRouter } = await import('../topic');
const caller = topicRouter.createCaller({ userId: 'owner' } as Parameters<
  typeof topicRouter.createCaller
>[0]);

/** @example Replacement topics inherit project context only from the same accessible conversation. */
describe('Codex edit topic project context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({ id: 'replacement' });
    mocks.findSource.mockResolvedValue({
      agentId: 'agent',
      groupId: null,
      id: 'source',
      projectId: 'project',
      projectWorkingDirectoryId: 'directory',
      metadata: { heteroSessionId: 'original-native-session' },
    });
    mocks.guard.mockResolvedValue(undefined);
    mocks.resolveSession.mockResolvedValue(undefined);
  });

  /** @example A Project edit persists its project directory but never copies native session ownership. */
  it('persists source project and directory bindings in the replacement', async () => {
    // ROOT CAUSE:
    // createTopic stripped the source project association, so the UI temporarily
    // showed inherited fields that disappeared on the next persisted read.
    await caller.createTopic({
      agentId: 'agent',
      title: 'EDITED',
      inheritProjectFromTopicId: 'source',
    });
    /** @example The actual router input reaches storage with both source project fields. */
    expect(mocks.create).toHaveBeenCalledWith({
      agentId: 'agent',
      sessionId: null,
      title: 'EDITED',
      projectId: 'project',
      projectWorkingDirectoryId: 'directory',
    });
    /** @example The source must be readable through the existing conversation access guard. */
    expect(mocks.guard).toHaveBeenCalledWith(expect.any(Object), ['source']);
  });

  /** @example Session-backed history can be edited before asynchronous agent backfill completes. */
  it('inherits context from a legacy topic mapped to the same agent', async () => {
    // ROOT CAUSE:
    // Legacy source rows retain agentId=null while the request resolves to the
    // mapped agent. Comparing raw IDs rejected the same logical conversation.
    // Resolve legacy session ownership before enforcing the existing equality.
    mocks.findSource.mockResolvedValue({
      agentId: null,
      groupId: null,
      sessionId: 'legacy-session',
      projectId: 'project',
      projectWorkingDirectoryId: 'directory',
    });
    mocks.resolveSession.mockResolvedValue('agent');
    await caller.createTopic({
      agentId: 'agent',
      title: 'EDITED',
      inheritProjectFromTopicId: 'source',
    });
    /** @example Session resolution remains scoped to the requesting owner. */
    expect(mocks.resolveSession).toHaveBeenCalledWith(
      'legacy-session',
      expect.any(Object),
      'owner',
      undefined,
    );
    /** @example Canonical ownership permits the original Project context to persist. */
    expect(mocks.create).toHaveBeenCalledWith({
      agentId: 'agent',
      sessionId: null,
      title: 'EDITED',
      projectId: 'project',
      projectWorkingDirectoryId: 'directory',
    });
  });

  /** @example A legacy source mapped to another agent cannot transfer its context. */
  it('rejects a legacy session belonging to another agent', async () => {
    mocks.findSource.mockResolvedValue({
      agentId: null,
      groupId: null,
      sessionId: 'other-session',
    });
    mocks.resolveSession.mockResolvedValue('other-agent');
    /** @example Canonicalization does not weaken the owner equality requirement. */
    await expect(
      caller.createTopic({
        agentId: 'agent',
        title: 'EDITED',
        inheritProjectFromTopicId: 'source',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    /** @example No replacement is written across conversation owners. */
    expect(mocks.create).not.toHaveBeenCalled();
  });

  /** @example Missing session mappings cannot be assumed to belong to the requested agent. */
  it('rejects an unmapped legacy session', async () => {
    mocks.findSource.mockResolvedValue({
      agentId: null,
      groupId: null,
      sessionId: 'unmapped-session',
    });
    /** @example Unresolved ownership remains an explicit preparation failure. */
    await expect(
      caller.createTopic({
        agentId: 'agent',
        title: 'EDITED',
        inheritProjectFromTopicId: 'source',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    /** @example The failed edit has no partial replacement topic. */
    expect(mocks.create).not.toHaveBeenCalled();
  });

  /** @example A missing or inaccessible source cannot create a misleading unbound replacement. */
  it('rejects missing source context before creating any topic', async () => {
    mocks.findSource.mockResolvedValue(undefined);
    /** @example The caller retains the edit draft after NOT_FOUND. */
    await expect(
      caller.createTopic({
        agentId: 'agent',
        title: 'EDITED',
        inheritProjectFromTopicId: 'missing',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    /** @example There is no partial replacement to navigate to. */
    expect(mocks.create).not.toHaveBeenCalled();
  });

  /** @example Context inheritance cannot transfer a project topic to an unrelated agent. */
  it('rejects an owner mismatch before creating any topic', async () => {
    mocks.findSource.mockResolvedValue({ agentId: 'other', groupId: null });
    /** @example The source owner must match the resolved replacement owner. */
    await expect(
      caller.createTopic({
        agentId: 'agent',
        title: 'EDITED',
        inheritProjectFromTopicId: 'source',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    /** @example No write occurs for an incompatible source. */
    expect(mocks.create).not.toHaveBeenCalled();
  });

  /** @example Creating ordinary conversations keeps the pre-existing API behavior. */
  it('does not load source context for ordinary topic creation', async () => {
    await caller.createTopic({ agentId: 'agent', title: 'ordinary' });
    /** @example Existing callers need no source topic. */
    expect(mocks.findSource).not.toHaveBeenCalled();
    /** @example Ordinary creation does not gain project data. */
    expect(mocks.create).toHaveBeenCalledWith({
      agentId: 'agent',
      sessionId: null,
      title: 'ordinary',
    });
  });
});
