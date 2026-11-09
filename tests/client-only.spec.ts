import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { apply } from '../src/index.ts'
import { Config } from '../src/deployment.ts'

it('loads the client-only entry without host agent services or creating a local database',async()=>{
  const root=mkdtempSync(join(tmpdir(),'superagent-client-only-')),ctx=new Context()
  try {
    await apply(ctx,Config({clientOnly:true,stateDir:join(root,'state')}))
    expect(existsSync(join(root,'state'))).toBe(false)
    expect(ctx.get('orchestrator')).toBeUndefined()
  } finally {rmSync(root,{recursive:true,force:true})}
})
