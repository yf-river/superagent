/** Default deployment and machine fixtures for tests. */
import type { Volatile } from '@deepseek-ai/cordis'
import type { Machine } from '../../src/deployment.ts'

/** Mutable Volatile reference for simulating live configuration updates. */
export const reference = <T>(value: T): Volatile<T> & { set(next: T): void } => {
  let current = value
  return { get: () => current as never, set: next => { current = next } }
}
export const testMachine = (overrides: Partial<Machine> = {}): Machine => ({
  stateDir: '/tmp/dsh-superagent-test', promptMaxChars: reference(100000), admissionContextMaxPages: reference(10),
  admissionContextTimeoutMs: reference(15000), ...overrides,
})
interface LegacyDeployment extends Machine { repository: string; github: { cli: string; login: string; noreply: string }; feishu?: { cli:string; botId:string; appId:string; brand:'feishu'|'lark'; name:string } }
export const testDeployment = (overrides: Partial<LegacyDeployment> = {}): LegacyDeployment => ({ ...testMachine(),repository:'acme/widgets',github:{cli:'/bin/false',login:'agent-bot',noreply:'7+agent-bot@users.noreply.github.com'},...overrides })
