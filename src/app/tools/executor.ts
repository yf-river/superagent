/** Worker 直接报告任务状态，DSH 会话承载聊天和结果。 */
import { z } from 'zod'
import { liveTicket, type EngineForExecutor, type Ticket } from '../../core/index.ts'
import { readResource, type ResourceHost } from '../resources.ts'
import type { Store } from '../store.ts'
import { reportRelay } from '../notices.ts'
import type { Sessions } from '../sessions.ts'
import { readTool, tool, type Tool } from './tool.ts'

export interface ExecutorToolsHost {
  readonly engine: Pick<EngineForExecutor, 'report'>
  readonly store: Pick<Store, 'tickets' | 'atomic'>
  readonly sessions: Pick<Sessions, 'relay'>
  readonly resources: ResourceHost
}
export function executorTools(host: ExecutorToolsHost, ticket: Ticket): Tool[] {
  return [
    readTool('Read the task context and execution records.', true, (resource, offset, limit, signal) => readResource(host.resources, resource, offset, limit, ticket.id, signal)),
    tool({ name: 'orchestrator_report', description: 'Report task progress, ready, blocked, failed or dropped. The result and any question appear directly in DSH.',
      schema: z.object({ state: z.enum(['progress', 'ready', 'blocked', 'failed', 'dropped']), summary: z.string().min(1),
        human_action: z.string().trim().min(1).max(1000).nullish() }).strict(),
      execute: async args => host.store.atomic(() => {
        const current = host.store.tickets.get(ticket.id)
        if (!current || !liveTicket(current)) throw new Error('Task execution ended')
        const report = { state: args.state, summary: args.summary, ...(args.human_action !== undefined ? { question: args.human_action } : {}) }
        const updated = host.engine.report(ticket.id, report)
        const relay = reportRelay(updated, report)
        if (relay) host.sessions.relay(relay.id, relay.text)
        return { reported: true, ...(updated.attention ? { attention: updated.attention } : {}) }
      }),
    }),
  ]
}
