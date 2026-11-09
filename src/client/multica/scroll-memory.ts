/** 按视图与任务保存滚动偏移；内容异步到达后恢复，用户滚动后以用户位置为准。 */
import { useCallback, useLayoutEffect, useRef } from 'react'
type Offset = { top: number; left: number }
const offsets = new Map<string, Offset>()
function read(key: string): Offset {
  const known = offsets.get(key)
  if (known) return known
  try { const value = JSON.parse(sessionStorage.getItem(`superagent/scroll/${key}`) ?? 'null') as Offset | null; if (value && Number.isFinite(value.top) && Number.isFinite(value.left)) return value } catch (error) { void error /* 浏览器可禁用本地存储。 */ }
  return { top: 0, left: 0 }
}
function write(key: string, value: Offset) {
  if (offsets.size >= 100 && !offsets.has(key)) offsets.delete(offsets.keys().next().value!)
  offsets.set(key, value)
  try { sessionStorage.setItem(`superagent/scroll/${key}`, JSON.stringify(value)) } catch (error) { void error /* 内存中的偏移仍可用于当前页面。 */ }
}
export function useScrollMemory<T extends HTMLElement>(key: string, ready = true) {
  const ref = useRef<T | null>(null), desired = useRef(read(key)), restored = useRef(false), cancel = useRef<() => void>()
  useLayoutEffect(() => { desired.current = read(key); restored.current = false }, [key])
  const setRef = useCallback((element: T | null) => { cancel.current?.(); ref.current = element }, [])
  useLayoutEffect(() => {
    const element = ref.current
    if (!element || !ready) return
    const restore = () => {
      if (restored.current) return
      const value = desired.current
      element.scrollTop = value.top; element.scrollLeft = value.left
      if (element.scrollHeight - element.clientHeight >= value.top && element.scrollWidth - element.clientWidth >= value.left) restored.current = true
    }
    const save = () => { if (restored.current) write(key, { top: element.scrollTop, left: element.scrollLeft }) }
    const takeOver = () => { restored.current = true }
    const observer = new MutationObserver(restore)
    observer.observe(element, { childList: true, subtree: true })
    const resize = new ResizeObserver(restore)
    resize.observe(element); if (element.firstElementChild) resize.observe(element.firstElementChild)
    restore()
    element.addEventListener('scroll', save, { passive: true }); element.addEventListener('wheel', takeOver, { passive: true }); element.addEventListener('pointerdown', takeOver)
    const dispose = () => { save(); observer.disconnect(); resize.disconnect(); element.removeEventListener('scroll', save); element.removeEventListener('wheel', takeOver); element.removeEventListener('pointerdown', takeOver) }
    cancel.current = dispose
    return dispose
  }, [key, ready])
  return { ref: setRef, offset: read(key) }
}
