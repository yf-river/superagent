/** 任务看板、创建表单和详情；完整执行过程由 DSH 会话呈现。 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { DndContext, DragOverlay, MouseSensor, TouchSensor, KeyboardSensor, useSensor, useSensors, useDroppable, pointerWithin, closestCenter, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Virtuoso, GroupedVirtuoso } from 'react-virtuoso'
import { AlertTriangle, Target, Zap, Circle, Plus, MoreHorizontal, ListFilter, SlidersHorizontal, Columns3, List, Search, ArrowLeft, PanelRight, Check, Paperclip, FileText, Download, Eye } from 'lucide-react'
import { Button, Choice, Menu, Modal, ColumnMenu } from './multica/controls.tsx'
import { StatusIcon } from './multica/status-icon.tsx'
import { PortalScope, useDarkTheme } from './multica/portal.tsx'
import { useBoardDragPan } from './multica/use-board-drag-pan.ts'
import { useScrollMemory } from './multica/scroll-memory.ts'
import { ContentEditor } from './multica/editor.tsx'
import MULTICA_STYLES from './multica/generated.css?raw'
import FONT_STYLES from './multica/fonts.css?raw'

import type { TaskAsset, TaskCreate, TaskDetail, TaskList, TaskStage, TaskStrategy, TaskView } from '../app/task-model.ts'
import { TASK_STAGES } from '../app/task-model.ts'
import { Icon, Input } from './controls.tsx'
import { usePoll } from './api.ts'
import type { T } from './text.ts'
import { taskCaller, type ApiTransport, type TaskCall } from './task-api.ts'
import STYLES from './client.css?raw'
import TASK_STYLES from './tasks.css?raw'

const taskHash = () => window.location.hash.match(/^#superagent\/tasks\/([a-f0-9-]{36})$/)?.[1]
const activeStages: TaskStage[] = TASK_STAGES.filter(stage => stage !== 'cancelled')
const date = (value: string) => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const titleOf = (t: T, stage: TaskStage) => t(`task.stage.${stage}`)
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
const folderName = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) || path
interface Directory { id: string; path: string; title: string }
type DraggedTask = Pick<TaskView, 'id' | 'revision' | 'stage'>
type Move = (task: DraggedTask, stage: TaskStage) => Promise<void>
type Scope = 'all' | 'waiting' | 'review'
interface Preferences { scope: Scope; view: 'board' | 'list'; q: string; directory: string; summaries: boolean; hidden: TaskStage[]; order?: string[] }
function readPreferences(): Preferences {
  try { const value = JSON.parse(sessionStorage.getItem('superagent/tasks') ?? '{}'); return { scope: value.scope === 'waiting' || value.scope === 'review' ? value.scope : 'all', view: value.view === 'list' ? 'list' : 'board', q: value.q ?? '', directory: value.directory ?? '', summaries: value.summaries ?? true, hidden: (value.hidden ?? []).filter((stage: TaskStage) => activeStages.includes(stage)), order: value.order ?? [] } }
  catch (error) { void error; return { scope:'all', view: 'board', q: '', directory: '', summaries: true, hidden: [] } }
}
function Styles() { return <><style>{STYLES}</style><style>{MULTICA_STYLES}</style><style>{FONT_STYLES}</style><style>{TASK_STYLES}</style></> }
async function encoded(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ''
  for (let at = 0; at < bytes.length; at += 32768) binary += String.fromCharCode(...bytes.subarray(at, at + 32768))
  return btoa(binary)
}

function Uploads({ t, call, assets, onChange, onBusy, incoming, disabled = false }: { t: T; call: TaskCall; assets: TaskAsset[]; onChange: (assets: TaskAsset[]) => void; onBusy: (busy: boolean) => void; incoming?: File[]; disabled?: boolean }) {
  const [error, setError] = useState(''), [uploading, setUploading] = useState(false), input = useRef<HTMLInputElement>(null)
  const upload = async (files: FileList | File[] | null) => {
    if (!files?.length) return
    setError(''); setUploading(true); onBusy(true)
    const added: TaskAsset[] = []
    try { for (const file of Array.from(files)) added.push(await call<TaskAsset>('POST', 'task-assets', { name: file.name, mediaType: file.type, data: await encoded(file) })) }
    catch (failure) { setError(message(failure)) }
    finally { onChange([...assets, ...added]); setUploading(false); onBusy(false) }
  }
  useEffect(() => { if (incoming?.length) void upload(incoming) }, [incoming])
  return <div className="st-uploads">
    <Button size="sm" variant="outline" icon={<Paperclip className="size-3.5"/>} disabled={disabled || uploading} onClick={() => input.current?.click()}>{uploading ? t('task.uploading') : t('task.attach')}</Button>
    <input ref={input} aria-label={t('task.attach')} className="st-file-input" type="file" multiple disabled={disabled || uploading}
      onChange={event => { void upload(event.target.files); event.target.value = '' }}/>
    {assets.map(asset => <span className="st-attachment" key={asset.id}>{asset.ref.name ?? asset.id}<Button size="sm" disabled={disabled || uploading}
      aria-label={t('task.removeAttachment', { name: asset.ref.name ?? asset.id })} onClick={() => onChange(assets.filter(item => item.id !== asset.id))}><Icon name="close" size={12}/></Button></span>)}
    {error && <p role="alert" className="dt-error">{error}</p>}
  </div>
}

function TaskForm({ t, call, directories, initial, defaults, onClose, onSaved }: { t: T; call: TaskCall; directories: Directory[]; initial?: TaskDetail; defaults: { directory: string }; onClose: () => void; onSaved: (id: string) => void }) {
  const [title, setTitle] = useState(initial?.title ?? ''), [description, setDescription] = useState(initial?.description ?? ''), [directory, setDirectory] = useState(initial?.directory ?? defaults.directory)
  const [strategy, setStrategy] = useState<TaskStrategy>(initial?.strategy ?? 'auto')
  const [assets, setAssets] = useState<TaskAsset[]>(initial?.attachments.filter(asset => initial.assets.includes(asset.id)) ?? []), [files, setFiles] = useState<File[]>()
  const [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false), [error, setError] = useState(''), [advanced, setAdvanced] = useState(false)
  const requestId = useRef(crypto.randomUUID()), submitted = useRef(false)
  const changed = () => { requestId.current = crypto.randomUUID() }
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (submitted.current || uploading) return
    if (!title.trim() || !description.trim() || !directory.trim()) { setError(t('task.requiredFields')); return }
    submitted.current = true; setBusy(true); setError('')
    const body: TaskCreate = { requestId: requestId.current, title, description, directory, strategy, assets: assets.map(asset => asset.id) }
    try { const value = await call<TaskDetail>(initial ? 'PUT' : 'POST', initial ? `tasks/${initial.id}` : 'tasks', initial ? { ...body, revision: initial.revision } : body); onSaved(value.id) }
    catch (failure) { setError(message(failure)) }
    finally { submitted.current = false; setBusy(false) }
  }
  const close = () => { if (!busy && !uploading) onClose() }
  return <Modal onClose={close} title={initial ? t('task.edit') : t('task.create')} closeLabel={t('close')} disabled={busy || uploading} className="st-form-modal max-w-2xl">
    <form onSubmit={event => { void submit(event) }} className="st-form flex min-h-0 flex-1 flex-col" onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); event.currentTarget.requestSubmit() } }}>
      <fieldset disabled={busy} className="flex min-h-0 flex-1 flex-col border-0 p-0">
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pt-4">
          <input className="st-title-input w-full bg-transparent text-title-lg font-medium outline-none" required maxLength={200} aria-label={t('task.title')} placeholder={t('task.titlePlaceholder')} value={title} onChange={event => { setTitle(event.target.value); changed() }}/>
          <div className="mt-3 flex-1"><ContentEditor t={t} value={description} label={t('task.description')} placeholder={t('task.descriptionPlaceholder')} disabled={busy} onFiles={setFiles} onChange={value => { setDescription(value); changed() }}/></div>
          {advanced && <label className="my-3 flex items-center gap-3 text-caption text-muted-foreground">{t('task.executionMode')}<Choice disabled={!!initial?.sessionId || !!initial?.preparation?.execution || (!!initial?.preparation && initial.preparation.state !== 'error')} label={t('task.executionMode')} value={strategy} onChange={value=>{setStrategy(value);changed()}} options={(['auto','shared','worktree'] as const).map(value=>({value,label:t(`task.strategy.${value}`)}))}/></label>}
          {error && <p className="st-error" role="alert">{error}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <label className="st-directory-picker flex max-w-full items-center gap-1 rounded-md border px-2 py-1 text-caption"><Icon name="folder" size={13}/><input required disabled={!!initial?.sessionId || !!initial?.preparation?.execution || (!!initial?.preparation && initial.preparation.state !== 'error')} list="st-directories" className="min-w-0 max-w-52 bg-transparent outline-none" aria-label={t('task.projectDirectory')} value={directory} placeholder={t('task.projectDirectory')} onChange={event=>{setDirectory(event.target.value);changed()}}/></label>
          <datalist id="st-directories">{directories.map(item => <option value={item.path} key={item.id}>{item.title}</option>)}</datalist>
        </div>
        <div className="flex items-center justify-between gap-3 border-t px-4 py-3"><div className="flex min-w-0 items-center gap-2"><Uploads t={t} call={call} assets={assets} incoming={files} onChange={next => { setAssets(next); changed() }} onBusy={setUploading}/>
          <Button aria-label={t('task.advanced')} aria-expanded={advanced} onClick={()=>setAdvanced(!advanced)}><MoreHorizontal className="size-4"/></Button></div>
          <Button type="submit" variant="primary" disabled={busy || uploading}>{busy ? t('task.saving') : t('task.saveDraft')}</Button>
        </div>
      </fieldset>
      <p className="px-4 pb-3 text-micro text-muted-foreground">{t('task.draftHint')}</p>
    </form>
  </Modal>
}

function Card({ task, t, summaries = true, busy, onOpen, onAction, overlay = false }: { task: TaskView; t: T; summaries?: boolean; busy: boolean; onOpen: () => void; onAction: (task: TaskView, action: string) => void; overlay?: boolean }) {
  return <article className="group/card" data-stage={task.stage}>
    <a className="st-card block rounded-lg border-[0.5px] border-surface-border bg-surface px-2.5 py-3 shadow-[var(--surface-shadow)] transition-colors hover:border-foreground/15 hover:bg-surface-hover"
      href={`#superagent/tasks/${task.id}`} tabIndex={overlay ? -1 : 0} onClick={event => { event.preventDefault(); if (!overlay) onOpen() }}>
      <div className="flex items-center justify-between gap-2"><div className="flex min-w-0 items-center gap-1.5">
        <p className="truncate text-caption text-muted-foreground">{task.id.slice(0, 8).toUpperCase()}</p></div>
        {task.stage === 'working' && <span className="st-running-dot" aria-label={titleOf(t, task.stage)}/>}</div>
      <p className="mt-1 line-clamp-2 text-body font-medium leading-snug">{task.title}</p>
      {summaries && (task.question || task.summary || task.description) && <p className="mt-1 line-clamp-1 text-caption text-muted-foreground">{(task.question || task.summary || task.description).replace(/[#*`>]/g, '')}</p>}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5"><span className="inline-flex max-w-[160px] items-center gap-1 rounded-full bg-muted/60 px-1.5 py-0.5 text-micro text-muted-foreground" title={task.directory}><Icon name="folder" size={12}/><span className="truncate">{folderName(task.directory)}</span></span></div>
      {(task.preparation?.state === 'routing' || task.preparation?.state === 'preparing') && <p role="status" className="mt-2 text-caption text-muted-foreground">{t('task.preparing')}</p>}
      {task.preparation?.state === 'error' && <p className="mt-2 text-caption text-destructive">{task.preparation.error}</p>}
      {task.waitingForWorker && <p className="mt-2 text-caption text-muted-foreground">{t('task.queued')}</p>}
      <div className="mt-2 flex items-center justify-between gap-2 text-caption text-muted-foreground"><span>{task.attentionKind ? t(`task.attention.${task.attentionKind}`) : titleOf(t, task.stage)}</span>
        <time dateTime={task.updatedAt}>{date(task.updatedAt)}</time>
      </div>
    </a>
  </article>
}

/** 逐页读取用户展开的范围，每次请求遵守服务端页大小。 */
type CardProps = Parameters<typeof Card>[0]
function DraggableCard(props: CardProps & { order: string[] }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.task.id, data: { task: props.task, stage: props.task.stage, order: props.order }, disabled: props.busy })
  return <div ref={setNodeRef} data-board-card="" style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? .3 : 1, touchAction: 'pan-y' }} {...attributes} {...listeners}><Card {...props}/></div>
}
function MoreTasks({ onMore }: { onMore: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current) return
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) onMore() }, { rootMargin: '100px' })
    observer.observe(ref.current); return () => observer.disconnect()
  }, [onMore])
  return <div ref={ref} className="h-8"/>
}

async function taskPage(call: TaskCall, query: URLSearchParams, wanted: number): Promise<TaskList> {
  const result: TaskView[] = []; let offset = 0; let page: TaskList
  do {
    const params = new URLSearchParams(query); params.set('offset', String(offset)); params.set('limit', String(Math.min(200, wanted - result.length)))
    page = await call<TaskList>('GET', `tasks?${params}`); result.push(...page.items)
    if (page.nextOffset === undefined) break
    offset = page.nextOffset
  } while (result.length < wanted)
  return { ...page!, items: result }
}

function TaskLane({ stage, t, call, prefs, version, busy, canHide, onOpen, onCreate, onHide, onAction }: { stage: TaskStage; t: T; call: TaskCall; prefs: Preferences; version: number; busy: boolean; canHide: boolean; onOpen: (id: string) => void; onCreate: () => void; onHide: () => void; onAction: (task: TaskView, action: string) => void }) {
  const [limit, setLimit] = useState(60), [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  const query = new URLSearchParams({ q: prefs.q, directory: prefs.directory, stage })
  const queryKey = query.toString()
  useEffect(() => setLimit(60), [queryKey])
  const { data, error } = usePoll(() => taskPage(call, query, limit), [call, queryKey, limit, version])
  const { setNodeRef, isOver } = useDroppable({ id: stage, data: { stage } })
  const scroll = useScrollMemory<HTMLDivElement>(`board/${queryKey}`, !!data)
  const mergeRef = useCallback((element: HTMLDivElement | null) => { setNodeRef(element); setScrollEl(element); scroll.ref(element) }, [setNodeRef, scroll.ref])
  const more = useCallback(() => setLimit(value => value + 60), [])
  const items = useMemo(() => {
    const order = prefs.order ?? [], rank = new Map(order.map((id,index)=>[id,index]))
    return [...(data?.items ?? [])].sort((a,b)=>(rank.get(a.id) ?? 100000)-(rank.get(b.id) ?? 100000))
  }, [data,prefs.order])
  const card = (task: TaskView) => <DraggableCard order={items.map(item=>item.id)} key={task.id} task={task} t={t} summaries={prefs.summaries} busy={busy} onOpen={() => onOpen(task.id)} onAction={onAction}/>
  const footer = data?.nextOffset !== undefined ? <MoreTasks onMore={more}/> : null
  return <section className={`st-column st-column-${stage} flex w-[280px] shrink-0 flex-col rounded-xl p-2`} aria-label={titleOf(t, stage)}>
    <header className="mb-2 flex h-7 shrink-0 items-center justify-between px-1.5"><div className="flex items-center gap-2"><span className="inline-flex items-center gap-1.5 text-caption font-medium"><StatusIcon stage={stage} className="size-3"/>{titleOf(t, stage)}</span><span className="text-caption text-muted-foreground">{data?.counts[stage] ?? '–'}</span></div>
      <div className="flex items-center gap-1"><ColumnMenu label={t('task.columnMenu', { stage: titleOf(t, stage) })} t={t} disabled={!canHide} onHide={onHide}/>
        {stage === 'draft' && <Button size="sm" aria-label={t('task.create')} className="size-6 rounded-full p-0 text-muted-foreground" onClick={() => onCreate()}><Plus className="size-3.5"/></Button>}</div>
    </header>
    <div className="relative min-h-[200px] flex-1 rounded-lg"><div ref={mergeRef} data-scroll-column={stage} className={`absolute inset-0 overflow-y-auto rounded-lg p-1 transition-colors ${isOver ? 'bg-accent/60' : ''}`}>
      {error && <p role="alert" className="st-error">{error.message}</p>}{!data && !error && <p className="py-8 text-center text-caption text-muted-foreground">{t('loading')}</p>}
      {data && <SortableContext items={items.map(task => task.id)} strategy={verticalListSortingStrategy}>
        {items.length > 30 && scrollEl ? <Virtuoso customScrollParent={scrollEl} data={items} computeItemKey={(_i, task) => task.id} initialScrollTop={scroll.offset.top} initialItemCount={Math.min(items.length,10)} defaultItemHeight={140} increaseViewportBy={{top:300,bottom:300}}
          components={{Footer:() => footer}} itemContent={(index, task) => <div className={index ? 'pt-2' : ''}>{card(task)}</div>}/>
          : <><div className="space-y-2">{items.map(card)}</div>{!items.length && <p className="py-8 text-center text-caption text-muted-foreground">{t('task.emptyColumn')}</p>}{footer}</>}
      </SortableContext>}
    </div></div>
  </section>
}
function TaskBoard({ children, t, busy, onMove, onOrder }: { children: ReactNode; t: T; busy: boolean; onMove: Move; onOrder: (order:string[])=>void }) {
  const pan = useBoardDragPan<HTMLElement>(), scroll = useScrollMemory<HTMLElement>('board-horizontal')
  const ref = useCallback((element: HTMLElement | null) => { pan.ref.current = element; scroll.ref(element) }, [pan.ref, scroll.ref])
  const [dragged, setDragged] = useState<TaskView>()
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 5 } }), useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, arrayMove }))
  const end = (event: DragEndEvent) => {
    setDragged(undefined)
    const task = event.active.data.current?.task as TaskView | undefined, target = event.over?.data.current as {stage?:TaskStage} | undefined
    if (!task || !target?.stage || busy) return
    if (task.stage === target.stage) {
      const order = event.active.data.current?.order as string[] | undefined
      if (order && event.over && event.over.id !== task.id) {
        const from=order.indexOf(task.id), to=order.indexOf(String(event.over.id))
        if(from>=0 && to>=0) onOrder(arrayMove(order,from,to))
      }
      return
    }
    void onMove(task, target.stage)
  }
  return <DndContext sensors={sensors} collisionDetection={args => { const collisions = pointerWithin(args); const cards=collisions.filter(hit=>args.droppableContainers.find(container=>container.id===hit.id)?.data.current?.task); return cards.length?cards:collisions.length?collisions:closestCenter(args) }}
    onDragStart={event => setDragged(event.active.data.current?.task as TaskView)} onDragEnd={end} onDragCancel={() => setDragged(undefined)}>
    <main {...pan} ref={ref} className={`st-board flex min-h-0 flex-1 gap-4 overflow-x-auto p-2 ${dragged ? 'st-dragging' : ''}`} aria-label={t('task.board')}>{children}</main>
    <DragOverlay dropAnimation={null}>{dragged && <div className="w-[256px] cursor-grabbing"><Card task={dragged} t={t} summaries busy overlay onOpen={() => {}} onAction={() => {}}/></div>}</DragOverlay>
  </DndContext>
}
function Opening({ id, t, call, openSession, onClose }: { id: string; t: T; call: TaskCall; openSession: (id: string) => Promise<void>; onClose: () => void }) {
  const { data, error, reload } = usePoll(() => call<TaskDetail>('GET', `tasks/${id}`), [call,id])
  const [failure, setFailure] = useState(''), opened = useRef(false)
  useEffect(() => { if (data?.sessionId && !opened.current) { opened.current = true; void openSession(data.sessionId).then(onClose).catch(error => { opened.current = false; setFailure(message(error)) }) } }, [data?.sessionId, openSession, onClose])
  const retry = async () => { if (!data) return; setFailure(''); try { await call('POST', `tasks/${id}/prepare`, { requestId: crypto.randomUUID(), revision: data.revision }); await reload() } catch(error) { setFailure(message(error)) } }
  return <Modal title={t('task.openConversation')} closeLabel={t('close')} onClose={onClose}><div className="space-y-3 p-5"><p role="status">{data?.preparation?.state === 'error' ? data.preparation.error : t('task.preparing')}</p>{(error || failure) && <p role="alert">{failure || error?.message}</p>}{data?.preparation?.state === 'error' && <Button onClick={() => { void retry() }}>{t('task.retry')}</Button>}</div></Modal>
}
export function TaskPanel({ t, transport, openSession, onSettings }: { t: T; transport: ApiTransport; openSession: (id: string) => Promise<void>; onSettings: () => void }) {
  const call = useMemo(() => taskCaller(transport), [transport]), dark = useDarkTheme()
  const [prefs, setPrefs] = useState(readPreferences), [version, setVersion] = useState(0), [creating, setCreating] = useState(false), [opening, setOpening] = useState<string>(), [busy, setBusy] = useState(false), [failure, setFailure] = useState('')
  const [stage,setStage] = useState<TaskStage>(), [limit,setLimit] = useState(50), [debounced,setDebounced] = useState(prefs.q)
  const selectedStage = stage ?? (prefs.scope === 'waiting' ? 'waiting' : prefs.scope === 'review' ? 'review' : undefined)
  useEffect(()=>{const timer=setTimeout(()=>setDebounced(prefs.q),250);return()=>clearTimeout(timer)},[prefs.q])
  const running = useRef(false)
  useEffect(() => { sessionStorage.setItem('superagent/tasks', JSON.stringify(prefs)) }, [prefs])
  const { data, error, reload } = usePoll(() => taskPage(call, new URLSearchParams({ q: debounced, directory: prefs.directory, ...(selectedStage ? {stage:selectedStage} : {}) }), limit), [call,debounced,prefs.directory,selectedStage,limit,version])
  const { data: directories } = usePoll(() => call<Directory[]>('GET','task-directories'), [call])
  const changed = async () => { setVersion(value => value + 1); await reload() }
  const open = async (id: string) => {
    if (running.current) return; running.current = true; setBusy(true); setFailure('')
    try { const task = await call<TaskDetail>('GET',`tasks/${id}`); if (task.sessionId) await openSession(task.sessionId)
      else { await call('POST',`tasks/${id}/prepare`,{requestId:crypto.randomUUID(),revision:task.revision}); setOpening(id) } }
    catch(error) { setFailure(message(error)) } finally { running.current = false; setBusy(false) }
  }
  useEffect(() => { const id = taskHash(); if (id) { void open(id); history.replaceState(history.state,'',location.pathname+location.search+'#superagent') } }, [])
  const mutate = async (task: DraggedTask, action: string) => {
    if (running.current) return; running.current = true; setBusy(true); setFailure('')
    try { await call('POST',`tasks/${task.id}/${action}`,{requestId:crypto.randomUUID(),revision:task.revision}); await changed() }
    catch(error) { setFailure(message(error)); await changed() } finally { running.current = false; setBusy(false) }
  }
  const move: Move = async (task, target) => {
    const action = task.stage === 'draft' && target === 'working' ? 'start' : task.stage === 'review' && target === 'done' ? 'confirm' : ['done','cancelled'].includes(task.stage) && target === 'draft' ? 'reopen' : target === 'cancelled' ? 'cancel' : undefined
    if (!action) { setFailure(t('task.invalidMove')); return } await mutate(task,action)
  }
  const create = () => setCreating(true)
  const visibleStages = selectedStage ? [selectedStage] : activeStages.filter(stage=>!prefs.hidden.includes(stage))
  const filterCount = Number(!!prefs.directory) + Number(!!stage)
  const lanePrefs = {...prefs,q:debounced}
  return <PortalScope><div className={`st-ui st-page ${dark ? 'dark' : ''}`}><Styles/><div className="st-overview">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4"><h1 className="flex items-center gap-2 text-body font-medium"><Icon name="list" size={16}/>{t('task.heading')}</h1>
        <div className="flex items-center gap-2"><Button icon={<SlidersHorizontal className="size-3.5"/>} onClick={onSettings}>{t('task.settings')}</Button><Button variant="primary" icon={<Plus className="size-3.5"/>} onClick={()=>create()}>{t('task.create')}</Button></div>
      </header>
      <div className="st-toolbar flex min-h-12 shrink-0 items-center justify-between gap-3 px-4 py-2">
        <div className="flex items-center gap-1" role="group" aria-label={t('task.quickViews')}>{(['all','waiting','review'] as const).map(value=><Button key={value} aria-pressed={prefs.scope===value && !stage} className={prefs.scope===value && !stage?'bg-muted/60':''} onClick={()=>{setStage(undefined);setLimit(50);setPrefs({...prefs,scope:value})}}>{t(value==='all'?'task.viewAll':value==='waiting'?'task.viewWaiting':'task.viewReview')}{value!=='all' && <span className="text-micro text-muted-foreground">{data?.counts[value]??'–'}</span>}</Button>)}</div>
        <div className="st-toolbar-right flex items-center gap-1">
          <span className="st-running flex items-center gap-1.5 rounded-md border px-2 py-1 text-caption text-muted-foreground"><span className={`size-1.5 rounded-full ${data?.counts.working?'bg-success':'bg-faint-foreground'}`}/>{t('task.runningCount',{count:data?.counts.working??0})}</span>
          <Menu compact label={t('task.search')} icon={<Search className="size-3.5"/>}><Input aria-label={t('task.search')} placeholder={t('task.search')} value={prefs.q} onChange={event=>{setLimit(50);setPrefs({...prefs,q:event.target.value})}}/></Menu>
          <Menu label={`${t('task.filter')}${filterCount?` · ${filterCount}`:''}`} icon={<ListFilter className="size-3.5"/>}>
            <label className="st-menu-field">{t('task.directoryFilter')}<Choice label={t('task.directoryFilter')} value={prefs.directory} onChange={value=>{setLimit(50);setPrefs({...prefs,directory:value})}} options={[{value:'',label:t('task.allDirectories')},...(directories??[]).map(item=>({value:item.path,label:item.title}))]}/></label>
            <label className="st-menu-field">{t('task.statusFilter')}<Choice label={t('task.statusFilter')} value={stage??''} onChange={value=>{setLimit(50);setStage(value ? value as TaskStage : undefined)}} options={[{value:'',label:t('task.activeTasks')},...TASK_STAGES.map(value=>({value,label:titleOf(t,value)}))]}/></label>
            <Button onClick={()=>{setStage(undefined);setLimit(50);setPrefs({...prefs,q:'',directory:'',scope:'all'})}}>{t('task.clearFilters')}</Button>
          </Menu>
          <Menu label={t('task.display')} icon={<SlidersHorizontal className="size-3.5"/>}>
            <label className="st-check"><input type="checkbox" checked={prefs.summaries} onChange={event=>setPrefs({...prefs,summaries:event.target.checked})}/>{t('task.showSummary')}</label>
            <h3 className="mt-2 text-caption text-muted-foreground">{t('task.columns')}</h3>{activeStages.map(value=><label className="st-check" key={value}><input type="checkbox" checked={!prefs.hidden.includes(value)} disabled={!prefs.hidden.includes(value)&&prefs.hidden.length===activeStages.length-1} onChange={event=>setPrefs({...prefs,hidden:event.target.checked?prefs.hidden.filter(item=>item!==value):[...prefs.hidden,value]})}/><StatusIcon stage={value}/>{titleOf(t,value)}</label>)}
          </Menu>
          <Choice label={t('task.display')} value={prefs.view} onChange={value=>setPrefs({...prefs,view:value})} options={[{value:'board',label:t('task.board'),icon:<Columns3 className="size-3.5"/>},{value:'list',label:t('task.list'),icon:<List className="size-3.5"/>}]}/>
        </div>
      </div>
      {prefs.q && <div className="flex items-center gap-2 px-4 pb-2 text-caption text-muted-foreground"><Search className="size-3.5"/>{prefs.q}<Button size="sm" aria-label={t('task.clearFilters')} onClick={()=>setPrefs({...prefs,q:''})}><Icon name="close" size={12}/></Button></div>}
      {failure && <p role="alert" className="st-error">{failure}</p>}{error && <p role="alert" className="st-error">{error.message}<Button onClick={()=>{void reload()}}>{t('task.refresh')}</Button></p>}
      {!data && !error && <p role="status" className="p-6 text-caption text-muted-foreground">{t('loading')}</p>}
    {prefs.view === 'board' ? <TaskBoard t={t} busy={busy} onMove={move} onOrder={order=>setPrefs({...prefs,order})}>{visibleStages.map(stage=><TaskLane key={stage} stage={stage} t={t} call={call} prefs={lanePrefs} version={version} canHide={!selectedStage && visibleStages.length>1} onHide={()=>setPrefs({...prefs,hidden:[...prefs.hidden,stage]})} busy={busy} onOpen={id=>{void open(id)}} onCreate={()=>setCreating(true)} onAction={(task,action)=>{void mutate(task,action)}}/>)}</TaskBoard> : <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">{data?.items.map(task=><Card key={task.id} task={task} t={t} busy={busy} onOpen={()=>{void open(task.id)}} onAction={(task,action)=>{void mutate(task,action)}}/>)}{data?.nextOffset!==undefined && <Button onClick={()=>setLimit(limit+50)}>{t('loadMore')}</Button>}</div>}
    </div>
    {creating && <TaskForm t={t} call={call} directories={directories ?? []} defaults={{directory:prefs.directory}} onClose={()=>setCreating(false)} onSaved={()=>{setCreating(false);void changed()}}/>}
    {opening && <Opening id={opening} t={t} call={call} openSession={openSession} onClose={()=>setOpening(undefined)}/>}
  </div></PortalScope>
}

/** 关联任务的普通 DSH 会话操作；聊天正文使用原生会话界面。 */
export function TaskConversation({ sessionId, t, transport, back, placement = 'header' }: { sessionId?: string; t: T; transport: ApiTransport; back: () => void; placement?: 'hero' | 'header' }) {
  const call = useMemo(()=>taskCaller(transport),[transport]), dark = useDarkTheme()
  const { data, reload } = usePoll(()=>sessionId ? call<TaskDetail | null>('GET',`task-session/${encodeURIComponent(sessionId)}`) : Promise.resolve(null),[call,sessionId])
  const [busy,setBusy] = useState(false), [failure,setFailure] = useState(''), [editing,setEditing] = useState(false)
  const request = useRef(false)
  if (!data) return null
  const run = async (action: string) => { if(request.current)return;request.current=true;setBusy(true);setFailure('');try {await call('POST',`tasks/${data.id}/${action}`,{requestId:crypto.randomUUID(),revision:data.revision});await reload()}catch(error){setFailure(message(error));await reload()}finally{request.current=false;setBusy(false)} }
  const actions = () => <>
    {data.phase === 'draft' && <><Button disabled={busy} variant="primary" onClick={()=>{void run('start')}}>{t('task.start')}</Button><Button onClick={()=>setEditing(true)}>{t('task.edit')}</Button></>}
    {data.stage === 'review' && <Button disabled={busy} onClick={()=>{void run('confirm')}}>{t('task.confirmDone')}</Button>}
    {data.retryable && <Button disabled={busy} onClick={()=>{void run('retry')}}>{t('task.retry')}</Button>}
    {['done','cancelled'].includes(data.phase) ? <Button disabled={busy} onClick={()=>{void run('reopen')}}>{t('task.reopen')}</Button> : <Button disabled={busy} onClick={()=>{void run('cancel')}}>{t('task.cancelTask')}</Button>}
  </>
  return <PortalScope><div className={`st-ui st-task-conversation st-task-${placement} ${dark?'dark':''}`}><Styles/><div className="st-task-controls">
    <Button onClick={back} aria-label={t('task.backToTasks')}><ArrowLeft size={14}/><span className="st-task-back-label">{t('task.backToTasks')}</span></Button>
    {placement==='hero' && <span className="st-task-title" title={data.title}>{data.title}</span>}
    <span className="st-task-stage">{titleOf(t,data.stage)}</span>
    <div className="st-task-actions">{actions()}</div>
    <div className="st-task-menu"><Menu label={t('task.actions')} icon={<MoreHorizontal size={14}/>}><div className="flex flex-col items-stretch gap-1">{actions()}</div></Menu></div>
    {failure && <span role="alert">{failure}</span>}
  </div>{editing && <TaskForm t={t} call={call} initial={data} directories={[]} defaults={{directory:data.directory}} onClose={()=>setEditing(false)} onSaved={()=>{setEditing(false);void reload()}}/>}</div></PortalScope>
}
