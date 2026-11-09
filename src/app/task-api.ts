/** 经 DSH Gateway 暴露的任务与管理接口，浏览器和远程客户端共用。 */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-workspace'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { TaskError, Tasks, TaskCreateSchema, TaskCommandSchema, TaskPropertiesSchema, TaskPrioritySchema } from './tasks.ts'
import { TASK_STAGES } from './task-model.ts'
import { dispatchManagement, type HttpHost } from './http.ts'

const RequestSchema=z.object({method:z.enum(['GET','POST','PUT']),path:z.string().min(1),body:z.unknown().optional()}).strict()
const ListSchema=z.object({q:z.string().optional(),directory:z.string().optional(),stage:z.enum(TASK_STAGES).optional(),
  priority:TaskPrioritySchema.optional(),
  offset:z.coerce.number().int().nonnegative().default(0),limit:z.coerce.number().int().positive().max(200).default(50)})
const UploadSchema=z.object({data:z.string(),name:z.string().min(1).max(255),mediaType:z.string()}).strict()

/** 所有变更落到 Tasks，Gateway 负责当前 DSH 所有者的连接鉴权。 */
export class SuperagentApi extends TypertRemoteService {
  constructor(ctx: Context, private readonly tasks: Tasks, private readonly management: HttpHost) {
    super(ctx,'superagentTasks')
    // 显式应用公开的方法标记，宿主可以直接用 Node 装载 ESM。
    Remote<SuperagentApi,[unknown],Promise<{status:number;body:unknown}>>(this.request,{kind:'method',name:'request',static:false,private:false,metadata:{},
      access:{has:instance=>'request' in instance,get:instance=>instance.request},
      addInitializer:initializer=>initializer.call(this)})
  }
  async request(input: unknown): Promise<{status:number;body:unknown}> {
    try {
      const {method,path,body}=RequestSchema.parse(input)
      const url=new URL(path,'http://task.local/'), parts=url.pathname.replace(/^\//,'').split('/').map(decodeURIComponent)
      if(parts[0]!=='tasks' && parts[0]!=='task-assets' && parts[0]!=='task-directories') return dispatchManagement(this.management,method,path,body)
      await this.management.ready
      if(parts[0]==='task-directories' && method==='GET') return {status:200,body:this.ctx.workspaceRegistry.list().map(workspace=>({id:workspace.id,path:workspace.path,title:workspace.title}))}
      if(parts[0]==='task-assets' && method==='POST') {
        const upload=UploadSchema.parse(body), id=randomUUID()
        if(['image/png','image/jpeg','image/webp','image/gif'].includes(upload.mediaType)) {
          const mediaType=z.enum(['image/png','image/jpeg','image/webp','image/gif']).parse(upload.mediaType)
          const parts=await this.ctx.attachments.admitPromptContent([{type:'image',data:upload.data,name:upload.name,mediaType}])
          const image=parts[0]
          if(image?.type!=='image') throw new TaskError('图片上传未返回有效附件')
          return {status:200,body:this.tasks.saveAsset({id,kind:'image',ref:image.attachment})}
        }
        const ref=await this.ctx.attachments.admitEncodedFile({data:upload.data,name:upload.name})
        return {status:200,body:this.tasks.saveAsset({id,kind:'file',ref})}
      }
      if(parts[0]==='task-assets' && parts[1] && method==='GET') {
        const asset=this.tasks.asset(parts[1])
        if(asset.kind==='image') {
          const image=await this.ctx.attachments.readImage(asset.ref)
          return {status:200,body:{mediaType:asset.ref.mediaType,name:asset.ref.name,data:Buffer.from(image.data).toString('base64')}}
        }
        const chunks:Uint8Array[]=[]
        for await (const chunk of this.ctx.attachments.readFileStream(asset.ref)) chunks.push(chunk)
        return {status:200,body:{mediaType:'application/octet-stream',name:asset.ref.name,data:Buffer.concat(chunks).toString('base64')}}
      }
      if(parts[0]!=='tasks') throw new TaskError('未知操作',404)
      const id=parts[1], action=parts[2]
      if(!id && method==='GET') return {status:200,body:this.tasks.list(ListSchema.parse(Object.fromEntries(url.searchParams)))}
      if(!id && method==='POST') return {status:200,body:await this.tasks.create(TaskCreateSchema.parse(body))}
      if(id && !action && method==='GET') return {status:200,body:this.tasks.detail(id,z.coerce.number().int().nonnegative().parse(url.searchParams.get('offset') ?? 0))}
      if(id && action==='properties' && method==='PUT') return {status:200,body:this.tasks.properties(id,TaskPropertiesSchema.parse(body))}
      if(id && !action && method==='PUT') {
        const value=TaskCreateSchema.extend({revision:z.number().int().positive()}).parse(body)
        return {status:200,body:await this.tasks.edit(id,value)}
      }
      if(id && action && method==='POST') {
        const command=TaskCommandSchema.parse(body)
        if(action==='start') return {status:200,body:await this.tasks.start(id,command)}
        const verb=z.enum(['note','retry','cancel','confirm','reopen']).parse(action)
        return {status:200,body:this.tasks.command(id,verb,command)}
      }
      throw new TaskError('未知操作',404)
    } catch(error) {
      if(error instanceof TaskError) return {status:error.status,body:{error:error.message}}
      if(error instanceof z.ZodError) return {status:400,body:{error:error.issues.map(issue=>`${issue.path.join('.')}: ${issue.message}`).join('; ')}}
      this.ctx.logger.warn('Superagent task request failed: %s',String(error))
      return {status:500,body:{error:error instanceof Error ? error.message : String(error)}}
    }
  }
}
