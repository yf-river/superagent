import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../src/app/store.ts'
import { Prompts, defaultPrompts } from '../src/app/prompts.ts'
const dispose:(()=>void)[]=[]
afterEach(()=>dispose.splice(0).reverse().forEach(fn=>fn()))
it('previews the local role instructions actually used, including saved team sections',()=>{
 const dir=mkdtempSync(join(tmpdir(),'local-prompts-')),store=new Store(join(dir,'db.sqlite'));dispose.push(()=>{store.close();rmSync(dir,{recursive:true,force:true})})
 const prompts=new Prompts(store,()=>100000,()=>[],()=>false,()=>true)
 expect(prompts.current().config).toEqual(defaultPrompts(true))
 const config={...prompts.current().config,scope:'Only modify the requested document.'}
 const preview=prompts.preview(config)
 expect(preview.worker).toContain('Only modify the requested document.')
 expect(preview.worker).toBe(prompts.compose(config,'worker'))
 expect(preview.orchestrator).toContain('execution_mode')
 expect(preview.worker).not.toContain('Never enable auto-merge')
 expect(prompts.skills(config)).toEqual([])
})
