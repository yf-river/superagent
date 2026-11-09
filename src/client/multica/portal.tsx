/** 将 Base UI 浮层放在独立的样式作用域，避免继承或修改 DSH 的页面样式。 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
const Container = createContext<HTMLElement | null>(null)
export const usePortalContainer = () => useContext(Container)
export function useDarkTheme() {
  const [dark, setDark] = useState(() => document.body.hasAttribute('data-ds-dark-theme'))
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(document.body.hasAttribute('data-ds-dark-theme')))
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    return () => observer.disconnect()
  }, [])
  return dark
}
export function PortalScope({ children }: { children: ReactNode }) {
  const [element, setElement] = useState<HTMLElement | null>(null)
  const dark = useDarkTheme()
  useEffect(() => {
    const root = document.createElement('div')
    root.className = 'st-ui st-portals'
    document.body.append(root); setElement(root)
    return () => root.remove()
  }, [])
  useEffect(() => { element?.classList.toggle('dark', dark) }, [element, dark])
  return <Container.Provider value={element}>{children}</Container.Provider>
}
