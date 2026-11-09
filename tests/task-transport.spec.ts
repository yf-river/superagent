import { expect, it, vi } from 'vitest'
import { connectionTransport, taskCaller } from '../src/client/task-api.ts'

it('routes task calls through the selected authenticated carrier with Gateway named args',async()=>{
  const call=vi.fn(async()=>({ok:true as const,value:{status:200,body:{items:[]}}})),fetch=vi.fn()
  vi.stubGlobal('fetch',fetch)
  try {
    const api=taskCaller(connectionTransport({call}))
    expect(await api('POST','tasks/example/start',{requestId:'id',revision:2})).toEqual({items:[]})
    expect(call).toHaveBeenCalledExactlyOnceWith('/api','superagentTasks/request',{args:{input:{method:'POST',path:'tasks/example/start',body:{requestId:'id',revision:2}}}})
    expect(fetch).not.toHaveBeenCalled()
  } finally {vi.unstubAllGlobals()}
})
it('preserves host refusals and carrier failures for visible error feedback',async()=>{
  const conflict=taskCaller(connectionTransport({call:async()=>({ok:true,value:{status:409,body:{error:'任务已更新'}}})}))
  await expect(conflict('POST','tasks/id/start',{})).rejects.toThrow('任务已更新')
  const offline=taskCaller(connectionTransport({call:async()=>({ok:false,error:{code:'offline',message:'Disconnected',details:{}}})}))
  await expect(offline('GET','tasks')).rejects.toThrow('Disconnected')
})
