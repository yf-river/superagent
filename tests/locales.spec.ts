import { expect, it } from 'vitest'
import type { EffectKind } from '../src/app/effects.ts'
import { en, zh, type DshSuperagentKey } from '../src/client/locales.ts'
import { reasonLabel, type T } from '../src/client/text.ts'
import { REASONS, USER_ERRORS } from '../src/core/index.ts'
import { localKind } from '../src/sources/local.ts'

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort()

it('names the same placeholders in both languages', () => {
  const keys = Object.keys(zh) as DshSuperagentKey[]
  expect(keys.filter(key => placeholders(zh[key]).join() !== placeholders(en[key]).join())).toEqual([])
  expect(keys.filter(key => !zh[key] || !en[key])).toEqual([])
})

it('names the surface by what it holds, not by the plugin name, everywhere a person reads its heading', () => {
  // The sidebar entry, the board header and the settings-and-diagnostics header each name the surface.
  expect([zh.panel, en.panel, zh['task.heading'], en['task.heading'], zh.title, en.title])
    .not.toContain('superagent')
  expect([zh.panel, zh['task.heading'], zh.title]).toEqual(['任务', '任务', '任务'])
})

it('names every Source a row can carry, since a missing entry renders the raw id', () => {
  // Views read a Source's name through `source.<id>`; an absent entry falls back to the bare id.
  expect([localKind().kind].filter(kind => !(`source.${kind}` in zh) || !(`source.${kind}` in en))).toEqual([])
})

it('words a reason by its code with its values, each of a batch, and words a person or an assessor wrote as written', () => {
  const t = ((key: DshSuperagentKey, values: Record<string, string> = {}) => (zh[key] ?? key).replace(/\{(\w+)\}/g, (_match, name: string) => values[name] ?? '')) as T
  expect(reasonLabel(t, 'retried')).toBe(zh['reason.retried'])
  expect(reasonLabel(t, [{ code: 'routed', values: { ticket: 't1' } }])).toBe('已转给工单 t1')
  expect(reasonLabel(t, [{ code: 'not_a_member', triggerId: '1' }, { code: 'no_mention', triggerId: '2' }]))
    .toBe(`${zh['reason.not_a_member']}；${zh['reason.no_mention']}`)
  expect(reasonLabel(t, [{ code: 'said', values: { text: 'The button is already blue' } }])).toBe('The button is already blue')
  // A code the panel has no words for reads as the host words it.
  expect(reasonLabel(t, { code: 'some_new_filter' })).toBe('some_new_filter')
  expect(reasonLabel(t, 'The button is already blue')).toBe('The button is already blue')
})

it('names every health entry of dsh-superagent itself, which the overview shows when it fails', () => {
  // Each entry by its writer: dsh-superagent, the model budget retries, every kind of the effect queue, Channel messages, the
  // Executor and the unavailable Evals of the last hour.
  const entries = { runtime: 0, models: 0, worker: 0, assessment: 0, launch: 0, delivery: 0, relay: 0,
    notice: 0, evals: 0 } satisfies Record<EffectKind | 'runtime' | 'models' | 'worker' | 'evals', 0>
  expect(Object.keys(entries).filter(name => !(`health.${name}` in zh))).toEqual([])
})

it('words every refusal the host words by code, in both languages', () => {
  expect(Object.keys(USER_ERRORS).filter(code => !zh[`userError.${code}` as DshSuperagentKey]
    || !en[`userError.${code}` as DshSuperagentKey])).toEqual([])
})

it('has words for every reason code the core records', () => {
  expect(Object.keys(REASONS).filter(code => code !== 'said' && !(`reason.${code}` in zh))).toEqual([])
})

it('words the reasons agents read in the glossary\'s words: a sender on the list, a Thread', () => {
  expect(Object.values(REASONS).filter(text => /\b(member|members|topic)\b/i.test(text))).toEqual([])
})

it('keeps no copy for a surface the bundle no longer renders', async () => {
  // A key nothing reads is copy for a removed surface. Dynamic keys are reached through a template literal with a literal
  // prefix (`t(`task.stage.${stage}`)`) or through `valueLabel(t, group, key)`; both count as reads here.
  const { readFileSync, readdirSync } = await import('node:fs')
  const { join } = await import('node:path')
  const files: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (/\.(ts|tsx)$/.test(entry.name) && !path.endsWith('src/client/locales.ts')) files.push(path)
    }
  }
  walk('src'); walk('tests')
  const code = files.map(file => readFileSync(file, 'utf8')).join('\n')
  const prefixes = [...new Set([
    ...[...code.matchAll(/`([A-Za-z][\w./-]*\.)\$\{/g)].map(match => match[1]!),
    ...[...code.matchAll(/valueLabel\(t,\s*'([\w-]+)'/g)].map(match => `${match[1]}.`),
  ])]
  const unread = Object.keys(zh).filter(key => !code.includes(key) && !prefixes.some(prefix => key.startsWith(prefix)))
  expect(unread).toEqual([])
})
