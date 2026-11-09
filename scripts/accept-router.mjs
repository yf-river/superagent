/** 用真实 DSH 模型和本地文件验收 Router；只创建本次专属目录与任务。 */
import assert from 'node:assert/strict'
import { parseArgs } from 'node:util'
import { randomUUID, createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const { values } = parseArgs({ options: {
  url: { type: 'string', default: 'http://127.0.0.1:8081' }, home: { type: 'string' }, cookies: { type: 'string' },
  output: { type: 'string' }, repetitions: { type: 'string', default: '3' }, scenario: { type: 'string' }, resume: { type: 'boolean', default: false },
} })
assert(values.home && values.cookies && values.output, 'Required: --home <DSH_HOME> --cookies <private cookie JSON> --output <artifact directory>')
const origin = new URL(values.url)
assert(['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname), 'Acceptance runs only against a local test instance')
const repetitions = Number(values.repetitions)
assert(Number.isSafeInteger(repetitions) && repetitions > 0 && repetitions <= 3, 'Repetitions must be 1–3')
const cookies = JSON.parse(await readFile(values.cookies, 'utf8'))
const cookie = Object.entries(cookies).map(([key, value]) => { assert.equal(typeof value, 'string'); return `${key}=${value}` }).join('; ')
const output = resolve(values.output); await mkdir(output, { recursive: true })
const fixtureRoot = join(resolve(values.home), 'router-evaluations'); await mkdir(fixtureRoot, { recursive: true })
const root = values.resume ? JSON.parse(await readFile(join(output, 'run.json'), 'utf8')).fixtureRoot : await mkdtemp(join(fixtureRoot, 'run-'))
assert(root.startsWith(fixtureRoot + '/'), 'The resumed run must belong to this test home')
const git = (directory, ...args) => execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8' }).trim()
const hash = text => createHash('sha256').update(text).digest('hex')
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
async function gateway(endpoint, args) {
  const response = await fetch(new URL(`/api/${endpoint}`, origin), { method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method: endpoint, payload: { args } }), signal: AbortSignal.timeout(60000) })
  assert.equal(response.status, 200, `HTTP ${response.status} for ${endpoint}`)
  const { result } = await response.json(); assert(result.ok, JSON.stringify(result.error)); return result.value
}
async function api(method, path, body) {
  const result = await gateway('superagentTasks/request', { input: { method, path, ...body === undefined ? {} : { body } } })
  assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body
}
async function events(sessionId) {
  const page = await gateway('session/events', { request: { address: { kind: 'session', sessionId }, maxMessages: 10000 } })
  assert(!page.hasMore, 'The evidence reader requires a complete session page')
  return page.records.filter(record => record.type === 'event').map(record => record.event)
}
const common = '完成后回读核对，通过 orchestrator_report 报告 ready。仅处理指定文件，不提交、推送、合并或部署。'
const cases = [
  { name: 'non-git-auto', git: false, requested: 'auto', expected: 'shared', write: true,
    prompts: ['把 input.txt 的内容替换为', '这是一个普通文件目录，请将 input.txt 写成', 'Update input.txt in this non-Git folder to contain exactly'] },
  { name: 'git-read-only', git: true, requested: 'auto', expected: 'shared', write: false,
    prompts: ['只读取 input.txt 并报告原样内容，不修改任何文件。', '核对当前 Git 项目 input.txt 中的文字，仅做只读检查。', 'Read input.txt and report its exact content. Do not create or change any files.'] },
  { name: 'git-code-auto', git: true, requested: 'auto', expected: 'worktree', write: true,
    prompts: ['修改这个 Git 项目的 input.txt，使其内容为', '请在该 Git 代码项目实现一次文件内容调整：input.txt 改为', 'Make a code change in this Git repository: replace input.txt with'] },
  { name: 'git-explicit-shared', git: true, requested: 'shared', expected: 'shared', write: true,
    prompts: ['已明确选择原目录执行，将 input.txt 改为', '使用我指定的共享工作目录，把 input.txt 内容更新为', 'Use the explicitly selected shared directory and set input.txt to'] },
  { name: 'concurrent-distinct', git: true, requested: 'auto', expected: 'worktree', write: true,
    prompts: ['修改 alpha.txt 为', '修改 beta.txt 为', '修改 gamma.txt 为'] },
]
const results = []
const settings = await api('GET', 'settings')
if (!values.resume) await writeFile(join(output, 'run.json'), JSON.stringify({ startedAt: new Date().toISOString(), fixtureRoot: root, origin: origin.origin, repetitions,
  models: { router: settings.blocks.eval.value.model, worker: settings.blocks.executor.value.model } }, null, 2))
else {
  try { await writeFile(join(output, 'previous-validator-results.json'), await readFile(join(output, 'results.json')), { flag: 'wx' }) }
  catch (error) { if (error.code !== 'EEXIST') throw error }
}
for (const scenario of cases.filter(item => !values.scenario || item.name === values.scenario)) {
  const jobs = []
  let commonDirectory
  if (scenario.name === 'concurrent-distinct' && !values.resume) {
    commonDirectory = join(root, scenario.name); await mkdir(commonDirectory)
    for (const name of ['alpha.txt', 'beta.txt', 'gamma.txt']) await writeFile(join(commonDirectory, name), 'baseline\n')
    git(commonDirectory, 'init', '-q'); git(commonDirectory, 'add', '.')
    git(commonDirectory, '-c', 'user.name=Router acceptance', '-c', 'user.email=router-acceptance@example.invalid', 'commit', '-qm', 'Acceptance fixture')
  }
  for (let index = 0; index < repetitions; index++) {
    const directory = commonDirectory ?? join(root, scenario.name === 'concurrent-distinct' ? scenario.name : `${scenario.name}-${index + 1}`), target = scenario.name === 'concurrent-distinct' ? ['alpha.txt', 'beta.txt', 'gamma.txt'][index] : 'input.txt'
    if (values.resume) {
      const page = await api('GET', 'tasks?' + new URLSearchParams({ q: `[Router验收] ${scenario.name} ${index + 1}`, directory }))
      assert.equal(page.items.length, 1, 'Resume requires exactly one existing task per scenario and repetition')
      const task = page.items[0]
      jobs.push({ id: task.id, revision: task.revision, directory, target, marker: `${scenario.name}-${index + 1}-verified\n`, index: index + 1,
        baseline: scenario.git ? git(directory, 'rev-parse', 'HEAD') : null })
      continue
    }
    if (!commonDirectory) {
      await mkdir(directory); await writeFile(join(directory, target), 'baseline\n')
      if (scenario.git) { git(directory, 'init', '-q'); git(directory, 'add', '.'); git(directory, '-c', 'user.name=Router acceptance', '-c', 'user.email=router-acceptance@example.invalid', 'commit', '-qm', 'Acceptance fixture') }
    }
    await writeFile(join(directory, 'owner-draft.txt'), 'uncommitted owner data\n')
    const marker = `${scenario.name}-${index + 1}-verified\n`
    const description = `${scenario.prompts[index]}${scenario.write ? ` ${JSON.stringify(marker)}。` : ''}\n${common}`
    const draft = await api('POST', 'tasks', { requestId: randomUUID(), title: `[Router验收] ${scenario.name} ${index + 1}`, description,
      directory, strategy: scenario.requested, priority: ['important_urgent', 'important_not_urgent', 'not_important_urgent'][index], assets: [] })
    assert.equal(draft.stage, 'draft'); assert.equal(draft.routes.length, 0)
    jobs.push({ id: draft.id, revision: draft.revision, directory, target, marker, index: index + 1, baseline: scenario.git ? git(directory, 'rev-parse', 'HEAD') : null })
  }
  // 同时开始是真实的并发入口；不调用后端决定函数替代 Router。
  if (!values.resume) await Promise.all(jobs.map(job => api('POST', `tasks/${job.id}/start`, { requestId: randomUUID(), revision: job.revision })))
  await Promise.all(jobs.map(async job => {
    const row = { scenario: scenario.name, repetition: job.index, taskId: job.id, requested: scenario.requested, expected: scenario.expected, status: 'FAILED' }
    try {
      let task; const deadline = Date.now() + 300000
      while (Date.now() < deadline) {
        task = await api('GET', `tasks/${job.id}`)
        if (task.stage === 'review' || task.stage === 'done') break
        if (task.stage === 'waiting') throw new Error(`Task needs attention: ${task.question || task.summary}`)
        await delay(2000)
      }
      assert(['review', 'done'].includes(task.stage), 'Timed out waiting for a ready report')
      assert.equal(task.routes.length, 1, 'One task must have exactly one execution ticket')
      const route = task.routes[0]; assert.equal(route.selectedStrategy, scenario.expected); assert(route.reason.trim())
      const routerEvents = await events(task.routerSessionId)
      const calls = routerEvents.filter(event => event.type === 'tool/call' && event.data.name === 'orchestrator_route')
        .flatMap(event => { const args = JSON.parse(event.data.arguments); return args.decisions.filter(item => item.trigger_id === route.triggerId).map(item => ({ callId: event.data.callId, ...item })) })
      const attempts = calls.map(call => {
        const result = routerEvents.find(event => event.type === 'tool/result' && event.data.message?.toolCallId === call.callId)
        const text = result?.data.message.content.filter(part => part.type === 'text').map(part => part.text).join('')
        const outcome = text ? JSON.parse(text).results?.find(item => item.trigger_id === route.triggerId) : undefined
        return { ...call, outcome }
      })
      const accepted = attempts.filter(call => call.outcome?.decision === 'accept')
      assert(accepted.length > 0, 'A correlated successful Router tool result is required')
      for (const call of accepted) {
        assert.equal(call.kind, 'accept'); assert.equal(call.execution_mode, scenario.expected)
        assert.equal(call.outcome.ticket.ticket_id, route.ticketId, 'Every accepted result must refer to the same execution ticket')
      }
      assert.equal(route.ticketId, task.activeTicket); assert.equal(task.execution.directory, route.directory)
      const execution = task.execution.directory, actual = await readFile(join(execution, job.target), 'utf8'), expected = scenario.write ? job.marker : 'baseline\n'
      assert.equal(actual, expected)
      if (scenario.expected === 'worktree') {
        assert.notEqual(execution, job.directory); assert.equal(await readFile(join(job.directory, job.target), 'utf8'), 'baseline\n')
        assert.equal(task.execution.baseCommit, job.baseline); assert.equal(git(execution, 'branch', '--show-current'), task.execution.branch)
        await assert.rejects(readFile(join(execution, 'owner-draft.txt')))
      } else assert.equal(execution, job.directory)
      if (scenario.git) assert.equal(git(execution, 'diff', '--name-only'), scenario.write ? job.target : '')
      assert.equal(await readFile(join(job.directory, 'owner-draft.txt'), 'utf8'), 'uncommitted owner data\n')
      const workerEvents = await events(task.sessionId)
      assert(workerEvents.some(event => event.type === 'tool/call' && event.data.name === 'orchestrator_report'), 'Worker must report through the real tool')
      await writeFile(join(output, `${scenario.name}-${job.index}.json`), JSON.stringify({ task, routerAttempts: attempts,
        routerModelSelections: routerEvents.filter(event => event.type === 'model/selection').map(event => event.data),
        workerModelSelections: workerEvents.filter(event => event.type === 'model/selection').map(event => event.data),
        workerCalls: workerEvents.filter(event => event.type === 'tool/call').map(event => event.data), resultSha256: hash(actual) }, null, 2))
      if (task.stage === 'review') { const done = await api('POST', `tasks/${job.id}/confirm`, { requestId: randomUUID(), revision: task.revision }); assert.equal(done.stage, 'done') }
      Object.assign(row, { status: 'PASS', ticketId: route.ticketId, sessionId: task.sessionId, execution, routerCallId: accepted[0].callId,
        attempts: attempts.length, firstAttemptAccepted: attempts[0]?.outcome?.decision === 'accept', firstChoiceCorrect: attempts[0]?.execution_mode === scenario.expected })
    } catch (error) { row.error = error.message }
    results.push(row); await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify(row))
  }))
  if (scenario.name === 'concurrent-distinct') {
    const rows = results.filter(row => row.scenario === scenario.name && row.status === 'PASS')
    assert.equal(new Set(rows.map(row => row.ticketId)).size, rows.length)
    assert.equal(new Set(rows.map(row => row.execution)).size, rows.length)
    assert.equal(git(commonDirectory ?? join(root, scenario.name), 'diff', '--name-only'), '')
  }
}
const failed = results.filter(row => row.status !== 'PASS')
const report = `# Router 真实模型验收\n\n完成时间：${new Date().toISOString()}。任务、决策和 Worker 均来自真实 DSH；未替代 Router 决策。\n\n${results.filter(row => row.status === 'PASS').length}/${results.length} 执行与文件核验通过。首次目录选择正确 ${results.filter(row => row.firstChoiceCorrect).length}/${results.length}，首次工具接单成功 ${results.filter(row => row.firstAttemptAccepted).length}/${results.length}。测试目录：\`${root}\`。\n\n| 场景 | 轮次 | 结果 | 预期 | 尝试次数 | 首次接单 | 证据 |\n| --- | --- | --- | --- | --- | --- | --- |\n${results.map(row => `| ${row.scenario} | ${row.repetition} | ${row.status} | ${row.expected} | ${row.attempts ?? '—'} | ${row.firstAttemptAccepted ? '通过' : '未通过'} | ${row.status === 'PASS' ? `[决策与执行](${row.scenario}-${row.repetition}.json)` : row.error.replaceAll('|', '/') } |`).join('\n')}\n\n工单名称不符合规则的调用会被工具拒绝，Router 可以读取回执并纠正；每个证据文件保留所有尝试、拒绝或成功回执及关联工单。通过标准要求成功回执关联唯一执行工单，不要求模型永不重试。初版验证器将尝试次数误当工单数的结果单独保留在 previous-validator-results.json，复核不重新运行模型。\n\n结论仅适用于本次模型、提示词、任务和运行环境；不代表其他模型或任意任务的判断质量。文件检查同时核对原目录、worktree、未提交文件保留、任务/工单一对一关联和真实 Router 工具调用。调度引擎的幂等、取消和重试另由行为测试覆盖。\n`
await writeFile(join(output, 'report.md'), report)
console.log(`Router acceptance: ${results.length - failed.length}/${results.length} passed`)
process.exitCode = failed.length ? 1 : 0
