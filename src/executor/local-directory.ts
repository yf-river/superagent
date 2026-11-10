/** 本地任务目录准备；共享目录不切换分支，worktree 记录基线并支持恢复。 */
import { stat } from 'node:fs/promises'
import { runAsWorker } from '../infra/environment.ts'
import type { Context } from '@deepseek-ai/cordis'
import { CliError } from '../infra/commands.ts'
import type { Execution, Ticket } from '../core/index.ts'
import type { Store } from '../app/store.ts'

export async function prepareLocalDirectory(ticket: Ticket, host: { context: Context; store: Pick<Store,'tickets'>; lifetime: AbortSignal }, current: ()=>boolean): Promise<void> {
  await prepareExecutionDirectory(ticket.execution!, host, execution => {
    const latest = host.store.tickets.get(ticket.id)
    if (!latest || latest.ended) throw new Error('Task stopped before directory preparation')
    host.store.tickets.save({ ...latest, execution })
  }, current)
}

/** 准备已持久化的 shared/worktree 选择；在创建 worktree 前保存分支及基线。 */
export async function prepareExecutionDirectory(execution: Execution, host: { context: Context; lifetime: AbortSignal }, save: (execution: Execution) => void, current: () => boolean): Promise<void> {
  const local = execution.local!
  const check=()=>{ host.lifetime.throwIfAborted(); if(!current()) throw new Error('Task stopped during directory preparation') }
  const git=async (cwd:string,args:string[])=>{check();const value=await runAsWorker(host.context.subprocess,['git','-C',cwd,...args],cwd,AbortSignal.any([host.lifetime,AbortSignal.timeout(60000)]));check();return value.trim()}
  if(!(await stat(local.projectDirectory)).isDirectory()) throw new Error('The project directory is unavailable')
  check()
  if(local.strategy==='shared') return
  const repository=await git(local.projectDirectory,['rev-parse','--show-toplevel'])
  if(!local.baseCommit) {
    local.baseCommit=await git(local.projectDirectory,['rev-parse','HEAD'])
    local.branch=`superagent/${execution.name}`
    save({ ...execution, local: { ...local } })
  }
  if(await stat(execution.directory).then(()=>true,()=>false)) {
    const branch=await git(execution.directory,['branch','--show-current'])
    const common=await git(execution.directory,['rev-parse','--path-format=absolute','--git-common-dir'])
    const sourceCommon=await git(repository,['rev-parse','--path-format=absolute','--git-common-dir'])
    if(branch!==local.branch || common!==sourceCommon) throw new Error('The task directory does not match its recorded worktree')
    return
  }
  const existing = await git(repository,['show-ref','--verify','--quiet',`refs/heads/${local.branch}`]).then(()=>true,error=>{ if(error instanceof CliError && error.exitCode===1) return false; throw error })
  if(existing) await git(repository,['worktree','add',execution.directory,local.branch!])
  else await git(repository,['worktree','add','-b',local.branch!,execution.directory,local.baseCommit])
}
