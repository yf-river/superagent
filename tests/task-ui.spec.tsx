// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useScrollMemory } from '../src/client/multica/scroll-memory.ts'
import { useBoardDragPan } from '../src/client/multica/use-board-drag-pan.ts'
import { cn } from '../src/client/multica/utils.ts'
import { PortalScope } from '../src/client/multica/portal.tsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
beforeEach(() => vi.stubGlobal('ResizeObserver',class { observe(){} disconnect(){} }))
afterEach(()=>{vi.unstubAllGlobals();sessionStorage.clear()})
function mount(component: React.ReactNode) {
  const container=document.createElement('div');document.body.append(container);const root=createRoot(container)
  act(()=>root.render(component))
  return {container,dispose:()=>{act(()=>root.unmount());container.remove()}}
}
it('keeps semantic text sizes and text colors together when merging Multica classes',()=>{
  expect(cn('text-body text-primary-foreground','text-caption')).toBe('text-primary-foreground text-caption')
})
it('restores delayed content and lets a new user gesture take over the scroll position',()=>{
  const key=crypto.randomUUID();sessionStorage.setItem(`superagent/scroll/${key}`,JSON.stringify({top:420,left:70}))
  let setReady:(value:boolean)=>void=()=>{}
  function Harness(){const[ready,change]=useState(false);setReady=change;const scroll=useScrollMemory<HTMLDivElement>(key,ready);return <div ref={scroll.ref}/>}
  const view=mount(<Harness/>),element=view.container.firstElementChild as HTMLDivElement
  Object.defineProperties(element,{scrollHeight:{get:()=>2000},clientHeight:{get:()=>400},scrollWidth:{get:()=>800},clientWidth:{get:()=>400}})
  act(()=>setReady(true));expect(element.scrollTop).toBe(420);expect(element.scrollLeft).toBe(70)
  act(()=>{element.dispatchEvent(new WheelEvent('wheel'));element.scrollTop=600;element.dispatchEvent(new Event('scroll'))})
  view.dispose();expect(JSON.parse(sessionStorage.getItem(`superagent/scroll/${key}`)!)).toEqual({top:600,left:70})
})
it('pans only the horizontal axis after the activation distance and releases selection suppression',()=>{
  function Harness(){const pan=useBoardDragPan<HTMLDivElement>();return <div {...pan}><button>control</button><span>blank</span></div>}
  const view=mount(<Harness/>),el=view.container.firstElementChild as HTMLDivElement
  Object.defineProperties(el,{scrollWidth:{value:1000},clientWidth:{value:300},setPointerCapture:{value:vi.fn()},releasePointerCapture:{value:vi.fn()}})
  const pointer=(target:Element,type:string,x:number,buttons=1)=>{const event=new MouseEvent(type,{bubbles:true,button:0,buttons,clientX:x,clientY:100,cancelable:true});Object.defineProperties(event,{pointerId:{value:1},pointerType:{value:'mouse'}});act(()=>target.dispatchEvent(event))}
  el.scrollLeft=200;el.scrollTop=50
  pointer(el.querySelector('button')!,'pointerdown',200);pointer(el,'pointermove',100);expect(el.scrollLeft).toBe(200)
  pointer(el.querySelector('span')!,'pointerdown',200);pointer(el,'pointermove',198);expect(el.scrollLeft).toBe(200)
  pointer(el,'pointermove',100);expect(el.scrollLeft).toBe(300);expect(el.scrollTop).toBe(50);expect(el.style.userSelect).toBe('none')
  pointer(el,'pointerup',100,0);expect(el.style.userSelect).toBe('');expect(el.releasePointerCapture).toHaveBeenCalledWith(1)
  view.dispose()
})
it('owns the overlay container and follows the DSH dark theme through unload',async()=>{
  const view=mount(<PortalScope><div/></PortalScope>);expect(document.querySelectorAll('.st-portals')).toHaveLength(1)
  await act(async()=>{document.body.setAttribute('data-ds-dark-theme','');await Promise.resolve()})
  expect(document.querySelector('.st-portals')?.classList.contains('dark')).toBe(true)
  view.dispose();expect(document.querySelector('.st-portals')).toBeNull();document.body.removeAttribute('data-ds-dark-theme')
})
it('starts the associated task from native conversation controls and keeps an action menu for narrow layouts',async()=>{
 const {TaskConversation}=await import('../src/client/tasks.tsx'),{zh}=await import('../src/client/locales.ts'),{translator}=await import('./fixtures/panel.tsx')
 let task={id:'local-task',revision:2,title:'读取文件',description:'只读取',directory:'/project',strategy:'shared',assets:[],phase:'draft',stage:'draft',sessionId:'task-local-task',tickets:[],run:0,events:[],attachments:[],routes:[],retryable:false,waitingForWorker:false,summary:'',createdAt:'',updatedAt:''}
 const transport=vi.fn(async(path:string,method:string,body?:unknown)=>{
  if(method==='POST'){expect(path).toBe('tasks/local-task/start');expect(body).toMatchObject({revision:2});task={...task,revision:3,phase:'submitted',stage:'working'}}
  return new Response(JSON.stringify(task))
 })
 const back=vi.fn(),view=mount(<TaskConversation sessionId="task-local-task" t={translator(zh)} transport={transport} back={back}/> )
 try{
  await act(async()=>{await new Promise(r=>setTimeout(r,30))})
  expect(transport).toHaveBeenCalledWith('task-session/task-local-task','GET',undefined)
  expect(view.container.querySelector('.st-task-menu button')?.textContent).toContain('任务操作')
  const start=[...view.container.querySelectorAll('.st-task-actions button')].find(b=>b.textContent==='开始执行') as HTMLButtonElement
  expect(start).toBeDefined();await act(async()=>{start.click();await new Promise(r=>setTimeout(r,30))})
  expect(view.container.textContent).toContain('进行中');expect(view.container.querySelector('.st-task-actions')?.textContent).not.toContain('开始执行')
 }finally{view.dispose()}
})
