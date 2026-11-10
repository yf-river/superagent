import { expect, it } from 'vitest'
import { SourceRegistry } from '../src/sources/registry.ts'
import { localKind } from '../src/sources/local.ts'
import { SettingsSchema } from '../src/policy.ts'
it('registers the local owner entry and removes it with its lifecycle',()=>{
 const registry=new SourceRegistry(()=>SettingsSchema.parse({})),dispose=registry.register(localKind())
 expect(registry.scope({source:'local',meta:{}})).toEqual({listened:true,observed:false});expect(registry.kind('local')?.kind).toBe('local')
 expect(registry.kind('feishu')).toBeUndefined();expect(registry.kind('github')).toBeUndefined();dispose();expect(registry.kind('local')).toBeUndefined()
})
