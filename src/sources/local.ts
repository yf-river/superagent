/** 当前 DSH 实例所有者从任务页提交的明确请求。 */
import { z } from 'zod'
import type { SourceKind } from './kind.ts'
import type { Tasks } from '../app/tasks.ts'

export function localKind(tasks: Tasks): SourceKind {
  return {kind:'local',title:{zh:'本地任务',en:'Local tasks'},description:{zh:'当前实例的任务请求',en:'Tasks submitted by this instance owner'},schema:z.object({}).strict(),fields:[],health:[],
    scope:()=>({listened:true,observed:false}),
    channel:{send:async(_host,message)=>{tasks.reply(message.channel.address.taskId!,message.id,message.text);return 'sent'},
      link:()=>({url:'',label:{zh:'任务',en:'Task'}})} }
}
