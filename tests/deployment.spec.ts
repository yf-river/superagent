import { expect, it } from 'vitest'
import { Config, machineOf } from '../src/deployment.ts'
it('accepts local DSH deployment configuration and retains validated live tunables',()=>{
 const config=Config({stateDir:'/tmp/superagent-config'}),machine=machineOf(config)
 expect(machine.stateDir).toBe('/tmp/superagent-config');expect(machine.promptMaxChars.get()).toBeGreaterThan(0)
 expect(()=>machineOf({...config,repository:'acme/widgets'} as never)).toThrow('keys it does not use')
})
