/** 本地任务的创建、授权、验收和活动记录；页面与聊天工具共用。 */
import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { z } from 'zod'
import { canRetry, key, latestAssignment, latestReport, type AssessmentOutcome, type Execution, type Engine, type Ticket, type Trigger } from '../core/index.ts'
import { workerSessionId } from '../executor/dsh.ts'
import type { Store } from './store.ts'
import { TASK_STAGES, type TaskAsset, type TaskCommand, type TaskCreate, type TaskDetail, type TaskList, type TaskRecord, type TaskStage, type TaskView } from './task-model.ts'


export const TaskCreateSchema = z.object({ requestId: z.uuid(), title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(100000), directory: z.string().trim().min(1),
  strategy: z.enum(['auto', 'shared', 'worktree']).default('auto'), assets: z.array(z.uuid()).max(20).default([]) }).strict()
export const TaskCommandSchema = z.object({ requestId: z.uuid(), revision: z.number().int().positive(),
  text: z.string().trim().max(100000).optional(), assets: z.array(z.uuid()).max(20).default([]) }).strict()
/** 页面和工具可直接呈现的任务操作失败。 */
export class TaskError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}
export interface TaskHost { store: Store; engine: Engine; stateDir: string; routerSessionId?: string; requestPass(): void; retryRouting?(trigger: Trigger, requestId: string): void; requestPreparation?(task: TaskRecord): void; prepareDirectory?(execution: Execution, save: (execution: Execution) => void, current: () => boolean): Promise<void>; ensureSession?(id: string, directory: string, title: string): Promise<void> }
const now = () => new Date().toISOString()
const decode = <T>(row: Record<string, unknown>): T => JSON.parse(String(row.value)) as T

/** 将业务决定与运行工单关联；不复制 Worker 的运行状态。 */
export class Tasks {
  private readonly preparing = new Map<string, Promise<void>>()
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
    let stage: TaskStage = task.phase === 'submitted' ? (task.routingError ? 'waiting' : 'working') : task.phase
    if (task.phase === 'submitted' && ticket) {
      stage = ticket.ended?.outcome === 'completed' || ticket.ended?.outcome === 'merged' || report?.state === 'ready' ? 'review'
        : ticket.attention || ticket.delivery || ['blocked', 'failed', 'waiting', 'dropped'].includes(report?.state ?? '') || ticket.ended ? 'waiting'
        : assignment?.state === 'running' ? 'working' : 'working'
      if (ticket.undelivered.length && !ticket.ended) stage = assignment?.state === 'running' ? 'working' : 'working'
    }
    const execution = task.preparation?.execution ?? ticket?.execution
    return { ...rest, waitingForWorker: task.phase === 'submitted' && (!assignment || assignment.state === 'pending'), stage, retryable: ticket ? canRetry(ticket) : !!task.routingError,
      ...(stage==='waiting'?{attentionKind:task.routingError?'routing' as const:ticket?.attention?'question' as const:ticket?.delivery||report?.state==='failed'?'failed' as const:report?.state==='blocked'?'blocked' as const:'waiting' as const}:{}), updatedAt: ticket && ticket.updatedAt > task.updatedAt ? ticket.updatedAt : task.updatedAt,
      summary: ticket?.delivery?.error ?? report?.summary ?? task.routingError ?? '', ...(ticket?.attention ? { question: ticket.attention.question } : {}),
      ...(task.sessionId ? { sessionId: task.sessionId } : ticket ? { sessionId: workerSessionId(ticket) } : {}),
      ...(execution?.local ? { execution: { directory: execution.directory, ...execution.local } } : {}) }
  }
  bySession(sessionId: string): TaskDetail | null {
    const row = this.host.store.db.prepare("SELECT id FROM task WHERE json_extract(value,'$.sessionId')=? LIMIT 1").get(sessionId)
    return row ? this.detail(String(row.id)) : null
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
  list(query: { q?: string; directory?: string; stage?: TaskStage; offset?: number; limit?: number } = {}): TaskList {
    // 运行分类复用关联工单的投影；SQL 先按目录和搜索收敛记录。
    const parameters = [`%${(query.q ?? '').replace(/[\\%_]/g, value => `\\${value}`)}%`, query.directory ?? '', query.directory ?? '']
    const rows = this.host.store.db.prepare("SELECT value FROM task WHERE (json_extract(value,'$.title') LIKE ? ESCAPE '\\') AND (?='' OR json_extract(value,'$.directory')=?)")
      .all(...parameters).map(row => this.view(decode<TaskRecord>(row)))
    rows.sort((a,b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
    const counts = Object.fromEntries(TASK_STAGES.map(stage => [stage, rows.filter(row => row.stage === stage).length])) as Record<TaskStage, number>
    const filtered = rows.filter(row => query.stage ? row.stage === query.stage : row.stage !== 'cancelled')
    const offset = query.offset ?? 0, limit = Math.min(query.limit ?? 50, 200)
    return { items: filtered.slice(offset, offset + limit), counts, ...(offset + limit < filtered.length ? { nextOffset: offset + limit } : {}) }
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
        directory, strategy: input.strategy, assets: input.assets, ...(sourceSession ? { sourceSession } : {}), phase:'draft',
        tickets: [], activeTicket:null, run:0, events:[], createdAt:at, updatedAt:at }
      this.event(task,'created',input.description,input.assets); this.save(task); this.receipt(input.requestId,'create',task.id)
      return this.detail(task.id)
    })
  }
  async edit(id: string, value: TaskCreate & { revision: number }): Promise<TaskDetail> {
    const { revision, ...body } = value, input = TaskCreateSchema.parse(body), directory = await this.directory(input.directory)
    return this.mutate(id,{ ...input, revision },'edit',task => {
      if (task.phase !== 'draft') throw new TaskError('执行开始后请通过补充要求修改任务')
      if (directory !== task.directory || input.strategy !== task.strategy) {
        if (task.sessionId || task.preparation?.execution) throw new TaskError('会话准备后不能更换任务目录或执行方式')
        if (task.preparation) {
          if (task.preparation.state !== 'error') throw new TaskError('目录准备中，请等待准备结束后再修改')
          task.preparation = { state:'error', generation:task.preparation.generation+1, startRequested:false, error:'目录已修改，请重新准备' }
        }
      }
      this.assets(input.assets); Object.assign(task,{title:input.title,description:input.description,directory,strategy:input.strategy,assets:input.assets})
      this.event(task,'edited',input.description,input.assets)
    })
  }
  /** 首次打开只准备目录及会话；startRequested 在准备完成后提交执行。 */
  async prepare(id: string, value: TaskCommand, startRequested = false): Promise<TaskDetail> {
    const input = TaskCommandSchema.parse(value)
    const previous = this.prior(input.requestId, startRequested ? 'start' : 'prepare', id)
    if (previous) return previous
    this.host.store.atomic(() => {
      const task = this.record(id)
      if (task.phase !== 'draft') { if (!startRequested && task.sessionId) return; throw new TaskError('任务已经开始或已结束',409) }
      if (task.revision !== input.revision) throw new TaskError('任务已更新，请刷新后重试', 409)
      if (task.preparation?.state === 'ready') {
        if (startRequested) this.submit(task)
      } else {
        if (!task.preparation || task.preparation.state === 'error') {
          task.preparation = { state: task.preparation?.execution ? 'preparing' : 'routing', generation: (task.preparation?.generation ?? 0) + 1,
            startRequested, ...(task.preparation?.execution ? { execution: task.preparation.execution } : {}) }
          this.event(task, 'preparing', '准备执行目录和会话')
        } else task.preparation.startRequested ||= startRequested
        this.save(task)
        this.host.store.afterCommit(() => this.continuePreparation(task.id))
      }
      this.receipt(input.requestId, startRequested ? 'start' : 'prepare', id)
    })
    return this.detail(id)
  }
  async start(id: string, value: TaskCommand): Promise<TaskDetail> { return this.prepare(id, value, true) }
  private submit(task: TaskRecord): void {
    if (!task.sessionId || task.preparation?.state !== 'ready') throw new TaskError('任务目录尚未准备完成')
    task.phase = 'submitted'; task.activeTicket = null; delete task.routingError; task.run++
    this.event(task, 'started', '开始执行'); this.save(task)
    const received = this.host.engine.receive(this.trigger(task, `start:${task.run}`, `${task.title}\n\n${task.description}\n${task.events.filter(event => event.kind === 'note').map(event => event.text).join('\n')}`,
      [...task.assets, ...task.events.filter(event => event.kind === 'note').flatMap(event => event.assets)]))
    if (received === 'filtered') throw new TaskError('本地任务入口已停用，请启用后重试')
    this.host.store.afterCommit(() => this.host.requestPass())
  }
  /** Router 只能为当前准备轮次提交一次目录选择，不接受任务开始指令。 */
  async chooseDirectory(id: string, generation: number, strategy: 'shared' | 'worktree', reason: string): Promise<TaskDetail> {
    this.host.store.atomic(() => {
      const task = this.record(id), preparation = task.preparation
      if (task.phase !== 'draft' || !preparation || preparation.generation !== generation) throw new TaskError('目录准备请求已失效', 409)
      if (preparation.state === 'error') throw new TaskError('准备失败，请从任务页面重试',409)
      if (preparation.execution) return
      if (task.strategy !== 'auto' && task.strategy !== strategy) throw new TaskError('执行方式与任务指定值不一致')
      const name = `task-${task.id}-p${generation}`
      preparation.execution = { name, directory: strategy === 'shared' ? task.directory : join(this.host.stateDir, 'work', name),
        sessionId: `task-${task.id}`, assignment: '', local: { strategy, projectDirectory: task.directory, reason } }
      preparation.state = 'preparing'; this.save(task)
    })
    await this.finishPreparation(id)
    return this.detail(id)
  }
  private continuePreparation(id: string): void {
    const task = this.record(id)
    if (task.preparation?.state === 'routing') {
      if (!this.host.requestPreparation) throw new Error('Task directory preparation is not configured')
      this.host.requestPreparation(task)
    } else if (task.preparation?.state === 'preparing') {
      void this.finishPreparation(id).catch(error => { this.failPreparation(id, String(error)) })
    }
  }
  private finishPreparation(id: string): Promise<void> {
    const pending = this.preparing.get(id)
    if (pending) return pending.then(() => this.record(id).preparation?.state === 'preparing' ? this.finishPreparation(id) : undefined)
    const generation = this.record(id).preparation!.generation
    const work = this.prepareSession(id).catch(error => { this.failPreparation(id, error instanceof Error ? error.message : String(error), generation) })
      .finally(() => { this.preparing.delete(id) })
    this.preparing.set(id, work)
    return work
  }
  private async prepareSession(id: string): Promise<void> {
    const task = this.record(id), preparation = task.preparation, execution = preparation?.execution
    if (!preparation || preparation.state === 'ready' || !execution) return
    const current = () => { const latest = this.record(id); return latest.phase === 'draft' && latest.preparation?.generation === preparation.generation }
    const save = (execution: Execution) => this.host.store.atomic(() => { if (!current()) throw new TaskError('任务准备已取消'); const latest = this.record(id); latest.preparation!.execution = execution; this.save(latest) })
    if (!this.host.prepareDirectory || !this.host.ensureSession) throw new Error('Task Session preparation is not configured')
    await this.host.prepareDirectory(execution, save, current)
    if (!current()) return
    await this.host.ensureSession(execution.sessionId!, execution.directory, task.title)
    this.host.store.atomic(() => {
      if (!current()) return
      const latest = this.record(id); latest.sessionId = execution.sessionId; latest.preparation!.state = 'ready'
      this.event(latest, 'prepared', '执行目录和会话已准备'); this.save(latest)
      if (latest.preparation!.startRequested) this.submit(latest)
    })
  }
  private failPreparation(id: string, error: string, generation?: number): void {
    this.host.store.atomic(() => { const task = this.record(id); if (task.phase !== 'draft' || task.preparation?.state === 'ready' || !task.preparation || (generation !== undefined && task.preparation.generation !== generation)) return
      task.preparation.state = 'error'; task.preparation.error = error; this.event(task, 'prepare-failed', error); this.save(task) })
  }
  /** 恢复未完成准备，已失败的任务等待用户重试。 */
  resumePreparation(): void {
    for (const row of this.host.store.db.prepare('SELECT value FROM task').all()) {
      const task = decode<TaskRecord>(row)
      if (task.phase === 'draft' && ['routing', 'preparing'].includes(task.preparation?.state ?? '')) this.continuePreparation(task.id)
    }
  }
  command(id: string, action: 'note'|'retry'|'cancel'|'confirm'|'reopen', value: TaskCommand): TaskDetail {
    return this.mutate(id,TaskCommandSchema.parse(value),action,(task,input) => {
      const ticket = this.last(task), stage = this.view(task).stage
      if(action === 'cancel') {
        if(task.phase === 'done' || task.phase === 'cancelled') throw new TaskError('任务已经结束')
        if(!ticket && task.phase==='submitted') this.host.engine.decide(this.trigger(task,`start:${task.run}`,'',[]).id,{kind:'ignore',reason:'用户取消任务'})
        task.phase='cancelled'; if(task.preparation) { task.preparation.startRequested=false; if(task.preparation.state!=='ready') { task.preparation.state='error'; task.preparation.generation++; task.preparation.error='任务准备已取消' } } if(ticket && !ticket.ended) this.host.engine.stopTicket(ticket.id,'任务页面取消')
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
      human:true,addressed:'direct',at:now(),text,
      meta:{taskId:task.id,directory:task.directory,strategy:task.strategy,assets} }
  }
  /** Router 接受本地任务时固定执行选择，和工单创建在同一事务内保存。 */
  assign(ticket: Ticket, outcome: Extract<AssessmentOutcome,{kind:'accept'}>): Ticket {
    const origin=this.host.store.triggers.get(ticket.origin.triggerId)
    if(origin?.source !== 'local') return ticket
    const task=this.record(String(origin.meta.taskId))
    if(task.phase !== 'submitted') throw new TaskError('任务已经取消或尚未开始')
    if (!task.sessionId || task.preparation?.state !== 'ready' || !task.preparation.execution) throw new TaskError('任务目录和会话尚未准备完成')
    const execution = { ...task.preparation.execution, assignment: outcome.note ?? '' }
    const directory = execution.directory, reason = execution.local!.reason
    if(task.activeTicket) throw new TaskError('这个任务已经有执行工单，请关联其已有执行')
    delete task.routingError; task.activeTicket=ticket.id; task.tickets.push(ticket.id); this.event(task,'assigned',`${reason}\n${directory}`); this.save(task)
    return {...ticket,execution}
  }
  /** Router 请求失败时向已送达、尚未分派的任务显示可重试错误。 */
  routingFailed(message: string): void {
    this.host.store.atomic(()=>{
      for (const row of this.host.store.db.prepare("SELECT id FROM task WHERE json_extract(value,'$.phase')='draft' AND json_extract(value,'$.preparation.state')='routing'").all()) this.failPreparation(String(row.id), message)
      const rows=this.host.store.db.prepare("SELECT value FROM task WHERE json_extract(value,'$.phase')='submitted'").all()
      for(const row of rows) {
        const task=decode<TaskRecord>(row),thread=this.host.store.threads.get(`local:${task.id}:${task.run}`)
        if(this.last(task) || !thread?.evaluating?.delivered || task.routingError===message) continue
        task.routingError=message;this.event(task,'routing-failed',message);this.save(task)
      }
    })
  }
  /** 工单报告直接回写本地任务；报告时间与工单编号共同确定幂等键。 */
  recordReport(ticketId: string): void {
    const ticket = this.host.store.tickets.get(ticketId), report = ticket && latestReport(ticket)
    if (!report) return
    const row = this.host.store.db.prepare("SELECT id FROM task WHERE json_extract(value,'$.activeTicket')=?").get(ticketId)
    if (!row) return
    const task = this.record(String(row.id)), id = `report:${key(ticketId,report.at,report.state,report.summary,ticket?.attention?.question ?? '')}`
    if (task.events.some(event => event.id === id)) return
    this.event(task, 'report', report.summary); task.events.at(-1)!.id = id; this.save(task)
  }
}
