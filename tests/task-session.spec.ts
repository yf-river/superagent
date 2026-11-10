/** 本地任务与 DSH 会话、调度、直接汇报的集成；宿主模型和 Session 使用测试夹具。 */
import { afterEach,expect,it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { startRuntime,type Host } from './fixtures/host.ts'
let h:Host|undefined
afterEach(async()=>{await h?.stop()})
it('prepares without a model turn, binds task tools on execution and keeps its native Session for retry',async()=>{
 h=await startRuntime();const {runtime}=h
 const task=await runtime.tasks.create({requestId:randomUUID(),title:'会话绑定验收',description:'仅读取本地文件',directory:runtime.machine.stateDir,strategy:'shared'})
 const cmd=()=>({requestId:randomUUID(),revision:runtime.tasks.detail(task.id).revision})
 await runtime.tasks.prepare(task.id,cmd());await runtime.tasks.chooseDirectory(task.id,1,'shared','只读检查')
 const ready=runtime.tasks.detail(task.id),session=ready.sessionId!
 expect(ready.stage).toBe('draft');expect(runtime.store.tickets.list()).toHaveLength(0)
 expect(h.agents.get(session)?.followup).not.toHaveBeenCalled();expect(h.agents.get(session)?.steer).not.toHaveBeenCalled()
 await runtime.tasks.start(task.id,cmd());await runtime.idle()
 const trigger=runtime.store.db.prepare("SELECT id FROM trigger WHERE json_extract(value,'$.source')='local'").get()!
 await h.route({kind:'accept',trigger_id:String(trigger.id),title:task.title,worktree_name:'session-test'})
 await runtime.idle();expect(runtime.tasks.detail(task.id).sessionId).toBe(session)
 expect(h.tools.get(session)?.has('orchestrator_report')).toBe(true)
 await h.runTool(session,'orchestrator_report',{state:'ready',summary:'验证完成'})
 expect(runtime.tasks.detail(task.id)).toMatchObject({stage:'review',summary:'验证完成'})
 const firstTicket=runtime.tasks.detail(task.id).activeTicket
 runtime.tasks.command(task.id,'confirm',cmd());runtime.tasks.command(task.id,'reopen',cmd())
 await runtime.tasks.start(task.id,cmd());await runtime.idle()
 const nextTrigger=runtime.store.db.prepare("SELECT id FROM trigger WHERE json_extract(value,'$.source')='local' ORDER BY rowid DESC").get()!
 await h.route({kind:'accept',trigger_id:String(nextTrigger.id),title:task.title,worktree_name:'session-again'});await runtime.idle()
 const secondTicket=runtime.tasks.detail(task.id).activeTicket;expect(secondTicket).not.toBe(firstTicket)
 await h.runTool(session,'orchestrator_report',{state:'ready',summary:'同一会话第二次完成'})
 expect(runtime.tasks.detail(task.id)).toMatchObject({stage:'review',sessionId:session,summary:'同一会话第二次完成'})
 expect(runtime.store.tickets.get(firstTicket!)?.assignments.at(-1)?.report?.summary).toBe('验证完成')
})
it('creates a local Router independently of the external coordinator and reuses its persisted identity',async()=>{
 h=await startRuntime(store=>{store.set('master-id','legacy-external-router');store.set('local-router-session','legacy-external-router')})
 const id=h.runtime.masterId;expect(id).toMatch(/^local-router-/);expect(id).not.toBe('legacy-external-router');expect(h.runtime.store.get('local-router-session')).toBe(id)
 expect(h.runtime.store.get('master-id')).toBe('legacy-external-router');await h.stop()
 h=await startRuntime(store=>{store.set('local-router-session',id)})
 expect(h.runtime.masterId).toBe(id)
})
