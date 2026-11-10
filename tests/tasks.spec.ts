import { afterEach, expect, it, vi } from 'vitest'
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
const cleanups: (()=>void)[]=[]
afterEach(()=>cleanups.splice(0).reverse().forEach(cleanup=>cleanup()))
function fixture() {
 const dir=mkdtempSync(join(tmpdir(),'superagent-tasks-')),store=new Store(join(dir,'state.sqlite'))
 cleanups.push(()=>{store.close();rmSync(dir,{recursive:true,force:true})})
 const sources=new SourceRegistry(()=>store.settings()),launch=vi.fn(),route=vi.fn(),prepareDirectory=vi.fn(async()=>{}),ensureSession=vi.fn(async()=>{}),pass=vi.fn()
 let tasks:Tasks
 const engine=new Engine({repo:store,scope:sources,policy:()=>settingsPolicy(store.settings(),sources),assessor:{request:vi.fn()},executor:{start:launch,stop:vi.fn(),deliver:vi.fn()},
  prepareTicket:(ticket,outcome)=>tasks.assign(ticket,outcome),emit:event=>{if(event.type==='assignment.reported')tasks.recordReport(event.data.ticketId)}})
 tasks=new Tasks({store,engine,stateDir:dir,requestPass:pass,requestPreparation:route,prepareDirectory,ensureSession});sources.register(localKind())
 const create=()=>tasks.create({requestId:randomUUID(),title:'测试任务',description:'仅处理明确的需求',directory:dir})
 const command=(id:string)=>({requestId:randomUUID(),revision:tasks.detail(id).revision})
 const prepare=async(id:string)=>{await tasks.prepare(id,command(id));return tasks.chooseDirectory(id,tasks.detail(id).preparation!.generation,'shared','读取已有目录')}
 const accept=()=>{const trigger=store.db.prepare('SELECT value FROM trigger').all().map(row=>JSON.parse(String(row.value)) as Trigger).at(-1)!;return engine.decide(trigger.id,{kind:'accept',title:'测试任务',scope:'明确需求',reason:'用户开始',name:'test'})}
 return {dir,store,tasks,engine,launch,route,prepareDirectory,ensureSession,create,command,prepare,accept}
}
it('saves a draft without preparing a directory, creating a Session or launching work',async()=>{
 const h=fixture(),task=await h.create();expect(task).toMatchObject({phase:'draft',stage:'draft'});expect(task.sessionId).toBeUndefined();expect(h.route).not.toHaveBeenCalled();expect(h.ensureSession).not.toHaveBeenCalled();expect(h.launch).not.toHaveBeenCalled()
})
it('first open routes and prepares once, opens a bound Session, and remains a draft',async()=>{
 const h=fixture(),task=await h.create(),command=h.command(task.id)
 await Promise.all([h.tasks.prepare(task.id,command),h.tasks.prepare(task.id,command)])
 expect(h.route).toHaveBeenCalledTimes(1);expect(h.ensureSession).not.toHaveBeenCalled()
 const ready=await h.tasks.chooseDirectory(task.id,1,'shared','现有目录')
 expect(ready).toMatchObject({phase:'draft',stage:'draft',sessionId:`task-${task.id}`,preparation:{state:'ready',execution:{directory:h.dir}}})
 expect(h.prepareDirectory).toHaveBeenCalledTimes(1);expect(h.ensureSession).toHaveBeenCalledTimes(1);expect(h.launch).not.toHaveBeenCalled()
 await h.tasks.prepare(task.id,h.command(task.id));expect(h.route).toHaveBeenCalledTimes(1)
})
it('start before opening waits for preparation, then submits one execution with the same Session and directory',async()=>{
 const h=fixture(),task=await h.create(),command=h.command(task.id)
 await h.tasks.start(task.id,command);await h.tasks.start(task.id,command)
 expect(h.launch).not.toHaveBeenCalled();await h.tasks.chooseDirectory(task.id,1,'shared','现有目录');h.accept()
 const active=h.tasks.detail(task.id),ticket=h.store.tickets.get(active.activeTicket!)!
 expect(ticket.execution).toMatchObject({sessionId:active.sessionId,directory:h.dir});expect(h.launch).toHaveBeenCalledTimes(1)
})
it('preparation failure preserves the draft and can retry its persisted directory choice',async()=>{
 const h=fixture(),task=await h.create();h.prepareDirectory.mockRejectedValueOnce(new Error('磁盘空间不足'))
 await h.tasks.prepare(task.id,h.command(task.id));const failed=await h.tasks.chooseDirectory(task.id,1,'shared','现有目录')
 expect(failed).toMatchObject({phase:'draft',preparation:{state:'error',error:'磁盘空间不足'}});expect(h.ensureSession).not.toHaveBeenCalled()
 await h.tasks.prepare(task.id,h.command(task.id));await vi.waitFor(()=>expect(h.tasks.detail(task.id).preparation?.state).toBe('ready'))
 expect(h.route).toHaveBeenCalledTimes(1);expect(h.ensureSession).toHaveBeenCalledTimes(1);expect(h.launch).not.toHaveBeenCalled()
})
it('restores an unfinished Router request after restart and keeps stale decisions from replacing it',async()=>{
 const h=fixture(),task=await h.create();await h.tasks.prepare(task.id,h.command(task.id));h.tasks.resumePreparation();expect(h.route).toHaveBeenCalledTimes(2)
 await expect(h.tasks.chooseDirectory(task.id,2,'shared','过期选择')).rejects.toThrow('已失效')
 const ready=await h.tasks.chooseDirectory(task.id,1,'shared','原选择');expect(ready.sessionId).toBe(`task-${task.id}`)
})
it('reports progress and a ready result directly without channel delivery, and preserves the Session after reopen',async()=>{
 const h=fixture(),task=await h.create();await h.prepare(task.id);await h.tasks.start(task.id,h.command(task.id));h.accept()
 const active=h.tasks.detail(task.id),ticket=h.store.tickets.get(active.activeTicket!)!,assignment=latestAssignment(ticket)!
 h.engine.assignmentStarted(ticket.id,assignment.id);h.engine.report(ticket.id,{state:'progress',summary:'正在检查',question:'请确认范围'})
 expect(h.tasks.detail(task.id)).toMatchObject({stage:'waiting',question:'请确认范围',summary:'正在检查'});h.tasks.recordReport(ticket.id)
 expect(h.tasks.detail(task.id).events.filter(event=>event.kind==='report')).toHaveLength(1)
 h.engine.report(ticket.id,{state:'ready',summary:'已完成并验证'});expect(h.tasks.detail(task.id).stage).toBe('review')
 h.tasks.command(task.id,'confirm',h.command(task.id));h.tasks.command(task.id,'reopen',h.command(task.id));await h.tasks.start(task.id,h.command(task.id));h.accept()
 expect(h.tasks.detail(task.id).sessionId).toBe(active.sessionId);expect(h.ensureSession).toHaveBeenCalledTimes(1)
})
it('refuses moving a prepared Session to another directory and rejects removed task fields',async()=>{
 const h=fixture(),task=await h.create();await h.prepare(task.id)
 await expect(h.tasks.edit(task.id,{...h.command(task.id),title:task.title,description:task.description,directory:tmpdir()})).rejects.toThrow('不能更换')
 await expect(h.tasks.create({requestId:randomUUID(),title:'旧字段',description:'旧字段',directory:h.dir,...JSON.parse('{"priority":"none"}')} as never)).rejects.toThrow()
 expect(JSON.stringify(h.tasks.list())).not.toMatch(/priority|dueDate|priorityCounts/)
})
it('finds an associated task by its Session without changing ordinary conversations',async()=>{
 const h=fixture(),task=await h.create();await h.prepare(task.id);expect(h.tasks.bySession(`task-${task.id}`)?.id).toBe(task.id);expect(h.tasks.bySession('ordinary')).toBeNull()
})
it('invalidates a pending preparation when cancelled and never submits its late result after reopen',async()=>{
 const h=fixture(),task=await h.create();let finish!:()=>void
 h.prepareDirectory.mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve}))
 await h.tasks.start(task.id,h.command(task.id));const choosing=h.tasks.chooseDirectory(task.id,1,'shared','原目录')
 await vi.waitFor(()=>expect(finish).toBeDefined());h.tasks.command(task.id,'cancel',h.command(task.id));h.tasks.command(task.id,'reopen',h.command(task.id));finish();await choosing
 expect(h.tasks.detail(task.id)).toMatchObject({phase:'draft',preparation:{state:'error',startRequested:false}})
 expect(h.ensureSession).not.toHaveBeenCalled();expect(h.launch).not.toHaveBeenCalled()
 await h.tasks.prepare(task.id,h.command(task.id));await vi.waitFor(()=>expect(h.tasks.detail(task.id).preparation?.state).toBe('ready'))
 expect(h.launch).not.toHaveBeenCalled()
})
it('keeps the chosen directory fixed if cancellation overlaps Session creation',async()=>{
 const h=fixture(),task=await h.create();let finish!:()=>void
 h.ensureSession.mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve}))
 await h.tasks.prepare(task.id,h.command(task.id));const preparing=h.tasks.chooseDirectory(task.id,1,'shared','固定执行目录')
 await vi.waitFor(()=>expect(finish).toBeDefined());h.tasks.command(task.id,'cancel',h.command(task.id));h.tasks.command(task.id,'reopen',h.command(task.id))
 await expect(h.tasks.edit(task.id,{...h.command(task.id),title:task.title,description:task.description,directory:tmpdir(),strategy:'auto'})).rejects.toThrow('不能更换')
 finish();await preparing;expect(h.launch).not.toHaveBeenCalled()
})
it('rolls a start back to the prepared draft when the local intake is disabled',async()=>{
 const h=fixture(),task=await h.create();await h.prepare(task.id)
 const settings=h.store.settings();h.store.saveSettings({...settings,sources:{local:{enabled:false,config:{}}}})
 await expect(h.tasks.start(task.id,h.command(task.id))).rejects.toThrow('入口已停用')
 expect(h.tasks.detail(task.id)).toMatchObject({phase:'draft',sessionId:`task-${task.id}`});expect(h.launch).not.toHaveBeenCalled()
})
