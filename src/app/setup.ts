/** DSH 本地实例的运行环境就绪状态。 */
import type { Context } from '@deepseek-ai/cordis'
import type { Deployment, Machine } from '../deployment.ts'
import type { Settings, SettingsBlock } from '../policy.ts'
import type { SetupProblem } from '../setup.ts'
export interface SetupHost { readonly context: Context; readonly machine: Machine; readonly lifetime: AbortSignal; restart(): void }
/** 记录当前 DSH 配置的就绪状态，并提供显式重启入口。 */
export class Setup {
  private resolved?: Deployment
  problem?: SetupProblem
  constructor(private readonly host: SetupHost) {}
  get commandEnvironment(): Record<string, string | undefined> { return {} }
  get deployment(): Deployment { if (!this.resolved) throw new Error('DSH task runtime has not started'); return this.resolved }
  configured(): boolean { return this.resolved !== undefined }
  async run(_settings: Settings): Promise<boolean> { this.host.lifetime.throwIfAborted(); this.resolved = { ...this.host.machine }; return true }
  check(): void { this.restart() }
  restart(): void { setTimeout(this.host.restart, 0) }
}
