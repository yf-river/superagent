/** DSH 客户端工厂只向宿主读取 React；其余界面依赖必须随插件打包。 */
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const code = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
const allowed = new Set(['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client'])
const unexpected = [...new Set([...code.matchAll(/\brequire\(["']([^"']+)["']\)/g)].map(match => match[1]))].filter(name => !allowed.has(name))
assert.deepEqual(unexpected, [], 'Client dependencies must be bundled; Node dependencies cannot run in DSH Web')
