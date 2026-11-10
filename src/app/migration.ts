/** 本地任务版本升级，在 Store 的同一事务内清理外部渠道数据。 */
import type { Store } from './store.ts'
import type { TaskRecord } from './task-model.ts'
import type { Thread, Trigger, TriggerDisposition } from '../core/index.ts'

export const SCHEMA_VERSION = 13
export const OLDEST_SCHEMA = 12
export const tooOld = (version: number): string => `Orchestrator database schema ${version} predates schema ${OLDEST_SCHEMA}; use a schema 12 database or a new state directory`

/** 删除外部任务及投递状态，本地任务和其会话关联在事务内转换。 */
export function migrateTo13(store: Store): void {
  const external = new Set(store.db.prepare('SELECT value FROM trigger').all().map(row => JSON.parse(String(row.value)) as Trigger).filter(trigger => trigger.source !== 'local').map(trigger => trigger.id))
  const removedTickets = new Set(store.tickets.list().filter(ticket => external.has(ticket.origin.triggerId)).map(ticket => ticket.id))
  for (const table of ['trigger', 'disposition']) for (const id of external) store.db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id)
  for (const id of external) store.db.prepare('DELETE FROM trigger_thread WHERE id=?').run(id)
  for (const ticket of store.tickets.list()) {
    if (removedTickets.has(ticket.id)) store.db.prepare('DELETE FROM ticket WHERE id=?').run(ticket.id)
    else {
      const value: Record<string, unknown> = { ...ticket }
      delete value.channels
      store.db.prepare('UPDATE ticket SET value=? WHERE id=?').run(JSON.stringify(value), ticket.id)
    }
  }
  for (const row of store.db.prepare('SELECT id,value FROM decision').all()) {
    const decision = JSON.parse(String(row.value)) as { ticketId?: string; triggerIds: string[] }
    if ((decision.ticketId && removedTickets.has(decision.ticketId)) || decision.triggerIds.some(id => external.has(id))) store.db.prepare('DELETE FROM decision WHERE id=?').run(String(row.id))
  }
  for (const row of store.db.prepare('SELECT key,value FROM thread').all()) {
    const thread = JSON.parse(String(row.value)) as Thread
    if (thread.ref.source !== 'local') store.db.prepare('DELETE FROM thread WHERE key=?').run(String(row.key))
    else {
      thread.subscriptions = thread.subscriptions.filter(id => !removedTickets.has(id))
      if (thread.context) thread.context = thread.context.filter(id => !removedTickets.has(id))
      thread.pending = thread.pending.filter(id => !external.has(id))
      if (thread.evaluating?.triggerIds.some(id => external.has(id))) delete thread.evaluating
      thread.correlated = thread.correlated.filter(key => key.startsWith('local:'))
      store.db.prepare('UPDATE thread SET value=? WHERE key=?').run(JSON.stringify(thread), String(row.key))
    }
  }
  for (const trigger of store.db.prepare('SELECT value FROM trigger').all().map(row => JSON.parse(String(row.value)) as Trigger)) {
    const value: Record<string, unknown> = { ...trigger }; delete value.channel
    store.db.prepare('UPDATE trigger SET value=? WHERE id=?').run(JSON.stringify(value), trigger.id)
  }
  for (const row of store.db.prepare('SELECT kind,key,value FROM effect').all()) {
    const kind = String(row.kind), payload = JSON.parse(String(row.value)) as { ticketId?: string; triggerId?: string; text?: string }
    if (kind === 'reply' || (payload.ticketId && removedTickets.has(payload.ticketId)) || (payload.triggerId && external.has(payload.triggerId))
) {
      store.db.prepare('DELETE FROM effect WHERE kind=? AND key=?').run(kind, String(row.key))
    }
  }
  for (const row of store.db.prepare('SELECT id,value FROM disposition').all()) {
    const value = JSON.parse(String(row.value)) as TriggerDisposition
    value.fanout = value.fanout.filter(id => !removedTickets.has(id))
    if (value.context) value.context = value.context.filter(id => !removedTickets.has(id))
    if (value.acked) value.acked = value.acked.filter(id => !removedTickets.has(id))
    if (value.handbacks) value.handbacks = value.handbacks.filter(item => !removedTickets.has(item.ticketId))
    store.db.prepare('UPDATE disposition SET value=? WHERE id=?').run(JSON.stringify(value), String(row.id))
  }
  store.db.prepare("DELETE FROM task_command WHERE action='properties'").run()
  store.db.exec('DROP TABLE IF EXISTS outbox')
  for (const row of store.db.prepare('SELECT id,value FROM task').all()) {
    const value = JSON.parse(String(row.value)) as TaskRecord & Record<string, unknown>
    delete value.priority; delete value.dueDate
    value.events = value.events.filter(event => event.kind !== 'properties')
    value.tickets = value.tickets.filter(id => !removedTickets.has(id))
    if (value.activeTicket && removedTickets.has(value.activeTicket)) { value.activeTicket = null; value.phase = 'draft' }
    const ticket = store.tickets.get(value.activeTicket ?? value.tickets.at(-1) ?? '')
    if (ticket?.execution?.local) {
      value.sessionId = ticket.execution.sessionId ?? `worker-${ticket.id}`
      ticket.execution.sessionId = value.sessionId
      store.tickets.save(ticket)
      value.preparation = { state: 'ready', generation: 1, startRequested: false, execution: ticket.execution }
    }
    store.db.prepare('UPDATE task SET value=? WHERE id=?').run(JSON.stringify(value), String(row.id))
  }
  for (const row of store.db.prepare('SELECT key,value FROM kv').all()) {
    if (/^(github|feishu|source:|sources:|source-labels:)/.test(String(row.key))) store.db.prepare('DELETE FROM kv WHERE key=?').run(String(row.key))
  }
  for (const row of store.db.prepare("SELECT key,value FROM kv WHERE key LIKE 'settings-version:%'").all()) {
    const version = JSON.parse(String(row.value)); version.settings.sources = {}; version.settings.policy.sources = {};
    store.db.prepare('UPDATE kv SET value=? WHERE key=?').run(JSON.stringify(version), String(row.key))
  }
}
