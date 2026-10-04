import { describe, expect, it } from 'vitest';

import type { Message } from '../../types';
import { BranchResolver } from '../BranchResolver';
import { FlatListBuilder } from '../FlatListBuilder';
import { MessageCollector } from '../MessageCollector';
import { MessageTransformer } from '../MessageTransformer';

/**
 * Read-side fix for tpc_MAA6wBdUN1gw "消息链又断了".
 *
 * When the agent parks on a long-running background tool, the stdout push that
 * wakes it is exactly how its real reply arrives: a toolless turn tagged
 * `signal` at stream_start, carrying the whole answer. Treated as a reactive
 * callback it was folded into the collapsed SignalCallbacks accordion while the
 * throwaway acks around it rendered inline — the run looked like it trailed off
 * mid-thought.
 *
 * `signal` is trigger provenance, not structure. `getMessageSignal` already
 * defangs the tag for a turn that emitted TOOLS; this pins the symmetric case —
 * a turn that emitted an ANSWER (prose past the length threshold) is main-chain,
 * while a one-line progress note stays a callback so the accordion still earns
 * its keep on chatty tools.
 */

const toolArr = (id: string) => [
  { apiName: 'Bash', arguments: '{}', id, identifier: 'claude-code', type: 'default' as const },
];

const stdout = (seq: number) =>
  ({
    signal: {
      sequence: seq,
      sourceToolCallId: 'bashwait',
      sourceToolName: 'Bash',
      type: 'tool-stdout',
    },
  }) as any;

const flatten = (messages: Message[]) => {
  const messageMap = new Map<string, Message>();
  const childrenMap = new Map<string | null, string[]>();
  messages.forEach((msg) => {
    messageMap.set(msg.id, msg);
    const parentId = msg.parentId || null;
    if (!childrenMap.has(parentId)) childrenMap.set(parentId, []);
    childrenMap.get(parentId)!.push(msg.id);
  });
  const builder = new FlatListBuilder(
    messageMap,
    new Map(),
    childrenMap,
    new BranchResolver(),
    new MessageCollector(messageMap, childrenMap),
    new MessageTransformer(),
  );
  return builder.flatten(messages);
};

const groupOf = (flat: Message[]) =>
  flat.find((m) => m.role === ('assistantGroup' as any)) as any | undefined;

const callbackIds = (group: any): string[] =>
  (group?.signalCallbacks ?? []).flatMap((b: any) => b.callbacks.map((c: any) => c.id));

// A 200+ char answer, the shape that arrives on a background-tool stdout push.
const answer = 'PLANMARKER 探查回来了，方案可以落到文件级，这是完整判断：'.padEnd(220, '。');

//   W     — spine turn that launched a background Bash and parked
//   PLAN  — the turn its stdout push woke; toolless, carrying the ANSWER
//   ACK   — a second push wakes a one-line note ("timer fired, nothing new")
const scenario = (): Message[] => [
  { content: 'go', createdAt: 0, id: 'u1', role: 'user', updatedAt: 0 },
  {
    agentId: 'a',
    content: '两个探查 agent 在跑',
    createdAt: 100,
    id: 'W',
    parentId: 'u1',
    role: 'assistant',
    tools: toolArr('bashwait'),
    updatedAt: 100,
  },
  {
    content: 'Command running in background',
    createdAt: 110,
    id: 'toolW',
    parentId: 'W',
    role: 'tool',
    tool_call_id: 'bashwait',
    updatedAt: 110,
  } as any,
  {
    agentId: 'a',
    content: answer,
    createdAt: 120,
    id: 'PLAN',
    metadata: stdout(1),
    parentId: 'toolW',
    role: 'assistant',
    updatedAt: 120,
  },
  {
    agentId: 'a',
    content: 'ACKMARKER （那只是计时器到点了，没有新信息。）',
    createdAt: 130,
    id: 'ACK',
    metadata: stdout(2),
    parentId: 'toolW',
    role: 'assistant',
    updatedAt: 130,
  },
];

describe('signal turn that emits an answer — read-side main-chain (tpc_MAA6wBdUN1gw)', () => {
  it('renders the answer on the main chain, not folded into the accordion', () => {
    const flat = flatten(scenario());
    const group = groupOf(flat);

    expect(group).toBeDefined();
    // The answer renders as a chain step …
    expect(JSON.stringify(flat)).toContain('PLANMARKER');
    expect(callbackIds(group)).not.toContain('PLAN');
    // … while the one-line note stays in the collapsed accordion.
    expect(callbackIds(group)).toContain('ACK');
  });

  it('keeps a short reactive note as a callback (accordion still earns its keep)', () => {
    // Drop the long answer; only the note remains under the tool.
    const flat = flatten(scenario().filter((m) => m.id !== 'PLAN'));
    const group = groupOf(flat);

    expect(callbackIds(group)).toEqual(['ACK']);
  });
});
