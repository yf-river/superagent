/** 当前 DSH 实例所有者从任务页提交的明确请求。 */
import { z } from 'zod'
import type { SourceKind } from './kind.ts'
export function localKind(): SourceKind {
  return { kind:'local', title:{zh:'本地任务',en:'Local tasks'}, description:{zh:'当前实例的任务请求',en:'Tasks submitted by this instance owner'},
    schema:z.object({}).strict(), fields:[], health:[], scope:()=>({listened:true,observed:false}) }
}
