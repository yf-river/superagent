/** 本地任务的创建、授权、验收和活动记录；页面与聊天工具共用。 */
import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { z } from 'zod'
import { canRetry, latestAssignment, latestReport, type AssessmentOutcome, type Engine, type Ticket, type Trigger } from '../core/index.ts'
import { workerSessionId } from '../executor/dsh.ts'
import type { Store } from './store.ts'
import { TASK_PRIORITIES, TASK_STAGES, type TaskAsset, type TaskCommand, type TaskCreate, type TaskDetail, type TaskList, type TaskPriority, type TaskProperties, type TaskRecord, type TaskStage, type TaskView } from './task-model.ts'

export const TaskPrioritySchema = z.enum(TASK_PRIORITIES)
const DueDateSchema = z.iso.date().nullable()

export const TaskCreateSchema = z.object({ requestId: z.uuid(), title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(100000), directory: z.string().trim().min(1),
  strategy: z.enum(['auto', 'shared', 'worktree']).default('auto'), assets: z.array(z.uuid()).max(20).default([]),
  priority: TaskPrioritySchema.default('none'), dueDate: DueDateSchema.default(null) }).strict()
export const TaskPropertiesSchema = z.object({ requestId: z.uuid(), revision: z.number().int().positive(),
  priority: TaskPrioritySchema.optional(), dueDate: DueDateSchema.optional() }).strict()
  .refine(value => value.priority !== undefined || value.dueDate !== undefined, '请选择要修改的任务属性')
export const TaskCommandSchema = z.object({ requestId: z.uuid(), revision: z.number().int().positive(),
  text: z.string().trim().max(100000).optional(), assets: z.array(z.uuid()).max(20).default([]) }).strict()
/** 页面和工具可直接呈现的任务操作失败。 */
export class TaskError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}
export interface TaskHost { store: Store; engine: Engine; stateDir: string; routerSessionId?: string; requestPass(): void; retryRouting?(trigger: Trigger, requestId: string): void }
const now = () => new Date().toISOString()
const decode = <T>(row: Record<string, unknown>): T => JSON.parse(String(row.value)) as T

/** 将业务决定与运行工单关联；不复制 Worker 的运行状态。 */
export class Tasks {
  constructor(private readonly host: TaskHost) {}
  private record(id: string): TaskRecord {
    const row = this.host.store.db.prepare('SELECT value FROM task WHERE id=?').get(id)
    if (!row) throw new TaskError('任务不存在', 404)
    return decode<TaskRecord>(row)
  }
  private save(task: TaskRecord): void {
    this.host.store.db.prepare('INSERT INTO task(id,value) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value')
      .run(task.id, JSON.stringify(task))
  }
  private event(task: TaskRecord, kind: string, text: string, assets: string[] = []): void {
    task.updatedAt = now(); task.revision++
    task.events.push({ id: randomUUID(), kind, text, assets, at: task.updatedAt })
  }
  private last(task: TaskRecord): Ticket | undefined { return this.host.store.tickets.get((task.activeTicket === undefined ? task.tickets.at(-1) : task.activeTicket) ?? '') }
  private view(task: TaskRecord): TaskView {
    const ticket = this.last(task), assignment = ticket && latestAssignment(ticket), report = ticket && latestReport(ticket)
    const { events: _events, ...rest } = task
    let stage: TaskStage = task.phase === 'submitted' ? (task.routingError ? 'waiting' : 'queued') : task.phase
    if (task.phase === 'submitted' && ticket) {
      stage = ticket.ended?.outcome === 'completed' || ticket.ended?.outcome === 'merged' || report?.state === 'ready' ? 'review'
        : ticket.attention || ticket.delivery || ['blocked', 'failed', 'waiting', 'dropped'].includes(report?.state ?? '') || ticket.ended ? 'waiting'
        : assignment?.state === 'running' ? 'working' : 'queued'
      if (ticket.undelivered.length && !ticket.ended) stage = assignment?.state === 'running' ? 'working' : 'queued'
    }
    const execution = ticket?.execution
    return { ...rest, priority: task.priority ?? 'none', dueDate: task.dueDate ?? null, stage, retryable: ticket ? canRetry(ticket) : !!task.routingError,
      ...(stage==='waiting'?{attentionKind:task.routingError?'routing' as const:ticket?.attention?'question' as const:ticket?.delivery||report?.state==='failed'?'failed' as const:report?.state==='blocked'?'blocked' as const:'waiting' as const}:{}), updatedAt: ticket && ticket.updatedAt > task.updatedAt ? ticket.updatedAt : task.updatedAt,
      summary: ticket?.delivery?.error ?? report?.summary ?? task.routingError ?? '', ...(ticket?.attention ? { question: ticket.attention.question } : {}),
      ...(ticket ? { sessionId: workerSessionId(ticket.id) } : {}),
      ...(execution?.local ? { execution: { directory: execution.directory, ...execution.local } } : {}) }
  }
  detail(id: string, offset = 0): TaskDetail {
    const task = this.record(id), events = [...task.events].reverse(), assets = new Set([...task.assets, ...task.events.flatMap(event => event.assets)])
    const routes = task.tickets.flatMap(id => {
      const ticket = this.host.store.tickets.get(id), execution = ticket?.execution, local = execution?.local
      if (!ticket || !execution || !local) return []
      const decision = this.host.store.decisions.get(ticket.decisionId), trigger = this.host.store.triggers.get(ticket.origin.triggerId)
      return [{ ticketId: ticket.id, decisionId: ticket.decisionId, triggerId: ticket.origin.triggerId,
        at: decision?.at ?? ticket.createdAt, requestedStrategy: z.enum(['auto','shared','worktree']).parse(trigger?.meta.strategy ?? task.strategy),
        selectedStrategy: local.strategy, reason: local.reason, directory: execution.directory }]
    }).reverse()
    return { ...this.view(task), events: events.slice(offset, offset + 50), attachments: [...assets].map(id => this.asset(id)), routes,
      ...(this.host.routerSessionId ? { routerSessionId: this.host.routerSessionId } : {}),
      ...(offset + 50 < events.length ? { nextOffset: offset + 50 } : {}) }
  }
  list(query: { q?: string; directory?: string; stage?: TaskStage; priority?: TaskPriority; offset?: number; limit?: number } = {}): TaskList {
    // 运行分类复用关联工单的投影；SQL 先按目录和搜索收敛记录。
    const parameters = [`%${(query.q ?? '').replace(/[\\%_]/g, value => `\\${value}`)}%`, query.directory ?? '', query.directory ?? '']
    const rows = this.host.store.db.prepare("SELECT value FROM task WHERE (json_extract(value,'$.title') LIKE ? ESCAPE '\\') AND (?='' OR json_extract(value,'$.directory')=?)")
      .all(...parameters).map(row => this.view(decode<TaskRecord>(row))).filter(row => !query.priority || row.priority === query.priority)
    rows.sort((a,b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
    const counts = Object.fromEntries(TASK_STAGES.map(stage => [stage, rows.filter(row => row.stage === stage).length])) as Record<TaskStage, number>
    const filtered = rows.filter(row => query.stage ? row.stage === query.stage : row.stage !== 'cancelled')
    const offset = query.offset ?? 0, limit = Math.min(query.limit ?? 50, 200)
    const priorityCounts = Object.fromEntries(TASK_PRIORITIES.map(priority => [priority, filtered.filter(row => row.priority === priority).length])) as Record<TaskPriority, number>
    return { items: filtered.slice(offset, offset + limit), counts, priorityCounts, ...(offset + limit < filtered.length ? { nextOffset: offset + limit } : {}) }
  }
  asset(id: string): TaskAsset {
    const row = this.host.store.db.prepare('SELECT value FROM task_asset WHERE id=?').get(id)
    if (!row) throw new TaskError('附件不存在或上传未完成', 404)
    return decode<TaskAsset>(row)
  }
  saveAsset(asset: TaskAsset): TaskAsset {
    this.host.store.db.prepare('INSERT INTO task_asset(id,value) VALUES (?,?)').run(asset.id, JSON.stringify(asset))
    return asset
  }
  private assets(ids: string[]): void { for (const id of ids) this.asset(id) }
  private directory = async (path: string): Promise<string> => {
    if (!isAbsolute(path)) throw new TaskError('请选择服务器上的绝对目录')
    const resolved = await realpath(path).catch(() => { throw new TaskError('服务器目录不存在') })
    if (!(await stat(resolved)).isDirectory()) throw new TaskError('所选路径不是目录')
    return resolved
  }
  private prior(requestId: string, action: string, id?: string): TaskDetail | undefined {
    const row = this.host.store.db.prepare('SELECT task,action FROM task_command WHERE id=?').get(requestId)
    if (!row) return undefined
    if (row.action !== action || id && row.task !== id) throw new TaskError('请求编号已用于另一个操作',409)
    return this.detail(String(row.task))
  }
  private receipt(requestId: string, action: string, id: string): void {
    this.host.store.db.prepare('INSERT INTO task_command(id,task,action) VALUES (?,?,?)').run(requestId,id,action)
  }
  async create(value: TaskCreate, sourceSession?: string): Promise<TaskDetail> {
    const input = TaskCreateSchema.parse(value), previous = this.prior(input.requestId,'create')
    if (previous) return previous
    const directory = await this.directory(input.directory); this.assets(input.assets)
    return this.host.store.atomic(() => {
      const replay = this.prior(input.requestId,'create'); if (replay) return replay
      const at = now(), task: TaskRecord = { id: randomUUID(), revision: 1, title: input.title, description: input.description,
        directory, strategy: input.strategy, assets: input.assets, priority: input.priority, dueDate: input.dueDate, ...(sourceSession ? { sourceSession } : {}), phase:'draft',
        tickets: [], activeTicket:null, run:0, events:[], createdAt:at, updatedAt:at }
      this.event(task,'created',input.description,input.assets); this.save(task); this.receipt(input.requestId,'create',task.id)
      return this.detail(task.id)
    })
  }
  async edit(id: string, value: TaskCreate & { revision: number }): Promise<TaskDetail> {
    const { revision, ...body } = value, input = TaskCreateSchema.parse(body), directory = await this.directory(input.directory)
    return this.mutate(id,{ ...input, revision },'edit',task => {
      if (task.phase !== 'draft') throw new TaskError('执行开始后请通过补充要求修改任务')
      this.assets(input.assets); Object.assign(task,{title:input.title,description:input.description,directory,strategy:input.strategy,assets:input.assets,priority:input.priority,dueDate:input.dueDate})
      this.event(task,'edited',input.description,input.assets)
    })
  }
  /** 任务属性可在执行期间修改，不触发模型请求或改变已授权的执行要求。 */
  properties(id: string, value: TaskProperties): TaskDetail {
    const input = TaskPropertiesSchema.parse(value)
    return this.mutate(id,input,'properties',task => {
      if(input.priority !== undefined) task.priority = input.priority
      if(input.dueDate !== undefined) task.dueDate = input.dueDate
      this.event(task,'properties',JSON.stringify({priority:task.priority ?? 'none',dueDate:task.dueDate ?? null}))
    })
  }
  async start(id: string, value: TaskCommand): Promise<TaskDetail> {
    const input = TaskCommandSchema.parse(value), previous = this.prior(input.requestId,'start',id); if(previous) return previous
    await this.directory(this.record(id).directory)
    return this.mutate(id,input,'start',task => {
      if(task.phase !== 'draft') throw new TaskError('只有待规划任务可以开始')
      task.phase='submitted'; task.activeTicket=null; delete task.routingError; task.run++; this.event(task,'started','开始执行'); this.save(task)
      this.host.engine.receive(this.trigger(task,`start:${task.run}`,`${task.title}\n\n${task.description}\n${task.events.filter(event=>event.kind==='note').map(event=>event.text).join('\n')}`,[...task.assets,...task.events.filter(event=>event.kind==='note').flatMap(event=>event.assets)]))
      this.host.store.afterCommit(() => this.host.requestPass())
    })
  }
  command(id: string, action: 'note'|'retry'|'cancel'|'confirm'|'reopen', value: TaskCommand): TaskDetail {
    return this.mutate(id,TaskCommandSchema.parse(value),action,(task,input) => {
      const ticket = this.last(task), stage = this.view(task).stage
      if(action === 'cancel') {
        if(task.phase === 'done' || task.phase === 'cancelled') throw new TaskError('任务已经结束')
        if(!ticket && task.phase==='submitted') this.host.engine.decide(this.trigger(task,`start:${task.run}`,'',[]).id,{kind:'ignore',reason:'用户取消任务'})
        task.phase='cancelled'; if(ticket && !ticket.ended) this.host.engine.stopTicket(ticket.id,'任务页面取消')
        this.event(task,'cancelled','已请求停止执行')
      } else if(action === 'confirm') {
        if(stage !== 'review') throw new TaskError('只有待确认任务可以确认完成')
        task.phase='done'; this.event(task,'confirmed','用户确认完成；未执行合并、推送或部署')
      } else if(action === 'reopen') {
        if(task.phase !== 'done' && task.phase !== 'cancelled') throw new TaskError('任务尚未结束')
        task.phase='draft'; task.activeTicket=null; this.event(task,'reopened','重新打开，等待开始')
      } else if(action === 'retry') {
        if(task.phase !== 'submitted') throw new TaskError('任务尚未开始或已经结束')
        if(ticket && !ticket.ended) this.host.engine.retryTicket(ticket.id)
        else if(!ticket) {
          const trigger=this.host.store.triggers.get(this.trigger(task,`start:${task.run}`,'',[]).id)!
          if(this.host.retryRouting) this.host.retryRouting(trigger,input.requestId)
          else this.host.engine.reevaluate(trigger.id)
          delete task.routingError
        }
        else throw new TaskError('请补充要求继续任务')
        this.event(task,'retry','重试执行')
      } else {
        if(!input.text?.trim() && !input.assets?.length) throw new TaskError('请输入补充要求或添加附件')
        if(task.phase === 'done' || task.phase === 'cancelled') throw new TaskError('请先重新打开任务')
        const assets=input.assets ?? []; this.assets(assets); this.event(task,'note',input.text ?? '',assets)
        if(task.phase === 'submitted') this.host.engine.receive(this.trigger(task,input.requestId,input.text ?? '',assets))
      }
      this.host.store.afterCommit(() => this.host.requestPass())
    })
  }
  private mutate(id: string, input: TaskCommand, action: string, change: (task: TaskRecord,input: TaskCommand)=>void): TaskDetail {
    return this.host.store.atomic(() => {
      const previous = this.prior(input.requestId,action,id); if(previous) return previous
      const task=this.record(id)
      if(task.revision !== input.revision) throw new TaskError('任务已更新，请刷新后重试',409)
      change(task,input); this.save(task); this.receipt(input.requestId,action,id); return this.detail(id)
    })
  }
  private trigger(task: TaskRecord, id: string, text: string, assets: string[]): Trigger {
    return { id:`local:${task.id}:${id}`, source:'local',threads:[{source:'local',id:`${task.id}:${task.run}`}],actor:{source:'local',id:'owner'},
      human:true,addressed:'direct',at:now(),text,channel:{source:'local',thread:`local:${task.id}:${task.run}`,address:{taskId:task.id}},
      meta:{taskId:task.id,directory:task.directory,strategy:task.strategy,assets} }
  }
  /** Router 接受本地任务时固定执行选择，和工单创建在同一事务内保存。 */
  assign(ticket: Ticket, outcome: Extract<AssessmentOutcome,{kind:'accept'}>): Ticket {
    const origin=this.host.store.triggers.get(ticket.origin.triggerId)
    if(origin?.source !== 'local') return ticket
    const task=this.record(String(origin.meta.taskId))
    if(task.phase !== 'submitted') throw new TaskError('任务已经取消或尚未开始')
    const strategy = task.strategy === 'auto' ? outcome.execution?.strategy : task.strategy
    if(!strategy) throw new TaskError('本地任务需要 execution_mode 和 execution_reason；Git 代码修改使用 worktree，读取和环境操作使用 shared')
    const name=`task-${ticket.id.slice(0,12)}`, directory=strategy === 'shared' ? task.directory : join(this.host.stateDir,'work',name)
    const reason=outcome.execution?.reason || '任务已指定执行方式'
    const execution={name,directory,assignment:outcome.note ?? '',local:{strategy,projectDirectory:task.directory,reason}}
    if(task.activeTicket) throw new TaskError('这个任务已经有执行工单，请关联其已有执行')
    delete task.routingError; task.activeTicket=ticket.id; task.tickets.push(ticket.id); this.event(task,'assigned',`${reason}\n${directory}`); this.save(task)
    return {...ticket,execution}
  }
  /** Router 请求失败时向已送达、尚未分派的任务显示可重试错误。 */
  routingFailed(message: string): void {
    this.host.store.atomic(()=>{
      const rows=this.host.store.db.prepare("SELECT value FROM task WHERE json_extract(value,'$.phase')='submitted'").all()
      for(const row of rows) {
        const task=decode<TaskRecord>(row),thread=this.host.store.threads.get(`local:${task.id}:${task.run}`)
        if(this.last(task) || !thread?.evaluating?.delivered || task.routingError===message) continue
        task.routingError=message;this.event(task,'routing-failed',message);this.save(task)
      }
    })
  }
  /** 来源回信写入任务活动；相同消息只保存一次。 */
  reply(taskId: string, id: string, text: string): void {
    this.host.store.atomic(() => { const task=this.record(taskId); if(task.events.some(event=>event.id===id)) return
      this.event(task,'agent',text); task.events.at(-1)!.id=id; this.save(task) })
  }
}
