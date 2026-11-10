/** 使用真实插槽注册表验证界面覆盖的优先级与卸载恢复。 */
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { expect, it } from 'vitest'
import { apply } from '../src/client/chrome.tsx'

it('shadows decoration and only the sidebar default More menu, then restores every original registration', () => {
  const core = new SlotCore()
  const brands = ['sidebar.brand.mark', 'sidebar.brand.name', 'conversation.hero.brand.mark']
  core.register({ name: 'root', children: Object.fromEntries([
    ...brands.map(key => [key, { kind: 'single', scope: 'root' }]),
    ['sidebar.panellist.actions', { kind: 'list', scope: 'root' }],
  ]) } as never, () => null)
  const original = () => null
  for (const slot of brands) core.register({ name: slot } as never, original)
  const injected = () => ({ browsePlugins: () => {}, createPlugin: () => {} })
  core.register({ name: 'sidebar.panellist.actions', id: 'entry-customization', inject: injected } as never, original)
  core.register({ name: 'sidebar.panellist.actions', id: 'custom-menu' } as never, original)
  const effects: (() => void)[] = []
  apply({ slots: {
    inject: (_key: string, setup: () => () => void) => { const cleanup = setup(); effects.push(cleanup); return cleanup },
    register: (options: never, component: never) => core.register(options, component),
    entries: (key: string) => core.entries(key),
    subscribe: (key: string, listener: () => void) => core.subscribe(key, listener),
  } } as never)
  for (const slot of brands) expect(core.entriesOfSlot(slot)[0]?.component).not.toBe(original)
  const menus = core.entriesOfSlot('sidebar.panellist.actions')
  expect(menus.find(row => row.options.id === 'entry-customization')?.component).not.toBe(original)
  expect(menus.find(row => row.options.id === 'entry-customization')?.inject).toBe(injected)
  expect(menus.find(row => row.options.id === 'custom-menu')?.component).toBe(original)
  for (const dispose of effects.reverse()) dispose()
  for (const slot of brands) expect(core.entriesOfSlot(slot).map(row => row.component)).toEqual([original])
  expect(core.entriesOfSlot('sidebar.panellist.actions').map(row => row.component)).toEqual([original, original])
})
