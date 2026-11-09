import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Store } from '../src/app/store.ts'
import { Tasks } from '../src/app/tasks.ts'
import { Engine, latestAssignment, type Trigger } from '../src/core/index.ts'
import { settingsPolicy } from '../src/policy.ts'
import { SourceRegistry } from '../src/sources/registry.ts'
import { localKind } from '../src/sources/local.ts'
import { taskContent } from '../src/app/task-tools.ts'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
const cleanups:(()=>void)[]=[]
afterEach(()=>cleanups.splice(0).reverse().forEach(cleanup=>cleanup()))
function fixture() {
  const dir=mkdtempSync(join(tmpdir(),'superagent-tasks-')),path=join(dir,'state.sqlite'),store=new Store(path)
  cleanups.push(()=>{store.close();rmSync(dir,{recursive:true,force:true})})
  const sources=new SourceRegistry(()=>store.settings()),start=vi.fn(),stop=vi.fn(),request=vi.fn(),pass=vi.fn()
  let tasks:Tasks
  const engine=new Engine({repo:store,scope:sources,policy:()=>settingsPolicy(store.settings(),sources),
    assessor:{request},executor:{start,stop,deliver:vi.fn()},outbox:{send:vi.fn(),withdraw:vi.fn(),status:()=> 'sent'},
    prepareTicket:(ticket,outcome)=>tasks.assign(ticket,outcome)})
  tasks=new Tasks({store,engine,stateDir:dir,routerSessionId:'router',requestPass:pass});sources.register(localKind(tasks))
  const create=()=>tasks.create({requestId:randomUUID(),title:'修复任务卡片',description:'调整间距，验证结果',directory:dir})
  const accepted=()=>{
    const trigger=store.db.prepare('SELECT value FROM trigger').all().map(row=>JSON.parse(String(row.value)) as Trigger).find(trigger=>trigger.source==='local')!
    const decision=engine.decide(trigger.id,{kind:'accept',title:'修复卡片',scope:'调整间距',reason:'明确任务',name:'fix-card',execution:{strategy:'shared',reason:'在现有目录操作'}})
    return store.tickets.get(decision.ticketId!)!
  }
  return {store,dir,path,tasks,engine,start,stop,request,pass,create,accepted}
}
describe('local tasks',()=>{
  it('updates and deduplicates properties during execution without dispatching new work',async()=>{
    const h=fixture(),draft=await h.create()
    const command={requestId:randomUUID(),revision:draft.revision,priority:'important_urgent' as const,dueDate:'2026-11-20'}
    const updated=h.tasks.properties(draft.id,command)
    expect(updated).toMatchObject({priority:'important_urgent',dueDate:'2026-11-20',stage:'draft'})
    expect(h.tasks.properties(draft.id,command).revision).toBe(updated.revision)
    expect(h.request).not.toHaveBeenCalled();expect(h.start).not.toHaveBeenCalled()
    await h.tasks.start(draft.id,{requestId:randomUUID(),revision:updated.revision})
    h.accepted();const active=h.tasks.detail(draft.id),starts=h.start.mock.calls.length
    const next=h.tasks.properties(draft.id,{requestId:randomUUID(),revision:active.revision,priority:'important_not_urgent',dueDate:null})
    expect(next).toMatchObject({priority:'important_not_urgent',dueDate:null});expect(h.start).toHaveBeenCalledTimes(starts)
    expect(()=>h.tasks.properties(draft.id,{requestId:randomUUID(),revision:active.revision,priority:'none'})).toThrow('已更新')
  })
  it('refuses invalid calendar dates and counts each priority before pagination',async()=>{
    const h=fixture(),draft=await h.create()
    expect(()=>h.tasks.properties(draft.id,{requestId:randomUUID(),revision:draft.revision,dueDate:'2026-02-30'})).toThrow()
    for(let i=0;i<3;i++)await h.tasks.create({requestId:randomUUID(),title:'重要任务',description:'稍后处理',directory:h.dir,priority:'important_urgent'})
    const page=h.tasks.list({stage:'draft',limit:1})
    expect(page.priorityCounts).toMatchObject({important_urgent:3,none:1})
    expect(h.tasks.list({priority:'important_urgent'}).items).toHaveLength(3)
  })
  it('reads earlier task records with no priority or due date without rewriting them',async()=>{
    const h=fixture(),draft=await h.create()
    h.store.db.prepare("UPDATE task SET value=json_remove(value,'$.priority','$.dueDate') WHERE id=?").run(draft.id)
    expect(h.tasks.detail(draft.id)).toMatchObject({priority:'none',dueDate:null})
    expect(h.store.db.prepare("SELECT json_type(value,'$.priority') AS kind FROM task WHERE id=?").get(draft.id)?.kind).toBeNull()
  })
  it('projects Router evidence from the durable decision and ticket across task reopen',async()=>{
    const h=fixture(),draft=await h.create();await h.tasks.start(draft.id,{requestId:randomUUID(),revision:draft.revision})
    const ticket=h.accepted(),detail=h.tasks.detail(draft.id)
    expect(detail.routerSessionId).toBe('router')
    expect(detail.routes).toEqual([expect.objectContaining({ticketId:ticket.id,decisionId:ticket.decisionId,triggerId:ticket.origin.triggerId,
      requestedStrategy:'auto',selectedStrategy:'shared',reason:'在现有目录操作',directory:h.dir})])
    const cancelled=h.tasks.command(draft.id,'cancel',{requestId:randomUUID(),revision:detail.revision})
    const reopened=h.tasks.command(draft.id,'reopen',{requestId:randomUUID(),revision:cancelled.revision})
    expect(reopened.routes).toEqual(detail.routes);expect(reopened.sessionId).toBeUndefined()
  })
  it('saves drafts without an evaluation or worker, and deduplicates concurrent creation',async()=>{
    const h=fixture(),input={requestId:randomUUID(),title:'记录想法',description:'以后再做',directory:h.dir}
    const [one,two]=await Promise.all([h.tasks.create(input),h.tasks.create(input)])
    expect(one.id).toBe(two.id);expect(h.tasks.list().items).toHaveLength(1)
    expect(h.store.db.prepare('SELECT value FROM trigger').all().map(row=>JSON.parse(String(row.value)) as Trigger)).toEqual([]);expect(h.request).not.toHaveBeenCalled();expect(h.start).not.toHaveBeenCalled()
  })
  it('starts once, lets the router choose a directory, and requires human acceptance',async()=>{
    const h=fixture(),draft=await h.create(),command={requestId:randomUUID(),revision:draft.revision}
    await Promise.all([h.tasks.start(draft.id,command),h.tasks.start(draft.id,command)])
    h.engine.evaluateDue();expect(h.request).toHaveBeenCalledOnce()
    const ticket=h.accepted();expect(h.start).toHaveBeenCalledOnce()
    h.engine.assignmentStarted(ticket.id,latestAssignment(ticket)!.id)
    expect(h.tasks.detail(draft.id).stage).toBe('working')
    h.engine.report(ticket.id,{state:'ready',summary:'调整完成，检查通过'})
    const review=h.tasks.detail(draft.id);expect(review.stage).toBe('review');expect(review.phase).toBe('submitted')
    const done=h.tasks.command(draft.id,'confirm',{requestId:randomUUID(),revision:review.revision})
    expect(done.stage).toBe('done');expect(h.start).toHaveBeenCalledOnce()
    expect(done.events[0]?.text).toContain('未执行合并')
  })
  it('persists draft notes and native file/image references into the start request',async()=>{
    const h=fixture(),id=randomUUID()
    h.tasks.saveAsset({id,kind:'file',ref:{attachmentId:AttachmentId('sha256:'+'a'.repeat(64)),bytes:7,name:'input.txt'}})
    const draft=await h.create(),noted=h.tasks.command(draft.id,'note',{requestId:randomUUID(),revision:draft.revision,text:'附加要求',assets:[id]})
    await h.tasks.start(draft.id,{requestId:randomUUID(),revision:noted.revision})
    const trigger=h.store.db.prepare('SELECT value FROM trigger').all().map(row=>JSON.parse(String(row.value)) as Trigger)[0]!
    expect(trigger.text).toContain('附加要求');expect(taskContent(h.tasks,trigger)).toEqual([{type:'file',attachment:h.tasks.asset(id).ref}])
  })
  it('continues a ready ticket on new instructions without creating a duplicate task',async()=>{
    const h=fixture(),draft=await h.create();await h.tasks.start(draft.id,{requestId:randomUUID(),revision:draft.revision})
    const ticket=h.accepted();h.engine.assignmentStarted(ticket.id,latestAssignment(ticket)!.id);h.engine.report(ticket.id,{state:'ready',summary:'第一轮完成'})
    const review=h.tasks.detail(draft.id)
    const continued=h.tasks.command(draft.id,'note',{requestId:randomUUID(),revision:review.revision,text:'再调整一次'})
    expect(continued.phase).toBe('submitted');expect(continued.stage).not.toBe('review');expect(continued.tickets).toEqual([ticket.id])
    expect(h.tasks.list().items).toHaveLength(1)
  })
  it('rejects stale writes, keeps task history on cancel and requires a separate reopen/start',async()=>{
    const h=fixture(),draft=await h.create()
    const cancelled=h.tasks.command(draft.id,'cancel',{requestId:randomUUID(),revision:draft.revision})
    expect(()=>h.tasks.command(draft.id,'note',{requestId:randomUUID(),revision:draft.revision,text:'过期输入'})).toThrow('已更新')
    const reopened=h.tasks.command(draft.id,'reopen',{requestId:randomUUID(),revision:cancelled.revision})
    expect(reopened.stage).toBe('draft');expect(reopened.events.map(event=>event.kind)).toEqual(['reopened','cancelled','created'])
    expect(h.start).not.toHaveBeenCalled()
  })
  it('keeps a reopened task queued until its new execution is accepted',async()=>{
    const h=fixture(),draft=await h.create();await h.tasks.start(draft.id,{requestId:randomUUID(),revision:draft.revision})
    const ticket=h.accepted();h.engine.assignmentStarted(ticket.id,latestAssignment(ticket)!.id);h.engine.report(ticket.id,{state:'ready',summary:'完成'})
    const review=h.tasks.detail(draft.id),done=h.tasks.command(draft.id,'confirm',{requestId:randomUUID(),revision:review.revision})
    const reopened=h.tasks.command(draft.id,'reopen',{requestId:randomUUID(),revision:done.revision})
    const queued=await h.tasks.start(draft.id,{requestId:randomUUID(),revision:reopened.revision})
    expect(queued.stage).toBe('queued');expect(queued.sessionId).toBeUndefined();expect(queued.tickets).toEqual([ticket.id])
  })
  it('surfaces a delivered Router failure without changing draft tasks',async()=>{
    const h=fixture(),draft=await h.create(),pending=await h.create()
    await h.tasks.start(pending.id,{requestId:randomUUID(),revision:pending.revision});h.engine.evaluateDue()
    const evaluation=h.store.threads.active().find(thread=>thread.evaluating)?.evaluating
    h.engine.candidateDelivered(evaluation!.id);h.tasks.routingFailed('Model credentials are missing')
    expect(h.tasks.detail(draft.id).stage).toBe('draft')
    expect(h.tasks.detail(pending.id)).toMatchObject({stage:'waiting',attentionKind:'routing',retryable:true,summary:'Model credentials are missing'})
  })
  it('cancels an evaluating task before a worker can be assigned',async()=>{
    const h=fixture(),draft=await h.create(),queued=await h.tasks.start(draft.id,{requestId:randomUUID(),revision:draft.revision})
    h.engine.evaluateDue()
    const cancelled=h.tasks.command(draft.id,'cancel',{requestId:randomUUID(),revision:queued.revision})
    expect(cancelled.stage).toBe('cancelled');expect(h.start).not.toHaveBeenCalled()
    expect(h.store.threads.active().some(thread=>thread.evaluating)).toBe(false)
    expect(()=>h.accepted()).toThrow();expect(h.start).not.toHaveBeenCalled()
  })
  it('requires a valid directory and known assets and keeps explicit directory overrides',async()=>{
    const h=fixture()
    await expect(h.tasks.create({requestId:randomUUID(),title:'bad',description:'bad',directory:'relative'})).rejects.toThrow('绝对目录')
    await expect(h.tasks.create({requestId:randomUUID(),title:'bad',description:'bad',directory:h.dir,assets:[randomUUID()]})).rejects.toThrow('附件不存在')
    const draft=await h.tasks.create({requestId:randomUUID(),title:'test',description:'test',directory:h.dir,strategy:'shared'})
    await h.tasks.start(draft.id,{requestId:randomUUID(),revision:draft.revision})
    const trigger=h.store.db.prepare('SELECT value FROM trigger').all().map(row=>JSON.parse(String(row.value)) as Trigger)[0]!
    const decision=h.engine.decide(trigger.id,{kind:'accept',title:'test',scope:'test',reason:'test',name:'test',execution:{strategy:'worktree',reason:'override'}})
    expect(h.store.tickets.get(decision.ticketId!)?.execution?.directory).toBe(h.dir)
  })
  it('keeps tasks readable after reopening the database and paginates task lists',async()=>{
    const h=fixture();await h.create();await h.create();await h.create()
    const first=h.tasks.list({limit:2});expect(first.items).toHaveLength(2);expect(first.nextOffset).toBe(2)
    expect(h.tasks.list({limit:2,offset:2}).items).toHaveLength(1)
    const second=new Store(h.path);try{expect(second.db.prepare('SELECT COUNT(*) AS n FROM task').get()?.n).toBe(3)}finally{second.close()}
  })
})
