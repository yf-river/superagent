/** 普通 DSH 会话的任务工具；保存草稿与执行调度分离。 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { key, type Trigger } from '../core/index.ts'
import { TaskPrioritySchema, type Tasks } from './tasks.ts'
import { ticketOfSession } from '../executor/dsh.ts'

/** 将任务附件作为原生内容投递，文件路径由 DSH 请求投影解析。 */
export function taskContent(tasks: Tasks, trigger: Trigger | undefined): ContentBlock[] {
  if(trigger?.source!=='local') return []
  const ids=z.array(z.string()).parse(trigger.meta.assets ?? [])
  return ids.map(id=>tasks.asset(id)).map(asset=>asset.kind==='image' ? {type:'image',attachment:asset.ref} : {type:'file',attachment:asset.ref})
}
const uuidOf=(value:string)=>{const h=key(value);return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20)}`}
/** 已加载和后续普通会话获得同样工具，卸载时释放全部注册。 */
export function installTaskTools(ctx: Context, tasks: Tasks, masterId: string): ()=>void {
  const registered=new Map<Agent,(()=>void)[]>()
  const install=(agent:Agent)=>{
    if(registered.has(agent) || agent.id===masterId || ticketOfSession(agent.id) || agent.session.header.origin==='subagent') return
    const disposers:(()=>void)[]=[];registered.set(agent,disposers)
    const add=<S extends z.ZodType>(name:string,description:string,schema:S,execute:(args:z.infer<S>,callId:string)=>Promise<unknown>)=>{
      disposers.push(agent.ctx.tools.register({name,description,parameters:z.toJSONSchema(schema),
        output:{schema:{type:'object',additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
        execute:(args,execution)=>execute(schema.parse(args),execution.callId)}))
    }
    add('superagent_task_create','Save a task to the task board as a draft; does not start execution. Use only the request the user wants saved. Return the task id. attachmentNames selects files/images by name from the most recent user message.',
      z.object({title:z.string().min(1).max(200),description:z.string().min(1).max(100000),directory:z.string().optional(),
        strategy:z.enum(['auto','shared','worktree']).default('auto'),priority:TaskPrioritySchema.default('none'),dueDate:z.iso.date().nullable().default(null),attachmentNames:z.array(z.string()).default([])}).strict(),async(args,callId)=>{
        const assets:string[]=[]
        const message=agent.session.snapshotEvents().filter(event=>event.type==='user/message' && event.data.source.kind==='user').at(-1)
        if(args.attachmentNames.length) {
          const content=message?.type==='user/message' ? message.data.content : []
          for(const name of args.attachmentNames) {
            const matches=content.filter(part=>(part.type==='file' || part.type==='image') && part.attachment.name===name)
            if(matches.length!==1) throw new Error(`Attachment name must identify one file in the current user message: ${name}`)
            const part=matches[0]!, id=randomUUID()
            if(part.type==='image') tasks.saveAsset({id,kind:'image',ref:part.attachment})
            else if(part.type==='file') tasks.saveAsset({id,kind:'file',ref:part.attachment})
            assets.push(id)
          }
        }
        const task=await tasks.create({requestId:uuidOf(`${agent.id}:${callId}`),title:args.title,description:args.description,
          directory:args.directory ?? agent.session.header.cwd ?? '',strategy:args.strategy,priority:args.priority,dueDate:args.dueDate,assets},agent.id)
        return {task_id:task.id,title:task.title,stage:task.stage,directory:task.directory,url:`#superagent/tasks/${task.id}`}
      })
    add('superagent_task_list','Find tasks on this DSH instance task board. Does not start or change tasks.',
      z.object({q:z.string().optional(),offset:z.number().int().nonnegative().default(0)}).strict(),async(args)=>tasks.list(args))
    add('superagent_task_get','Read one task, its current result, question, execution directory and recent activity.',
      z.object({id:z.string(),offset:z.number().int().nonnegative().default(0)}).strict(),async(args)=>tasks.detail(args.id,args.offset))
  }
  const created=ctx.on('agent/created',({agent})=>{install(agent)})
  const disposed=ctx.on('agent/disposed',({agent})=>{registered.get(agent)?.forEach(dispose=>dispose());registered.delete(agent)})
  for(const agent of ctx.agents.list()) install(agent)
  return ()=>{created();disposed();for(const disposers of registered.values()) disposers.reverse().forEach(dispose=>dispose());registered.clear()}
}
