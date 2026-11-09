/** 任务页与管理页共用 DSH 的已认证 Connection，不访问浏览器本机服务。 */
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
export type ApiTransport = (path: string, method: string, body?: unknown)=>Promise<Response>
export type TaskCall = <T>(method: string, path: string, body?: unknown)=>Promise<T>
export function connectionTransport(rpc: ClientConnectionRpc): ApiTransport {
  return async(path,method,body)=>{
    const result=await rpc.call('/api','superagentTasks/request',{args:{input:{method,path,...body===undefined?{}:{body}}}})
    if(!result.ok) throw new Error(result.error.message)
    const reply=result.value as {status:number;body:unknown}
    return new Response(JSON.stringify(reply.body),{status:reply.status,headers:{'content-type':'application/json'}})
  }
}
export function taskCaller(transport: ApiTransport): TaskCall {
  return async<T>(method:string,path:string,body?:unknown):Promise<T>=>{
    const response=await transport(path,method,body), result=await response.json() as T & {error?:string}
    if(!response.ok) throw new Error(result.error ?? `Request failed (${response.status})`)
    return result
  }
}
