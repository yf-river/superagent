import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Execution } from '../src/core/index.ts'
import { prepareExecutionDirectory } from '../src/executor/local-directory.ts'
import { withoutDirectory } from '../src/infra/environment.ts'
const roots:string[]=[];afterEach(()=>roots.splice(0).forEach(path=>rmSync(path,{recursive:true,force:true})))
const git=(cwd:string,...args:string[])=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8'}).trim()
function host() {
 const ctx=new Context();ctx.provide('subprocess');ctx.set('subprocess',{spawn:(spec:{argv:string[];cwd:string;signal:AbortSignal})=>{
  const child=spawn(spec.argv[0]!,spec.argv.slice(1),{cwd:spec.cwd,signal:spec.signal});let stdout='',stderr='';child.stdout.on('data',data=>{stdout+=data});child.stderr.on('data',data=>{stderr+=data})
  const done=new Promise<{exitCode:number|null}>(resolve=>child.on('close',exitCode=>resolve({exitCode})))
  return {done,collected:{stdout:{readFrom:()=>({text:stdout})},stderr:{readFrom:()=>({text:stderr})}}}
 }} as never);return {context:ctx,lifetime:new AbortController().signal}
}
it('creates and reuses a real Git worktree with a fixed recorded branch and baseline',async()=>{
 const root=mkdtempSync(join(tmpdir(),'superagent-worktree-'));roots.push(root);git(root,'init','-q');git(root,'config','user.email','test@example.com');git(root,'config','user.name','Test');writeFileSync(join(root,'input.txt'),'original\n');git(root,'add','.');git(root,'commit','--no-gpg-sign','-qm','initial')
 const directory=join(root,'..',`${root.split('/').at(-1)}-work`);roots.push(directory)
 let execution:Execution={name:'task-test',directory,assignment:'',sessionId:'task-session',local:{strategy:'worktree',projectDirectory:root,reason:'代码修改'}}
 await prepareExecutionDirectory(execution,host(),value=>{execution=value},()=>true)
 expect(existsSync(join(directory,'input.txt'))).toBe(true);expect(git(directory,'rev-parse','HEAD')).toBe(execution.local!.baseCommit);expect(git(directory,'branch','--show-current')).toBe('superagent/task-test')
 await prepareExecutionDirectory(execution,host(),()=>{throw Error('choice was already persisted')},()=>true)
 git(directory,'checkout','-qb','other-branch');await expect(prepareExecutionDirectory(execution,host(),()=>{},()=>true)).rejects.toThrow('does not match')
})
it('rejects cancelled directory preparation and normalizes PATH without external account shims',async()=>{
 const root=mkdtempSync(join(tmpdir(),'superagent-shared-'));roots.push(root)
 await expect(prepareExecutionDirectory({name:'task',directory:root,assignment:'',local:{strategy:'shared',projectDirectory:root,reason:'读取'}},host(),()=>{},()=>false)).rejects.toThrow('stopped')
 expect(withoutDirectory('/usr/bin:/tmp/example:/bin','/tmp/example')).toBe('/usr/bin:/bin')
})
