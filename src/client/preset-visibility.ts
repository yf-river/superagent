/** 在日常模式入口隐藏 Superagent 内部预设，复用 DSH 已注册的组件和交互。 */
import type { Context } from '@deepseek-ai/cordis'
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'

export const name = 'superagent-preset-visibility'
export const inject = ['slots']

const INTERNAL_PRESETS = new Set(['dsh-superagent-router', 'dsh-superagent-worker'])
type Snapshot = Record<string, unknown>
interface Source {
  getSnapshot(): Snapshot
  subscribe(listener: () => void): () => void
}
type Injection = (...args: unknown[]) => Record<string, unknown>
interface Target {
  slot: string
  id?: string
  hook: string
  field: string
}
interface Registration {
  name: string
  id?: string
  key?: string
  order?: number
  label?: StoredEntry['options']['label']
  priority: number
  locale?: string
  inject: Injection
}
/** 已声明插槽的动态注册接口；组件及其注入参数由原注册项提供。 */
interface Slots {
  entries(key: string): readonly StoredEntry[]
  subscribe(key: string, listener: () => void): () => void
  inject(key: string, setup: () => () => void): () => void
  register(options: Registration, component: unknown): () => void
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function snapshotSource(value: unknown): value is Source {
  return object(value) && typeof value.getSnapshot === 'function' && typeof value.subscribe === 'function'
}

function presetRow(value: unknown): value is { id: string } {
  return object(value) && typeof value.id === 'string'
}

/** 只投影列表，保留稳定的快照引用和原来的订阅生命周期。 */
function visibleSource(value: unknown, field: string): Source {
  if (!snapshotSource(value)) {
    throw new Error('Superagent preset visibility requires a DSH preset snapshot source')
  }
  const source = value
  let previous: Snapshot | undefined
  let filtered: Snapshot
  return {
    subscribe: listener => source.subscribe(listener),
    getSnapshot() {
      const current = source.getSnapshot()
      if (current === previous) return filtered
      const rows = current[field]
      if (!Array.isArray(rows) || !rows.every(presetRow)) {
        throw new Error(`Superagent preset visibility requires the DSH preset ${field} list`)
      }
      const visible = rows.filter(row => !INTERNAL_PRESETS.has(row.id))
      previous = current
      filtered = visible.length === rows.length ? current : { ...current, [field]: visible }
      return filtered
    },
  }
}

/**
 * 仅过滤新会话选择器；设置保留完整预设目录，供查看系统内部配置。
 * @param ctx - 提供 DSH UI 插槽的客户端上下文。
 */
export function apply(ctx: Context): void {
  const slots = ctx.slots as Slots
  const ownInjections = new WeakSet<Injection>()
  const sources = new WeakMap<object, Map<string, Source>>()
  const targets: Target[] = [
    { slot: 'conversation.hero.agentPreset', hook: 'agentPresetSeat', field: 'options' },
  ]
  for (const target of targets) {
    slots.inject(target.slot, () => {
      let active = true
      let original: StoredEntry | undefined
      let remove: (() => void) | undefined
      const refresh = () => {
        if (!active) return
        const candidate = slots.entries(target.slot).find(entry => entry.options.id === target.id
          && (!entry.inject || !ownInjections.has(entry.inject as Injection)))
        if (candidate === original) return
        remove?.()
        remove = undefined
        original = candidate
        if (!candidate) return
        if (!candidate.inject || candidate.store || Object.keys(candidate.children ?? {}).length) {
          throw new Error(`Superagent preset visibility cannot reuse the DSH ${target.slot} registration`)
        }
        const originalInject = candidate.inject as Injection
        const inject: Injection = (...args) => {
          const props = originalInject(...args)
          const hooks = props.hooks
          const source = object(hooks) ? hooks[target.hook] : undefined
          if (!object(hooks) || !object(source)) {
            throw new Error(`Superagent preset visibility requires DSH's ${target.hook} hook`)
          }
          let byField = sources.get(source)
          if (!byField) { byField = new Map(); sources.set(source, byField) }
          let filtered = byField.get(target.field)
          if (!filtered) { filtered = visibleSource(source, target.field); byField.set(target.field, filtered) }
          return { ...props, hooks: { ...hooks, [target.hook]: filtered } }
        }
        ownInjections.add(inject)
        remove = slots.register({
          ...candidate.options,
          name: target.slot,
          priority: (candidate.options.priority ?? 0) - 1,
          locale: candidate.locale,
          inject,
        }, candidate.component)
      }
      const unsubscribe = slots.subscribe(target.slot, refresh)
      try { refresh() } catch (error) { unsubscribe(); remove?.(); throw error }
      return () => { active = false; unsubscribe(); remove?.() }
    })
  }
}
