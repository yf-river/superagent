/** 检查当前本地 Router/Worker 的模型入口，不加载外部渠道适配器。 */
import { afterEach, expect, it } from 'vitest'
import { startRuntime, type Host } from './fixtures/host.ts'
import { LOCAL_ROUTER_PROMPT, LOCAL_WORKER_PROMPT } from '../src/app/local-prompts.ts'
let host: Host | undefined
afterEach(async()=>{await host?.stop();host=undefined})
it('offers directory preparation separately from routing and has no channel send tools',async()=>{
 host=await startRuntime();const names=[...host.tools.get(host.runtime.masterId)!.keys()]
 expect(names).toContain('orchestrator_prepare_task');expect(names).toContain('orchestrator_route');expect(names).not.toContain('orchestrator_reply');expect(names).not.toContain('orchestrator_ack')
 expect(LOCAL_ROUTER_PROMPT).toContain('never start execution');expect(LOCAL_WORKER_PROMPT).toContain('normal chat responses')
})
