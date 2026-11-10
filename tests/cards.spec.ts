import { expect, it } from 'vitest'
import { masterPrompt, workerPrompt } from '../src/app/context.ts'
import { composePrompt, defaultPrompts } from '../src/app/prompts.ts'
import { promptFile } from '../src/app/skill-files.ts'
import { TICKET_STATES, decisionCard, decisionDetails, ticketCard, ticketDetails, triggerCard, threadCard } from '../src/app/cards.ts'
import { key, said, type Decision, type Thread, type Ticket, type Trigger } from '../src/core/index.ts'

/**
 * Built-in prompt and skill contract: target file (`skill <name>` for a bundled skill, `*` for both composed prompts),
 * required phrases, and forbidden phrases (case-insensitive).
 * Words no text may use, tool names and schema options are checked in tests/model-surface.spec.ts.
 */

it('keeps each role\'s own instructions short', () => {
  expect(masterPrompt.length).toBeLessThan(1400)
  expect(workerPrompt.length).toBeLessThan(1000)
})

const trigger: Trigger = { id: 'request-1', source: 'github', threads: [{ source: 'github', id: '42' }], actor: { source: 'github', id: 'alice' }, human: true,
  at: '2026-09-09T00:00:00Z', text: 'Please inspect the failing check.\n' + 'Additional context. '.repeat(20), meta: {} }
const SUMMARY = 'The focused check passed.\n' + 'Detailed evidence. '.repeat(20)
const ticket: Ticket = { id: 'ticket-1', title: 'Inspect failing check', decisionId: 'd1',  inputs: [], undelivered: [],
  mandate: { strength: 'explicit', policyVersion: 'v1', basis: { via: 'listed', sender: 'Alice' }, actor: trigger.actor, scope: 'small' },
  assignments: [{ id: 'a1', state: 'running', createdAt: '2026-09-09T00:00:00Z', startedAt: '2026-09-09T00:00:00Z', report: { state: 'ready', summary: SUMMARY, at: '' } }],
  createdAt: '2026-09-09T00:00:00Z', updatedAt: '2026-09-09T00:00:00Z',
  origin: { triggerId: 'request-1', triggerIds: ['request-1'] },
  execution: { name: 'ticket-1', directory: '/worktrees/ticket-1', assignment: 'Inspect the check.' },
  follows: [{ thread: 'github:42', own: true }] }


it('shows a decision with snake_case keys and a reference to its details', () => {
  const decision: Decision = { id: 'd1', evalId: 'e1', threadKey: 'github:42', triggerIds: ['request-1'], policyVersion: 'v1', at: 'a', kind: 'accept', reason: [said('r')],
    strength: 'explicit', ticketId: 'ticket-1', audit: { matches: [] } }
  expect(decisionCard(decision)).toEqual({ decision_id: 'd1', kind: 'accept', reason: 'r', strength: 'explicit', thread: 'github:42', trigger_ids: ['request-1'],
    ticket_id: 'ticket-1', at: 'a', read: 'decision/d1' })
  expect(decisionDetails(decision)).toMatchObject({ decision_id: 'd1', audit: { matches: [] } })
  // An Eval's id and a Policy version are hashes nothing reads by.
  expect(decisionDetails(decision)).not.toHaveProperty('eval_id')
  expect(decisionDetails(decision)).not.toHaveProperty('policy_version')
})
it('summarizes threads with their subscriptions and assessment state', () => {
  const evaluating = { id: 'e1', threadKey: 'github:42', triggerIds: ['x'], strength: 'inferred' as const, actor: trigger.actor, basis: { via: 'followup' as const }, policyVersion: 'v1',
    startedAt: 's', deadline: 'd' }
  const thread: Thread = { key: 'github:42', ref: { source: 'github', id: '42' }, createdAt: '', subscriptions: ['ticket-1'], correlated: [], pending: ['x'], evaluating,
    meta: { pollError: 'boom' } }
  expect(threadCard(thread, 'Fix the margin')).toEqual({ thread: 'github:42', label: 'Fix the margin', source: 'github', tickets: ['ticket-1'],
    evaluating: { since: 's', deadline: 'd' }, pending: 1, error: 'boom', read: 'thread/github:42' })
})

it('keeps what a model reads in a preview as written: code, angle brackets and link targets', () => {
  const text = 'Fix `Map<string, T>` typing, see [the issue](https://github.com/acme/widgets/issues/7)\n\n  **now**'
  expect(triggerCard({ ...trigger,
    text }).preview).toBe('Fix `Map<string, T>` typing, see [the issue](https://github.com/acme/widgets/issues/7) **now**')
})
