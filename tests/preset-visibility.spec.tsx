// @vitest-environment jsdom
/** 使用真实 SlotCore 验证覆盖、原组件复用、订阅更新和插件卸载。 */
import { act, useSyncExternalStore, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, expect, it, vi } from 'vitest'
import { apply } from '../src/client/preset-visibility.ts'

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean }
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const PICKER = 'conversation.hero.agentPreset'
const SETTINGS = 'settings.section'
const ids = ['standard', 'dsh-superagent-router', 'dsh-superagent-worker', 'my-preset', 'dsh-superagent-worker-custom']
type Row = { id: string }
type State = { options: Row[]; rows: Row[]; current: string; busy: boolean }
interface Source { getSnapshot(): State; subscribe(listener: () => void): () => void }
function store() {
  let state: State = { options: ids.map(id => ({ id })), rows: ids.map(id => ({ id })), current: 'standard', busy: false }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    update: (patch: Partial<State>) => { state = { ...state, ...patch }; for (const listener of listeners) listener() },
    listeners,
  }
}
interface Face { hooks: { agentPresetSeat: Source; agentPresetSection: Source }; select(id: string): void }
function Picker({ hooks, select }: Face) {
  const state = useSyncExternalStore(hooks.agentPresetSeat.subscribe, hooks.agentPresetSeat.getSnapshot)
  return <div>{state.options.map(row => <button key={row.id} onClick={() => { select(row.id) }}>{row.id}</button>)}</div>
}
const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })
const settle = async () => { await Promise.resolve(); await Promise.resolve() }

function fixture(before = true, invalid = false) {
  const core = new SlotCore()
  core.register({ name: 'root', children: {
    [PICKER]: { kind: 'single', scope: 'session-maybe' },
    [SETTINGS]: { kind: 'list', scope: 'root' },
    'conversation.session.header.actions': { kind: 'list', scope: 'session-maybe' },
  } } as never, () => null)
  const state = store()
  const select = vi.fn()
  const injections: unknown[][] = []
  const originalInject = (...args: unknown[]) => {
    injections.push(args)
    if (invalid) return {}
    return { hooks: { agentPresetSeat: state, agentPresetSection: state }, select }
  }
  const original = () => core.register({ name: PICKER, locale: 'settings.agentPreset', inject: originalInject } as never, Picker as never)
  let removeOriginal = before ? original() : () => {}
  const removeSettings = core.register({ name: SETTINGS, id: 'agent-presets', order: 20, label: 'Modes', inject: originalInject } as never, Picker as never)
  const header = () => null
  core.register({ name: 'conversation.session.header.actions', id: 'agent-preset' } as never, header)
  core.register({ name: SETTINGS, id: 'models' } as never, header)
  const effects: (() => void)[] = []
  const ctx = { slots: {
    entries: (key: string) => core.entries(key),
    subscribe: (key: string, listener: () => void) => core.subscribe(key, listener),
    inject: (_key: string, setup: () => () => void) => { const cleanup = setup(); effects.push(cleanup); return cleanup },
    register: (options: never, component: never) => core.register(options, component),
  } }
  apply(ctx as never)
  const dispose = () => { for (const effect of effects.splice(0).reverse()) effect() }
  cleanups.push(dispose)
  const entry = (key = PICKER) => core.entriesOfSlot(key).find(row => key === PICKER || row.options.id === 'agent-presets')!
  const face = (key = PICKER): Face => Reflect.apply(entry(key).inject!, undefined, ['session-123'])
  return { core, state, select, injections, entry, face, dispose, removeSettings,
    original, removeOriginal: () => { removeOriginal() }, addOriginal: () => { removeOriginal = original() }, header }
}

it('filters the internal presets from the picker while retaining a single complete settings section', () => {
  const f = fixture()
  const picker = f.face()
  const section = f.face(SETTINGS)
  const visible = ['standard', 'my-preset', 'dsh-superagent-worker-custom']
  expect(picker.hooks.agentPresetSeat.getSnapshot().options.map(row => row.id)).toEqual(visible)
  expect(section.hooks.agentPresetSection.getSnapshot().rows.map(row => row.id)).toEqual(ids)
  expect(f.core.entries(SETTINGS).filter(row => row.options.id === 'agent-presets')).toHaveLength(1)
  expect(f.state.getSnapshot().options.map(row => row.id)).toEqual(ids)
  expect(f.entry().component).toBe(Picker)
  expect(f.entry(SETTINGS).options).toMatchObject({ id: 'agent-presets', order: 20, label: 'Modes' })
  expect(f.entry().locale).toBe('settings.agentPreset')
  expect(picker.select).toBe(f.select)
  expect(f.injections).toEqual([['session-123'], ['session-123']])
  expect(f.core.entriesOfSlot('conversation.session.header.actions')[0]?.component).toBe(f.header)
  expect(f.core.entriesOfSlot(SETTINGS).some(entry => entry.options.id === 'models')).toBe(true)
})

it('preserves stable snapshots, selected session identity and the latest changes', () => {
  const f = fixture()
  const source = f.face().hooks.agentPresetSeat
  expect(f.face().hooks.agentPresetSeat).toBe(source)
  expect(source.getSnapshot()).toBe(source.getSnapshot())
  f.state.update({ current: 'dsh-superagent-worker', busy: true })
  expect(source.getSnapshot()).toMatchObject({ current: 'dsh-superagent-worker', busy: true })
  f.state.update({ options: [{ id: 'new-mode' }] })
  expect(source.getSnapshot()).toBe(f.state.getSnapshot())
})

it('reuses the component interactions and updates through its existing subscription', async () => {
  const f = fixture()
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => { act(() => { root.unmount() }); container.remove() })
  const Component = f.entry().component as ComponentType<Face>
  await act(async () => { root.render(<Component {...f.face()} />) })
  expect([...container.querySelectorAll('button')].map(button => button.textContent)).toEqual(['standard', 'my-preset', 'dsh-superagent-worker-custom'])
  await act(async () => { container.querySelector('button')!.click() })
  expect(f.select).toHaveBeenCalledExactlyOnceWith('standard')
  await act(async () => { f.state.update({ options: [{ id: 'dsh-superagent-router' }, { id: 'new-mode' }] }) })
  expect(container.textContent).toBe('new-mode')
  await act(async () => { f.state.update({ options: [{ id: 'dsh-superagent-worker' }] }) })
  expect(container.querySelectorAll('button')).toHaveLength(0)
})

it('handles late registrations, replaces changed entries and restores the original on unload', async () => {
  const f = fixture(false)
  expect(f.core.entriesOfSlot(PICKER)).toEqual([])
  f.addOriginal()
  await settle()
  expect(f.entry().options.priority).toBe(-1)
  f.removeOriginal()
  await settle()
  expect(f.core.entriesOfSlot(PICKER)).toEqual([])
  f.addOriginal()
  await settle()
  expect(f.entry().options.priority).toBe(-1)
  f.dispose()
  await settle()
  expect(f.core.entries(PICKER)).toHaveLength(1)
  expect(f.core.entries(SETTINGS)).toHaveLength(2)
  expect(f.face().hooks.agentPresetSeat.getSnapshot().options.map(row => row.id)).toEqual(ids)
  f.removeOriginal()
  f.addOriginal()
  await settle()
  expect(f.core.entries(PICKER)).toHaveLength(1)
})

it('reports an incompatible injection instead of modifying the preset registry', () => {
  const f = fixture(true, true)
  expect(() => f.face()).toThrow('requires DSH\'s agentPresetSeat hook')
})
