/** Superagent 的界面精简，通过 DSH 插槽注册并随 bundle 卸载恢复。 */
import { createElement, type ComponentType } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'

export const name = 'superagent-chrome'
export const inject = ['slots']

/** 动态复用上游注册项，保留其私有注入参数和 locale。 */
interface Slots {
  inject(key: string, setup: () => () => void): () => void
  entries(key: string): readonly StoredEntry[]
  subscribe(key: string, listener: () => void): () => void
  register(options: StoredEntry['options'] & { name: string; locale?: string; inject?: StoredEntry['inject'] }, component: unknown): () => void
}

/** 插槽没有提供整行显隐开关；以自有标记定位装饰容器，不依赖构建生成的类名。 */
function SidebarBrand() {
  return <span data-superagent-sidebar-brand=""><style>{`
    [data-window-drag] > :is(button, span):not([data-sidebar-toggle]):has([data-superagent-sidebar-brand]) { display: none; }
    [data-sidebar-toggle][type="button"]:has([data-superagent-sidebar-brand]) > svg { display: inline; }
    [data-slot="sidebar"] > div:has(> [data-window-drag] > :not([data-sidebar-toggle]) [data-superagent-sidebar-brand]) { display: grid; grid-template-columns: minmax(0, 1fr) 36px; grid-template-rows: 38px auto minmax(0, 1fr) auto; column-gap: 4px; row-gap: 8px; }
    [data-slot="sidebar"] > div:has(> [data-window-drag] > :not([data-sidebar-toggle]) [data-superagent-sidebar-brand]) > [data-window-drag] { display: contents; }
    [data-slot="sidebar"] > div:has(> [data-window-drag] > :not([data-sidebar-toggle]) [data-superagent-sidebar-brand]) > [data-window-drag] [data-sidebar-toggle] { grid-area: 1 / 2; align-self: center; }
    [data-slot="sidebar"] > div:has(> [data-window-drag] > :not([data-sidebar-toggle]) [data-superagent-sidebar-brand]) > button { grid-area: 1 / 1; margin: 0; width: 100%; }
    [data-slot="sidebar"] > div:has(> [data-window-drag] > :not([data-sidebar-toggle]) [data-superagent-sidebar-brand]) > nav { grid-area: 2 / 1 / 3 / 3; height: auto; }
    [data-slot="sidebar"] > div:has(> [data-window-drag] > :not([data-sidebar-toggle]) [data-superagent-sidebar-brand]) > div:has([data-slot="sidebar.workspaces"]) { grid-area: 3 / 1 / 4 / 3; min-height: 0; }
    [data-slot="sidebar"] > div:has(> [data-window-drag] > :not([data-sidebar-toggle]) [data-superagent-sidebar-brand]) > div:last-child { grid-area: 4 / 1 / 5 / 3; }
  `}</style></span>
}
function HeroBrand() {
  return <span data-superagent-hero-brand=""><style>{`
    div:has(> span > [data-slot="conversation.hero.brand.mark"] [data-superagent-hero-brand]) { display: none; }
  `}</style></span>
}
const Empty = () => null

/** 安装装饰覆盖和左侧更多菜单过滤，保留原菜单的导航、图标及固定操作。
 * @param ctx - 客户端插槽上下文。
 */
export function apply(ctx: Context): void {
  const slots = ctx.slots as Slots
  for (const [slot, component] of [
    ['sidebar.brand.mark', SidebarBrand], ['sidebar.brand.name', Empty],
    ['conversation.hero.brand.mark', HeroBrand],
  ] as const) {
    slots.inject(slot, () => slots.register({ name: slot, priority: -100 }, component))
  }
  slots.inject('sidebar.panellist.actions', () => {
    let original: StoredEntry | undefined
    let remove: (() => void) | undefined
    const own = new Set<unknown>()
    let active = true
    const refresh = () => {
      if (!active) return
      const candidate = slots.entries('sidebar.panellist.actions').find(entry =>
        entry.options.id === 'entry-customization' && !own.has(entry.component))
      if (candidate === original) return
      remove?.(); remove = undefined; original = candidate
      if (!candidate) return
      const Original = candidate.component as ComponentType<Record<string, unknown>>
      const Menu = (props: Record<string, unknown>) => <div data-superagent-menu="">
        <style>{`[data-superagent-menu] > :last-child { display: none; }`}</style>
        {createElement(Original, { ...props, usePluginNavigation: () => false })}
      </div>
      own.add(Menu)
      remove = slots.register({ ...candidate.options, name: 'sidebar.panellist.actions',
        priority: (candidate.options.priority ?? 0) - 1, locale: candidate.locale,
        inject: candidate.inject,
      }, Menu)
    }
    const unsubscribe = slots.subscribe('sidebar.panellist.actions', refresh)
    try { refresh() } catch (error) { unsubscribe(); remove?.(); throw error }
    return () => { active = false; unsubscribe(); remove?.() }
  })
}
