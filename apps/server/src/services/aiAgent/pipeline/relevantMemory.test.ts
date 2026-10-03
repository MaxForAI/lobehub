// @vitest-environment node
/**
 * `fetchRelevantMemory` — the retrieval half of server-run memory injection.
 * The assertions pin the two things a caller depends on: the retrieval query /
 * top-k it sends, and the `UserMemoryData` shape it returns.
 */
import { RequestTrigger } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as userMemoryModule from '@/database/models/userMemory';

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(async () => ({ embeddings: vi.fn() })),
}));

vi.mock('@/server/globalConfig', () => ({
  getServerDefaultFilesConfig: () => ({}),
}));

const createFtsSearchRepo = vi.fn();
vi.mock('@/server/services/ftsSearch', () => ({
  createFtsSearchRepo: (...args: unknown[]) => createFtsSearchRepo(...args),
}));

const embedUserMemoryTexts = vi.fn();
vi.mock('@/server/services/memory/userMemory/embedding', () => ({
  embedUserMemoryTexts: (...args: unknown[]) => embedUserMemoryTexts(...args),
}));

const searchMemory = vi.fn();
const memoryModelArgs = vi.fn();
vi.mock('@/database/models/userMemory', async (importOriginal) => {
  const actual = await importOriginal<typeof userMemoryModule>();
  return {
    ...actual,
    UserMemoryModel: class {
      constructor(...args: unknown[]) {
        memoryModelArgs(...args);
      }

      searchMemory(...args: unknown[]) {
        return searchMemory(...args);
      }
    },
  };
});

const { fetchRelevantMemory } = await import('./relevantMemory');

const emptyResult = {
  activities: [],
  contexts: [],
  experiences: [],
  identities: [],
  preferences: [],
};

describe('fetchRelevantMemory', () => {
  beforeEach(() => {
    memoryModelArgs.mockReset();
    createFtsSearchRepo.mockReset().mockResolvedValue({ kind: 'fts-repo' });
    embedUserMemoryTexts.mockReset().mockResolvedValue([[0.1, 0.2, 0.3]]);
    searchMemory.mockReset().mockResolvedValue({
      activities: [],
      contexts: [{ description: 'the personal agent goal', id: 'ctx-1', title: 'Project' }],
      experiences: [{ id: 'exp-1', keyLearning: 'ship in small PRs', situation: 'release' }],
      identities: [
        {
          createdAt: new Date('2026-01-02T00:00:00Z'),
          description: 'maintains LobeHub',
          id: 'idn-1',
          role: 'engineer',
          type: 'professional',
        },
      ],
      preferences: [{ conclusionDirectives: 'no emoji', id: 'prf-1' }],
    });
  });

  it('queries with the trimmed prompt and the injection top-k budget', async () => {
    await fetchRelevantMemory({
      db: {} as never,
      prompt: '  what did we decide about releases?  ',
      userId: 'user-1',
    });

    expect(embedUserMemoryTexts).toHaveBeenCalledWith(
      expect.objectContaining({ input: ['what did we decide about releases?'], userId: 'user-1' }),
    );
    expect(searchMemory).toHaveBeenCalledWith(
      {
        queries: ['what did we decide about releases?'],
        topK: { activities: 0, contexts: 3, experiences: 3, identities: 2, preferences: 3 },
      },
      [[0.1, 0.2, 0.3]],
    );
  });

  it('ranks through the same lexical candidate source as the searchMemory tool', async () => {
    await fetchRelevantMemory({ db: {} as never, prompt: 'release cadence', userId: 'user-1' });

    expect(createFtsSearchRepo).toHaveBeenCalledWith(
      expect.objectContaining({ usage: 'memory', userId: 'user-1' }),
    );
    expect(memoryModelArgs).toHaveBeenCalledWith(expect.anything(), 'user-1', {
      kind: 'fts-repo',
    });
  });

  it('bills the query embedding to the share visitor origin when given', async () => {
    const spendOrigin = {
      agentShare: { agentId: 'agt-1', shareId: 'shr-1', visitorUserId: 'visitor-1' },
      trigger: RequestTrigger.AgentShare,
    };

    await fetchRelevantMemory({
      db: {} as never,
      prompt: 'release cadence',
      spendOrigin,
      userId: 'user-1',
    });

    expect(embedUserMemoryTexts).toHaveBeenCalledWith(expect.objectContaining({ spendOrigin }));
  });

  it('maps the search result onto the context-engine memory shape', async () => {
    const memory = await fetchRelevantMemory({
      db: {} as never,
      prompt: 'release cadence',
      userId: 'user-1',
    });

    expect(memory).toEqual({
      contexts: [{ description: 'the personal agent goal', id: 'ctx-1', title: 'Project' }],
      experiences: [{ id: 'exp-1', keyLearning: 'ship in small PRs', situation: 'release' }],
      identities: [
        {
          capturedAt: new Date('2026-01-02T00:00:00Z'),
          description: 'maintains LobeHub',
          id: 'idn-1',
          role: 'engineer',
          type: 'professional',
        },
      ],
      preferences: [{ conclusionDirectives: 'no emoji', id: 'prf-1' }],
    });
  });

  it('returns undefined for a blank prompt without calling the provider', async () => {
    await expect(
      fetchRelevantMemory({ db: {} as never, prompt: '   ', userId: 'user-1' }),
    ).resolves.toBeUndefined();
    expect(embedUserMemoryTexts).not.toHaveBeenCalled();
    expect(searchMemory).not.toHaveBeenCalled();
  });

  it('returns undefined when nothing matches', async () => {
    searchMemory.mockResolvedValue(emptyResult);

    await expect(
      fetchRelevantMemory({ db: {} as never, prompt: 'release cadence', userId: 'user-1' }),
    ).resolves.toBeUndefined();
  });

  it('still searches lexically when the embedding call yields nothing', async () => {
    embedUserMemoryTexts.mockResolvedValue([undefined]);

    await fetchRelevantMemory({
      db: {} as never,
      prompt: 'release cadence',
      userId: 'user-1',
    });

    expect(searchMemory).toHaveBeenCalledWith(expect.anything(), []);
  });
});
